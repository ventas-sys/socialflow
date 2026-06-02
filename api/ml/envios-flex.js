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

async function fetchAssignmentsBatch(token, ids) {
  const headers = { 'Authorization': 'Bearer ' + token };
  const out = {};
  const batchSize = 8;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const promises = batch.map(id =>
      httpRequest('GET', 'https://api.mercadolibre.com/flex/sites/MLA/shipments/' + id + '/assignment/v1', headers, null)
        .then(r => ({ id, body: r.status === 200 ? r.body : null }))
        .catch(() => ({ id, body: null }))
    );
    const res = await Promise.all(promises);
    for (const { id, body } of res) if (body) out[id] = body;
  }
  return out;
}

function pickDriver(sh, assignment) {
  // Prioridad: el endpoint de assignment expone el chofer real asignado.
  // Si no hay assignment caemos a campos del shipment estandar.
  return assignment?.driver?.full_name ||
    assignment?.driver?.name ||
    assignment?.assignee?.full_name ||
    assignment?.assignee?.name ||
    assignment?.operator?.name ||
    (assignment?.driver?.first_name && assignment?.driver?.last_name ? assignment.driver.first_name + ' ' + assignment.driver.last_name : null) ||
    sh?.driver?.full_name ||
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

    const assignments = await fetchAssignmentsBatch(token, flex.map(s => s.id));

    const byDriver = {};
    for (const sh of flex) {
      const k = pickDriver(sh, assignments[sh.id]);
      if (!byDriver[k]) byDriver[k] = { cantidad: 0, ids: [], orders: [] };
      byDriver[k].cantidad++;
      byDriver[k].ids.push(sh.id);
    }

    const detalle = flex.map(sh => {
      const a = sh.receiver_address || {};
      const calle = [a.street_name, a.street_number].filter(Boolean).join(' ');
      const zona = [a.city?.name, a.state?.name].filter(Boolean).join(', ');
      const direccion = [calle, a.zip_code, zona].filter(Boolean).join(' · ');
      return {
        id: sh.id,
        fecha: sh.date_created || sh.status_history?.date_handling || null,
        chofer: pickDriver(sh, assignments[sh.id]),
        direccion,
        referencia: a.comment || '',
        recibe: a.receiver_name || ''
      };
    }).sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));

    const sample = flex[0] || null;
    const sampleAssignment = flex[0] ? assignments[flex[0].id] : null;

    // Sonda diagnostica: probamos varios endpoints contra el primer envio Flex
    // para encontrar cual devuelve el operador asignado (PABLO CHEN).
    let diagnostico = null;
    if (flex[0]) {
      const id = flex[0].id;
      const headers = { 'Authorization': 'Bearer ' + token };
      const endpoints = [
        '/flex/sites/MLA/shipments/' + id + '/assignment/v1',
        '/flex/sites/MLA/shipments/' + id,
        '/shipments/' + id + '/items',
        '/shipments/' + id + '/route',
        '/shipments/' + id + '/sla',
        '/sites/MLA/users/' + userId + '/operators',
        '/users/' + userId + '/drivers',
        '/flex/sites/MLA/users/' + userId + '/operators'
      ];
      const results = await Promise.all(endpoints.map(ep =>
        httpRequest('GET', 'https://api.mercadolibre.com' + ep, headers, null)
          .then(r => ({ endpoint: ep, status: r.status, body: r.body }))
          .catch(e => ({ endpoint: ep, status: 'error', body: { error: e.message } }))
      ));
      diagnostico = { shipmentId: id, results };
    }

    return res.status(200).json({
      ok: true,
      totalOrders: orders.length,
      totalShipments: shipments.length,
      totalFlex: flex.length,
      totalAssignments: Object.keys(assignments).length,
      byDriver,
      detalle,
      sample,
      sampleAssignment,
      diagnostico
    });
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
