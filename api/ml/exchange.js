import { httpRequest, cors } from '../_http.js';

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
