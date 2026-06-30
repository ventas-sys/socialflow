import { httpRequest, cors } from '../_http.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

// Intercambia el code de OAuth por un token de larga duración y devuelve
// las páginas de Facebook administrables + su cuenta de Instagram Business.
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { clientId, clientSecret, code, redirectUri } = req.body || {};
  if (!clientId || !clientSecret || !code || !redirectUri) {
    return res.status(400).json({ ok: false, error: 'Faltan: clientId, clientSecret, code, redirectUri' });
  }

  try {
    // 1) code -> token de corta duración
    const shortUrl = `${GRAPH}/oauth/access_token?` + new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code
    }).toString();
    const short = await httpRequest('GET', shortUrl, {});
    if (short.status !== 200 || !short.body?.access_token) {
      return res.status(200).json({
        ok: false,
        error: short.body?.error?.message || ('HTTP ' + short.status),
        details: short.body
      });
    }

    // 2) token corto -> token largo (~60 días)
    const longUrl = `${GRAPH}/oauth/access_token?` + new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: clientId,
      client_secret: clientSecret,
      fb_exchange_token: short.body.access_token
    }).toString();
    const long = await httpRequest('GET', longUrl, {});
    const userToken = long.body?.access_token || short.body.access_token;
    const expiresIn = long.body?.expires_in || short.body.expires_in || 5184000; // 60d default

    // 3) páginas administrables (cada una trae su propio page access token)
    const pagesUrl = `${GRAPH}/me/accounts?` + new URLSearchParams({
      fields: 'id,name,access_token,instagram_business_account{id,username}',
      access_token: userToken,
      limit: '50'
    }).toString();
    const pagesRes = await httpRequest('GET', pagesUrl, {});
    if (pagesRes.status >= 400) {
      return res.status(200).json({
        ok: false,
        error: pagesRes.body?.error?.message || ('HTTP ' + pagesRes.status),
        details: pagesRes.body
      });
    }

    const pages = (pagesRes.body?.data || []).map(p => ({
      id: p.id,
      name: p.name,
      accessToken: p.access_token,
      igId: p.instagram_business_account?.id || null,
      igUsername: p.instagram_business_account?.username || null
    }));

    return res.status(200).json({
      ok: true,
      userToken,
      expiresIn,
      pages
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
