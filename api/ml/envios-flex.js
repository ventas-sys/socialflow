import { httpRequest, cors } from '../_http.js';

async function fetchAllOrders(token, userId, from, to) {
  const headers = { 'Authorization': 'Bearer ' + token };
  const orders = [];
  let offset = 0;
  const limit = 50;
  while (true) {
    const url = 'https://api.mercadolibre.com/orders/search?seller=' + userId +
      '&order.date_created.from=' + encodeURIComponent(from) +
      '&order.date_created.to=' + encodeURIComponent(to) +
      '&limit=' + limit + '&offset=' + offset;
    const r = await httpRequest('GET', url, headers, null);
    if (r.status !== 200) throw new Error('ML orders HTTP ' + r.status + ': ' + (r.body?.message || JSON.stringify(r.body).substring(0, 200)));
    const results = r.body?.results || [];
    orders.push(...results);
    const total = r.body?.paging?.total || 0;
    if (orders.length >= total || results.length === 0) break;
    offset += limit;
    if (offset > 1000) break;
  }
  return orders;
}

async function fetchShipmentsBatch(token, ids) {
  const headers = { 'Authorization': 'Bearer ' + token };
  const out = [];
  const batchSize = 8;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const promises = batch.map(id =>
      httpRequest('GET', 'https://api.mercadolibre.com/shipments/' + id, headers, null)
        .then(r => r.status === 200 ? r.body : null)
        .catch(() => null)
    );
    const res = await Promise.all(promises);
    out.push(...res.filter(Boolean));
  }
  return out;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const { token, userId, from, to } = req.body || {};
  if (!token || !userId) return res.status(400).json({ ok: false, error: 'Falta token o userId. Conectá Mercado Libre en /conexiones.' });
  if (!from || !to) return res.status(400).json({ ok: false, error: 'Faltan fechas from/to (formato ISO con timezone)' });

  try {
    const me = await httpRequest('GET', 'https://api.mercadolibre.com/users/me', { 'Authorization': 'Bearer ' + token }, null)
      .then(r => r.status === 200 ? r.body : null).catch(() => null);
    const transportista = me?.nickname || 'UNIPROVEEDORES';

    const orders = await fetchAllOrders(token, userId, from, to);
    const shipIds = [...new Set(orders.map(o => o.shipping?.id).filter(Boolean))];
    const shipments = await fetchShipmentsBatch(token, shipIds);
    const flex = shipments.filter(s => s.logistic_type === 'self_service');

    const detalle = flex.map(sh => {
      const a = sh.receiver_address || {};
      const calle = [a.street_name, a.street_number].filter(Boolean).join(' ');
      const zona = [a.city?.name, a.state?.name].filter(Boolean).join(', ');
      const direccion = [calle, a.zip_code, zona].filter(Boolean).join(' · ');
      return {
        id: sh.id,
        fecha: sh.date_created || sh.status_history?.date_handling || null,
        chofer: transportista,
        direccion,
        referencia: a.comment || '',
        recibe: a.receiver_name || ''
      };
    }).sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));

    return res.status(200).json({
      ok: true,
      totalOrders: orders.length,
      totalShipments: shipments.length,
      totalFlex: flex.length,
      transportista,
      detalle
    });
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
