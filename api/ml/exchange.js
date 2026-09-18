import { httpRequest, httpText, cors } from '../_http.js';

// OAuth de Mercado Libre, consolidado en una función para no exceder el
// límite de funciones serverless de Vercel.
//   POST /api/ml/exchange                  -> intercambia code por token (default)
//   POST /api/ml/exchange?action=refresh   -> renueva token con refresh_token
//   POST /api/ml/exchange?action=test      -> prueba el token contra /users/me
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const action = (req.query?.action || req.body?.action || 'exchange').toString();
  try {
    if (action === 'refresh') return await refresh(req, res);
    if (action === 'test') return await test(req, res);
    if (action === 'orders') return await orders(req, res);
    if (action === 'items') return await items(req, res);
    if (action === 'shipstatus') return await shipStatus(req, res);
    if (action === 'topsold') return await topSold(req, res);
    if (action === 'metrics') return await metrics(req, res);
    if (action === 'flexsales') return await flexSales(req, res);
    if (action === 'mptest') return await mpTest(req, res);
    if (action === 'mpdinero') return await mpDinero(req, res);
    if (action === 'mpcobros') return await mpCobros(req, res);
    if (action === 'mpsaldo') return await mpSaldo(req, res);
    if (action === 'mpsaldotest') return await mpSaldoTest(req, res);
    if (action === 'mpsaldoreal') return await mpSaldoReal(req, res);
    return await exchange(req, res);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// Trae las órdenes (ventas) recientes del vendedor con su tipo de envío.
// Body: { token, from } (from = fecha ISO desde la cual traer las ventas).
// Cada orden incluye logisticType para poder EXCLUIR "fulfillment" (Full/bodega ML).
async function orders(req, res) {
  const { token, from } = req.body || {};
  if (!token) return res.status(400).json({ ok: false, error: 'Falta access_token' });
  try {
    const r = await fetchOrdersDetailed(token, from);
    return res.status(200).json({ ok: true, sellerId: r.sellerId, nickname: r.nickname, count: r.orders.length, orders: r.orders });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
}

// Ranking de lo más vendido en un período (para priorizar la carga de medidas,
// fotos y ubicaciones). Cuenta TODAS las ventas: flex, correo y Full.
//
// /orders/search corta en offset 10.000, y un mes puede tener más ventas que
// eso, así que el período se parte en ventanas de 7 días y cada ventana se
// pagina en paralelo (secuencial tardaría minutos y la función se corta).
async function topSold(req, res) {
  const { token, days = 30, limit = 300 } = req.body || {};
  if (!token) return res.status(400).json({ ok: false, error: 'Falta access_token' });
  const auth = { 'Authorization': 'Bearer ' + token };

  const me = await httpRequest('GET', 'https://api.mercadolibre.com/users/me', auth);
  if (me.status !== 200) throw new Error(me.body?.message || ('HTTP ' + me.status));
  const sellerId = me.body.id;

  const pedir = async (desde, hasta, offset) => {
    const url = 'https://api.mercadolibre.com/orders/search'
      + `?seller=${sellerId}&sort=date_desc&limit=50&offset=${offset}`
      + `&order.date_created.from=${encodeURIComponent(desde)}`
      + `&order.date_created.to=${encodeURIComponent(hasta)}`;
    const r = await httpRequest('GET', url, auth);
    if (r.status !== 200) throw new Error(r.body?.message || ('HTTP ' + r.status));
    return r.body;
  };

  const acc = new Map();
  let ordenes = 0, canceladas = 0, truncado = false;
  const sumar = (orders) => {
    for (const o of orders) {
      if (o.status === 'cancelled' || o.status === 'invalid') { canceladas++; continue; }
      ordenes++;
      for (const it of (o.order_items || [])) {
        const mla = it.item?.id || '';
        const sku = it.item?.seller_sku || it.item?.seller_custom_field || '';
        const key = mla || sku;
        if (!key) continue;
        const x = acc.get(key) || { mla, sku, titulo: it.item?.title || '', unidades: 0, ventas: 0 };
        x.unidades += it.quantity || 0;
        x.ventas += 1;
        if (!x.titulo && it.item?.title) x.titulo = it.item.title;
        if (!x.sku && sku) x.sku = sku;
        acc.set(key, x);
      }
    }
  };

  const ahora = Date.now();
  const VENTANA = 7 * 24 * 3600 * 1000;
  for (let ini = ahora - days * 24 * 3600 * 1000; ini < ahora; ini += VENTANA) {
    const desde = new Date(ini).toISOString();
    const hasta = new Date(Math.min(ini + VENTANA, ahora)).toISOString();
    const primera = await pedir(desde, hasta, 0);
    sumar(primera.results || []);
    const total = primera.paging?.total || 0;
    if (total > 10000) truncado = true;
    const tope = Math.min(total, 10000);
    const offsets = [];
    for (let off = 50; off < tope; off += 50) offsets.push(off);
    const CONC = 8;
    for (let i = 0; i < offsets.length; i += CONC) {
      const lote = await Promise.all(offsets.slice(i, i + CONC).map(off => pedir(desde, hasta, off)));
      lote.forEach(b => sumar(b.results || []));
    }
  }

  const top = [...acc.values()].sort((a, b) => b.unidades - a.unidades).slice(0, limit);
  return res.status(200).json({ ok: true, ordenes, canceladas, truncado, publicaciones: acc.size, top });
}

// BÚSQUEDA A FONDO DEL SALDO. El endpoint clásico da 403, pero hay otras
// puertas por las que Mercado Pago informa el dinero de la cuenta, y además
// puede que el problema sean los PERMISOS de la aplicación y no la puerta.
//
// Esto prueba cada candidato con los dos tokens que tenemos (el de ML y el de
// MP) y devuelve exactamente qué contestó cada combinación, para saber por
// dónde entrar en vez de adivinar.
async function mpSaldoTest(req, res) {
  const { token, mpToken } = req.body || {};
  if (!token && !mpToken) return res.status(400).json({ ok: false, error: 'Falta algún token' });

  // De quién es cada token
  const quien = async (tk) => {
    if (!tk) return null;
    try {
      const r = await httpRequest('GET', 'https://api.mercadopago.com/users/me', { 'Authorization': 'Bearer ' + tk });
      return r.status === 200 ? { id: r.body?.id, nickname: r.body?.nickname, scopes: r.body?.scopes || null } : { error: r.status };
    } catch (e) { return { error: e.message }; }
  };
  const deML = await quien(token);
  const deMP = await quien(mpToken);
  const uid = deML?.id || deMP?.id;

  const candidatos = [
    ['balance clásico', `https://api.mercadopago.com/users/${uid}/mercadopago_account/balance`],
    ['balance sin users', 'https://api.mercadopago.com/v1/account/balance'],
    ['balance corto', 'https://api.mercadopago.com/account/balance'],
    ['asset management', 'https://api.mercadopago.com/v1/asset_management/balance'],
    ['wallet', `https://api.mercadopago.com/users/${uid}/wallet/balance`],
    ['account bank report', 'https://api.mercadopago.com/v1/account/bank_report/list'],
    ['release report (lista)', 'https://api.mercadopago.com/v1/account/release_report/list'],
    ['settlement (config)', 'https://api.mercadopago.com/v1/account/settlement_report/config'],
    ['saldo por ML', `https://api.mercadolibre.com/users/${uid}/mercadopago_account/balance`],
  ];

  const probar = async (tk) => {
    if (!tk) return null;
    const salida = {};
    for (const [nombre, url] of candidatos) {
      try {
        const r = await httpRequest('GET', url, { 'Authorization': 'Bearer ' + tk });
        salida[nombre] = {
          estado: r.status,
          anda: r.status >= 200 && r.status < 300,
          respuesta: String(typeof r.body === 'object' ? JSON.stringify(r.body) : r.body ?? '').slice(0, 250),
        };
      } catch (e) {
        salida[nombre] = { estado: 0, anda: false, respuesta: e.message };
      }
    }
    return salida;
  };

  return res.status(200).json({
    ok: true,
    tokenDeML: deML,
    tokenDeMP: deMP,
    conTokenDeML: await probar(token),
    conTokenDeMP: await probar(mpToken),
  });
}

// SALDO REAL de la cuenta de Mercado Pago.
//
// Con el token de ML esto da 403 (probado en las dos cuentas el 18/9): ML y MP
// comparten la cuenta pero no los permisos. Por eso acá se usa el Access Token
// propio de Mercado Pago, que el usuario carga en la ficha de cada cuenta.
//
// Se prueban las dos formas que tiene MP de informarlo, porque cambia según
// cómo esté dada de alta la cuenta.
async function mpSaldo(req, res) {
  const { mpToken, token } = req.body || {};
  const usado = (mpToken || '').trim();
  if (!usado) {
    return res.status(200).json({
      ok: false,
      falta: 'mpToken',
      error: 'Esta cuenta todavía no tiene cargado el Access Token de Mercado Pago.',
    });
  }
  const auth = { 'Authorization': 'Bearer ' + usado };

  // De quién es el token (sirve para avisar si se pegó el de la otra cuenta)
  let userId = null, nickname = null;
  try {
    const u = await httpRequest('GET', 'https://api.mercadopago.com/users/me', auth);
    if (u.status === 200) { userId = u.body?.id ?? null; nickname = u.body?.nickname ?? null; }
  } catch {}

  const intentos = [];
  const probar = async (nombre, url) => {
    try {
      const r = await httpRequest('GET', url, auth);
      intentos.push({ nombre, estado: r.status, cuerpo: r.status === 200 ? r.body : String(JSON.stringify(r.body || '')).slice(0, 200) });
      return r.status === 200 ? r.body : null;
    } catch (e) {
      intentos.push({ nombre, estado: 0, cuerpo: e.message });
      return null;
    }
  };

  let saldo = null;
  if (userId) {
    const b = await probar('balance', `https://api.mercadopago.com/users/${userId}/mercadopago_account/balance`);
    if (b) {
      const total = b.total_balance ?? b.total_amount ?? null;
      const disponible = b.available_balance ?? b.available_amount ?? null;
      if (total != null || disponible != null) {
        saldo = {
          total: total ?? 0,
          disponible: disponible ?? 0,
          aLiquidar: (total ?? 0) - (disponible ?? 0),
          fuente: 'balance',
        };
      }
    }
  }

  return res.status(200).json({
    ok: true,
    tokenDe: { userId, nickname },
    saldo,
    intentos,
  });
}

// PRÓXIMOS COBROS: el calendario de lo que ML va a depositar, día por día.
// Es la vista "Próximos cobros y pagos" de Mercado Pago.
//
// La diferencia con mpDinero es de qué lado se mira: acá se buscan los pagos
// por su FECHA DE LIBERACIÓN (no por cuándo se vendieron), así entra todo lo
// que está por cobrarse aunque la venta sea vieja.
async function mpCobros(req, res) {
  const { token, dias = 90 } = req.body || {};
  if (!token) return res.status(400).json({ ok: false, error: 'Falta access_token' });
  const auth = { 'Authorization': 'Bearer ' + token };

  const me = await httpRequest('GET', 'https://api.mercadolibre.com/users/me', auth);
  if (me.status !== 200) throw new Error(me.body?.message || ('HTTP ' + me.status));

  // Desde ayer (para no perder lo que se libera hoy) hasta N días adelante
  const iniMs = Date.now() - 24 * 3600 * 1000;
  const finMs = Date.now() + Number(dias) * 24 * 3600 * 1000;

  const pedir = async (d, h, offset) => {
    const url = 'https://api.mercadopago.com/v1/payments/search'
      + `?sort=money_release_date&criteria=asc&status=approved&limit=100&offset=${offset}`
      + `&range=money_release_date&begin_date=${encodeURIComponent(new Date(d).toISOString())}`
      + `&end_date=${encodeURIComponent(new Date(h).toISOString())}`;
    const r = await httpRequest('GET', url, auth);
    if (r.status !== 200) throw new Error(r.body?.message || r.body?.error || ('HTTP ' + r.status));
    return r.body;
  };

  const porDia = new Map();
  let total = 0, pagos = 0;
  // La fecha de liberación viene con la hora de Argentina adentro; se corta el
  // día tal cual lo manda ML para que coincida con lo que se ve en la app de MP
  const sumar = (lista) => {
    for (const p of lista) {
      const dia = String(p.money_release_date || '').slice(0, 10);
      if (!dia) continue;
      const bruto = Number(p.transaction_amount) || 0;
      let cargos = 0;
      for (const f of (p.fee_details || [])) cargos += Number(f.amount) || 0;
      const neto = p.transaction_details?.net_received_amount != null
        ? Number(p.transaction_details.net_received_amount)
        : bruto - cargos;
      const x = porDia.get(dia) || { dia, monto: 0, pagos: 0 };
      x.monto += neto; x.pagos++;
      porDia.set(dia, x);
      total += neto; pagos++;
    }
  };

  const VENTANA = 2 * 24 * 3600 * 1000;
  const traer = async (d, h, profundidad = 0) => {
    const primera = await pedir(d, h, 0);
    sumar(primera.results || []);
    const tot = primera.paging?.total || 0;
    if (tot > 1000 && profundidad < 5) {
      const medio = d + Math.floor((h - d) / 2);
      await traer(d, medio, profundidad + 1);
      await traer(medio, h, profundidad + 1);
      return;
    }
    const tope = Math.min(tot, 1000);
    const offsets = [];
    for (let off = 100; off < tope; off += 100) offsets.push(off);
    for (let i = 0; i < offsets.length; i += 5) {
      const lote = await Promise.all(offsets.slice(i, i + 5).map(off => pedir(d, h, off)));
      lote.forEach(b => sumar(b.results || []));
    }
  };

  for (let ini = iniMs; ini < finMs; ini += VENTANA) {
    await traer(ini, Math.min(ini + VENTANA, finMs));
  }

  return res.status(200).json({
    ok: true,
    cuenta: me.body.nickname,
    total, pagos,
    dias: [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia)),
  });
}

// La plata de las ventas: cuánto entró bruto, cuánto se lleva ML en comisiones
// y envío, cuánto queda neto, qué parte ya está liberada y qué parte falta
// liberar (con la fecha de cada liberación).
//
// El SALDO de Mercado Pago da 403 con el token de ML (probado en las dos
// cuentas el 18/9), así que todo esto sale de los PAGOS, que sí se pueden leer:
// cada pago trae su comisión, su neto y el día en que ML lo libera.
//
// /v1/payments/search corta cerca del offset 1000, así que el período se parte
// en ventanas y, si una ventana tiene demasiados pagos, se parte al medio.
async function mpDinero(req, res) {
  const { token, desde, hasta } = req.body || {};
  if (!token) return res.status(400).json({ ok: false, error: 'Falta access_token' });
  const auth = { 'Authorization': 'Bearer ' + token };

  const me = await httpRequest('GET', 'https://api.mercadolibre.com/users/me', auth);
  if (me.status !== 200) throw new Error(me.body?.message || ('HTTP ' + me.status));

  const iniMs = desde ? new Date(desde).getTime() : Date.now() - 30 * 24 * 3600 * 1000;
  const finMs = hasta ? new Date(hasta).getTime() : Date.now();

  const pedir = async (d, h, offset) => {
    const url = 'https://api.mercadopago.com/v1/payments/search'
      + `?sort=date_approved&criteria=asc&status=approved&limit=100&offset=${offset}`
      + `&range=date_approved&begin_date=${encodeURIComponent(new Date(d).toISOString())}`
      + `&end_date=${encodeURIComponent(new Date(h).toISOString())}`;
    const r = await httpRequest('GET', url, auth);
    if (r.status !== 200) throw new Error(r.body?.message || r.body?.error || ('HTTP ' + r.status));
    return r.body;
  };

  const acc = {
    pagos: 0, bruto: 0, comisionML: 0, costoEnvio: 0, otrosCargos: 0, neto: 0,
    liberado: 0, aLiquidar: 0,
  };
  const porFecha = new Map();   // cuándo entra la plata que todavía no se liberó
  let muestra = null;           // los campos del primer pago, para poder revisar

  const sumar = (pagos) => {
    for (const p of pagos) {
      acc.pagos++;
      const bruto = Number(p.transaction_amount) || 0;
      acc.bruto += bruto;

      let comision = 0, envio = 0, otros = 0;
      for (const f of (p.fee_details || [])) {
        const monto = Number(f.amount) || 0;
        const tipo = String(f.type || '').toLowerCase();
        if (tipo.includes('shipping')) envio += monto;
        else if (tipo.includes('fee')) comision += monto;
        else otros += monto;
      }
      // Si el pago no trae el detalle, el costo de envío igual viene aparte
      if (!envio) envio = Number(p.shipping_cost) || 0;
      acc.comisionML += comision;
      acc.costoEnvio += envio;
      acc.otrosCargos += otros;

      const neto = p.transaction_details?.net_received_amount != null
        ? Number(p.transaction_details.net_received_amount)
        : bruto - comision - envio - otros;
      acc.neto += neto;

      const liberado = String(p.money_release_status || '').toLowerCase() === 'released';
      if (liberado) acc.liberado += neto;
      else {
        acc.aLiquidar += neto;
        const dia = String(p.money_release_date || '').slice(0, 10);
        if (dia) {
          const x = porFecha.get(dia) || { dia, monto: 0, pagos: 0 };
          x.monto += neto; x.pagos++;
          porFecha.set(dia, x);
        }
      }

      if (!muestra) {
        muestra = {
          tieneFeeDetails: Array.isArray(p.fee_details) && p.fee_details.length > 0,
          tiposDeCargo: (p.fee_details || []).map(f => f.type),
          tieneNeto: p.transaction_details?.net_received_amount != null,
          estadoLiberacion: p.money_release_status || null,
        };
      }
    }
  };

  const VENTANA = 2 * 24 * 3600 * 1000;
  const traer = async (d, h, profundidad = 0) => {
    const primera = await pedir(d, h, 0);
    sumar(primera.results || []);
    const total = primera.paging?.total || 0;
    if (total > 1000 && profundidad < 5) {
      // Demasiados pagos para paginar: se parte al medio y se pide cada mitad
      const medio = d + Math.floor((h - d) / 2);
      await traer(d, medio, profundidad + 1);
      await traer(medio, h, profundidad + 1);
      return;
    }
    const tope = Math.min(total, 1000);
    const offsets = [];
    for (let off = 100; off < tope; off += 100) offsets.push(off);
    for (let i = 0; i < offsets.length; i += 5) {
      const lote = await Promise.all(offsets.slice(i, i + 5).map(off => pedir(d, h, off)));
      lote.forEach(b => sumar(b.results || []));
    }
  };

  for (let ini = iniMs; ini < finMs; ini += VENTANA) {
    await traer(ini, Math.min(ini + VENTANA, finMs));
  }

  const calendario = [...porFecha.values()].sort((a, b) => a.dia.localeCompare(b.dia));
  return res.status(200).json({
    ok: true,
    cuenta: me.body.nickname,
    desde: new Date(iniMs).toISOString(),
    hasta: new Date(finMs).toISOString(),
    ...acc,
    calendario,
    muestra,
  });
}

// DIAGNÓSTICO de Mercado Pago. La cuenta de MP es la misma que la de ML, pero
// no todos los datos de plata se pueden pedir con el token de ML: el saldo a
// veces sí, y las liquidaciones (lo que ML va a depositar, ya descontadas las
// comisiones y el envío) pueden necesitar una autorización aparte.
//
// En vez de adivinar, esto prueba cada puerta y devuelve qué contestó cada una,
// para saber qué se puede construir y qué hay que pedirle permiso a ML.
async function mpTest(req, res) {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ ok: false, error: 'Falta access_token' });
  const auth = { 'Authorization': 'Bearer ' + token };

  const me = await httpRequest('GET', 'https://api.mercadolibre.com/users/me', auth);
  if (me.status !== 200) throw new Error(me.body?.message || ('HTTP ' + me.status));
  const sellerId = me.body.id;

  const desde = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const hasta = new Date().toISOString();

  const puertas = [
    { clave: 'saldo',
      que: 'Saldo de la cuenta (total, disponible y a liquidar)',
      url: `https://api.mercadopago.com/users/${sellerId}/mercadopago_account/balance` },
    { clave: 'saldoPorML',
      que: 'El mismo saldo pero pedido por el lado de ML',
      url: `https://api.mercadolibre.com/users/${sellerId}/mercadopago_account/balance` },
    { clave: 'pagos',
      que: 'Pagos con su comisión y el neto que queda (últimos 7 días)',
      url: 'https://api.mercadopago.com/v1/payments/search?sort=date_created&criteria=desc&limit=3'
        + `&range=date_created&begin_date=${encodeURIComponent(desde)}&end_date=${encodeURIComponent(hasta)}` },
    { clave: 'liquidaciones',
      que: 'Informe de liquidaciones (lo que ML deposita y cuándo)',
      url: 'https://api.mercadopago.com/v1/account/settlement_report/list' },
    { clave: 'liberaciones',
      que: 'Informe de dinero liberado',
      url: 'https://api.mercadopago.com/v1/account/release_report/list' },
    { clave: 'facturacion',
      que: 'Facturación de ML (cargos y comisiones del período)',
      url: `https://api.mercadolibre.com/billing/integration/monthly/periods?group=ML&document_type=BILL&offset=0&limit=1` },
  ];

  const resultados = {};
  for (const p of puertas) {
    try {
      const r = await httpRequest('GET', p.url, auth);
      const cuerpo = r.body;
      // Solo una muestra: lo que interesa es si contesta y con qué forma
      let muestra = '';
      if (cuerpo && typeof cuerpo === 'object') {
        muestra = JSON.stringify(cuerpo).slice(0, 400);
      } else {
        muestra = String(cuerpo ?? '').slice(0, 300);
      }
      resultados[p.clave] = {
        que: p.que,
        estado: r.status,
        anda: r.status >= 200 && r.status < 300,
        respuesta: muestra,
      };
    } catch (e) {
      resultados[p.clave] = { que: p.que, estado: 0, anda: false, respuesta: 'Error: ' + e.message };
    }
  }

  return res.status(200).json({
    ok: true,
    cuenta: me.body.nickname,
    sellerId,
    // Los permisos que ML le dio a la aplicación (si los informa)
    scopes: me.body.scopes || null,
    resultados,
  });
}

// Ventas FLEX de un período, con el costo del envío y a quién se lo cobró ML.
// Sirve para comparar lo que nos cuesta el envío contra lo que le pagamos a
// los motoqueros. Se pide por tramos desde el navegador (un mes o menos por
// vez) porque cada venta necesita su envío y eso no entra en una sola corrida.
//
// Body: { token, desde, hasta } (fechas ISO). Devuelve una fila por venta FLEX.
async function flexSales(req, res) {
  const { token, desde, hasta } = req.body || {};
  if (!token) return res.status(400).json({ ok: false, error: 'Falta access_token' });
  if (!desde || !hasta) return res.status(400).json({ ok: false, error: 'Faltan las fechas desde/hasta' });
  const auth = { 'Authorization': 'Bearer ' + token };

  const me = await httpRequest('GET', 'https://api.mercadolibre.com/users/me', auth);
  if (me.status !== 200) throw new Error(me.body?.message || ('HTTP ' + me.status));
  const sellerId = me.body.id;

  const pedir = async (d, h, offset) => {
    const url = 'https://api.mercadolibre.com/orders/search'
      + `?seller=${sellerId}&sort=date_asc&limit=50&offset=${offset}`
      + `&order.date_created.from=${encodeURIComponent(d)}`
      + `&order.date_created.to=${encodeURIComponent(h)}`;
    const r = await httpRequest('GET', url, auth);
    if (r.status !== 200) throw new Error(r.body?.message || ('HTTP ' + r.status));
    return r.body;
  };

  // 1) Todas las ventas del tramo. /orders/search corta en offset 10.000, así
  //    que el tramo se parte en ventanas de 7 días y cada una se pagina en
  //    paralelo.
  const ventas = [];
  let canceladas = 0, truncado = false;
  const juntar = (orders) => {
    for (const o of orders) {
      if (o.status === 'cancelled' || o.status === 'invalid') { canceladas++; continue; }
      const sid = o.shipping?.id;
      if (!sid) continue; // venta sin envío de ML (retiro / acordado)
      ventas.push({
        orderId: o.id,
        shipmentId: String(sid),
        fecha: o.date_created,
        estadoOrden: o.status,
        total: o.total_amount || 0,
        comprador: o.buyer?.nickname || '',
        unidades: (o.order_items || []).reduce((s, it) => s + (it.quantity || 0), 0),
        sku: (o.order_items || []).map(it => it.item?.seller_sku || it.item?.seller_custom_field || it.item?.id || '').filter(Boolean).join(' + '),
        titulo: (o.order_items || []).map(it => it.item?.title || '').filter(Boolean).join(' + '),
      });
    }
  };

  const iniMs = new Date(desde).getTime();
  const finMs = new Date(hasta).getTime();
  const VENTANA = 7 * 24 * 3600 * 1000;
  for (let ini = iniMs; ini < finMs; ini += VENTANA) {
    const d = new Date(ini).toISOString();
    const h = new Date(Math.min(ini + VENTANA, finMs)).toISOString();
    const primera = await pedir(d, h, 0);
    juntar(primera.results || []);
    const total = primera.paging?.total || 0;
    if (total > 10000) truncado = true;
    const tope = Math.min(total, 10000);
    const offsets = [];
    for (let off = 50; off < tope; off += 50) offsets.push(off);
    const CONC = 8;
    for (let i = 0; i < offsets.length; i += CONC) {
      const lote = await Promise.all(offsets.slice(i, i + CONC).map(off => pedir(d, h, off)));
      lote.forEach(b => juntar(b.results || []));
    }
  }

  // 2) El envío de cada venta: ahí está el tipo (FLEX = self_service) y la
  //    dirección. Una venta con varios productos comparte un solo envío.
  const envios = new Map();
  const ids = [...new Set(ventas.map(v => v.shipmentId))];
  const CONC_ENV = 12;
  for (let i = 0; i < ids.length; i += CONC_ENV) {
    await Promise.all(ids.slice(i, i + CONC_ENV).map(async (sid) => {
      try {
        const r = await httpRequest('GET', `https://api.mercadolibre.com/shipments/${sid}`, auth);
        const b = r.body || {};
        const tipo = b.logistic_type || b.logistic?.type || '';
        if (tipo !== 'self_service') return; // solo FLEX
        const dir = b.receiver_address || {};
        envios.set(sid, {
          estadoEnvio: b.status || '',
          subEstado: b.substatus || '',
          provincia: dir.state?.name || '',
          localidad: dir.city?.name || '',
          municipio: dir.municipality?.name || '',
          barrio: dir.neighborhood?.name || '',
          cp: dir.zip_code || '',
          lat: dir.latitude ?? null,
          lng: dir.longitude ?? null,
          costoListado: b.shipping_option?.list_cost ?? null,
          costoOpcion: b.shipping_option?.cost ?? null,
        });
      } catch { /* un envío que falla no corta el reporte */ }
    }));
  }

  // 3) El detalle de plata SOLO de los FLEX: cuánto pagó el comprador y cuánto
  //    nos cobró ML a nosotros.
  const flexIds = [...envios.keys()];
  for (let i = 0; i < flexIds.length; i += CONC_ENV) {
    await Promise.all(flexIds.slice(i, i + CONC_ENV).map(async (sid) => {
      try {
        const r = await httpRequest('GET', `https://api.mercadolibre.com/shipments/${sid}/costs`, auth);
        const c = r.body || {};
        const vendedor = (c.senders || [])[0] || {};
        const e = envios.get(sid);
        e.costoComprador = c.receiver?.cost ?? 0;
        e.costoNosotros = vendedor.cost ?? 0;
        e.bonificacion = (vendedor.compensation ?? 0) + (vendedor.save ?? 0);
        e.costoBruto = c.gross_amount ?? null;
      } catch { /* sin detalle de costos: la fila igual sale */ }
    }));
  }

  const filas = ventas
    .filter(v => envios.has(v.shipmentId))
    .map(v => ({ ...v, ...envios.get(v.shipmentId) }));

  return res.status(200).json({
    ok: true,
    cuenta: me.body.nickname,
    desde, hasta,
    ventasLeidas: ventas.length,
    enviosConsultados: ids.length,
    flex: filas.length,
    canceladas,
    truncado,
    filas,
  });
}

// Métricas de la cuenta para la solapa 📊: ventas, unidades, dinero y ticket
// promedio del período, la evolución día por día, el desglose por tipo de
// envío y la reputación. Igual que topSold, el período se parte en ventanas de
// 7 días (porque /orders/search corta en offset 10.000) y se pagina en
// paralelo. Los días se agrupan en hora de ARGENTINA (UTC-3), si no las ventas
// de la tarde caen en el día siguiente.
const AR_OFFSET = 3 * 3600 * 1000;
const diaAR = (iso) => new Date(new Date(iso).getTime() - AR_OFFSET).toISOString().slice(0, 10);

async function metrics(req, res) {
  const { token, from, to, conEnvios = false } = req.body || {};
  if (!token) return res.status(400).json({ ok: false, error: 'Falta access_token' });
  const auth = { 'Authorization': 'Bearer ' + token };

  const me = await httpRequest('GET', 'https://api.mercadolibre.com/users/me', auth);
  if (me.status !== 200) throw new Error(me.body?.message || ('HTTP ' + me.status));
  const sellerId = me.body.id;
  const rep = me.body.seller_reputation || {};

  const desdeMs = from ? new Date(from).getTime() : Date.now() - 7 * 24 * 3600 * 1000;
  const hastaMs = to ? new Date(to).getTime() : Date.now();

  const pedir = async (d, h, offset) => {
    const url = 'https://api.mercadolibre.com/orders/search'
      + `?seller=${sellerId}&sort=date_desc&limit=50&offset=${offset}`
      + `&order.date_created.from=${encodeURIComponent(d)}&order.date_created.to=${encodeURIComponent(h)}`;
    const r = await httpRequest('GET', url, auth);
    if (r.status !== 200) throw new Error(r.body?.message || ('HTTP ' + r.status));
    return r.body;
  };

  const porDia = new Map();   // día → { ventas, unidades, dinero }
  const shipIds = [];         // para el desglose por tipo de envío
  const shipMonto = new Map();
  let ventas = 0, unidades = 0, dinero = 0, canceladas = 0;

  const sumar = (orders) => {
    for (const o of orders) {
      if (o.status === 'cancelled' || o.status === 'invalid') { canceladas++; continue; }
      const d = diaAR(o.date_created);
      const acc = porDia.get(d) || { dia: d, ventas: 0, unidades: 0, dinero: 0 };
      const u = (o.order_items || []).reduce((s, it) => s + (it.quantity || 0), 0);
      const monto = o.total_amount || 0;
      acc.ventas++; acc.unidades += u; acc.dinero += monto;
      porDia.set(d, acc);
      ventas++; unidades += u; dinero += monto;
      const sid = o.shipping?.id;
      if (sid) { shipIds.push(sid); shipMonto.set(sid, monto); }
    }
  };

  const VENTANA = 7 * 24 * 3600 * 1000;
  for (let ini = desdeMs; ini < hastaMs; ini += VENTANA) {
    const d = new Date(ini).toISOString();
    const h = new Date(Math.min(ini + VENTANA, hastaMs)).toISOString();
    const primera = await pedir(d, h, 0);
    sumar(primera.results || []);
    const tope = Math.min(primera.paging?.total || 0, 10000);
    const offsets = [];
    for (let off = 50; off < tope; off += 50) offsets.push(off);
    for (let i = 0; i < offsets.length; i += 8) {
      const lote = await Promise.all(offsets.slice(i, i + 8).map(off => pedir(d, h, off)));
      lote.forEach(b => sumar(b.results || []));
    }
  }

  // Tipo de envío: hay que preguntar envío por envío, así que solo se calcula
  // si lo piden y con un tope, para no pasarse del tiempo de la función
  let tipoEnvio = null;
  if (conEnvios && shipIds.length) {
    const unicos = [...new Set(shipIds)].slice(0, 4000);
    const acc = { flex: { envios: 0, dinero: 0 }, correo: { envios: 0, dinero: 0 }, full: { envios: 0, dinero: 0 }, otro: { envios: 0, dinero: 0 } };
    let costoNuestro = 0;
    for (let i = 0; i < unicos.length; i += 12) {
      await Promise.all(unicos.slice(i, i + 12).map(async (sid) => {
        try {
          const r = await httpRequest('GET', `https://api.mercadolibre.com/shipments/${sid}`, auth);
          const t = r.body?.logistic_type || r.body?.logistic?.type;
          const k = t === 'self_service' ? 'flex' : t === 'fulfillment' ? 'full'
            : (t ? 'correo' : 'otro');
          acc[k].envios++;
          acc[k].dinero += shipMonto.get(sid) || 0;
          costoNuestro += r.body?.shipping_option?.cost || 0;
        } catch { acc.otro.envios++; }
      }));
    }
    tipoEnvio = { ...acc, costoNuestro, consultados: unicos.length, total: [...new Set(shipIds)].length };
  }

  // Saldo de Mercado Pago: la cuenta es la misma que la de ML, así que se
  // intenta con el mismo token. "A liquidar" es lo que todavía no se puede
  // usar, o sea total - disponible. Si ML no lo autoriza, la pantalla sigue
  // funcionando y simplemente no se muestra la tarjeta.
  let saldo = null;
  try {
    const b = await httpRequest('GET', `https://api.mercadopago.com/users/${sellerId}/mercadopago_account/balance`, auth);
    if (b.status === 200 && b.body) {
      const total = b.body.total_balance ?? b.body.total_amount ?? null;
      const disponible = b.body.available_balance ?? b.body.available_amount ?? null;
      if (total != null || disponible != null) {
        saldo = {
          total: total ?? 0,
          disponible: disponible ?? 0,
          aLiquidar: (total ?? 0) - (disponible ?? 0),
        };
      }
    }
  } catch {}

  // Visitas del período (si ML no las da, la pantalla sigue funcionando igual)
  let visitas = null;
  try {
    const v = await httpRequest('GET',
      `https://api.mercadolibre.com/users/${sellerId}/items_visits?date_from=${new Date(desdeMs).toISOString().slice(0, 19)}.000-00:00&date_to=${new Date(hastaMs).toISOString().slice(0, 19)}.000-00:00`,
      auth);
    if (v.status === 200) visitas = v.body?.total_visits ?? null;
  } catch {}

  const dias = [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia));
  return res.status(200).json({
    ok: true,
    cuenta: me.body.nickname,
    resumen: {
      ventas, unidades, dinero, canceladas, visitas,
      ticket: ventas ? dinero / ventas : 0,
      promedioDia: dias.length ? ventas / dias.length : 0,
    },
    porDia: dias,
    tipoEnvio,
    saldo,
    reputacion: {
      nivel: rep.level_id || '',
      operaciones: rep.transactions?.total ?? null,
      completadas: rep.transactions?.completed ?? null,
      canceladasRep: rep.transactions?.canceled ?? null,
      reclamos: rep.metrics?.claims?.rate ?? null,
      demorados: rep.metrics?.delayed_handling_time?.rate ?? null,
      cancelacionesRate: rep.metrics?.cancellations?.rate ?? null,
    },
  });
}

// Núcleo reutilizable (lo usan el handler orders y el sync del tablero en
// api/ml/envios.js): órdenes + detalle de cada envío en paralelo.
export async function fetchOrdersDetailed(token, from) {
  const auth = { 'Authorization': 'Bearer ' + token };

  const me = await httpRequest('GET', 'https://api.mercadolibre.com/users/me', auth);
  if (me.status !== 200) {
    throw new Error(me.body?.message || ('HTTP ' + me.status));
  }
  const sellerId = me.body.id;
  const nickname = me.body.nickname;

  const fromParam = from ? `&order.date_created.from=${encodeURIComponent(from)}` : '';
  const raw = [];
  let offset = 0;
  for (let page = 0; page < 60; page++) { // hasta 3000 órdenes por cuenta (~300 envíos/día × 7 días)
    const url = `https://api.mercadolibre.com/orders/search?seller=${sellerId}&sort=date_desc&limit=50&offset=${offset}${fromParam}`;
    const r = await httpRequest('GET', url, auth);
    if (r.status !== 200) {
      throw new Error(r.body?.message || ('HTTP ' + r.status));
    }
    const results = r.body?.results || [];
    raw.push(...results);
    if (results.length < 50) break;
    offset += 50;
  }

  // Detalle de cada envío en PARALELO (lotes de 10) — secuencial tardaría minutos
  const shipCache = new Map();
  const shipIds = [...new Set(raw.map(o => o.shipping?.id).filter(Boolean))];
  const CONC = 10;
  for (let i = 0; i < shipIds.length; i += CONC) {
    await Promise.all(shipIds.slice(i, i + CONC).map(async (sid) => {
      try {
        const s = await httpRequest('GET', `https://api.mercadolibre.com/shipments/${sid}`, auth);
        const b = s.body || {};
        const ra = b.receiver_address || {};
        shipCache.set(sid, {
          logisticType: b.logistic_type || null,
          shipmentStatus: b.status || null,       // pending/handling/ready_to_ship/shipped/delivered...
          trackingNumber: b.tracking_number || null, // el CÓDIGO DE BARRAS de la etiqueta trae este número (≠ id del envío)
          shipmentSubstatus: b.substatus || null,
          dimensions: b.dimensions || null,       // alto/ancho/largo (para elegir bolsa al empaquetar)
          recipient: ra.receiver_name || null,
          address: [ra.address_line, ra.city?.name, ra.state?.name].filter(Boolean).join(', ') || null,
          notes: ra.comment || null, // "Referencia" de la etiqueta (puede traer horarios de entrega)
          lat: ra.latitude != null ? Number(ra.latitude) : null,
          lng: ra.longitude != null ? Number(ra.longitude) : null,
        });
      } catch {
        shipCache.set(sid, { logisticType: null });
      }
    }));
  }

  const out = [];
  for (const o of raw) {
    const items = (o.order_items || []).map(it => ({
      mla: it.item?.id || null,
      sku: it.item?.seller_sku || it.item?.seller_custom_field || null,
      title: it.item?.title || '',
      quantity: it.quantity || 0,
    }));
    const shipmentId = o.shipping?.id || null;
    const ship = (shipmentId && shipCache.get(shipmentId)) || { logisticType: null };
    if (!ship.recipient && o.buyer) {
      ship.recipient = [o.buyer.first_name, o.buyer.last_name].filter(Boolean).join(' ') || null;
    }
    out.push({
      id: String(o.id),
      date: o.date_created,
      status: o.status,
      logisticType: ship.logisticType, // 'fulfillment' = Full → se EXCLUYE
      shipmentStatus: ship.shipmentStatus || null,
      shipmentSubstatus: ship.shipmentSubstatus || null,
      trackingNumber: ship.trackingNumber || null,
      shipmentId: shipmentId != null ? String(shipmentId) : null,
      packId: o.pack_id != null ? String(o.pack_id) : null, // agrupa una compra de varios productos
      dimensions: ship.dimensions || null,
      recipient: ship.recipient,
      address: ship.address,
      notes: ship.notes || null,
      lat: ship.lat,
      lng: ship.lng,
      items,
    });
  }

  return { sellerId, nickname, orders: out };
}

// Lista TODAS las publicaciones activas del vendedor (para detectar cuáles no
// están cargadas como combo/producto). Body: { token }.
async function items(req, res) {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ ok: false, error: 'Falta access_token' });
  const auth = { 'Authorization': 'Bearer ' + token };

  const me = await httpRequest('GET', 'https://api.mercadolibre.com/users/me', auth);
  if (me.status !== 200) return res.status(200).json({ ok: false, error: me.body?.message || ('HTTP ' + me.status) });
  const sellerId = me.body.id;

  // IDs de publicaciones con scroll (paginado que soporta muchos items)
  const ids = [];
  let scrollId = null;
  for (let p = 0; p < 60; p++) {
    const url = `https://api.mercadolibre.com/users/${sellerId}/items/search?search_type=scan&limit=100` +
      (scrollId ? `&scroll_id=${encodeURIComponent(scrollId)}` : '');
    const r = await httpRequest('GET', url, auth);
    if (r.status !== 200) break;
    const results = r.body?.results || [];
    ids.push(...results);
    scrollId = r.body?.scroll_id;
    if (!results.length || !scrollId) break;
  }

  // Detalle en lotes de 20 (multiget): id, título, seller_sku
  const out = [];
  for (let i = 0; i < ids.length; i += 20) {
    const batch = ids.slice(i, i + 20).join(',');
    const r = await httpRequest('GET', `https://api.mercadolibre.com/items?ids=${batch}&attributes=id,title,seller_custom_field,status`, auth);
    for (const entry of (r.body || [])) {
      const b = entry?.body;
      if (!b) continue;
      out.push({ mla: b.id, title: b.title || '', sku: b.seller_custom_field || null, status: b.status });
    }
  }

  return res.status(200).json({ ok: true, sellerId, count: out.length, items: out });
}

async function exchange(req, res) {
  const { clientId, clientSecret, code, redirectUri } = req.body || {};
  if (!clientId || !clientSecret || !code || !redirectUri) {
    return res.status(400).json({ ok: false, error: 'Faltan: clientId, clientSecret, code, redirectUri' });
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri
  }).toString();

  const r = await httpRequest('POST', 'https://api.mercadolibre.com/oauth/token', {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json'
  }, body);

  if (r.status !== 200) {
    return res.status(200).json({
      ok: false,
      error: r.body?.message || r.body?.error_description || r.body?.error || ('HTTP ' + r.status),
      details: r.body
    });
  }

  return res.status(200).json({
    ok: true,
    accessToken: r.body.access_token,
    refreshToken: r.body.refresh_token,
    userId: r.body.user_id,
    expiresIn: r.body.expires_in,
    scope: r.body.scope
  });
}

async function refresh(req, res) {
  const { clientId, clientSecret, refreshToken } = req.body || {};
  if (!clientId || !clientSecret || !refreshToken) {
    return res.status(400).json({ ok: false, error: 'Faltan: clientId, clientSecret, refreshToken' });
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken
  }).toString();

  const r = await httpRequest('POST', 'https://api.mercadolibre.com/oauth/token', {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json'
  }, body);

  if (r.status !== 200) {
    return res.status(200).json({
      ok: false,
      error: r.body?.message || r.body?.error_description || ('HTTP ' + r.status),
      details: r.body
    });
  }

  return res.status(200).json({
    ok: true,
    accessToken: r.body.access_token,
    refreshToken: r.body.refresh_token,
    expiresIn: r.body.expires_in
  });
}

async function test(req, res) {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ ok: false, error: 'Falta access_token' });

  const r = await httpRequest('GET', 'https://api.mercadolibre.com/users/me', {
    'Authorization': 'Bearer ' + token
  });
  if (r.status !== 200) {
    return res.status(200).json({
      ok: false,
      error: r.body?.message || r.body?.error || ('HTTP ' + r.status),
      status: r.status
    });
  }
  return res.status(200).json({
    ok: true,
    info: {
      userId: r.body.id,
      nickname: r.body.nickname,
      siteId: r.body.site_id,
      email: r.body.email,
      country: r.body.country_id,
      sellerReputation: r.body.seller_reputation?.level_id || 'sin reputación'
    }
  });
}

// Estado actual de envíos puntuales, para refrescar los activos VIEJOS que ya
// no entran en la ventana de órdenes de 7 días. body: { token, ids: [...] }
async function shipStatus(req, res) {
  const { token, ids } = req.body || {};
  if (!token || !Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ ok: false, error: 'Falta token o ids' });
  }
  const auth = { 'Authorization': 'Bearer ' + token };
  const statuses = {};
  const list = ids.slice(0, 400).map(String);
  const CONC = 10;
  for (let i = 0; i < list.length; i += CONC) {
    await Promise.all(list.slice(i, i + CONC).map(async (id) => {
      try {
        const r = await httpRequest('GET', 'https://api.mercadolibre.com/shipments/' + id, auth);
        if (r.status === 200 && r.body?.status) {
          statuses[id] = { status: r.body.status, substatus: r.body.substatus || null, tracking: r.body.tracking_number || null };
        }
      } catch { /* envío de la otra cuenta o error puntual: se omite */ }
    }));
  }
  return res.status(200).json({ ok: true, statuses });
}

// ---------------------------------------------------------------------------
// SALDO REAL, por la única puerta que quedó abierta: el reporte de liberaciones
// ---------------------------------------------------------------------------
//
// El 18/9 probamos nueve endpoints de saldo con los dos tokens (el de ML y el
// de MP, en las dos cuentas). Todos contestan 403 o 404. Los únicos que
// contestan 200 son los de REPORTES.
//
// El reporte de liberaciones de Mercado Pago es el extracto de la cuenta:
// movimiento por movimiento, con el saldo acumulado después de cada uno. El
// último saldo acumulado ES el dinero disponible. Y a diferencia de sumar
// pagos, este camino sí incluye los retiros, las devoluciones y todo lo que no
// viene de una venta.
//
// El reporte se pide, MP lo genera (entre 10 segundos y un minuto) y después
// se baja el CSV.
const REPORTE_BASE = 'https://api.mercadopago.com/v1/account/release_report';
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// El CSV de MP no empieza en la primera línea: arriba trae un bloque de resumen
// (saldo inicial, saldo final, totales) y recién después la tabla de
// movimientos. Así que el encabezado hay que BUSCARLO: es la primera línea con
// varios separadores y nombres de columna conocidos.
function partirCsv(texto) {
  const crudas = String(texto || '').split(/\r?\n/);
  const lineas = crudas.filter((l) => l.trim());
  if (!lineas.length) return { columnas: [], filas: [], encabezado: -1, sep: ',' };

  const contar = (l, c) => (l.match(new RegExp('\\' + c, 'g')) || []).length;
  const sep = lineas.reduce((a, l) => a + contar(l, ';'), 0) > lineas.reduce((a, l) => a + contar(l, ','), 0) ? ';' : ',';

  const partir = (linea) => {
    const out = [];
    let act = '', comillas = false;
    for (let i = 0; i < linea.length; i++) {
      const ch = linea[i];
      if (ch === '"') {
        if (comillas && linea[i + 1] === '"') { act += '"'; i++; }
        else comillas = !comillas;
      } else if (ch === sep && !comillas) { out.push(act); act = ''; }
      else act += ch;
    }
    out.push(act);
    return out.map((c) => c.trim());
  };

  // La fila de encabezado: la primera que tenga al menos 4 columnas y algún
  // nombre típico del reporte de MP.
  let iEnc = 0;
  for (let i = 0; i < Math.min(lineas.length, 40); i++) {
    const cols = partir(lineas[i]);
    if (cols.length >= 4 && cols.some((c) => /^(date|source_id|external_reference|record_type|description|settlement_net_amount|transaction_type)$/i.test(c))) {
      iEnc = i;
      break;
    }
  }

  return { columnas: partir(lineas[iEnc]), filas: lineas.slice(iEnc + 1).map(partir), encabezado: iEnc, sep };
}

// "1.234,56" y "1,234.56" significan lo mismo: el último separador es el decimal.
function aNumero(v) {
  if (v == null) return null;
  let t = String(v).replace(/[^\d,.\-]/g, '').trim();
  if (!t || t === '-') return null;
  const ic = t.lastIndexOf(','), ip = t.lastIndexOf('.');
  if (ic > -1 && ip > -1) {
    t = ic > ip ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (ic > -1) {
    t = t.split(',').length === 2 && t.length - ic - 1 !== 3 ? t.replace(',', '.') : t.replace(/,/g, '');
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// El último número que aparezca en una línea suelta del bloque de resumen.
function ultimoNumeroDeLinea(linea) {
  const m = String(linea).match(/-?[\d][\d.,]*/g);
  if (!m) return null;
  for (let i = m.length - 1; i >= 0; i--) {
    const n = aNumero(m[i]);
    if (n != null) return n;
  }
  return null;
}

async function mpSaldoReal(req, res) {
  const { token, mpToken, dias = 3 } = req.body || {};
  const tokens = [['MP', (mpToken || '').trim()], ['ML', (token || '').trim()]].filter(([, t]) => t);
  if (!tokens.length) return res.status(400).json({ ok: false, error: 'Falta algún token' });

  const pasos = [];
  let config = null;   // lo último que contestó MP sobre la forma del reporte
  const finMs = Date.now();
  const iniMs = finMs - Number(dias) * 24 * 3600 * 1000;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 19) + 'Z';

  for (const [origen, tk] of tokens) {
    const auth = { 'Authorization': 'Bearer ' + tk };

    // 1. Qué reportes ya existían, para reconocer el nuevo
    const antes = await httpRequest('GET', REPORTE_BASE + '/list', auth);
    pasos.push({ paso: `lista previa (token de ${origen})`, estado: antes.status });
    if (antes.status !== 200) continue;
    const previos = new Set((Array.isArray(antes.body) ? antes.body : []).map((f) => f.file_name));

    // Qué columnas ACEPTA el reporte de esta cuenta y cuáles tiene puestas. Las
    // columnas son configurables por cuenta, así que FULL y FERRE pueden estar
    // trayendo archivos distintos. Esto se pide siempre, aunque después falle
    // la generación, porque es lo que dice si el saldo se puede pedir.
    config = {};
    for (const [nombre, url] of [
      ['release: columnas puestas', REPORTE_BASE + '/config'],
      ['release: columnas disponibles', REPORTE_BASE + '/columns'],
      ['retiros: columnas disponibles', 'https://api.mercadopago.com/v1/account/bank_report/columns'],
      ['liquidaciones: columnas disponibles', 'https://api.mercadopago.com/v1/account/settlement_report/columns'],
    ]) {
      try {
        const r = await httpRequest('GET', url, auth);
        config[nombre] = { estado: r.status, cuerpo: String(typeof r.body === 'object' ? JSON.stringify(r.body) : r.body ?? '').slice(0, 1500) };
      } catch (e) {
        config[nombre] = { estado: 0, cuerpo: e.message };
      }
    }

    // 2. Pedir uno nuevo
    const alta = await httpRequest('POST', REPORTE_BASE, { ...auth, 'Content-Type': 'application/json' }, {
      begin_date: iso(iniMs),
      end_date: iso(finMs),
    });
    pasos.push({
      paso: 'pedir el reporte',
      estado: alta.status,
      detalle: alta.status >= 300 ? String(JSON.stringify(alta.body || '')).slice(0, 200) : `${iso(iniMs)} → ${iso(finMs)}`,
    });
    if (alta.status >= 300) continue;

    // 3. Esperar a que MP lo genere. La cuenta FULL tiene tantos movimientos que
    //    con 100 segundos no alcanzaba, por eso ahora espera casi 4 minutos (la
    //    función de Vercel corta a los 5).
    let archivo = null;
    for (let i = 0; i < 30 && !archivo; i++) {
      await dormir(4000);
      const l = await httpRequest('GET', REPORTE_BASE + '/list', auth);
      if (l.status !== 200) continue;
      const arr = Array.isArray(l.body) ? l.body : [];
      archivo = arr.find((f) => f.file_name && !previos.has(f.file_name)) || null;
    }
    if (!archivo) {
      pasos.push({ paso: 'esperar el archivo', estado: 0, detalle: 'MP no lo generó en 2 minutos.' });
      continue;
    }
    pasos.push({ paso: 'archivo listo', estado: 200, detalle: archivo.file_name });

    // 4. Bajarlo
    const bajada = await httpText('GET', `${REPORTE_BASE}/${archivo.file_name}`, auth);
    pasos.push({ paso: 'bajar el CSV', estado: bajada.status, detalle: `${(bajada.text || '').length} caracteres` });
    if (bajada.status !== 200 || !bajada.text) continue;

    const texto = bajada.text;
    const crudas = texto.split(/\r?\n/).filter((l) => l.trim());

    // 5a. Primero se busca el saldo en el BLOQUE DE RESUMEN de arriba del
    //     archivo, que es donde MP escribe "final available balance". Es el dato
    //     bueno: el saldo de la cuenta, no el neto del período.
    let disponible = null, deDonde = null, fechaSaldo = null;
    for (const l of crudas.slice(0, 40)) {
      if (/(final|closing|ending).*balance|balance.*(final|closing)|saldo.*final/i.test(l)) {
        const n = ultimoNumeroDeLinea(l);
        if (n != null) { disponible = n; deDonde = `resumen: ${l.slice(0, 120)}`; break; }
      }
    }

    // 5b. Si no está el resumen, se usa la columna de saldo acumulado de la tabla.
    const { columnas, filas, encabezado, sep } = partirCsv(texto);
    const buscarCol = (...patrones) => {
      for (const p of patrones) {
        const i = columnas.findIndex((c) => p.test(c));
        if (i > -1) return i;
      }
      return -1;
    };
    // Ojo: BALANCE_AMOUNT NO sirve. Es el importe del movimiento que impacta en
    // el saldo, no el saldo acumulado: en FERRE la última fila daba 0 con la
    // cuenta teniendo $940.517. Sólo vale una columna que diga explícitamente
    // que es el saldo disponible.
    const iSaldo = buscarCol(/final.*balance|balance.*final/i, /available.*balance|balance.*available/i);
    const iFecha = buscarCol(/^date$/i, /release.*date|money.*date/i, /date/i);
    if (disponible == null && iSaldo > -1) {
      for (let i = filas.length - 1; i >= 0; i--) {
        const n = aNumero(filas[i][iSaldo]);
        if (n != null) { disponible = n; deDonde = `columna ${columnas[iSaldo]}`; fechaSaldo = iFecha > -1 ? filas[i][iFecha] : null; break; }
      }
    }

    // Neto del período, siempre: sirve de control aunque el saldo salga bien.
    const iCred = buscarCol(/net_credit/i, /^credit/i);
    const iDeb = buscarCol(/net_debit/i, /^debit/i);
    let netoPeriodo = null;
    if (iCred > -1 || iDeb > -1) {
      netoPeriodo = filas.reduce((a, f) => a + (aNumero(f[iCred]) || 0) - (aNumero(f[iDeb]) || 0), 0);
    }

    return res.status(200).json({
      ok: true,
      origenToken: origen,
      archivo: archivo.file_name,
      desde: iso(iniMs),
      hasta: iso(finMs),
      saldo: disponible != null ? { disponible, fecha: fechaSaldo, fuente: deDonde } : null,
      netoPeriodo,
      movimientos: filas.length,
      pasos,
      config,
      // Para poder ajustar la lectura sin tener que adivinar: cómo se vio el
      // archivo por dentro.
      crudo: {
        separador: sep,
        filaEncabezado: encabezado,
        columnas,
        primeras: crudas.slice(0, 8).map((l) => l.slice(0, 300)),
        ultimas: crudas.slice(-3).map((l) => l.slice(0, 300)),
      },
    });
  }

  return res.status(200).json({ ok: false, saldo: null, pasos, config, error: 'No se pudo armar el reporte con ninguno de los dos tokens.' });
}
