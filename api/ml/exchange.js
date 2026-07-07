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
    if (action === 'videos') return await videos(req, res);
    return await exchange(req, res);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// Lista las publicaciones del vendedor y devuelve los datos de video/clip de
// cada una para poder descargarlos. Body: { token }
async function videos(req, res) {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ ok: false, error: 'Falta access_token' });
  const auth = { 'Authorization': 'Bearer ' + token };

  // 1) quién soy
  const me = await httpRequest('GET', 'https://api.mercadolibre.com/users/me', auth);
  if (me.status !== 200) {
    return res.status(200).json({ ok: false, error: me.body?.message || ('HTTP ' + me.status) });
  }
  const sellerId = me.body.id;

  // 2) IDs de mis items (hasta 100; se pagina con scan si hace falta)
  const search = await httpRequest('GET', `https://api.mercadolibre.com/users/${sellerId}/items/search?limit=100`, auth);
  if (search.status !== 200) {
    return res.status(200).json({ ok: false, error: search.body?.message || ('HTTP ' + search.status) });
  }
  const ids = search.body?.results || [];

  // 3) detalle de cada item en lotes de 20 (multiget), pidiendo campos de video
  const attrs = 'id,title,permalink,thumbnail,video_id,videos,catalog_product_id';
  const items = [];
  for (let i = 0; i < ids.length; i += 20) {
    const batch = ids.slice(i, i + 20).join(',');
    const r = await httpRequest('GET', `https://api.mercadolibre.com/items?ids=${batch}&attributes=${attrs}`, auth);
    for (const entry of (r.body || [])) {
      const b = entry?.body;
      if (!b) continue;
      const videoId = b.video_id || null;
      const clips = b.videos || null; // clips propios de ML si existen
      if (!videoId && !(clips && clips.length)) continue; // solo los que tienen video
      items.push({
        id: b.id,
        title: b.title,
        permalink: b.permalink,
        thumbnail: b.thumbnail,
        videoId,
        youtubeUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null,
        clips: clips || null,
      });
    }
  }

  return res.status(200).json({
    ok: true,
    sellerId,
    totalItems: ids.length,
    withVideo: items.length,
    items,
  });
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
