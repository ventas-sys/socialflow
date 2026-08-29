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
