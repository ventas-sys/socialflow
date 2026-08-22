// Helpers de la API de Mercado Libre para el Agente de Preguntas.
import { httpRequest } from '../../api/_http.js';
import { readToken, writeToken } from './token-store.js';

const ML = 'https://api.mercadolibre.com';

// Renueva el access_token con un refresh_token puntual.
// OJO: ML devuelve un refresh_token NUEVO y invalida el que acabamos de usar
// (es de un solo uso) -> hay que guardar el nuevo (ver getAccessToken).
export async function refreshAccessToken(acc, refreshToken) {
  const rt = refreshToken || acc.refresh_token;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: acc.client_id,
    client_secret: acc.client_secret,
    refresh_token: rt,
  }).toString();
  const r = await httpRequest('POST', ML + '/oauth/token',
    { 'Content-Type': 'application/x-www-form-urlencoded' }, body);
  if (r.status >= 300 || !r.body?.access_token) {
    const code = r.body?.error || ('http_' + r.status);
    const detalle = r.body?.message || r.body?.error_description || JSON.stringify(r.body || {}).slice(0, 200);
    const e = new Error(code === 'invalid_grant'
      ? `El refresh_token de la cuenta "${acc.label || '?'}" ya no sirve (vencido o YA USADO). `
        + 'ML rota el refresh_token en cada renovación: reautorizá la cuenta en /conexiones y actualizá ML_ACCOUNTS '
        + '(y configurá KV_REST_API_URL/KV_REST_API_TOKEN para que el token rotado se guarde solo). Detalle: ' + detalle
      : `No se pudo refrescar el token de "${acc.label || 'cuenta'}" (${code}): ${detalle}`);
    e.code = code;
    throw e;
  }
  return {
    access_token: r.body.access_token,
    refresh_token: r.body.refresh_token || rt,
    expires_in: Number(r.body.expires_in) || 0,
  };
}

// Access token listo para usar, con cache + persistencia del refresh rotado.
// - Reusa el access_token guardado mientras no esté por vencer (ML: ~6 hs).
// - Si hay que renovar, guarda el refresh_token NUEVO en el store.
// - Si el guardado falla con invalid_grant, reintenta UNA vez con el de
//   ML_ACCOUNTS (por si el store quedó desactualizado).
export async function getAccessToken(acc) {
  const now = Date.now();
  const saved = await readToken(acc.label);
  if (saved?.access_token && Number(saved.expires_at) > now + 60000) return saved.access_token;

  const guardado = saved?.refresh_token || null;
  let t;
  try {
    t = await refreshAccessToken(acc, guardado || acc.refresh_token);
  } catch (e) {
    if (!guardado || guardado === acc.refresh_token || e.code !== 'invalid_grant') throw e;
    t = await refreshAccessToken(acc, acc.refresh_token); // fallback al de ML_ACCOUNTS
  }
  await writeToken(acc.label, {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: now + (t.expires_in ? t.expires_in * 1000 : 5 * 3600 * 1000),
    updated_at: new Date().toISOString(),
  });
  return t.access_token;
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
// Devuelve ok=false + error cuando ML la rechaza (antes esto pasaba en silencio
// y parecía que el bot había respondido cuando en realidad no publicó nada).
export async function postAnswer(token, questionId, text) {
  const r = await httpRequest('POST', ML + '/answers',
    { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    { question_id: questionId, text });
  const ok = r.status >= 200 && r.status < 300;
  return {
    ok,
    status: r.status,
    body: r.body,
    error: ok ? null : (r.body?.message || r.body?.error || ('HTTP ' + r.status)),
  };
}

// Datos de la cuenta dueña del token (para verificar que el user_id coincida).
export async function getMe(token) {
  return mlGetChecked(token, '/users/me');
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
