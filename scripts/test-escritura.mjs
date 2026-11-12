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
// Un mensaje largo tarda más que uno corto (mismo azar).
assert.ok(duracionTotal(200, 0.5) > duracionTotal(10, 0.5));

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
