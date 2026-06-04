import { loadRules, matchAt, nextStateAfter, menuOptionsAt } from './rules.js';
import { guideUser } from './ia-guide.js';

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

  let newState = safeState;
  if (ia.matchedKey && ia.intent === 'redirect') {
    const re = matchAt(ia.matchedKey, safeState, data);
    if (re.kind === 'specific') {
      const ruleMsgs = ruleMessages(re.rule);
      const transitionState = nextStateAfter(re.rule, safeState, data);
      return {
        messages: [{ body: ia.reply, delaySec: 1 }, ...ruleMsgs],
        state: transitionState,
        matched: { row: re.rule.rowNumber, key: re.rule.received, kind: 'ia_redirect' },
        ia: { intent: ia.intent, confidence: ia.confidence },
        reason: 'ia_redirected',
      };
    }
  }

  if (wildcardRule) {
    newState = nextStateAfter(wildcardRule, safeState, data);
  } else {
    newState = { ...safeState, fallbackStreak: (safeState.fallbackStreak || 0) + 1 };
  }

  return {
    messages: [{ body: ia.reply, delaySec: 1 }],
    state: { ...newState, escalated: ia.needsHuman || newState.fallbackStreak >= 3 },
    matched: { row: wildcardRule?.rowNumber || null, key: '*', kind: 'ia_fallback' },
    ia: { intent: ia.intent, confidence: ia.confidence, needsHuman: ia.needsHuman },
    reason: ia.needsHuman ? 'ia_escalate_human' : 'ia_fallback',
  };
}
