// OAuth de Google (People API / Contactos), para el Agente de Contactos del bot.
//   POST /api/google/exchange   -> intercambia el "code" por refresh_token
// Mismo patrón que api/ml/exchange.js. Los valores resultantes se cargan como
// variables de entorno del bridge: GOOGLE_CONTACTS_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN.
import { httpRequest, cors } from '../_http.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { clientId, clientSecret, code, redirectUri } = req.body || {};
    if (!clientId || !clientSecret || !code || !redirectUri) {
      return res.status(400).json({ ok: false, error: 'Faltan: clientId, clientSecret, code, redirectUri' });
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }).toString();

    const r = await httpRequest('POST', 'https://oauth2.googleapis.com/token', {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    }, body);

    if (r.status !== 200 || !r.body?.refresh_token) {
      return res.status(200).json({
        ok: false,
        error: r.body?.error_description || r.body?.error || ('HTTP ' + r.status) +
          (r.body?.refresh_token === undefined ? ' (sin refresh_token: agregá prompt=consent y access_type=offline, o revocá el acceso previo y reautorizá)' : ''),
        details: r.body,
      });
    }

    return res.status(200).json({
      ok: true,
      refreshToken: r.body.refresh_token,
      accessToken: r.body.access_token,
      expiresIn: r.body.expires_in,
      scope: r.body.scope,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
