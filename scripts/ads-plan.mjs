// Resumen + plan de ajustes de publicidad a partir del JSON de ads-leer-reporte.py.
// Uso: node scripts/ads-plan.mjs ads.json [unidades_por_dia_ML] [cargo_por_unidad]
// Solo calcula: no toca ninguna campaña (Rodo aplica a mano).
import { readFileSync } from 'fs';
import { planSemanal, planEnTexto } from '../lib/ml/ads-optimizer.js';

const [, , archivo, unidades, cargo] = process.argv;
const { periodo, anuncios } = JSON.parse(readFileSync(archivo, 'utf8'));
const m = (n) => '$' + Math.round(n).toLocaleString('es-AR');

console.log(periodo, '\n');
const tot = (f) => anuncios.filter(f).reduce((s, a) => ({ inv: s.inv + a.inversion, ing: s.ing + a.ingresos, v: s.v + a.ventas }), { inv: 0, ing: 0, v: 0 });
for (const c of [...new Set(anuncios.map(a => a.camp))]) {
  const t = tot(a => a.camp === c);
  console.log(`${c}: gasto ${m(t.inv)} · ingresos ${m(t.ing)} · ROAS ${t.inv ? (t.ing / t.inv).toFixed(2) : '-'} · ventas por publicidad ${t.v}`);
}
const T = tot(() => true);
console.log(`TOTAL: gasto ${m(T.inv)} · ingresos ${m(T.ing)} · ROAS ${T.inv ? (T.ing / T.inv).toFixed(2) : '-'}\n`);

// Fondo de publicidad: unidades vendidas (panel de ML, 30 dias) x cargo por unidad.
if (unidades && cargo) {
  const fondo = Number(unidades) * Number(cargo);
  console.log(`Fondo: ${unidades} u × ${m(cargo)} = ${m(fondo)} → cubre ${(100 * fondo / T.inv).toFixed(0)}% del gasto; salen del margen ${m(Math.max(0, T.inv - fondo))}`);
  console.log(`Cargo que cerraría el gasto: ${m(T.inv / Number(unidades))} por unidad\n`);
}

const inactivos = anuncios.filter(a => /^(deshabilitado|pausado|movido)$/i.test(a.estado) && a.ingresos > 0)
  .sort((a, b) => b.ingresos - a.ingresos);
if (inactivos.length) {
  console.log('Con ventas en el período pero hoy inactivos (¿falta stock?):');
  for (const a of inactivos) console.log(`  ${a.estado} · ingresos ${m(a.ingresos)} · ${a.titulo.slice(0, 60)}`);
  console.log('');
}
console.log(planEnTexto(planSemanal(anuncios), 'Ajustes de publicidad'));
