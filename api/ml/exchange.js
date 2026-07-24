import https from 'node:https';
import { httpRequest, cors } from '../../lib/http.js';

// GET que devuelve el CUERPO COMPLETO (texto), siguiendo redirects, con
// User-Agent de navegador. Sirve para "scrapear" una página propia (ej. la
// del clip de ML) y sacar la URL real del video.
function fetchText(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/json,*/*',
        'Accept-Language': 'es-AR,es;q=0.9',
      },
    }, (r) => {
      if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location && redirects > 0) {
        const next = new URL(r.headers.location, url).href;
        r.resume();
        return resolve(fetchText(next, redirects - 1));
      }
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => resolve({ status: r.statusCode, url, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout 20s')); });
    req.end();
  });
}

// Extrae URLs de video (.mp4 / .m3u8) del HTML/JSON de una página.
function extractVideoUrls(html) {
  const urls = new Set();
  const patterns = [
    /<meta[^>]+property=["']og:video(?::secure_url|:url)?["'][^>]+content=["']([^"']+)["']/gi,
    /"(?:video_url|videoUrl|contentUrl|hls|mp4|url)"\s*:\s*"(https?:\/\/[^"']+?\.(?:mp4|m3u8)[^"']*)"/gi,
    /(https?:\/\/[^"'\s)]+?\.mp4[^"'\s)]*)/gi,
    /(https?:\/\/[^"'\s)]+?\.m3u8[^"'\s)]*)/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const cand = (m[1] || '').replace(/\\u002F/g, '/').replace(/\\\//g, '/');
      if (cand.startsWith('http')) urls.add(cand);
    }
  }
  return Array.from(urls);
}

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
    if (action === 'clip') return await clip(req, res);
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

// Resuelve la URL real del video de un clip/short de ML a partir del link
// que da "Compartir" (o del link del producto). Body: { url }
async function clip(req, res) {
  const { url } = req.body || {};
  if (!url || !/^https?:\/\//.test(url)) {
    return res.status(400).json({ ok: false, error: 'Pegá el link del clip (el de "Compartir")' });
  }

  // short_id del link de compartir, si viene.
  let shortId = null;
  try { shortId = new URL(url).searchParams.get('short_id'); } catch {}

  const tried = [];
  const found = new Set();
  let rawSnippet = '';

  // Candidatos a consultar: la propia página + posibles endpoints internos.
  const candidates = [url];
  if (shortId) {
    candidates.push(`https://www.mercadolibre.com.ar/clips/api/reproductions/${shortId}`);
    candidates.push(`https://www.mercadolibre.com.ar/clips/api/shorts/${shortId}`);
    candidates.push(`https://frontend.mercadolibre.com/clips/${shortId}`);
  }

  for (const c of candidates) {
    try {
      const r = await fetchText(c);
      tried.push({ url: c, status: r.status, len: (r.body || '').length });
      for (const v of extractVideoUrls(r.body || '')) found.add(v);
      if (found.size) break;
      // guardo un pedazo alrededor de la 1ª mención de video/mp4/short para diagnóstico
      if (!rawSnippet) {
        const body = r.body || '';
        const idx = body.search(/mp4|m3u8|video_url|videoUrl|"video"|short_id/i);
        if (idx >= 0) rawSnippet = body.slice(Math.max(0, idx - 200), idx + 800);
      }
    } catch (e) {
      tried.push({ url: c, error: e.message });
    }
  }

  return res.status(200).json({
    ok: found.size > 0,
    shortId,
    videos: Array.from(found),
    tried,
    rawSnippet: found.size ? undefined : (rawSnippet || '(sin pistas de video en el HTML)'),
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
