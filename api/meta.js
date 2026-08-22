import { httpRequest, cors } from '../lib/http.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

// Conector Meta (Facebook + Instagram) en una sola función serverless.
//   POST /api/meta?action=exchange         -> OAuth code -> token largo + páginas + IG
//   POST /api/meta?action=publish          -> publica en página FB y/o IG
//   POST /api/meta?action=google_exchange  -> OAuth de Google (Contactos): code -> refresh_token
//        (va acá para no superar el límite de funciones serverless de Vercel)
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const action = (req.query?.action || req.body?.action || '').toString();
  try {
    if (action === 'exchange') return await exchange(req, res);
    if (action === 'publish') return await publish(req, res);
    if (action === 'google_exchange') return await googleExchange(req, res);
    return res.status(400).json({ ok: false, error: 'action inválida (exchange | publish | google_exchange)' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// OAuth de Google (People API / Contactos): intercambia el code por refresh_token.
// Resultado -> variables .env del bot: GOOGLE_CONTACTS_CLIENT_ID/_CLIENT_SECRET/_REFRESH_TOKEN.
async function googleExchange(req, res) {
  const { clientId, clientSecret, code, redirectUri } = req.body || {};
  if (!clientId || !clientSecret || !code || !redirectUri) {
    return res.status(400).json({ ok: false, error: 'Faltan: clientId, clientSecret, code, redirectUri' });
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri,
  }).toString();
  const r = await httpRequest('POST', 'https://oauth2.googleapis.com/token', {
    'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json',
  }, body);
  if (r.status !== 200 || !r.body?.refresh_token) {
    return res.status(200).json({
      ok: false,
      error: (r.body?.error_description || r.body?.error || ('HTTP ' + r.status))
        + (r.body?.refresh_token === undefined ? ' (sin refresh_token: revocá el acceso previo en myaccount.google.com/permissions y reautorizá)' : ''),
      details: r.body,
    });
  }
  return res.status(200).json({
    ok: true, refreshToken: r.body.refresh_token, accessToken: r.body.access_token,
    expiresIn: r.body.expires_in, scope: r.body.scope,
  });
}

// Intercambia el code de OAuth por token de larga duración y devuelve
// las páginas de Facebook administrables + su cuenta de Instagram Business.
async function exchange(req, res) {
  const { clientId, clientSecret, code, redirectUri } = req.body || {};
  if (!clientId || !clientSecret || !code || !redirectUri) {
    return res.status(400).json({ ok: false, error: 'Faltan: clientId, clientSecret, code, redirectUri' });
  }

  // 1) code -> token corto
  const shortUrl = `${GRAPH}/oauth/access_token?` + new URLSearchParams({
    client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code
  }).toString();
  const short = await httpRequest('GET', shortUrl, {});
  if (short.status !== 200 || !short.body?.access_token) {
    return res.status(200).json({ ok: false, error: short.body?.error?.message || ('HTTP ' + short.status), details: short.body });
  }

  // 2) token corto -> token largo (~60 días)
  const longUrl = `${GRAPH}/oauth/access_token?` + new URLSearchParams({
    grant_type: 'fb_exchange_token', client_id: clientId, client_secret: clientSecret, fb_exchange_token: short.body.access_token
  }).toString();
  const long = await httpRequest('GET', longUrl, {});
  const userToken = long.body?.access_token || short.body.access_token;
  const expiresIn = long.body?.expires_in || short.body.expires_in || 5184000;

  // 3) páginas administrables (cada una con su page access token + IG)
  const pagesUrl = `${GRAPH}/me/accounts?` + new URLSearchParams({
    fields: 'id,name,access_token,instagram_business_account{id,username}', access_token: userToken, limit: '50'
  }).toString();
  const pagesRes = await httpRequest('GET', pagesUrl, {});
  if (pagesRes.status >= 400) {
    return res.status(200).json({ ok: false, error: pagesRes.body?.error?.message || ('HTTP ' + pagesRes.status), details: pagesRes.body });
  }

  const pages = (pagesRes.body?.data || []).map(p => ({
    id: p.id,
    name: p.name,
    accessToken: p.access_token,
    igId: p.instagram_business_account?.id || null,
    igUsername: p.instagram_business_account?.username || null
  }));

  return res.status(200).json({ ok: true, userToken, expiresIn, pages });
}

// Publica en página FB (feed/photos) e IG (container + media_publish).
// Body: { pageToken, pageId, igId, message, imageUrl, targets:{fb,ig} }
async function publish(req, res) {
  const { pageToken, pageId, igId, message = '', imageUrl = '', targets = {} } = req.body || {};
  if (!pageToken) return res.status(400).json({ ok: false, error: 'Falta pageToken (autorizá Meta en Conexiones)' });

  const wantFb = targets.fb !== false;
  const wantIg = targets.ig === true;
  const results = {};

  // ---- Facebook ----
  if (wantFb && pageId) {
    let fbUrl;
    if (imageUrl) {
      fbUrl = `${GRAPH}/${pageId}/photos?` + new URLSearchParams({ url: imageUrl, caption: message, access_token: pageToken }).toString();
    } else {
      fbUrl = `${GRAPH}/${pageId}/feed?` + new URLSearchParams({ message, access_token: pageToken }).toString();
    }
    const r = await httpRequest('POST', fbUrl, {});
    results.fb = r.status < 400
      ? { ok: true, id: r.body?.post_id || r.body?.id }
      : { ok: false, error: r.body?.error?.message || ('HTTP ' + r.status) };
  }

  // ---- Instagram (requiere imageUrl pública) ----
  if (wantIg && igId) {
    if (!imageUrl) {
      results.ig = { ok: false, error: 'Instagram requiere una imagen con URL pública' };
    } else {
      const createUrl = `${GRAPH}/${igId}/media?` + new URLSearchParams({ image_url: imageUrl, caption: message, access_token: pageToken }).toString();
      const c = await httpRequest('POST', createUrl, {});
      if (c.status >= 400 || !c.body?.id) {
        results.ig = { ok: false, error: c.body?.error?.message || ('HTTP ' + c.status) };
      } else {
        const pubUrl = `${GRAPH}/${igId}/media_publish?` + new URLSearchParams({ creation_id: c.body.id, access_token: pageToken }).toString();
        const p = await httpRequest('POST', pubUrl, {});
        results.ig = p.status < 400
          ? { ok: true, id: p.body?.id }
          : { ok: false, error: p.body?.error?.message || ('HTTP ' + p.status) };
      }
    }
  }

  const anyOk = Object.values(results).some(r => r.ok);
  return res.status(200).json({ ok: anyOk, results });
}
