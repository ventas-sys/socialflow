// Helpers de la API de Mercado Libre para el Agente de Preguntas.
import { httpRequest } from '../../api/_http.js';

const ML = 'https://api.mercadolibre.com';

// Renueva el access_token con el refresh_token de la cuenta.
export async function refreshAccessToken(acc) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: acc.client_id,
    client_secret: acc.client_secret,
    refresh_token: acc.refresh_token,
  }).toString();
  const r = await httpRequest('POST', ML + '/oauth/token',
    { 'Content-Type': 'application/x-www-form-urlencoded' }, body);
  if (r.status >= 300 || !r.body?.access_token) {
    throw new Error('No se pudo refrescar token de ' + (acc.label || 'cuenta') + ': ' + JSON.stringify(r.body).slice(0, 200));
  }
  return { access_token: r.body.access_token, refresh_token: r.body.refresh_token || acc.refresh_token };
}

async function mlGet(token, path) {
  const r = await httpRequest('GET', ML + path, { 'Authorization': 'Bearer ' + token });
  return r.body;
}

// Igual que mlGet pero valida el status HTTP - la usan solo las funciones
// nuevas del conector MCP para no cambiar el comportamiento de las funciones
// ya usadas en producción (api/ml/questions.js).
async function mlGetChecked(token, path) {
  const r = await httpRequest('GET', ML + path, { 'Authorization': 'Bearer ' + token });
  if (r.status >= 300) {
    throw new Error('ML API HTTP ' + r.status + ': ' + (r.body?.message || JSON.stringify(r.body).substring(0, 200)));
  }
  return r.body;
}

export async function getQuestion(token, questionId) {
  return mlGet(token, `/questions/${questionId}?api_version=4`);
}

export async function getItem(token, itemId) {
  return mlGet(token, `/items/${itemId}`);
}

// Preguntas sin responder de un vendedor (más nuevas primero).
export async function getUnanswered(token, sellerId, limit = 20) {
  return mlGet(token, `/questions/search?seller_id=${sellerId}&status=UNANSWERED&api_version=4&limit=${limit}&sort_fields=date_created&sort_types=DESC`);
}

// Todas las preguntas de una publicación (para detectar repetidos del mismo comprador).
export async function getItemQuestions(token, itemId, limit = 50) {
  return mlGet(token, `/questions/search?item=${itemId}&api_version=4&limit=${limit}&sort_fields=date_created&sort_types=DESC`);
}

// Preguntas recientes de un vendedor (todas, con su respuesta) -> para el registro/export.
export async function getRecentQuestions(token, sellerId, limit = 50) {
  return mlGet(token, `/questions/search?seller_id=${sellerId}&api_version=4&limit=${limit}&sort_fields=date_created&sort_types=DESC`);
}

// Busca productos (por texto) dentro del catálogo de un vendedor.
// Sirve para el cross-account (mismo producto en otra cuenta) y para
// recomendar OTRO artículo del catálogo de la misma cuenta.
export async function searchSellerItem(token, sellerId, query) {
  const q = encodeURIComponent((query || '').slice(0, 120));
  return mlGet(token, `/sites/MLA/search?seller_id=${sellerId}&q=${q}&limit=5`);
}

// Publica la respuesta a una pregunta.
export async function postAnswer(token, questionId, text) {
  const r = await httpRequest('POST', ML + '/answers',
    { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    { question_id: questionId, text });
  return { status: r.status, body: r.body };
}

// Descripción de una publicación.
export async function getItemDescription(token, itemId) {
  return mlGetChecked(token, `/items/${itemId}/description`);
}

// Reseñas de compradores de una publicación.
export async function getReviews(token, itemId) {
  return mlGetChecked(token, `/reviews/item/${itemId}?api_version=2`);
}

// Busca publicaciones propias del usuario (con filtros opcionales).
export async function searchMyItems(token, userId, opts = {}) {
  const { q, status, limit = 20, offset = 0 } = opts;
  let path = `/users/${userId}/items/search?limit=${limit}&offset=${offset}`;
  if (q) path += `&q=${encodeURIComponent(q)}`;
  if (status) path += `&status=${encodeURIComponent(status)}`;
  return mlGetChecked(token, path);
}

// Órdenes de un vendedor en un rango de fechas (pagina hasta juntar `limit`).
export async function getOrders(token, sellerId, from, to, limit = 200) {
  const orders = [];
  let offset = 0;
  const pageSize = 50;
  while (true) {
    const path = `/orders/search?seller=${sellerId}&order.date_created.from=${encodeURIComponent(from)}&order.date_created.to=${encodeURIComponent(to)}&limit=${pageSize}&offset=${offset}`;
    const r = await httpRequest('GET', ML + path, { 'Authorization': 'Bearer ' + token });
    if (r.status !== 200) throw new Error('ML orders HTTP ' + r.status + ': ' + (r.body?.message || JSON.stringify(r.body).substring(0, 200)));
    const results = r.body?.results || [];
    orders.push(...results);
    const total = r.body?.paging?.total || 0;
    if (orders.length >= total || results.length === 0) break;
    if (orders.length >= limit) break;
    offset += pageSize;
    if (offset > 1000) break;
  }
  return orders.slice(0, limit);
}

// Visitas de una publicación en una ventana de tiempo.
export async function getItemVisits(token, itemId, last = 30, unit = 'day') {
  return mlGetChecked(token, `/items/${itemId}/visits/time_window?last=${last}&unit=${unit}`);
}

// Visitas a todas las publicaciones de un usuario en un rango de fechas.
export async function getUserItemsVisits(token, userId, dateFrom, dateTo) {
  return mlGetChecked(token, `/users/${userId}/items_visits?date_from=${encodeURIComponent(dateFrom)}&date_to=${encodeURIComponent(dateTo)}`);
}

// Datos de un envío.
export async function getShipment(token, shipmentId) {
  return mlGetChecked(token, `/shipments/${shipmentId}`);
}

// Extrae un contexto compacto y útil del item para pasarle a la IA.
export function itemContext(item) {
  if (!item) return {};
  const atributos = (item.attributes || [])
    .filter(a => a.value_name)
    .map(a => `${a.name}: ${a.value_name}`);
  const variantes = (item.variations || []).map(v => {
    const combos = (v.attribute_combinations || []).map(c => `${c.name} ${c.value_name}`).join(', ');
    return `${combos || 'variante'} (stock ${v.available_quantity})`;
  });
  const logistic = item.shipping?.logistic_type || '';
  const envio = logistic === 'fulfillment' ? 'Mercado Envíos Full' : (logistic ? 'Mercado Envíos' : 'a coordinar');
  // ¿El producto tiene el COLOR como variante elegible? (para no prometer un color puntual si no lo es)
  const tieneColor = (item.variations || []).some(v =>
    (v.attribute_combinations || []).some(c => /color/i.test(c.name || ''))
  );
  return {
    title: item.title,
    price: item.price,
    available_quantity: item.available_quantity,
    permalink: item.permalink,
    envio,
    logistic_type: logistic,
    atributos,
    variantes,
    tieneColor,
  };
}
