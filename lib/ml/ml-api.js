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
