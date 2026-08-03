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
import { refreshAccessToken, getQuestion, getItem, getUnanswered, searchSellerItem, postAnswer, itemContext } from '../../lib/ml/ml-api.js';
import { generateAnswer } from '../../lib/ml/qa-brain.js';

async function tokenOf(acc) {
  const t = await refreshAccessToken(acc);
  return t.access_token;
}

// ¿La pregunta pide retiro/local y estamos en la cuenta Full? -> cross-account.
function wantsPickup(text, mode) {
  if (mode !== 'full') return false;
  return /\bretir|\blocal\b|pasar a buscar|sucursal|retiro/i.test(text || '');
}

// ¿El cliente pregunta por OTRO artículo / quiere llevar varios? -> recomendar del catálogo + carrito.
function wantsOtherProduct(text) {
  return /\botr[oa]s?\b|\baparte\b|\badem[aá]s\b|cat[aá]logo|lista de precio|\bvarios\b|\bcombo\b|carrito|\bvend[eé]n?\b|\bmanejan\b|consigu|m[aá]s productos|junto con|llevar (varios|todo)/i.test(text || '');
}

// Limpia la pregunta para buscar el producto en el catálogo (saca saludos y palabras de relleno).
function productQuery(text) {
  return String(text || '')
    .replace(/hola|buenas|buen d[ií]a|gracias|por favor|c[oó]mo est[aá]s?|que tal/gi, ' ')
    .replace(/[¿?¡!.,]/g, ' ')
    .replace(/\b(ten[eé]s|tienen|vend[eé]n?|manejan|hay|busco|necesito|quiero|otro|otra|otros|otras|aparte|adem[aá]s|para|el|la|los|las|un|una|de|del|que|cuanto|cu[aá]nto|mide|color|con|sin|este|esta)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 60);
}

// Flujo central: contexto del item + (cross-account) + IA + (postear).
async function answerFlow({ acc, accounts, q, autopost }) {
  const token = await tokenOf(acc);
  const item = await getItem(token, q.item_id);
  const ctx = itemContext(item);

  let cross = null;
  if (wantsPickup(q.text, acc.mode)) {
    const other = otherAccount(accounts, acc);
    if (other) {
      try {
        const ot = await tokenOf(other);
        const found = await searchSellerItem(ot, other.user_id, ctx.title || item?.title || '');
        cross = found?.results?.[0]?.permalink || null;
      } catch { /* si falla el cross-account, seguimos sin él */ }
    }
  }

  // ¿Preguntan por OTRO artículo? -> buscarlo en el catálogo de ESTA cuenta y recomendar + carrito.
  let otro = null;
  if (wantsOtherProduct(q.text)) {
    try {
      const found = await searchSellerItem(token, acc.user_id, productQuery(q.text) || ctx.title || '');
      const r = (found?.results || []).find(x => String(x.id) !== String(q.item_id));
      if (r) otro = { title: r.title, permalink: r.permalink };
    } catch { /* si la búsqueda falla, seguimos sin recomendación */ }
  }

  const answer = await generateAnswer({ question: q.text, ctx, mode: acc.mode, cross, otro });

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
      const out = await answerFlow({ acc, accounts, q, autopost: true });
      return res.status(200).json({ ok: true, ...out });
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

    return res.status(400).json({ error: 'Acción desconocida: ' + (action || '(vacía)') });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
