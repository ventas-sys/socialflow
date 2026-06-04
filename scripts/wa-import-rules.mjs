#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const csvPath = path.join(root, 'data', 'wa-rules.csv');
const outPath = path.join(root, 'data', 'wa-rules.json');

const raw = fs.readFileSync(csvPath, 'utf8');

function parseCsv(text) {
  const out = [];
  let i = 0;
  let field = '';
  let row = [];
  let inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { inQuotes = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); out.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); out.push(row); }
  return out;
}

const rows = parseCsv(raw).filter(r => r.length > 1);
let headerIdx = rows.findIndex(r => r[0] === 'received_message');
if (headerIdx === -1) throw new Error('header row not found');
const headers = rows[headerIdx];
const dataRows = rows.slice(headerIdx + 1).filter(r => r[0] !== '');

const colIdx = (name) => headers.indexOf(name);
const idx = {
  received: colIdx('received_message'),
  pattern: colIdx('pattern_matching'),
  reply: colIdx('reply_message'),
  recipients: colIdx('recipients'),
  subrule: colIdx('subrule_of'),
  goto: colIdx('go_to_rule'),
  delay: colIdx('reply_delay'),
  delayMax: colIdx('reply_delay_max'),
  id: colIdx('_id'),
  label: colIdx('label'),
};

const rules = dataRows.map((r, i) => {
  const rowNumber = i + 1; // 1-indexed data row, this is what subrule_of references
  const replyRaw = r[idx.reply] || '';
  const reply = replyRaw.replace(/\\n/g, '\n');
  const messages = reply.split('<#>').map(s => s.trim()).filter(Boolean);
  const subrule = (r[idx.subrule] || '').trim();
  const goto = (r[idx.goto] || '').trim();
  return {
    rowNumber,
    id: (r[idx.id] || '').trim(),
    label: (r[idx.label] || '').trim(),
    received: r[idx.received] || '',
    patternMode: r[idx.pattern] || 'none',
    messages,
    recipients: r[idx.recipients] || '',
    parentRow: subrule ? Number(subrule) : null,
    gotoRow: goto ? Number(goto) : null,
    delaySec: Number(r[idx.delay] || 0),
    delayMaxSec: Number(r[idx.delayMax] || 0),
  };
});

const rootRules = rules.filter(r => r.parentRow === null);
const childrenOf = Object.create(null);
for (const r of rules) {
  if (r.parentRow != null) {
    childrenOf[r.parentRow] ||= [];
    childrenOf[r.parentRow].push(r.rowNumber);
  }
}

const out = {
  source: 'AutoResponder for WhatsApp CSV export',
  importedAt: new Date().toISOString(),
  totalRules: rules.length,
  roots: rootRules.map(r => r.rowNumber),
  childrenByRow: childrenOf,
  rules,
};

fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`Wrote ${rules.length} rules to ${path.relative(root, outPath)}`);
console.log(`Roots: ${rootRules.map(r => `[${r.rowNumber}] ${r.received}`).join(', ')}`);
console.log(`Tree summary:`);
function dump(rowNum, depth) {
  const r = rules.find(x => x.rowNumber === rowNum);
  if (!r) return;
  const pad = '  '.repeat(depth);
  const preview = (r.messages[0] || '').slice(0, 60).replace(/\n/g, ' ');
  console.log(`${pad}[${rowNum}] "${r.received}" (${r.patternMode}) -> ${preview}...`);
  const kids = childrenOf[rowNum] || [];
  for (const k of kids) dump(k, depth + 1);
}
for (const r of rootRules) dump(r.rowNumber, 0);
