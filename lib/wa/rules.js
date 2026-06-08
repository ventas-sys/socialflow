import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.resolve(__dirname, '..', '..', 'data', 'wa-rules.json');

let cached = null;
export function loadRules() {
  if (cached) return cached;
  const raw = fs.readFileSync(dataPath, 'utf8');
  cached = JSON.parse(raw);
  cached.byRow = Object.create(null);
  for (const r of cached.rules) cached.byRow[r.rowNumber] = r;
  return cached;
}

function norm(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

function patternToRegex(pattern) {
  const cleaned = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const withWild = cleaned.replace(/\*/g, '.*');
  return new RegExp('^' + withWild + '$', 'is');
}

function similarMatch(text, pattern) {
  const t = norm(text);
  const p = norm(pattern);
  if (!p) return false;
  if (t === p) return true;
  if (t.startsWith(p + ' ') || t.startsWith(p + '.') || t.startsWith(p + ',')) return true;
  if (t.length <= p.length + 2 && t.includes(p)) return true;
  return false;
}

function normalMatch(text, pattern) {
  const t = norm(text);
  const p = norm(pattern);
  if (p === '*') return true;
  if (!p.includes('*')) return t === p;
  const re = patternToRegex(p);
  return re.test(t);
}

function noneMatch(text, pattern) {
  if (pattern === '*') return true;
  return norm(text) === norm(pattern);
}

function ruleMatches(rule, text) {
  const mode = rule.patternMode || 'none';
  if (rule.received === '*') return true;
  if (mode === 'similar') return similarMatch(text, rule.received);
  if (mode === 'normal')  return normalMatch(text, rule.received);
  return noneMatch(text, rule.received);
}

function candidatesForParent(data, parentRow) {
  return data.rules.filter(r => r.parentRow === parentRow);
}

export function matchAt(text, state, data = loadRules()) {
  const parentRow = state?.parentRow ?? null;
  const specific = candidatesForParent(data, parentRow).filter(r => r.received !== '*');
  for (const r of specific) {
    if (ruleMatches(r, text)) return { rule: r, kind: 'specific' };
  }
  const wild = candidatesForParent(data, parentRow).filter(r => r.received === '*');
  if (wild.length) return { rule: wild[0], kind: 'wildcard' };
  if (parentRow !== null) {
    return matchAt(text, { parentRow: null }, data);
  }
  return { rule: null, kind: 'none' };
}

export function nextStateAfter(rule, currentState, data = loadRules()) {
  if (!rule) {
    return { parentRow: null, fallbackStreak: (currentState?.fallbackStreak || 0) + 1, lastRuleRow: null };
  }
  let nextParent = rule.gotoRow != null ? rule.gotoRow : rule.rowNumber;
  const kids = candidatesForParent(data, nextParent);
  if (!kids.length) nextParent = null;
  const isWild = rule.received === '*';
  return {
    parentRow: nextParent,
    fallbackStreak: isWild ? (currentState?.fallbackStreak || 0) + 1 : 0,
    lastRuleRow: rule.rowNumber,
  };
}

export function menuOptionsAt(parentRow, data = loadRules()) {
  const kids = candidatesForParent(data, parentRow);
  return kids
    .filter(r => r.received !== '*')
    .map(r => ({ row: r.rowNumber, key: r.received, mode: r.patternMode, preview: (r.messages[0] || '').slice(0, 80) }));
}

export function describeRule(rule) {
  if (!rule) return null;
  return {
    row: rule.rowNumber,
    received: rule.received,
    patternMode: rule.patternMode,
    label: rule.label,
    gotoRow: rule.gotoRow,
  };
}
