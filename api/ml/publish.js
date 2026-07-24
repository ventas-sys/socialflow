import { httpRequest, cors } from '../../lib/http.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, item } = req.body || {};
  if (!token) return res.status(400).json({ ok: false, error: 'Falta access_token' });
  if (!item?.title || !item?.price || !item?.category_id) {
    return res.status(400).json({ ok: false, error: 'Faltan campos: title, price, category_id' });
  }

  const body = {
    title: item.title.substring(0, 60),
    category_id: item.category_id,
    price: Number(item.price),
    currency_id: 'ARS',
    available_quantity: Number(item.quantity || 1),
    buying_mode: 'buy_it_now',
    condition: item.condition || 'new',
    listing_type_id: item.listing_type_id || 'gold_special',
    description: { plain_text: (item.description || '').substring(0, 50000) },
    pictures: (item.pictures || []).map(url => ({ source: url })),
    attributes: item.attributes || []
  };

  try {
    const r = await httpRequest('POST', 'https://api.mercadolibre.com/items', {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    }, body);
    if (r.status >= 400) {
      return res.status(200).json({
        ok: false,
        error: r.body?.message || r.body?.error || ('HTTP ' + r.status),
        details: r.body?.cause || r.body
      });
    }
    return res.status(200).json({
      ok: true,
      itemId: r.body.id,
      permalink: r.body.permalink,
      status: r.body.status
    });
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
