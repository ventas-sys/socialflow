import { httpRequest, cors } from '../_http.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

  try {
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
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
