// Agente IA de Preguntas de Mercado Libre — endpoint consolidado.
//
//   POST /api/ml/questions?action=test         -> ver cuentas configuradas (ML_ACCOUNTS)
//   POST /api/ml/questions?action=unanswered   -> lista preguntas sin responder { account }
//   POST /api/ml/questions?action=answer       -> genera (y opcional postea) 1 respuesta
//                                                 { account, question_id, autopost }
//   POST /api/ml/questions?action=sweep        -> responde TODAS las pendientes (red de
//                                                 seguridad si el webhook no entra)
//   GET  /api/ml/questions?action=diag         -> diagnóstico: token, cuentas, pendientes,
//                                                 último webhook y qué está fallando
//   GET  /api/ml/questions?action=conversion   -> control de conversión: cruza preguntas con
//                                                 ventas por SKU y dice qué le falta a cada
//                                                 publicación { dias, limit, account }
//   POST /api/ml/questions   (webhook de ML)    -> ML manda { resource, user_id, topic }
//                                                 => responde la pregunta automáticamente
//
// Config: variable de entorno ML_ACCOUNTS (JSON). Ver lib/ml/qa-config.js.
import { cors } from '../_http.js';
import { loadAccounts, findAccountByUser, findAccountByLabel, otherAccount, NEGOCIO } from '../../lib/ml/qa-config.js';
import { getAccessToken, getQuestion, getItem, getUnanswered, getItemQuestions, getRecentQuestions, searchSellerItem, postAnswer, itemContext, getMe, getOrders, getItemsBulk } from '../../lib/ml/ml-api.js';
import { construirReporte } from '../../lib/ml/conversion.js';
import { generateAnswer } from '../../lib/ml/qa-brain.js';
import { storeKind, markWebhook, lastWebhook } from '../../lib/ml/token-store.js';

// Access token de la cuenta (con cache + guardado del refresh rotado).
async function tokenOf(acc) {
  return getAccessToken(acc);
}

function autoanswerOn() {
  return process.env.ML_AUTOANSWER !== 'off';
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
  let postError = null;
  if (autopost && q.status === 'UNANSWERED') {
    posted = await postAnswer(token, q.id, answer);
    if (!posted.ok) {
      // Antes esto quedaba en silencio: ML rechazaba la respuesta y desde afuera
      // parecía que el bot había contestado. Ahora se ve en la respuesta y en los logs.
      postError = posted.error;
      console.error('[ml-questions] ML rechazó la respuesta', {
        question_id: q.id, item_id: q.item_id, status: posted.status, error: posted.error,
      });
    }
  }
  return { question: q.text, item: ctx.title, answer, status: q.status, posted, postError };
}

// Responde en tanda las preguntas pendientes de una cuenta (red de seguridad si
// el webhook de ML no entra: se procesan igual las que quedaron sin responder).
async function sweepAccount({ acc, accounts, limit, autopost }) {
  const token = await tokenOf(acc);
  const data = await getUnanswered(token, acc.user_id, limit);
  const pendientes = (data?.questions || []).slice(0, limit);
  const resultados = [];
  for (const q of pendientes) {
    try {
      const out = await answerFlow({ acc, accounts, q, autopost });
      resultados.push({ question_id: q.id, item_id: q.item_id, ...out });
    } catch (e) {
      console.error('[ml-questions] sweep falló en la pregunta ' + q.id, e.message);
      resultados.push({ question_id: q.id, item_id: q.item_id, question: q.text, error: e.message });
    }
  }
  return {
    account: acc.label,
    pendientes: data?.total ?? pendientes.length,
    procesadas: resultados.length,
    posteadas: resultados.filter(r => r.posted?.ok).length,
    resultados,
  };
}

// Control de conversión de una cuenta: preguntas + ventas del período + datos
// de las publicaciones, todo cruzado en lib/ml/conversion.js.
async function conversionCuenta({ acc, desde, hasta, limitPreguntas }) {
  const token = await tokenOf(acc);
  const [qdata, ordenes] = await Promise.all([
    getRecentQuestions(token, acc.user_id, limitPreguntas),
    getOrders(token, acc.user_id, desde.toISOString(), hasta.toISOString(), 300),
  ]);
  const preguntas = (qdata?.questions || [])
    .filter(q => new Date(q.date_created).getTime() >= desde.getTime());
  const ids = preguntas.map(q => q.item_id).filter(Boolean);
  let items = new Map();
  try {
    items = await getItemsBulk(token, ids);
  } catch { /* sin datos del item igual sale el reporte, solo sin fotos/SKU */ }
  return construirReporte({
    cuenta: acc.label, preguntas, ordenes, items,
    desde: desde.toISOString(), hasta: hasta.toISOString(),
  });
}

// Radiografía de una cuenta: token, identidad, pendientes y última actividad.
async function diagAccount(acc) {
  const d = { label: acc.label, mode: acc.mode, user_id: acc.user_id, tiene_refresh: !!acc.refresh_token };
  try {
    const token = await tokenOf(acc);
    d.token = 'OK';
    const me = await getMe(token);
    d.nickname = me?.nickname || null;
    d.user_id_del_token = me?.id ?? null;
    d.user_id_coincide = String(me?.id) === String(acc.user_id);
    const un = await getUnanswered(token, acc.user_id, 10);
    const pend = un?.questions || [];
    d.sin_responder = un?.total ?? pend.length;
    d.pendientes = pend.slice(0, 5).map(q => ({ id: q.id, fecha: q.date_created, texto: (q.text || '').slice(0, 90) }));
    d.pendiente_mas_vieja = pend.length ? pend[pend.length - 1].date_created : null;
    const rec = await getRecentQuestions(token, acc.user_id, 20);
    const recientes = rec?.questions || [];
    const ult = recientes[0];
    d.ultima_pregunta = ult ? { fecha: ult.date_created, estado: ult.status, texto: (ult.text || '').slice(0, 90) } : null;
    const respondida = recientes.find(q => q.answer?.date_created);
    d.ultima_respuesta = respondida ? { fecha: respondida.answer.date_created, texto: (respondida.answer.text || '').slice(0, 90) } : null;
    // ¿Las respuestas las está escribiendo Tatiana o una persona a mano?
    // Tatiana SIEMPRE firma con su nombre, asi que la firma alcanza para distinguirlas.
    const conRespuesta = recientes.filter(q => q.answer?.text);
    d.respuestas_recientes = conRespuesta.length;
    d.respuestas_de_tatiana = conRespuesta.filter(q => new RegExp(NEGOCIO.agente, 'i').test(q.answer.text)).length;
  } catch (e) {
    d.token = 'FALLA';
    d.error_code = e.code || null;
    d.error = e.message;
  }
  return d;
}

// Traduce la radiografía a conclusiones en castellano (qué está roto y qué hacer).
function diagConclusiones({ accounts, cuentas, gemini, autoanswer, store, webhook, webhookPreguntas }) {
  const out = [];
  if (!accounts.length) out.push('❌ No hay cuentas cargadas: falta la variable ML_ACCOUNTS en Vercel (o quedó mal el JSON).');
  if (!gemini) out.push('❌ Falta GEMINI_API_KEY: sin eso el agente no puede redactar ninguna respuesta.');
  if (!autoanswer) out.push('⚠️ ML_AUTOANSWER=off: el auto-respondido está PAUSADO a propósito. Sacá esa variable (o ponela en "on") para que vuelva a responder.');
  if (store === 'memoria') out.push('⚠️ Los tokens se guardan solo en memoria: ML rota el refresh_token en cada renovación, así que al rato el de ML_ACCOUNTS queda invalidado y el bot deja de responder. Configurá KV_REST_API_URL + KV_REST_API_TOKEN en Vercel.');
  cuentas.forEach(c => {
    if (c.token === 'FALLA') {
      out.push(`❌ Cuenta "${c.label}": no se pudo renovar el token${c.error_code ? ' (' + c.error_code + ')' : ''}. ${c.error}`);
      return;
    }
    if (c.user_id_coincide === false) out.push(`❌ Cuenta "${c.label}": el user_id de ML_ACCOUNTS (${c.user_id}) NO es el del token (${c.user_id_del_token}). El webhook nunca la va a encontrar y las preguntas quedan sin responder.`);
    if (c.sin_responder > 0) out.push(`⚠️ Cuenta "${c.label}": ${c.sin_responder} pregunta(s) sin responder (la más vieja es del ${c.pendiente_mas_vieja || 's/d'}). Usá "Responder pendientes" para ponerse al día.`);
    if (c.respuestas_recientes > 0 && c.respuestas_de_tatiana === 0) {
      out.push(`❌ Cuenta "${c.label}": de las últimas ${c.respuestas_recientes} respuestas, NINGUNA lleva la firma de ${NEGOCIO.agente} → las está contestando una persona a mano. El bot no está entrando.`);
    } else if (c.respuestas_recientes > 0) {
      out.push(`ℹ️ Cuenta "${c.label}": ${c.respuestas_de_tatiana} de las últimas ${c.respuestas_recientes} respuestas son de ${NEGOCIO.agente}.`);
    }
  });
  if (!webhook) {
    out.push('⚠️ No hay registro de ningún webhook recibido de ML. Puede ser que el store esté en memoria (se pierde en cada arranque) o que ML NO esté notificando: revisá en DevCenter que la callback URL sea https://socialflow-flax.vercel.app/api/ml/questions con el topic "questions".');
  } else if (!webhookPreguntas) {
    out.push(`❌ ML nos está avisando (llegó un aviso de "${webhook.topic || 'sin topic'}"), pero NO hay registro de NINGÚN aviso de PREGUNTAS. O el topic "questions" no está tildado en la app de DevCenter, o el registro se perdió por guardar en memoria. Ese es el motivo más probable de que el bot no conteste solo.`);
  }
  if (!out.length) out.push('✅ Todo en orden: cuentas OK, token OK, sin preguntas pendientes y el auto-respondido prendido.');
  return out;
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
    // DIAGNÓSTICO: qué está pasando con el agente (se puede abrir con GET en el navegador).
    if (action === 'diag') {
      // En paralelo: en el plan Hobby la función corta a los 10s y una cuenta
      // sola ya se lleva varias llamadas a la API de ML.
      const [cuentas, webhook, webhookPreguntas] = await Promise.all([
        Promise.all(accounts.map(diagAccount)),
        lastWebhook(),
        lastWebhook('questions'),
      ]);
      const info = {
        gemini: !!(process.env.GEMINI_API_KEY || '').trim(),
        autoanswer: autoanswerOn(),
        store: storeKind(),
        webhook,
        webhookPreguntas,
      };
      return res.status(200).json({
        ok: true,
        fecha: new Date().toISOString(),
        cuentas_configuradas: accounts.length,
        auto_respondido: info.autoanswer ? 'on' : 'off (PAUSADO)',
        gemini: info.gemini ? 'OK' : 'FALTA',
        guardado_de_tokens: info.store,
        ultimo_webhook_de_ml: webhook || null,
        ultimo_webhook_de_preguntas: webhookPreguntas || null,
        cuentas,
        diagnostico: diagConclusiones({ accounts, cuentas, ...info }),
      });
    }

    // CONTROL DE CONVERSIÓN: qué preguntas terminaron en venta, por SKU, y qué le
    // falta a cada publicación (fotos, medidas, color, retiro, precio por mayor...).
    if (action === 'conversion') {
      if (!accounts.length) return res.status(400).json({ error: 'No hay cuentas configuradas (ML_ACCOUNTS).' });
      const dias = Math.min(Math.max(Number(req.query?.dias || req.body?.dias) || 30, 1), 180);
      const limitPreguntas = Math.min(Number(req.query?.limit || req.body?.limit) || 100, 200);
      const hasta = new Date();
      const desde = new Date(hasta.getTime() - dias * 86400000);
      const label = (req.query?.account || req.body?.account || '').toString();
      const target = label ? [findAccountByLabel(accounts, label)].filter(Boolean) : accounts;
      if (!target.length) return res.status(400).json({ error: 'Cuenta desconocida: ' + label });

      const cuentas = await Promise.all(target.map(async (acc) => {
        try {
          return await conversionCuenta({ acc, desde, hasta, limitPreguntas });
        } catch (e) {
          console.error('[ml-questions] conversion falló en la cuenta ' + acc.label, e.message);
          return { cuenta: acc.label, error: e.message, resumen: null, por_sku: [], detalle: [] };
        }
      }));

      // Consolidado de las 2 cuentas.
      const detalle = cuentas.flatMap(c => c.detalle || []);
      const convertidas = detalle.filter(d => d.convirtio).length;
      const porSku = cuentas.flatMap(c => (c.por_sku || []).map(s => ({ cuenta: c.cuenta, ...s })));
      return res.status(200).json({
        ok: true,
        dias,
        desde: desde.toISOString(),
        hasta: hasta.toISOString(),
        total: {
          preguntas: detalle.length,
          convertidas,
          tasa_conversion: detalle.length ? Math.round((convertidas / detalle.length) * 100) : 0,
          publicaciones_con_preguntas: porSku.length,
          publicaciones_sin_conversion: porSku.filter(s => s.convertidas === 0).length,
        },
        cuentas: cuentas.map(c => ({ cuenta: c.cuenta, error: c.error || null, resumen: c.resumen })),
        por_sku: porSku,
        detalle,
      });
    }

    // BARRIDO: responde las preguntas que quedaron pendientes (una cuenta o todas).
    // Sirve como red de seguridad cuando el webhook de ML no llega.
    if (action === 'sweep') {
      // Con GET (cron externo) pedimos la key si está configurada ML_SWEEP_KEY.
      // Por POST entra el botón del panel, igual que el resto de las acciones.
      const expected = (process.env.ML_SWEEP_KEY || '').trim();
      if (req.method === 'GET' && expected && (req.query?.key || '').toString() !== expected) {
        return res.status(401).json({ error: 'key inválida' });
      }
      if (!accounts.length) return res.status(400).json({ error: 'No hay cuentas configuradas (ML_ACCOUNTS).' });
      const limit = Math.min(Number(req.query?.limit || req.body?.limit) || 5, 20);
      // dry=1 genera las respuestas sin publicarlas (para revisar el tono).
      const dry = ['1', 'true', 'si'].includes(String(req.query?.dry ?? req.body?.dry ?? '').toLowerCase());
      const autopost = !dry && autoanswerOn();
      const label = (req.query?.account || req.body?.account || '').toString();
      const target = label ? [findAccountByLabel(accounts, label)].filter(Boolean) : accounts;
      if (!target.length) return res.status(400).json({ error: 'Cuenta desconocida: ' + label });
      const cuentas = [];
      for (const acc of target) {
        try {
          cuentas.push(await sweepAccount({ acc, accounts, limit, autopost }));
        } catch (e) {
          console.error('[ml-questions] sweep falló en la cuenta ' + acc.label, e.message);
          cuentas.push({ account: acc.label, error: e.message });
        }
      }
      return res.status(200).json({
        ok: true, autopost, limite_por_cuenta: limit,
        posteadas: cuentas.reduce((n, c) => n + (c.posteadas || 0), 0),
        cuentas,
      });
    }

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
    // SIEMPRE devolvemos 200: si contestamos 5xx, ML reintenta y termina dando de
    // baja la callback URL de la app (y ahí deja de avisarnos por completo).
    if (req.method === 'POST' && (action === 'webhook' || req.body?.resource)) {
      const { resource, user_id, topic } = req.body || {};
      // Queda registrado para el diagnóstico: así se ve si ML nos está llamando.
      await markWebhook({ topic: topic || null, user_id: user_id ?? null, resource: resource || null });
      try {
        if (topic && topic !== 'questions') return res.status(200).json({ ok: true, skipped: topic });
        const acc = findAccountByUser(accounts, user_id);
        if (!acc) {
          console.error('[ml-questions] webhook de un user sin cuenta en ML_ACCOUNTS', { user_id, resource });
          return res.status(200).json({ ok: false, error: 'cuenta no configurada para user ' + user_id });
        }
        const qId = String(resource || '').split('/').pop();
        const token = await tokenOf(acc);
        const q = await getQuestion(token, qId);
        if (!q || q.status !== 'UNANSWERED') return res.status(200).json({ ok: true, skipped: 'ya respondida o inexistente' });
        // Interruptor de seguridad: poné ML_AUTOANSWER=off en Vercel para pausar el auto-respondido.
        const autopost = autoanswerOn();
        const out = await answerFlow({ acc, accounts, q, autopost });
        return res.status(200).json({ ok: !out.postError, autopost, ...out });
      } catch (e) {
        console.error('[ml-questions] webhook falló', { user_id, resource, error: e.message });
        return res.status(200).json({ ok: false, error: e.message, hint: 'Abrí /api/ml/questions?action=diag para ver el detalle.' });
      }
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
