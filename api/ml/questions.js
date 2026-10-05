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
//   GET  /api/ml/questions?action=postventa    -> manda los mensajes post-entrega que ya
//                                                 cumplieron los 5 min (&ver=1 solo mira la cola)
//   POST /api/ml/questions   (webhook de ML)    -> ML manda { resource, user_id, topic }
//                                                 => responde la pregunta automáticamente
//
// Config: variable de entorno ML_ACCOUNTS (JSON). Ver lib/ml/qa-config.js.
import { cors } from '../_http.js';

// El reporte de medidas recorre TODO el catálogo (2000+ publicaciones); con los
// 10s por defecto del plan Hobby se cortaba en la mitad. Igual que api/image.js.
export const config = { maxDuration: 60 };
import { loadAccounts, findAccountByUser, findAccountByLabel, otherAccount, NEGOCIO } from '../../lib/ml/qa-config.js';
import { getAccessToken, getQuestion, getItem, getUnanswered, getItemQuestions, getRecentQuestions, searchSellerItem, postAnswer, itemContext, getMe, getOrders, getItemsBulk } from '../../lib/ml/ml-api.js';
import { construirReporte } from '../../lib/ml/conversion.js';
import { filaMedidas, ordenarFilas, medidasCsv } from '../../lib/ml/medidas.js';
import { compararCatalogos, faltantesCsv } from '../../lib/ml/catalogo.js';
import { searchMyItems, getItemsFichaBulk, mlAdsGet, getUserItemsVisits, getOrdersPagina } from '../../lib/ml/ml-api.js';
import { resumenKeys } from '../../lib/gemini-keys.js';
import { modeloTexto } from '../../lib/gemini-texto.js';
import { getShipment, getOrder, sendPostSaleMessage, getUnreadMessages, diagnosticarConversacion } from '../../lib/ml/ml-api.js';
import { armarMensaje, encolarLote, vencidos, marcarEnviadoLote, verCola, verEnviados, necesitaKv, DEMORA_MS } from '../../lib/ml/postventa.js';
import { generateAnswer, probarIA } from '../../lib/ml/qa-brain.js';
import { storeKind, kvDetalle, markWebhook, lastWebhook, markWebhookResultado, lastWebhookResultado, anotarPreguntaSinResponder, verPreguntasSinResponder, readJson, writeJson, kvPrueba, kvUltimoError } from '../../lib/ml/token-store.js';

// Access token de la cuenta (con cache + guardado del refresh rotado).
async function tokenOf(acc) {
  return getAccessToken(acc);
}

function autoanswerOn() {
  return process.env.ML_AUTOANSWER !== 'off';
}

// El mensaje post-entrega arranca APAGADO a propósito: le escribe a clientes
// reales. Se prende con ML_POSTVENTA=on en Vercel.
function postventaOn() {
  return process.env.ML_POSTVENTA === 'on';
}

// Un mensaje que quedó colgado más de un día ya no se manda (para que al
// prender el interruptor no salga una andanada de mensajes viejos).
const POSTVENTA_VENCE_MS = 24 * 60 * 60 * 1000;

// ─── Barrido de entregas ─────────────────────────────────────────────────────
// El webhook de ML NO llega (26-sep-2026: el diagnóstico mostró
// "ultimo_webhook_de_ml": null con el store en KV, o sea persistente). Las
// preguntas se salvan porque hay un barrido que las busca; el post-entrega
// dependía SOLO del webhook, así que la cola nunca se llenaba y no salió
// jamás un mensaje.
//
// Primero se probó buscar las órdenes MOVIDAS hace poco (`date_last_updated`).
// No sirve, y los contadores del 28-sep lo dejaron a la vista:
//
//   full:  ordenes 120 · con_envio 120 · envios_fallados 0
//          estados {ready_to_ship: 116, pending: 3, cancelled: 1}
//
// La búsqueda anda y las consultas de envío andan: ni una sola entrega porque
// **el estado del envío no actualiza la orden**. Una orden entregada hoy sigue
// teniendo el `last_updated` del día que se vendió, así que mirar lo movido
// recién trae ventas nuevas — por más que se suba el tope.
//
// Por eso ahora se recorren las órdenes por FECHA DE VENTA: las de los últimos
// días son las que se están entregando ahora. Como son miles, se avanza con un
// cursor guardado en el KV, unas pocas por pasada, dando vueltas en círculo.
// `encolarLote()` es idempotente, así que repasar la misma orden no duplica.
const VENTANA_DIAS = Number(process.env.ML_POSTVENTA_VENTANA_DIAS || 12);
const BARRIDO_MAX = Number(process.env.ML_POSTVENTA_BARRIDO_MAX || 120);
const ENVIOS_EN_PARALELO = 8;

// Cuántos minutos puede quedar una pregunta sin responder antes de avisar.
const ATRASADAS_MINUTOS = Number(process.env.ML_ATRASADAS_MINUTOS || 5);

// Los únicos topics de ML que este endpoint procesa. Cualquier otro se
// descarta sin tocar el KV (ver el comentario del webhook, más abajo).
// Lo ideal es además desuscribirlos en DevCenter: así ML ni siquiera llama.
const TOPICS_QUE_PROCESAMOS = new Set(
  (process.env.ML_TOPICS || 'questions,shipments').split(',').map(x => x.trim().toLowerCase()).filter(Boolean));

// Cuántas notificaciones descartamos de cada topic. Vive en memoria a
// propósito: es para ver actividad reciente sin gastar un solo comando del KV,
// y se reinicia cuando la función se enfría.
const webhooksDescartados = new Map();
const KEY_CURSOR = 'ml:postventa:cursor';

async function barrerEntregas({ accounts, ahora = Date.now() }) {
  const desde = new Date(ahora - VENTANA_DIAS * 86_400_000).toISOString();
  const hasta = new Date(ahora).toISOString();
  const cursores = (await readJson(KEY_CURSOR)) || {};
  const yaEnviados = new Set(Object.keys(await verEnviados()));
  const resumen = [];

  for (const acc of accounts) {
    // Los contadores están para diagnóstico: `entregadas: 0` puede significar
    // cosas muy distintas (órdenes demasiado nuevas / la búsqueda sin
    // `shipping.id` / la consulta del envío fallando) y sin esto no se
    // distinguen. Ya sirvieron una vez; se quedan.
    const fila = {
      cuenta: acc.label, desde_orden: cursores[acc.label] || 0, ordenes: 0,
      ya_avisadas: 0, con_envio: 0, envios_mirados: 0, envios_fallados: 0,
      estados: {}, entregadas: 0, agendadas: 0, total_en_ventana: 0, error: null,
    };
    const aEncolar = [];
    try {
      const token = await tokenOf(acc);
      let offset = cursores[acc.label] || 0;
      const ordenes = [];
      let total = 0;
      while (ordenes.length < BARRIDO_MAX) {
        // Pedir solo lo que falta para el tope: con páginas fijas de 50 la
        // última se pasaba de largo (traía 150 en vez de 120) y el barrido
        // consultaba más envíos de los que entran en el tiempo de la función.
        const pedir = Math.min(50, BARRIDO_MAX - ordenes.length);
        const pagina = await getOrdersPagina(token, acc.user_id, desde, hasta, offset + ordenes.length, pedir);
        total = pagina.total;
        ordenes.push(...pagina.ordenes);
        if (pagina.ordenes.length < pedir) break;   // se acabaron las órdenes
      }
      fila.ordenes = ordenes.length;
      fila.total_en_ventana = total;
      // Evidencia de que la ventana es la que se pidió.
      const fechas = ordenes.map(o => o?.date_created).filter(Boolean).sort();
      fila.vendidas_entre = fechas.length ? [fechas[0], fechas[fechas.length - 1]] : null;

      // Avanza el cursor y da la vuelta al llegar al final de la ventana.
      const siguiente = offset + ordenes.length;
      cursores[acc.label] = siguiente >= total ? 0 : siguiente;

      // A las que ya recibieron el mensaje no hace falta preguntarles el envío.
      const pendientes = ordenes.filter(o => !yaEnviados.has(String(o?.id)));
      fila.ya_avisadas = ordenes.length - pendientes.length;
      const conEnvio = pendientes.filter(o => o?.shipping?.id);
      fila.con_envio = conEnvio.length;

      for (let i = 0; i < conEnvio.length; i += ENVIOS_EN_PARALELO) {
        const tanda = conEnvio.slice(i, i + ENVIOS_EN_PARALELO);
        const envios = await Promise.all(tanda.map(o =>
          getShipment(token, o.shipping.id).catch(() => null)));
        for (let j = 0; j < tanda.length; j++) {
          fila.envios_mirados++;
          if (!envios[j]) { fila.envios_fallados++; continue; }
          const estado = envios[j].status || 'sin_estado';
          fila.estados[estado] = (fila.estados[estado] || 0) + 1;
          if (estado !== 'delivered') continue;
          fila.entregadas++;
          const orden = tanda[j];
          // Se juntan y se encolan TODAS juntas al final: una escritura por
          // pasada en vez de una por entrega (ver el comentario del costo en
          // comandos en lib/ml/postventa.js).
          aEncolar.push({
            orderId: orden.id,
            packId: orden.pack_id || orden.id,
            buyerId: orden.buyer?.id,
            cuenta: acc.label,
            titulo: orden.order_items?.[0]?.item?.title || '',
            vendida: orden.date_created,
          });
        }
      }
    } catch (e) {
      fila.error = e.message;
      console.error('[ml-postventa] barrido falló', { cuenta: acc.label, error: e.message });
    }
    // Fuera del try: si el barrido se cortó a mitad de camino, las entregas que
    // ya se encontraron se agendan igual.
    if (aEncolar.length) {
      const r = await encolarLote(aEncolar, { ahora });
      fila.agendadas = r.agendadas;
      fila.descartadas = {
        ya_en_cola: r.ya_en_cola, ya_avisadas: r.ya_avisadas, sin_datos: r.sin_datos,
        previas_al_arranque: r.previas_al_arranque,
      };
      fila.activo_desde = r.activo_desde;
      if (r.desbordo) fila.desbordo_de_cola = r.desbordo;
    }
    resumen.push(fila);
  }
  await writeJson(KEY_CURSOR, cursores);
  return resumen;
}

// Manda los mensajes post-entrega que ya cumplieron la demora.
// Tope de mensajes por pasada. Mandar 200 no entra en los 60 s de la función,
// y además un chorro de mensajes juntos es lo último que queremos que vea un
// comprador. Con el cron cada 5 minutos, 40 por pasada son 11.500 por día.
const ENVIOS_POR_PASADA = Number(process.env.ML_POSTVENTA_POR_PASADA || 40);

async function procesarPostventa({ accounts, ahora = Date.now() }) {
  const pendientes = (await vencidos(ahora)).slice(0, ENVIOS_POR_PASADA);
  const salida = [];
  // Igual que el barrido: se juntan los ids y se marcan todos juntos al final,
  // para no gastar un puñado de comandos del KV por cada mensaje.
  const marcar = [];
  // Si ML bloquea el primer mensaje por no dejar que el vendedor inicie la
  // conversación, le preguntamos UNA vez qué permite para ese pack. Una sola
  // consulta por pasada: alcanza para entender y no cuesta tiempo.
  let porQueBloquea = null;
  for (const p of pendientes) {
    const vencido = ahora - new Date(p.enviar_a_partir_de).getTime() > POSTVENTA_VENCE_MS;
    if (vencido) {
      marcar.push(p.orderId);
      salida.push({ ...p, resultado: 'caducado (más de 24 h en la cola, no se manda)' });
      continue;
    }
    const acc = findAccountByLabel(accounts, p.cuenta) || accounts[0];
    try {
      const token = await tokenOf(acc);

      // Si el comprador YA escribió algo que nadie leyó, no nos metemos: mandar
      // "¿llegó todo bien?" encima de su consulta la entierra y arma lío. Lo
      // dejamos en la cola: si el equipo le contesta, sale en la próxima
      // pasada; si no, caduca solo a las 24 h.
      // Este chequeo NO marca nada como leído (ver getUnreadMessages).
      let sinLeer = 0;
      try {
        const unread = await getUnreadMessages(token, p.packId, acc.user_id);
        sinLeer = Number(unread?.count ?? (Array.isArray(unread?.results) ? unread.results.length : 0)) || 0;
      } catch { /* si no se puede consultar, seguimos y mandamos igual */ }
      if (sinLeer > 0) {
        salida.push({ ...p, resultado: `en espera: el comprador escribió ${sinLeer} mensaje(s) sin leer, lo atiende una persona` });
        continue;
      }

      const texto = armarMensaje({ titulo: p.titulo });
      const r = await sendPostSaleMessage(token, {
        packId: p.packId, sellerId: acc.user_id, buyerId: p.buyerId, text: texto,
      });
      marcar.push(p.orderId);
      if (!r.ok) {
        console.error('[ml-postventa] ML rechazó el mensaje', { orden: p.orderId, error: r.error });
        if (!porQueBloquea && /conversation_initiated_by_seller|blocked/i.test(String(r.error))) {
          porQueBloquea = {
            orden: p.orderId, pack: p.packId, error: r.error,
            le_preguntamos_a_ml: await diagnosticarConversacion(token, p.packId, acc.user_id),
          };
        }
      }
      salida.push({ ...p, resultado: r.ok ? 'enviado' : 'ERROR: ' + r.error, texto });
    } catch (e) {
      console.error('[ml-postventa] falló el envío', { orden: p.orderId, error: e.message });
      salida.push({ ...p, resultado: 'ERROR: ' + e.message });
    }
  }
  await marcarEnviadoLote(marcar, { ahora });
  return { salida, porQueBloquea };
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

  // Si la publicación no está ACTIVA (pausada o finalizada), ML rechaza la
  // respuesta con "Item must be active" (not_active_item). Cortamos ACÁ, antes
  // de llamar a la IA: si no, cada barrido del cron vuelve a redactar una
  // respuesta que nunca se va a poder publicar y quema crédito de Gemini al
  // pedo -- justo el recurso que se nos agotó el 24/8.
  if (item?.status && item.status !== 'active') {
    return { question: q.text, item: item.title || null, answer: null, status: q.status,
             posted: null, omitida: true,
             note: `La publicación está ${item.status === 'paused' ? 'PAUSADA' : 'FINALIZADA'}: Mercado Libre no permite responder preguntas ahí. Si querés contestarla, reactivá la publicación.` };
  }

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
// POR QUÉ ESTA PREGUNTA QUEDÓ SIN RESPUESTA.
//
// answerFlow ya devuelve todo lo necesario (escalated / omitida / postError),
// pero eso vive un request y se pierde. Esto lo traduce a una frase para Rodo y
// devuelve null cuando la pregunta SÍ se contestó (el caso normal, que no se
// anota: ver el aviso de costo en token-store.js).
function motivoSinResponder(out, { autopost }) {
  if (!out) return null;
  if (out.error) return 'Se cayó el intento de responder: ' + out.error;
  if (out.escalated) return out.note || 'Por diseño la contesta una persona.';
  if (out.omitida) return out.note || 'La publicación no está activa: ML no deja responder ahí.';
  if (out.postError) return 'ML rechazó la respuesta: ' + out.postError;
  if (!autopost) return 'El bot está en modo prueba (ML_AUTOANSWER=off): redactó la respuesta pero no la publicó.';
  if (!out.posted?.ok) return 'La respuesta se generó pero no se llegó a publicar.';
  return null;
}

// Anota el motivo sin romper nada si el KV está caído: es un dato de ayuda, no
// puede hacer fallar el barrido ni el webhook.
async function anotarMotivo(q, out, { autopost, cuenta }) {
  const motivo = motivoSinResponder(out, { autopost });
  if (!motivo) return null;
  try {
    await anotarPreguntaSinResponder(q.id, motivo, {
      cuenta, item_id: q.item_id || null, pregunta: String(q.text || '').slice(0, 120),
    });
  } catch (e) {
    console.error('[ml-questions] no se pudo anotar el motivo de la pregunta ' + q.id, e.message);
  }
  return motivo;
}

async function sweepAccount({ acc, accounts, limit, autopost }) {
  const token = await tokenOf(acc);
  const data = await getUnanswered(token, acc.user_id, limit);
  const pendientes = (data?.questions || []).slice(0, limit);
  const resultados = [];
  for (const q of pendientes) {
    try {
      const out = await answerFlow({ acc, accounts, q, autopost });
      const motivo = await anotarMotivo(q, out, { autopost, cuenta: acc.label });
      resultados.push({ question_id: q.id, item_id: q.item_id, ...out, motivo });
    } catch (e) {
      console.error('[ml-questions] sweep falló en la pregunta ' + q.id, e.message);
      await anotarMotivo(q, { error: e.message }, { autopost, cuenta: acc.label });
      resultados.push({ question_id: q.id, item_id: q.item_id, question: q.text, error: e.message });
    }
  }
  return {
    account: acc.label,
    pendientes: data?.total ?? pendientes.length,
    procesadas: resultados.length,
    posteadas: resultados.filter(r => r.posted?.ok).length,
    omitidas_publicacion_inactiva: resultados.filter(r => r.omitida).length,
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
function diagConclusiones({ accounts, cuentas, gemini, iaError, keys, autoanswer, store, webhook, webhookPreguntas, resultadoPreguntas }) {
  const out = [];
  if (!accounts.length) out.push('❌ No hay cuentas cargadas: falta la variable ML_ACCOUNTS en Vercel (o quedó mal el JSON).');
  if (!gemini) {
    out.push(/spending cap|quota|RESOURCE_EXHAUSTED|429/i.test(iaError || '')
      ? `❌ LA IA NO RESPONDE — se acabó el crédito/cupo de Gemini: "${iaError}". Sin esto Tatiana no puede redactar NINGUNA respuesta, aunque todo lo demás esté bien. Entrá a https://ai.studio/spend y subí o sacá el tope de gasto mensual del proyecto.`
      : `❌ LA IA NO RESPONDE: ${iaError}. Sin esto el agente no puede redactar ninguna respuesta.`);
  }
  // El aviso se da por la HUELLA, no por el nombre de la variable: con
  // GEMINI_API_KEY_TEXTO cargada pero GEMINI_API_KEY_MEDIA vacía, media cae en
  // la key de siempre y puede ser la misma que la de los bots. Antes esto se
  // leía como "falta separarlas" aun cuando ya estaban separadas de hecho.
  if (gemini && keys?.misma_key) {
    out.push('⚠️ Los bots (ML y WhatsApp) comparten la key de Gemini con la generación de imágenes y video, que es MUCHO más cara. Si se agota el crédito haciendo contenido, los dos bots dejan de atender. Separalas: GEMINI_API_KEY_TEXTO para los bots y GEMINI_API_KEY_MEDIA para imagen/video, cada una de un PROYECTO distinto de Google (el cupo es por proyecto, no por key).');
  } else if (gemini && keys && !keys.separadas && !keys.misma_key) {
    out.push('ℹ️ Los bots y la generación de imágenes usan keys distintas, pero falta cargar GEMINI_API_KEY_MEDIA para dejarlo explícito: hoy imagen/video cae en GEMINI_API_KEY de respaldo.');
  }
  if (!autoanswer) out.push('⚠️ ML_AUTOANSWER=off: el auto-respondido está PAUSADO a propósito. Sacá esa variable (o ponela en "on") para que vuelva a responder.');
  if (store === 'memoria') {
    const d = kvDetalle();
    out.push(`⚠️ Los tokens y el registro de webhooks se guardan solo en memoria (se pierden en cada arranque). ${d.problema || ''} Variables que SÍ llegan: ${d.variables_encontradas.length ? d.variables_encontradas.join(', ') : 'ninguna'}.`);
  }
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
  } else if (webhookPreguntas && resultadoPreguntas && !resultadoPreguntas.ok) {
    out.push(`❌ ML avisó de la pregunta ${resultadoPreguntas.question_id || ''} pero el bot NO la contestó → ${resultadoPreguntas.resultado}`);
  } else if (webhookPreguntas && !resultadoPreguntas) {
    out.push('⚠️ Llegan avisos de PREGUNTAS pero no hay registro de qué pasó con ellos (se pierde sin KV). Configurá el KV para ver el error.');
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
      const [cuentas, webhook, webhookPreguntas, resultadoPreguntas, sinResponder, ia] = await Promise.all([
        Promise.all(accounts.map(diagAccount)),
        lastWebhook(),
        lastWebhook('questions'),
        lastWebhookResultado('questions'),
        verPreguntasSinResponder().catch(() => ({})),
        probarIA(),
      ]);
      const info = {
        gemini: ia.ok,
        iaError: ia.ok ? null : ia.error,
        keys: resumenKeys(),
        autoanswer: autoanswerOn(),
        store: storeKind(),
        webhook,
        webhookPreguntas,
        resultadoPreguntas,
      };
      return res.status(200).json({
        ok: true,
        fecha: new Date().toISOString(),
        cuentas_configuradas: accounts.length,
        auto_respondido: info.autoanswer ? 'on' : 'off (PAUSADO)',
        gemini: ia.ok ? `OK (probada de verdad, modelo ${ia.modelo})` : 'FALLA: ' + ia.error,
        modelo_de_ia: ia.modelo || modeloTexto(),
        keys_de_gemini: resumenKeys(),
        guardado_de_tokens: info.store,
        kv: kvDetalle(),
        // storeKind() solo mira si las variables están cargadas. Esto prueba
        // de verdad que el KV guarda y devuelve lo mismo que se guardó.
        kv_prueba: await kvPrueba(),
        kv_ultimo_error: kvUltimoError(),
        topics_que_procesamos: [...TOPICS_QUE_PROCESAMOS],
        // Si acá hay números altos, ML está notificando topics que no usamos:
        // hay que desuscribirlos en DevCenter para dejar de gastar invocaciones.
        webhooks_descartados: Object.fromEntries(webhooksDescartados),
        ultimo_webhook_de_ml: webhook || null,
        ultimo_webhook_de_preguntas: webhookPreguntas || null,
        que_paso_con_esa_pregunta: resultadoPreguntas || null,
        // Las últimas preguntas que quedaron sin contestar, con el motivo de cada
        // una. Es lo que se mira cuando llega el aviso de WhatsApp.
        preguntas_que_no_pudo_contestar: sinResponder,
        cuentas,
        diagnostico: diagConclusiones({ accounts, cuentas, ...info }),
      });
    }

    // CONTROL DE CONVERSIÓN: qué preguntas terminaron en venta, por SKU, y qué le
    // falta a cada publicación (fotos, medidas, color, retiro, precio por mayor...).
    // QUÉ FALTA PUBLICAR EN UNA CUENTA: compara los dos catálogos y lista los
    // productos que están en `origen` y no en `destino`. Solo lectura.
    // El matcheo va por SKU, por título normalizado y por parecido de palabras
    // (ver lib/ml/catalogo.js): el mismo producto suele estar titulado distinto
    // en cada cuenta.
    if (action === 'faltantes') {
      if (accounts.length < 2) return res.status(400).json({ error: 'Hacen falta 2 cuentas en ML_ACCOUNTS.' });
      const lblOrigen = (req.query?.origen || 'full').toString();
      const lblDestino = (req.query?.destino || 'local').toString();
      const accO = findAccountByLabel(accounts, lblOrigen);
      const accD = findAccountByLabel(accounts, lblDestino);
      if (!accO || !accD) return res.status(400).json({ error: `Cuenta desconocida: ${!accO ? lblOrigen : lblDestino}` });

      // Todas las publicaciones de una cuenta, con los datos que sirven para decidir.
      const catalogo = async (acc) => {
        const token = await tokenOf(acc);
        const ids = [];
        let scrollId = null;
        for (let v = 0; v < 60; v++) {
          const extra = 'search_type=scan' + (scrollId ? `&scroll_id=${encodeURIComponent(scrollId)}` : '');
          const r = await searchMyItems(token, acc.user_id, { limit: 100, extra });
          scrollId = r?.scroll_id || scrollId;
          const lote = r?.results || [];
          if (!lote.length) break;
          ids.push(...lote);
          if (r?.paging?.total && ids.length >= r.paging.total) break;
        }
        const items = await getItemsBulk(token, ids);
        return { token, items: [...items.entries()].map(([id, it]) => ({
          id, titulo: it.title, sku: it.sku, precio: it.price, stock: it.stock,
          estado: it.status || '', link: it.permalink,
        })) };
      };

      const [O, D] = await Promise.all([catalogo(accO), catalogo(accD)]);

      // Visitas de los últimos 30 días en la cuenta origen: un solo request y
      // sirve para priorizar (lo que la gente mira es lo que conviene publicar).
      const visitas = new Map();
      try {
        const hasta = new Date().toISOString().slice(0, 10);
        const desde = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
        const v = await getUserItemsVisits(O.token, accO.user_id, desde, hasta);
        for (const r of (v?.results || [])) {
          const id = r.item_id ?? r.id;
          if (id) visitas.set(String(id), Number(r.total_visits ?? r.visits) || 0);
        }
      } catch { /* sin visitas el reporte igual sirve, solo pierde el orden por interés */ }

      const cmp = compararCatalogos(O.items, D.items);
      const faltan = cmp.faltan
        .map(f => ({ ...f, vendidas: visitas.get(String(f.id)) || 0 }))
        .sort((a, b) => b.vendidas - a.vendidas || String(a.titulo).localeCompare(String(b.titulo)))
        .map((f, i) => ({ ...f, prioridad: f.vendidas > 0 ? `#${i + 1}` : '' }));

      const notas = [
        `Publicaciones en ${accO.label}: ${cmp.total_origen} · en ${accD.label}: ${cmp.total_destino}`,
        `Faltan en ${accD.label}: ${faltan.length}`,
        'La columna "Unidades vendidas (60d)" trae VISITAS de los últimos 30 días en la cuenta de origen: es el mejor indicador disponible de qué conviene publicar primero.',
        'El matcheo usa SKU, título normalizado y parecido de palabras. Puede haber algún falso faltante si el título es MUY distinto entre cuentas: revisá antes de publicar.',
      ];

      if ((req.query?.formato || '').toString() === 'json') {
        return res.status(200).json({ ok: true, origen: accO.label, destino: accD.label,
          total_origen: cmp.total_origen, total_destino: cmp.total_destino,
          faltan: faltan.length, ya_estan: cmp.estan.length, items: faltan.slice(0, 200) });
      }
      const hoy = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="faltan-en-${accD.label}-${hoy}.csv"`);
      return res.status(200).send(faltantesCsv(faltan, notas));
    }

    // SONDA DE MERCADO ADS (Product Ads): prueba los endpoints de publicidad
    // con el token de la cuenta y devuelve crudo qué contesta cada uno, para
    // saber qué acceso tenemos antes de construir el reporte de optimización.
    // Solo lectura: no crea ni toca ninguna campaña.
    if (action === 'ads') {
      if (!accounts.length) return res.status(400).json({ error: 'No hay cuentas configuradas (ML_ACCOUNTS).' });
      const label = (req.query?.account || 'full').toString();
      const acc = findAccountByLabel(accounts, label);
      if (!acc) return res.status(400).json({ error: 'Cuenta desconocida: ' + label });
      const token = await tokenOf(acc);
      const corto = (b) => { try { return JSON.stringify(b).slice(0, 900); } catch { return String(b).slice(0, 900); } };

      const out = { cuenta: acc.label, pasos: [] };
      // 1) ¿Quiénes somos como anunciante?
      const adv = await mlAdsGet(token, '/advertising/advertisers?product_id=PADS', 1);
      out.pasos.push({ paso: 'advertisers', status: adv.status, body: corto(adv.body) });
      const advertisers = adv.body?.advertisers || [];

      // 2) Campañas. Las rutas bajo /advertising/... dieron 404 en producción
      //    (14-sep): la buena va bajo /marketplace/, lleva el SITE_ID del
      //    anunciante y termina en /search. Igual dejamos alternativas por si
      //    ML vuelve a mover la ruta.
      for (const a of advertisers.slice(0, 2)) {
        const id = a.advertiser_id ?? a.id;
        const site = a.site_id || 'MLA';
        const hasta = new Date().toISOString().slice(0, 10);
        const desde = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
        const q = `?limit=50&date_from=${desde}&date_to=${hasta}`;
        let campanas = [];
        for (const ruta of [
          `/marketplace/advertising/${site}/advertisers/${id}/product_ads/campaigns/search${q}`,
          `/marketplace/advertising/${site}/advertisers/${id}/product_ads/campaigns${q}`,
        ]) {
          const camp = await mlAdsGet(token, ruta, 2);
          out.pasos.push({ paso: `campaigns ${ruta.split('?')[0]}`, status: camp.status, body: corto(camp.body) });
          if (camp.status >= 200 && camp.status < 300) {
            campanas = camp.body?.results || camp.body?.campaigns || [];
            break;
          }
        }
        // 3) Los ANUNCIOS (publicación por publicación) de la primera campaña:
        //    es el dato que sirve para decidir qué pautar y qué pausar.
        const c0 = campanas[0];
        if (c0?.id != null) {
          for (const ruta of [
            `/marketplace/advertising/${site}/advertisers/${id}/product_ads/campaigns/${c0.id}/ads/search${q}`,
            `/marketplace/advertising/${site}/advertisers/${id}/product_ads/campaigns/${c0.id}${q}`,
          ]) {
            const ads = await mlAdsGet(token, ruta, 2);
            out.pasos.push({ paso: `ads/metricas campaña ${c0.id}`, status: ads.status, body: corto(ads.body) });
            if (ads.status >= 200 && ads.status < 300) break;
          }
        }
      }
      return res.status(200).json(out);
    }

    // MEDIDAS POR SKU: recorre las publicaciones de una cuenta y baja un CSV
    // (se abre directo en Excel) con las medidas de la ficha técnica de cada
    // una. Las que NO tienen medidas salen primero: ésas son las que generan
    // preguntas de "¿cuánto mide?" sin conversión. Solo lectura.
    if (action === 'medidas') {
      if (!accounts.length) return res.status(400).json({ error: 'No hay cuentas configuradas (ML_ACCOUNTS).' });
      const label = (req.query?.account || 'full').toString();
      const acc = findAccountByLabel(accounts, label);
      if (!acc) return res.status(400).json({ error: 'Cuenta desconocida: ' + label });
      const token = await tokenOf(acc);

      // IDs de TODAS las publicaciones. El offset clásico de ML corta en 1000
      // (la cuenta FULL tiene 2078), así que se usa search_type=scan, que
      // recorre el catálogo completo con un scroll_id. Si el scan fallara,
      // se cae al offset clásico y el reporte avisa que quedó incompleto.
      const ids = [];
      let total = 0;
      let scrollId = null;
      for (let vuelta = 0; vuelta < 60; vuelta++) {
        const extra = 'search_type=scan' + (scrollId ? `&scroll_id=${encodeURIComponent(scrollId)}` : '');
        const r = await searchMyItems(token, acc.user_id, { limit: 100, extra });
        total = r?.paging?.total ?? total;
        scrollId = r?.scroll_id || scrollId;
        const lote = r?.results || [];
        if (!lote.length) break;
        ids.push(...lote);
        if (total && ids.length >= total) break;
      }
      if (!ids.length) {
        for (let offset = 0; offset < 1000; offset += 100) {
          const r = await searchMyItems(token, acc.user_id, { limit: 100, offset });
          total = r?.paging?.total ?? total;
          const lote = r?.results || [];
          ids.push(...lote);
          if (!lote.length || ids.length >= total) break;
        }
      }

      const items = await getItemsFichaBulk(token, ids);
      const filas = ordenarFilas([...items.values()].map(filaMedidas));
      const sinMedidas = filas.filter(f => f.tiene_medidas === 'NO').length;
      const notas = [];
      if (total > ids.length) notas.push(`OJO: la cuenta tiene ${total} publicaciones y este reporte cubre las primeras ${ids.length}.`);

      if ((req.query?.formato || '').toString() === 'json') {
        return res.status(200).json({ ok: true, cuenta: acc.label, publicaciones: filas.length, sin_medidas: sinMedidas, notas, filas });
      }
      const hoy = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="medidas-${acc.label}-${hoy}.csv"`);
      return res.status(200).send(medidasCsv(filas, notas));
    }

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

    // POST-VENTA: manda los mensajes de "¿llegó todo bien?" que ya cumplieron los 5 min.
    // Pensado para un cron cada 5 minutos (bridge/ml-sweep.sh).
    if (action === 'postventa') {
      const expected = (process.env.ML_SWEEP_KEY || '').trim();
      if (req.method === 'GET' && expected && (req.query?.key || '').toString() !== expected) {
        return res.status(401).json({ error: 'key inválida' });
      }
      const [cola, enviados] = await Promise.all([verCola(), verEnviados()]);
      const soloVer = ['1', 'true', 'si'].includes(String(req.query?.ver ?? req.body?.ver ?? '').toLowerCase());
      const base = {
        activo: postventaOn(),
        demora_minutos: DEMORA_MS / 60000,
        falta_kv: necesitaKv(),
        en_cola: cola.length,
        ya_enviados: Object.keys(enviados).length,
        cola,
      };
      if (soloVer) return res.status(200).json({ ok: true, ...base });
      if (!postventaOn()) {
        return res.status(200).json({ ok: true, ...base, nota: 'Apagado. Poné ML_POSTVENTA=on en Vercel para activarlo.' });
      }
      if (!accounts.length) return res.status(400).json({ error: 'No hay cuentas configuradas (ML_ACCOUNTS).' });
      // Primero llenamos la cola buscando las entregas (el webhook de ML no
      // llega), después mandamos lo que ya cumplió la demora.
      // El KV se prueba ANTES de barrer: si no guarda, la cola se llena y se
      // pierde en el mismo request, y el barrido parece andar cuando no anda.
      const kv_prueba = await kvPrueba();
      const barrido = await barrerEntregas({ accounts });
      const { salida: procesados, porQueBloquea } = await procesarPostventa({ accounts });
      const enCola = (await verCola()).length;
      const agendadas = barrido.reduce((s, f) => s + (f.agendadas || 0), 0);
      return res.status(200).json({
        ok: true, ...base,
        kv_prueba,
        kv_ultimo_error: kvUltimoError(),
        barrido,
        en_cola: enCola,
        // Si se agendaron entregas y la cola quedó vacía, lo que falla es el
        // guardado, no el barrido. Sin este aviso parecen dos datos sueltos.
        alerta: agendadas > 0 && enCola === 0
          ? `Se agendaron ${agendadas} entregas y la cola quedó vacía: el KV no está guardando. Mirá kv_prueba.`
          : null,
        procesados: procesados.length,
        enviados_ahora: procesados.filter(p => p.resultado === 'enviado').length,
        por_que_bloquea_ml: porQueBloquea,
        detalle: procesados,
      });
    }

    // PROBAR EL CHAT DE UNA VENTA CONCRETA.
    //
    // En el panel de ML el botón "Iniciar conversación" aparece en celeste y
    // activo, tanto en una venta despachada como en una ya entregada: o sea que
    // la capacidad EXISTE y el vendedor puede escribir primero. Pero la API nos
    // rechaza con `blocked_by_conversation_initiated_by_seller_limited`, así que
    // lo que hace ese botón no es lo que hacemos nosotros — lo más probable es
    // que elija una OPCIÓN de la guía de acciones de ML y mande con su id.
    //
    // Esto le pregunta a ML por UNA venta concreta (el número que se ve en el
    // panel, con o sin #), sin esperar a que caiga algo en la cola.
    //   GET ?action=probar-chat&id=2000015260093541
    if (action === 'probar-chat') {
      const expected = (process.env.ML_SWEEP_KEY || '').trim();
      if (req.method === 'GET' && expected && (req.query?.key || '').toString() !== expected) {
        return res.status(401).json({ error: 'key inválida' });
      }
      const id = String(req.query?.id || req.body?.id || '').replace(/[^0-9]/g, '');
      if (!id) return res.status(400).json({ error: 'Falta el número de venta: &id=2000015260093541' });
      if (!accounts.length) return res.status(400).json({ error: 'No hay cuentas configuradas (ML_ACCOUNTS).' });

      const label = (req.query?.account || req.body?.account || '').toString();
      const target = label ? [findAccountByLabel(accounts, label)].filter(Boolean) : accounts;
      const intentos = [];

      for (const acc of target) {
        const fila = { cuenta: acc.label };
        try {
          const token = await tokenOf(acc);
          // El número del panel puede ser la orden o el pack. Probamos como
          // orden: si existe, de ahí sacamos el pack y los datos del comprador.
          let orden = null;
          try { orden = await getOrder(token, id); } catch (e) { fila.no_es_orden = e.message; }
          const packId = orden?.pack_id || id;
          fila.orden_encontrada = !!orden;
          fila.pack = String(packId);
          if (orden) {
            fila.comprador = orden?.buyer?.id || null;
            fila.producto = orden?.order_items?.[0]?.item?.title || null;
            fila.vendida = orden?.date_created || null;
            fila.estado = orden?.status || null;
          }
          fila.le_preguntamos_a_ml = await diagnosticarConversacion(token, packId, acc.user_id);
        } catch (e) {
          fila.error = e.message;
        }
        intentos.push(fila);
        if (fila.orden_encontrada) break;   // ya la ubicamos, no hace falta seguir
      }
      return res.status(200).json({ ok: true, id, intentos });
    }

    // PREGUNTAS ATRASADAS: las que siguen sin responder después de X minutos.
    // Tatiana responde casi todas, pero algunas no las puede contestar (como
    // "si no me dicen qué colores, no me sirve", que necesita saber que el pack
    // es surtido sin elección). Esas quedan colgadas y hay que avisarle a una
    // persona: el bridge de WhatsApp consulta esto cada 5 minutos.
    if (action === 'atrasadas') {
      const expected = (process.env.ML_SWEEP_KEY || '').trim();
      if (req.method === 'GET' && expected && (req.query?.key || '').toString() !== expected) {
        return res.status(401).json({ error: 'key inválida' });
      }
      if (!accounts.length) return res.status(400).json({ error: 'No hay cuentas configuradas (ML_ACCOUNTS).' });
      const minutos = Math.max(1, Number(req.query?.minutos || req.body?.minutos) || ATRASADAS_MINUTOS);
      const corte = Date.now() - minutos * 60_000;
      const atrasadas = [];
      // Una sola lectura para todas las cuentas: el motivo por el que el bot no
      // contestó, anotado cuando pasó (ver anotarMotivo).
      let motivos = {};
      try { motivos = await verPreguntasSinResponder(); } catch { /* sin motivos el aviso igual sale */ }
      const botApagado = !autoanswerOn();

      for (const acc of accounts) {
        try {
          const token = await tokenOf(acc);
          const r = await getUnanswered(token, acc.user_id, 50);
          const viejas = (r?.questions || []).filter(q => new Date(q.date_created).getTime() <= corte);
          if (!viejas.length) continue;

          // Un solo multiget para todos los títulos y links de esta cuenta.
          const ids = [...new Set(viejas.map(q => q.item_id).filter(Boolean))];
          const items = {};
          if (ids.length) {
            try {
              // getItemsBulk devuelve un Map (item_id -> datos). Recorrerlo con
              // `for (const it of ...)` entrega pares [id, datos], así que `it.id`
              // era undefined y el aviso de WhatsApp salía SIEMPRE sin título ni
              // link -- justo los dos datos que sirven para encontrar la pregunta.
              for (const [id, it] of await getItemsBulk(token, ids)) {
                items[id] = { titulo: it?.title || null, link: it?.permalink || null, estado: it?.status || null };
              }
            } catch { /* sin títulos igual sirve: el id alcanza para encontrarla */ }
          }

          for (const q of viejas) {
            const info = items[String(q.item_id)] || {};
            atrasadas.push({
              cuenta: acc.label,
              question_id: q.id,
              texto: q.text,
              item_id: q.item_id,
              titulo: info.titulo || null,
              link: info.link || null,
              desde: q.date_created,
              hace_minutos: Math.round((Date.now() - new Date(q.date_created).getTime()) / 60_000),
              // Por qué sigue sin contestar. El orden importa: primero lo que
              // vemos AHORA (el bot apagado, la publicación no activa) y después
              // lo que quedó anotado cuando el bot lo intentó.
              motivo: botApagado
                ? 'El bot está apagado (ML_AUTOANSWER=off en Vercel).'
                : (info.estado && info.estado !== 'active'
                    ? `La publicación está ${info.estado === 'paused' ? 'PAUSADA' : 'FINALIZADA'}: ML no deja responder preguntas ahí.`
                    : (motivos[String(q.id)]?.motivo
                        || 'El bot todavía no la intentó: puede ser que ML no haya avisado (webhook) y falte el próximo barrido.')),
            });
          }
        } catch (e) {
          console.error('[ml-atrasadas] falló', { cuenta: acc.label, error: e.message });
          atrasadas.push({ cuenta: acc.label, error: e.message });
        }
      }
      atrasadas.sort((a, b) => (b.hace_minutos || 0) - (a.hace_minutos || 0));
      return res.status(200).json({ ok: true, minutos, bot_apagado: botApagado,
        cuantas: atrasadas.filter(a => !a.error).length, atrasadas });
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

      // ⚠️ DESCARTAR ANTES DE TOCAR EL KV (30-sep-2026)
      // ML notifica por CADA cambio de CADA publicación y de CADA orden, y la
      // app estaba suscripta a topics que no procesa: 637.953 invocaciones en
      // Vercel en 30 días (~21.300 por día, 15 por minuto, parejas las 24 hs).
      //
      // Lo caro no era sólo la invocación: `markWebhook` hace DOS escrituras al
      // KV, y corría ANTES de descartar el topic. 21.300 × 2 = 42.600 comandos
      // por día, 1,3 millones al mes contra un límite de 500.000. Por eso se
      // agotó Upstash — más que por el barrido de entregas.
      //
      // Ahora lo que no se procesa se descarta en la primera línea, sin KV y
      // sin trabajo. Queda un contador en memoria para que el diagnóstico
      // muestre igual que ML nos está llamando.
      const t = String(topic || '').toLowerCase().trim();
      if (t && !TOPICS_QUE_PROCESAMOS.has(t)) {
        const prev = webhooksDescartados.get(t) || { veces: 0 };
        webhooksDescartados.set(t, { veces: prev.veces + 1, ultimo: new Date().toISOString() });
        return res.status(200).json({ ok: true, skipped: t, nota: 'topic no procesado (descartado sin trabajo)' });
      }

      // Queda registrado para el diagnóstico: así se ve si ML nos está llamando.
      await markWebhook({ topic: topic || null, user_id: user_id ?? null, resource: resource || null });
      try {
        // ENVÍO ENTREGADO -> agendamos el mensaje post-venta para dentro de 5 min.
        if (topic === 'shipments') {
          if (!postventaOn()) return res.status(200).json({ ok: true, skipped: 'postventa apagada (ML_POSTVENTA)' });
          const acc = findAccountByUser(accounts, user_id);
          if (!acc) return res.status(200).json({ ok: false, error: 'cuenta no configurada para user ' + user_id });
          const shipmentId = String(resource || '').split('/').pop();
          const token = await tokenOf(acc);
          const envio = await getShipment(token, shipmentId);
          if (envio?.status !== 'delivered') {
            return res.status(200).json({ ok: true, skipped: 'envío en estado ' + (envio?.status || 's/d') });
          }
          const orden = await getOrder(token, envio.order_id);
          const r = await encolarLote([{
            orderId: envio.order_id,
            packId: orden?.pack_id || envio.order_id,
            buyerId: orden?.buyer?.id,
            cuenta: acc.label,
            titulo: orden?.order_items?.[0]?.item?.title || '',
          }]);
          return res.status(200).json({ ok: true, entregado: true, agendado: r.agendadas === 1,
            descartada: r.agendadas ? null : r });
        }
        if (topic && topic !== 'questions') return res.status(200).json({ ok: true, skipped: topic });
        const qId = String(resource || '').split('/').pop();
        const acc = findAccountByUser(accounts, user_id);
        if (!acc) {
          console.error('[ml-questions] webhook de un user sin cuenta en ML_ACCOUNTS', { user_id, resource });
          await markWebhookResultado('questions', { question_id: qId, ok: false, resultado: 'cuenta no configurada para user ' + user_id });
          return res.status(200).json({ ok: false, error: 'cuenta no configurada para user ' + user_id });
        }
        const token = await tokenOf(acc);
        const q = await getQuestion(token, qId);
        if (!q || q.status !== 'UNANSWERED') {
          await markWebhookResultado('questions', { question_id: qId, cuenta: acc.label, ok: true, resultado: 'ya respondida o inexistente' });
          return res.status(200).json({ ok: true, skipped: 'ya respondida o inexistente' });
        }
        // Interruptor de seguridad: poné ML_AUTOANSWER=off en Vercel para pausar el auto-respondido.
        const autopost = autoanswerOn();
        const out = await answerFlow({ acc, accounts, q, autopost });
        // Si quedó sin contestar, el motivo se guarda por pregunta: el aviso de
        // WhatsApp lo lee de ahí y Rodo ve POR QUÉ, no solo QUE no se contestó.
        await anotarMotivo(q, out, { autopost, cuenta: acc.label });
        await markWebhookResultado('questions', {
          question_id: qId, cuenta: acc.label, pregunta: (q.text || '').slice(0, 80),
          ok: !out.postError && !out.escalated,
          resultado: out.escalated ? ('no se responde: ' + out.note)
            : out.postError ? ('ML rechazó la respuesta: ' + out.postError)
            : autopost ? 'respondida por el bot' : 'generada pero NO posteada (ML_AUTOANSWER=off)',
          respuesta: (out.answer || '').slice(0, 120),
        });
        return res.status(200).json({ ok: !out.postError, autopost, ...out });
      } catch (e) {
        console.error('[ml-questions] webhook falló', { user_id, resource, error: e.message });
        const qIdFallado = String(resource || '').split('/').pop();
        await markWebhookResultado('questions', {
          question_id: qIdFallado, ok: false, resultado: 'ERROR: ' + e.message,
        });
        await anotarMotivo({ id: qIdFallado }, { error: e.message }, { autopost: true, cuenta: null });
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
