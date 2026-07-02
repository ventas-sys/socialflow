import { guideUser } from './ia-guide.js';
import { STORE, MAYORISTA, TEMPLATES, NEGOCIO } from './business-config.js';

// IA PRIMERO: cada mensaje lo interpreta directamente la IA (sin menú de reglas
// Sí/No ni a/b/c/d). La IA clasifica la intención y el sistema arma la respuesta.
export async function processMessage({ from, text, state, history }) {
  const safeState = state || { parentRow: null, fallbackStreak: 0 };
  const incoming = (text || '').trim();
  if (!incoming) {
    return { messages: [], state: safeState, matched: null, reason: 'empty_input' };
  }

  const lastBotMessage = (history || []).filter(h => h.role === 'bot').slice(-1)[0]?.text || '';
  const ia = await guideUser({
    userText: incoming,
    currentRuleReply: null,
    menuOptions: [],
    lastBotMessage,
    recentHistory: history || [],
  });

  const iaMeta = { intent: ia.intent, confidence: ia.confidence, needsHuman: ia.needsHuman };
  const baseState = { parentRow: null, fallbackStreak: 0 };

  // --- HORARIOS / UBICACIÓN: responde la IA natural; plantilla de respaldo -
  if (ia.intent === 'horario_ubicacion') {
    const body = ia.reply ||
      `📍 *${NEGOCIO.nombre}* — ${NEGOCIO.direccion}\n` +
      `🕒 ${NEGOCIO.horarios}\n\n` +
      `Te esperamos 🙌`;
    return {
      messages: [{ body, delaySec: 0 }],
      state: baseState,
      matched: { kind: 'ia_horario_ubicacion' },
      ia: iaMeta,
      reason: 'ia_horario_ubicacion',
    };
  }

  // --- PRODUCTO: link de la tienda ML filtrado por la palabra clave ------
  if (ia.intent === 'producto' && ia.productKeyword) {
    const kw = ia.productKeyword;
    const url = STORE.searchUrl(kw);
    return {
      messages: [
        ...(ia.reply ? [{ body: ia.reply, delaySec: 0 }] : []),
        { body: TEMPLATES.producto(kw, url), delaySec: ia.reply ? 1 : 0 },
      ],
      state: baseState,
      matched: { kind: 'ia_producto', keyword: kw },
      ia: iaMeta,
      reason: 'ia_producto',
    };
  }

  // --- MAYORISTA: lista (Drive) + descuentos. Etiqueta para que un humano
  // siga la venta, pero el bot SIGUE respondiendo dudas (mínimo, factura...).
  if (ia.intent === 'mayorista') {
    return {
      messages: [
        { body: `🧾 Te paso nuestra *Lista Mayorista* completa:\n${MAYORISTA.driveUrl}`, delaySec: 0 },
        { body: MAYORISTA.descuentos, delaySec: 2 },
        { body: `Cualquier duda con la lista decime, y para cerrar el pedido te paso con un compañero 🤗`, delaySec: 2 },
      ],
      state: { ...baseState, flagHuman: true },
      matched: { kind: 'ia_mayorista' },
      ia: iaMeta,
      reason: 'ia_mayorista',
    };
  }

  // --- RECLAMO ML: pedimos datos + guía. Etiqueta para el humano, pero el
  // bot sigue guiando (ej: "no encuentro el usuario", manda un mail, etc.).
  if (ia.intent === 'reclamo_ml') {
    return {
      messages: [
        { body: TEMPLATES.reclamoPedido, delaySec: 0 },
        { body: TEMPLATES.reclamoComoVerUsuario, delaySec: 10 },
      ],
      state: { ...baseState, flagHuman: true },
      matched: { kind: 'ia_reclamo_ml' },
      ia: iaMeta,
      reason: 'ia_reclamo_ml',
    };
  }

  // --- ANSWER / REDIRECT / HUMAN / fallback -----------------------------
  const replyBody = ia.reply || 'Uh, perdón, no te llegué a entender bien 🙈 ¿Me lo repetís de otra forma?';
  return {
    messages: [{ body: replyBody, delaySec: 1 }],
    state: { ...baseState, escalated: !!ia.needsHuman },
    matched: { kind: 'ia_' + (ia.intent || 'unknown') },
    ia: iaMeta,
    debug: ia.debug || null,
    reason: ia.needsHuman ? 'ia_escalate_human' : 'ia_direct',
  };
}
