import { httpRequest, cors } from '../../lib/http.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { title } = req.body || {};
  if (!title) return res.status(400).json({ ok: false, error: 'Falta title' });

  try {
    const r = await httpRequest('GET',
      'https://api.mercadolibre.com/sites/MLA/category_predictor/predict?title=' + encodeURIComponent(title),
      {});
    if (r.status !== 200) {
      return res.status(200).json({ ok: false, error: r.body?.message || ('HTTP ' + r.status) });
    }
    return res.status(200).json({
      ok: true,
      categoryId: r.body.id,
      categoryName: r.body.name,
      path: (r.body.path_from_root || []).map(p => p.name).join(' › ')
    });
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
