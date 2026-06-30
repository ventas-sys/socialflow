import { loadRules, matchAt, nextStateAfter, menuOptionsAt } from './rules.js';
import { guideUser } from './ia-guide.js';
import { STORE, MAYORISTA, TEMPLATES, NEGOCIO } from './business-config.js';

function ruleMessages(rule) {
  if (!rule) return [];
  return rule.messages.map(m => ({
    body: m,
    delaySec: rule.delaySec || 0,
  }));
}

export async function processMessage({ from, text, state, history }) {
  const data = loadRules();
  const safeState = state || { parentRow: null, fallbackStreak: 0, lastRuleRow: null };
  const incoming = (text || '').trim();
  if (!incoming) {
    return {
      messages: [],
      state: safeState,
      matched: null,
      reason: 'empty_input',
    };
  }

  const m = matchAt(incoming, safeState, data);

  if (m.kind === 'specific') {
    const newState = nextStateAfter(m.rule, safeState, data);
    return {
      messages: ruleMessages(m.rule),
      state: newState,
      matched: { row: m.rule.rowNumber, key: m.rule.received, kind: 'specific' },
      reason: 'rule_matched',
    };
  }

  const wildcardRule = m.kind === 'wildcard' ? m.rule : null;
  const lastBotMessage = (history || []).filter(h => h.role === 'bot').slice(-1)[0]?.text || '';
  const menuOptions = menuOptionsAt(safeState.parentRow, data);

  const ia = await guideUser({
    userText: incoming,
    currentRuleReply: wildcardRule?.messages?.[0] || null,
    menuOptions,
    lastBotMessage,
    recentHistory: history || [],
  });

  const iaMeta = { intent: ia.intent, confidence: ia.confidence, needsHuman: ia.needsHuman };
  const baseState = { ...safeState, parentRow: null, fallbackStreak: 0 };

  // --- HORARIOS / UBICACIÓN: respuesta directa con datos reales ----------
  if (ia.intent === 'horario_ubicacion') {
    const body =
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
      messages: [{ body: TEMPLATES.producto(kw, url), delaySec: 0 }],
      state: baseState,
      matched: { kind: 'ia_producto', keyword: kw },
      ia: iaMeta,
      reason: 'ia_producto',
    };
  }

  // --- MAYORISTA: lista (Drive) + descuentos, luego pasa a humano --------
  if (ia.intent === 'mayorista') {
    return {
      messages: [
        { body: `🧾 Te paso nuestra *Lista Mayorista* completa:\n${MAYORISTA.driveUrl}`, delaySec: 0 },
        { body: MAYORISTA.descuentos, delaySec: 2 },
        { body: `Cualquier duda con la lista o para cerrar el pedido, ya te paso con un compañero 🤗`, delaySec: 2 },
      ],
      state: { ...baseState, escalated: true },
      matched: { kind: 'ia_mayorista' },
      ia: iaMeta,
      reason: 'ia_mayorista',
    };
  }

  // --- RECLAMO ML: pedimos datos + guía de usuario, y agendamos a humano -
  if (ia.intent === 'reclamo_ml') {
    return {
      messages: [
        { body: TEMPLATES.reclamoPedido, delaySec: 0 },
        { body: TEMPLATES.reclamoComoVerUsuario, delaySec: 10 },
      ],
      state: { ...baseState, escalated: true },
      matched: { kind: 'ia_reclamo_ml' },
      ia: iaMeta,
      reason: 'ia_reclamo_ml',
    };
  }

  // --- REDIRECT: la IA mapea el mensaje a una opción del menú ------------
  if (ia.matchedKey && ia.intent === 'redirect') {
    const re = matchAt(ia.matchedKey, safeState, data);
    if (re.kind === 'specific') {
      const ruleMsgs = ruleMessages(re.rule);
      const transitionState = nextStateAfter(re.rule, safeState, data);
      return {
        messages: [...(ia.reply ? [{ body: ia.reply, delaySec: 1 }] : []), ...ruleMsgs],
        state: transitionState,
        matched: { row: re.rule.rowNumber, key: re.rule.received, kind: 'ia_redirect' },
        ia: { intent: ia.intent, confidence: ia.confidence },
        reason: 'ia_redirected',
      };
    }
  }

  // --- ANSWER / HUMAN / fallback ----------------------------------------
  let newState = safeState;
  if (wildcardRule) {
    newState = nextStateAfter(wildcardRule, safeState, data);
  } else {
    newState = { ...safeState, fallbackStreak: (safeState.fallbackStreak || 0) + 1 };
  }

  const replyBody = ia.reply || 'Disculpá, no te entendí bien 🙏 ¿Lo podés escribir de otra forma o decirme una opción del menú?';
  return {
    messages: [{ body: replyBody, delaySec: 1 }],
    state: { ...newState, escalated: ia.needsHuman || newState.fallbackStreak >= 3 },
    matched: { row: wildcardRule?.rowNumber || null, key: '*', kind: 'ia_fallback' },
    ia: iaMeta,
    reason: ia.needsHuman ? 'ia_escalate_human' : 'ia_fallback',
  };
}
