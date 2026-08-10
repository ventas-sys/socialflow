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
  const auth = { 'Authorization': 'Bearer ' + token };

  const me = await httpRequest('GET', 'https://api.mercadolibre.com/users/me', auth);
  if (me.status !== 200) {
    return res.status(200).json({ ok: false, error: me.body?.message || ('HTTP ' + me.status) });
  }
  const sellerId = me.body.id;
  const nickname = me.body.nickname;

  const fromParam = from ? `&order.date_created.from=${encodeURIComponent(from)}` : '';
  const raw = [];
  let offset = 0;
  for (let page = 0; page < 20; page++) { // hasta 1000 órdenes
    const url = `https://api.mercadolibre.com/orders/search?seller=${sellerId}&sort=date_desc&limit=50&offset=${offset}${fromParam}`;
    const r = await httpRequest('GET', url, auth);
    if (r.status !== 200) {
      return res.status(200).json({ ok: false, error: r.body?.message || ('HTTP ' + r.status), details: r.body });
    }
    const results = r.body?.results || [];
    raw.push(...results);
    if (results.length < 50) break;
    offset += 50;
  }

  const shipCache = new Map();
  const out = [];
  for (const o of raw) {
    const items = (o.order_items || []).map(it => ({
      mla: it.item?.id || null,
      sku: it.item?.seller_sku || it.item?.seller_custom_field || null,
      title: it.item?.title || '',
      quantity: it.quantity || 0,
    }));
    const shipmentId = o.shipping?.id || null;
    let logisticType = null;
    if (shipmentId) {
      if (shipCache.has(shipmentId)) {
        logisticType = shipCache.get(shipmentId);
      } else {
        const s = await httpRequest('GET', `https://api.mercadolibre.com/shipments/${shipmentId}`, auth);
        logisticType = s.body?.logistic_type || null;
        shipCache.set(shipmentId, logisticType);
      }
    }
    out.push({
      id: String(o.id),
      date: o.date_created,
      status: o.status,
      logisticType, // 'fulfillment' = Full → se EXCLUYE; el resto descuenta
      shipmentId,
      items,
    });
  }

  return res.status(200).json({ ok: true, sellerId, nickname, count: out.length, orders: out });
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
