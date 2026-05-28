import { httpRequest, cors } from '../_http.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, storeId } = req.body || {};
  if (!token || !storeId) return res.status(400).json({ ok: false, error: 'Falta token y/o storeId' });

  try {
    const r = await httpRequest('GET', `https://api.tiendanube.com/v1/${storeId}/store`, {
      'Authentication': 'bearer ' + token,
      'User-Agent': 'Uniproveedores Agencia (ventas@distribuidorauniverso.com)'
    });
    if (r.status !== 200) {
      return res.status(200).json({
        ok: false,
        error: r.body?.message || r.body?.description || ('HTTP ' + r.status),
        status: r.status,
        details: r.body
      });
    }
    return res.status(200).json({
      ok: true,
      info: {
        storeId: r.body.id,
        storeName: r.body.name?.es || r.body.name?.pt || (typeof r.body.name === 'string' ? r.body.name : 'Mi Tienda'),
        url: r.body.url,
        country: r.body.country,
        currency: r.body.main_currency,
        plan: r.body.plan_name,
        domains: r.body.domains
      }
    });
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
