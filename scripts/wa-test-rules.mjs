#!/usr/bin/env node
import { loadRules, matchAt, nextStateAfter, menuOptionsAt } from '../lib/wa/rules.js';

const data = loadRules();
console.log(`Loaded ${data.totalRules} rules, ${data.roots.length} root menus`);

function test(name, fn) {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✗ ${name}: ${e.message}`); }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

test('root: "a" matches Ubicación', () => {
  const m = matchAt('a', { parentRow: null });
  assert(m.kind === 'specific', 'expected specific match');
  assert(m.rule.received === 'a', 'expected rule a');
  assert(m.rule.messages[0].includes('Ubicación'), 'expected ubicación content');
});

test('root: "A" (case insensitive)', () => {
  const m = matchAt('A', { parentRow: null });
  assert(m.kind === 'specific');
  assert(m.rule.received === 'a');
});

test('root: "b" then "1" submenu = cliente mayorista', () => {
  const m1 = matchAt('b', { parentRow: null });
  assert(m1.rule.received === 'b');
  const s1 = nextStateAfter(m1.rule, { parentRow: null });
  assert(s1.parentRow === 14, `parent should be 14 got ${s1.parentRow}`);
  const m2 = matchAt('1', s1);
  assert(m2.kind === 'specific', `expected specific got ${m2.kind}`);
  assert(m2.rule.received === '*1*', `expected *1* got ${m2.rule.received}`);
});

test('root: "c" then "*1*" submenu', () => {
  const m1 = matchAt('c', { parentRow: null });
  const s1 = nextStateAfter(m1.rule, { parentRow: null });
  const m2 = matchAt('1', s1);
  assert(m2.rule.messages[0].includes('No me llegó'), 'expected no llegó');
});

test('root: garbage falls to wildcard at root (none)', () => {
  const m = matchAt('jdkfshjk', { parentRow: null });
  assert(m.kind === 'none', `expected none got ${m.kind}`);
});

test('"d" submenu si → link mercadolibre', () => {
  const m1 = matchAt('d', { parentRow: null });
  const s1 = nextStateAfter(m1.rule, { parentRow: null });
  assert(s1.parentRow === 18);
  const m2 = matchAt('si', s1);
  assert(m2.rule.received === 'si');
  assert(m2.rule.messages[0].includes('MercadoLibre'));
});

test('"d" submenu wildcard (typed "tal vez")', () => {
  const m1 = matchAt('d', { parentRow: null });
  const s1 = nextStateAfter(m1.rule, { parentRow: null });
  const m2 = matchAt('tal vez', s1);
  assert(m2.kind === 'wildcard', `expected wildcard got ${m2.kind}`);
  assert(m2.rule.received === '*');
});

test('nombre/marca/ciudad/provincia matches normal pattern', () => {
  const text = 'Nombre: Juan Perez\nMarca: La Negra\nCiudad/Provincia: Rosario, Santa Fe';
  const m = matchAt(text, { parentRow: 16 });
  assert(m.kind === 'specific', `expected specific got ${m.kind} (rule: ${m.rule?.received})`);
  assert(m.rule.received.includes('nombre'));
});

test('menu options at root has 4 items', () => {
  const opts = menuOptionsAt(null);
  assert(opts.length === 4, `expected 4 got ${opts.length}`);
  assert(opts.map(o => o.key).join(',') === 'a,b,c,d');
});

console.log('\nDone.');
