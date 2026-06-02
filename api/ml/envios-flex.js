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
    if (offset > 1000) break; // safety
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

function pickDriver(sh) {
  // Probamos los campos posibles donde ML expone el chofer/transportista en Flex.
  // Si ninguno matchea queda "Sin asignar" y el sample raw permite ver el shape real.
  return sh?.driver?.full_name ||
    sh?.driver?.name ||
    sh?.driver?.first_name ||
    (sh?.driver_id ? 'Driver ' + sh.driver_id : null) ||
    sh?.delivery_partner?.name ||
    sh?.tracking_method ||
    sh?.shipping_option?.name ||
    'Sin asignar';
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const { token, userId, from, to } = req.body || {};
  if (!token || !userId) return res.status(400).json({ ok: false, error: 'Falta token o userId. Conectá Mercado Libre en /conexiones.' });
  if (!from || !to) return res.status(400).json({ ok: false, error: 'Faltan fechas from/to (formato ISO con timezone)' });

  try {
    const orders = await fetchAllOrders(token, userId, from, to);
    const shipIds = [...new Set(orders.map(o => o.shipping?.id).filter(Boolean))];
    const shipments = await fetchShipmentsBatch(token, shipIds);
    const flex = shipments.filter(s => s.logistic_type === 'self_service');

    const byDriver = {};
    for (const sh of flex) {
      const k = pickDriver(sh);
      if (!byDriver[k]) byDriver[k] = { cantidad: 0, ids: [], orders: [] };
      byDriver[k].cantidad++;
      byDriver[k].ids.push(sh.id);
    }

    // Sample raw del primer Flex para poder inspeccionar el shape si "Sin asignar" toma todo.
    const sample = flex[0] || null;

    return res.status(200).json({
      ok: true,
      totalOrders: orders.length,
      totalShipments: shipments.length,
      totalFlex: flex.length,
      byDriver,
      sample
    });
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
