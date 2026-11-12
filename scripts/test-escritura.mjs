// node scripts/test-escritura.mjs
import assert from 'node:assert/strict';
import { duracionTotal, planEscritura, MIN_MS, MAX_MS } from '../lib/wa/escritura.mjs';

// El total siempre cae entre 5 y 15 segundos, para cualquier largo y cualquier azar.
for (const largo of [0, 1, 20, 60, 120, 220, 500, 5000]) {
  for (const azar of [0, 0.25, 0.5, 0.99, 1]) {
    const d = duracionTotal(largo, azar);
    assert.ok(d >= MIN_MS && d <= MAX_MS, `largo ${largo} azar ${azar} -> ${d}`);
  }
}
// Corto = 5 s, largo = 15 s, el medio queda en el medio (sin azar: 0.5 no suma ni resta).
assert.equal(duracionTotal(10, 0.5), 5000);
assert.equal(duracionTotal(40, 0.5), 5000);
assert.equal(duracionTotal(220, 0.5), 15000);
assert.equal(duracionTotal(600, 0.5), 15000);
const medio = duracionTotal(130, 0.5);
assert.ok(medio > 8000 && medio < 12000, 'medio: ' + medio);
// Crece parejo con el largo.
let prev = 0;
for (let n = 0; n <= 260; n += 20) { const d = duracionTotal(n, 0.5); assert.ok(d >= prev, `n=${n}`); prev = d; }

// El plan: empieza escribiendo, pausa en el medio, termina escribiendo, y suma el total.
for (const total of [5000, 6000, 8000, 11000, 15000, 100, 99999]) {
  for (let i = 0; i < 50; i++) {
    const plan = planEscritura(total);
    assert.equal(plan.length, 3);
    assert.equal(plan[0].escribiendo, true);
    assert.equal(plan[1].escribiendo, false);
    assert.equal(plan[2].escribiendo, true);
    const suma = plan.reduce((s, p) => s + p.ms, 0);
    const esperado = Math.min(MAX_MS, Math.max(MIN_MS, total));
    assert.equal(suma, esperado, `total ${total}`);
    assert.ok(plan.every(p => p.ms > 0), JSON.stringify(plan));
  }
}
console.log('✅ escritura: todo OK');
