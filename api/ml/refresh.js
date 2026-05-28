import { httpRequest, cors } from '../_http.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

  try {
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
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
