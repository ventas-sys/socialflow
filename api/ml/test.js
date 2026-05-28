import { httpRequest, cors } from '../_http.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.body || {};
  if (!token) return res.status(400).json({ ok: false, error: 'Falta access_token' });

  try {
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
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
