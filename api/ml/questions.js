// Agente IA de Preguntas de Mercado Libre — endpoint consolidado.
//
//   POST /api/ml/questions?action=test         -> ver cuentas configuradas (ML_ACCOUNTS)
//   POST /api/ml/questions?action=unanswered   -> lista preguntas sin responder { account }
//   POST /api/ml/questions?action=answer       -> genera (y opcional postea) 1 respuesta
//                                                 { account, question_id, autopost }
//   POST /api/ml/questions   (webhook de ML)    -> ML manda { resource, user_id, topic }
//                                                 => responde la pregunta automáticamente
//
// Config: variable de entorno ML_ACCOUNTS (JSON). Ver lib/ml/qa-config.js.
import { cors } from '../_http.js';
import { loadAccounts, findAccountByUser, findAccountByLabel, otherAccount } from '../../lib/ml/qa-config.js';
import { refreshAccessToken, getQuestion, getItem, getUnanswered, getItemQuestions, getRecentQuestions, searchSellerItem, postAnswer, itemContext } from '../../lib/ml/ml-api.js';
import { generateAnswer } from '../../lib/ml/qa-brain.js';

async function tokenOf(acc) {
  const t = await refreshAccessToken(acc);
  return t.access_token;
}

// ¿La pregunta pide retiro/ubicación y estamos en la cuenta Full? -> cross-account.
function wantsPickup(text, mode) {
  if (mode !== 'full') return false;
  return /\bretir|\blocal\b|pasar a buscar|sucursal|retiro|d[oó]nde|direcci[oó]n|ubica|\bzona\b|\bbarrio\b|paso a|puedo ir|est[aá]n\b|est[aá]s\b/i.test(text || '');
}

// Palabras "de peso" de un texto (para buscar y para medir relevancia).
function significantWords(s) {
  return String(s || '').toLowerCase().split(/\s+/).filter(w => w.length >= 4);
}

// Limpia la pregunta para buscar el producto en el catálogo (saca saludos y palabras de relleno).
function productQuery(text) {
  return String(text || '')
    .replace(/hola|buenas|buen d[ií]a|gracias|por favor|c[oó]mo est[aá]s?|que tal/gi, ' ')
    .replace(/[¿?¡!.,]/g, ' ')
    .replace(/\b(ten[eé]s|tienen|vend[eé]n?|manejan|hay|busco|necesito|quiero|otro|otra|otros|otras|aparte|adem[aá]s|para|el|la|los|las|un|una|de|del|que|cuanto|cu[aá]nto|mide|medida|medidas|color|stock|env[ií]os?|precio|factura|con|sin|este|esta|sirve|viene)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 60);
}

// ¿El cliente YA compró y quiere agregar/cambiar algo del pedido? -> no se puede.
function alreadyPurchased(text) {
  return /ya compr|reci[eé]n compr|hice (una|la|mi) compra|ya pagu|ya hice (el|un) pedido|agregar.*al pedido|sumar.*al pedido|al pedido\b|cambiar (el|la|mi) (pedido|compra|orden)|modificar (el|la|mi) (pedido|compra|orden)/i.test(text || '');
}

// ¿Pregunta por CANTIDAD / compra grande? -> ofrecer precio por mayor.
function wantsWholesale(text) {
  const t = String(text || '');
  if (/\bpor mayor\b|x\s*mayor|al por mayor|mayorista|revend|reventa|docena|\bbulto\b|\bpacks?\b|\bcajas?\b|descuento por cantidad|por cantidad|mejor precio/i.test(t)) return true;
  // "18 packs", "50 unidades", "x 20", "20u" -> cantidad de 6 o más
  const m = t.match(/(?:^|\D)(\d{1,4})\s*(unidad|unidades|packs?|cajas?|docenas?|u\b|piezas?)/i) || t.match(/\bx\s*(\d{1,4})\b/i);
  if (m && Number(m[1]) >= 6) return true;
  return false;
}

// ¿El cliente pregunta por OTRO artículo / quiere llevar varios? -> recomendar del catálogo + carrito.
// Dispara por palabras clave ("otro", "aparte"...) O cuando menciona un producto (>=2 palabras de peso).
function wantsOtherProduct(text) {
  if (/\botr[oa]s?\b|\baparte\b|\badem[aá]s\b|cat[aá]logo|lista de precio|\bvarios\b|\bcombo\b|carrito|\bvend[eé]n?\b|\bmanejan\b|consigu|m[aá]s productos|junto con|llevar (varios|todo)/i.test(text || '')) return true;
  return significantWords(productQuery(text)).length >= 2;
}

// Link público del catálogo del vendedor filtrado por palabra, ej:
//   https://listado.mercadolibre.com.ar/disco_CustId_46539072
// Muestra TODOS los productos de esa cuenta que matchean la palabra (siempre funciona, sin API).
function catalogUrl(userId, query) {
  const slug = String(query || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // saca acentos
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const base = 'https://listado.mercadolibre.com.ar/';
  return slug ? `${base}${slug}_CustId_${userId}` : `${base}_CustId_${userId}`;
}

// Normaliza texto para comparar preguntas repetidas.
function normText(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Contexto del comprador sobre esta publicación:
// - escalate: repite la pregunta o ya va por la 4ta -> lo atiende un humano (no respondemos).
// - isFollowup: ya preguntó antes -> la respuesta va SIN saludo ("hola cómo estás").
async function buyerContext(token, q) {
  const buyerId = q?.from?.id;
  if (!buyerId) return { escalate: false, isFollowup: false };
  try {
    const data = await getItemQuestions(token, q.item_id, 50);
    const mine = (data?.questions || []).filter(x => x?.from?.id === buyerId);
    const norm = normText(q.text);
    const iguales = mine.filter(x => normText(x.text) === norm);
    const escalate = mine.length > 3 || iguales.length >= 2; // 4ta pregunta o repetida
    const isFollowup = mine.length > 1;                       // ya preguntó antes (no volver a saludar)
    return { escalate, isFollowup };
  } catch {
    return { escalate: false, isFollowup: false };
  }
}

// Flujo central: contexto del item + (cross-account) + IA + (postear).
async function answerFlow({ acc, accounts, q, autopost }) {
  const token = await tokenOf(acc);

  // Anti-loop + saludo: si hay que escalar a humano, no respondemos ni posteamos.
  const { escalate, isFollowup } = await buyerContext(token, q);
  if (escalate) {
    return { question: q.text, item: null, answer: null, status: q.status, posted: null,
             escalated: true, note: 'Repetición/4ta pregunta: lo responde un humano (esperar 1h mínimo).' };
  }

  const item = await getItem(token, q.item_id);
  const ctx = itemContext(item);

  let cross = null;        // link exacto del MISMO producto en la cuenta LOCAL
  let crossLocal = null;   // fallback: catálogo LOCAL filtrado (si no aparece el exacto)
  if (wantsPickup(q.text, acc.mode)) {
    const other = otherAccount(accounts, acc);
    if (other) {
      // Catálogo LOCAL filtrado por las palabras del título (siempre disponible).
      const kw = significantWords(ctx.title || item?.title || '').slice(0, 2).join(' ');
      if (other.user_id) crossLocal = catalogUrl(other.user_id, kw);
      try {
        const ot = await tokenOf(other);
        const found = await searchSellerItem(ot, other.user_id, ctx.title || item?.title || '');
        cross = found?.results?.[0]?.permalink || null;
      } catch { /* si falla el cross-account, queda el link del catálogo LOCAL */ }
    }
  }

  // Si YA compró y quiere agregar/cambiar algo, NO ofrecemos carrito ni recomendaciones.
  const yaCompro = alreadyPurchased(q.text);

  // ¿Preguntan por OTRO artículo? -> buscarlo en el catálogo de ESTA cuenta y recomendar + carrito.
  let otro = null;
  let catalogo = null;
  if (!yaCompro && wantsOtherProduct(q.text)) {
    const query = productQuery(q.text);
    const qWords = significantWords(query);
    // Link del catálogo filtrado por la 1ª palabra de peso (siempre disponible, sin depender de la API).
    if (qWords.length) catalogo = catalogUrl(acc.user_id, qWords.slice(0, 2).join(' '));
    try {
      const found = await searchSellerItem(token, acc.user_id, query || ctx.title || '');
      // Relevante: distinto al item actual y que el título comparta alguna palabra de la pregunta.
      const r = (found?.results || []).find(x =>
        String(x.id) !== String(q.item_id) &&
        qWords.some(w => String(x.title || '').toLowerCase().includes(w))
      );
      if (r) otro = { title: r.title, permalink: r.permalink };
    } catch { /* si la búsqueda falla, seguimos con el link del catálogo */ }
  }

  const mayorista = wantsWholesale(q.text);

  const answer = await generateAnswer({ question: q.text, ctx, mode: acc.mode, cross, crossLocal, otro, catalogo, yaCompro, mayorista, saludar: !isFollowup });

  // Anti-repetición: solo posteamos si sigue SIN responder (ML permite 1 sola respuesta).
  let posted = null;
  if (autopost && q.status === 'UNANSWERED') {
    posted = await postAnswer(token, q.id, answer);
  }
  return { question: q.text, item: ctx.title, answer, status: q.status, posted };
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = (req.query?.action || req.body?.action || '').toString();
  const accounts = loadAccounts();

  // Health-check: ML (o el navegador) puede pegarle con GET para validar la URL.
  if (req.method === 'GET' && !action) {
    return res.status(200).json({ ok: true, service: 'ml-questions', accounts: accounts.length });
  }

  try {
    // Ver qué cuentas están cargadas (sin exponer secretos).
    if (action === 'test') {
      return res.status(200).json({
        ok: true,
        count: accounts.length,
        accounts: accounts.map(a => ({ label: a.label, mode: a.mode, user_id: a.user_id, has_refresh: !!a.refresh_token })),
      });
    }

    // WEBHOOK de Mercado Libre: notificación de pregunta nueva.
    // ML manda { resource: "/questions/{id}", user_id, topic }. Respondemos rápido.
    if (req.method === 'POST' && (action === 'webhook' || req.body?.resource)) {
      const { resource, user_id, topic } = req.body || {};
      if (topic && topic !== 'questions') return res.status(200).json({ ok: true, skipped: topic });
      const acc = findAccountByUser(accounts, user_id);
      if (!acc) return res.status(200).json({ ok: false, error: 'cuenta no configurada para user ' + user_id });
      const qId = String(resource || '').split('/').pop();
      const token = await tokenOf(acc);
      const q = await getQuestion(token, qId);
      if (!q || q.status !== 'UNANSWERED') return res.status(200).json({ ok: true, skipped: 'ya respondida o inexistente' });
      // Interruptor de seguridad: poné ML_AUTOANSWER=off en Vercel para pausar el auto-respondido.
      const autopost = process.env.ML_AUTOANSWER !== 'off';
      const out = await answerFlow({ acc, accounts, q, autopost });
      return res.status(200).json({ ok: true, autopost, ...out });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!accounts.length) return res.status(400).json({ error: 'No hay cuentas configuradas. Cargá ML_ACCOUNTS (JSON) en las variables de entorno.' });

    const acc = findAccountByLabel(accounts, (req.body?.account || '').toString()) || accounts[0];

    // Listar preguntas sin responder de una cuenta.
    if (action === 'unanswered') {
      const token = await tokenOf(acc);
      const data = await getUnanswered(token, acc.user_id, 20);
      return res.status(200).json({
        ok: true,
        account: acc.label,
        total: data?.total ?? (data?.questions?.length || 0),
        questions: (data?.questions || []).map(q => ({ id: q.id, text: q.text, item_id: q.item_id, date: q.date_created })),
      });
    }

    // Registro: preguntas recientes con su respuesta (para exportar a Excel).
    if (action === 'log') {
      const token = await tokenOf(acc);
      const limit = Math.min(Number(req.body?.limit) || 50, 100);
      const data = await getRecentQuestions(token, acc.user_id, limit);
      return res.status(200).json({
        ok: true,
        account: acc.label,
        total: data?.total ?? (data?.questions?.length || 0),
        rows: (data?.questions || []).map(q => ({
          fecha: q.date_created,
          item_id: q.item_id,
          estado: q.status,
          comprador: q.from?.id ?? '',
          pregunta: q.text || '',
          respuesta: q.answer?.text || '',
          fecha_respuesta: q.answer?.date_created || '',
        })),
      });
    }

    // Generar (y opcional postear) la respuesta de una pregunta puntual.
    if (action === 'answer') {
      const questionId = req.body?.question_id;
      const autopost = !!req.body?.autopost;
      if (!questionId) return res.status(400).json({ error: 'Falta question_id' });
      const token = await tokenOf(acc);
      const q = await getQuestion(token, questionId);
      if (!q) return res.status(404).json({ error: 'Pregunta no encontrada' });
      const out = await answerFlow({ acc, accounts, q, autopost });
      return res.status(200).json({ ok: true, account: acc.label, ...out });
    }

    // POST sin acción reconocida (ej: ping/validación de ML): respondemos 200 para no fallar.
    if (req.method === 'POST') return res.status(200).json({ ok: true, ignored: true });
    return res.status(400).json({ error: 'Acción desconocida: ' + (action || '(vacía)') });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
