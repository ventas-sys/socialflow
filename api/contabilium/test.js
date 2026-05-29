import { httpRequest, cors } from '../_http.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { clientId, clientSecret } = req.body || {};
  if (!clientId || !clientSecret) return res.status(400).json({ ok: false, error: 'Falta clientId y/o clientSecret' });

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret
  }).toString();

  try {
    const r = await httpRequest('POST', 'https://rest.contabilium.com/token', {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    }, body);

    if (r.status !== 200 || !r.body?.access_token) {
      return res.status(200).json({
        ok: false,
        error: r.body?.error_description || r.body?.error || ('HTTP ' + r.status),
        details: r.body
      });
    }

    return res.status(200).json({
      ok: true,
      info: {
        accessToken: r.body.access_token,
        tokenType: r.body.token_type,
        expiresIn: r.body.expires_in,
        scope: r.body.scope
      }
    });
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
