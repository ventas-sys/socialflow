// Pruebas del clasificador de reclamos y mensajes (sin red). node scripts/test-reclamos.mjs
import assert from 'node:assert/strict';
import { clasificarTexto, motivoLegible, vencimientoReclamo, respuestaSugerida, armarCasos, resumenEnTexto } from '../lib/ml/reclamos.mjs';

// Mensajes de compradores
assert.equal(clasificarTexto('¿Hasta qué hora atienden? Quiero pasar a retirarlo'), 'retiro_horarios');
assert.equal(clasificarTexto('Hola, se puede retirar por el local el sábado?'), 'retiro_horarios');
assert.equal(clasificarTexto('Necesito que cambien la factura a nombre de mi empresa, CUIT 30-1234'), 'cambio_factura');
assert.equal(clasificarTexto('La factura tiene que ser A, soy responsable inscripto'), 'cambio_factura');
// Si pide factura Y retiro, manda la factura (la resuelve una persona)
assert.equal(clasificarTexto('Paso a retirar mañana, ¿me cambian la factura?'), 'cambio_factura');
// Palabras graves: nunca "solo"
assert.equal(clasificarTexto('Quiero la devolución del dinero, retiro el sábado'), 'otro');
assert.equal(clasificarTexto('Muchas gracias por todo'), 'otro');
assert.equal(clasificarTexto(''), 'otro');
assert.equal(clasificarTexto(null), 'otro');

// Motivos
assert.match(motivoLegible('PNR2'), /no le llegó/);
assert.match(motivoLegible('PDD9'), /distinto o con defecto/);
assert.match(motivoLegible('XYZ'), /motivo XYZ/);
assert.match(motivoLegible(undefined), /sin motivo/);

// Vencimiento: la más cercana, solo del vendedor (respondent)
const v = vencimientoReclamo({ players: [
  { role: 'complainant', available_actions: [{ due_date: '2026-11-01T10:00:00Z' }] },
  { role: 'respondent', available_actions: [{ due_date: '2026-11-14T10:00:00Z' }, { due_date: '2026-11-12T10:00:00Z' }] },
] });
assert.equal(v, Date.parse('2026-11-12T10:00:00Z'));
assert.equal(vencimientoReclamo({}), null);
assert.equal(vencimientoReclamo(null), null);

// Respuesta sugerida: sin dirección exacta, y distinta según la cuenta
const local = respuestaSugerida('retiro_horarios', { mode: 'local' }, { horarios: 'de lunes a viernes de 14 a 17:30', barrio: 'Floresta, CABA' });
assert.match(local, /Floresta/);
assert.match(local, /cerca de la estación/);
assert.doesNotMatch(local, /Bacacay/);
assert.doesNotMatch(local, /https?:|whatsapp|\d{3}[ -]\d{4}/i);
assert.match(respuestaSugerida('retiro_horarios', { mode: 'full' }), /no tiene retiro por el local/);
assert.equal(respuestaSugerida('cambio_factura', { mode: 'local' }), null);

// Armado + resumen
const casos = armarCasos([
  { cuenta: 'full', tipo: 'reclamo', id: '1', motivo: 'no le llegó (PNR1)', vence: Date.parse('2026-11-12T10:00:00Z'), producto: 'Tapa de arranque' },
  { cuenta: 'local', tipo: 'mensaje', id: '2', texto: 'a qué hora abren? quiero retirar' },
  { cuenta: 'full', tipo: 'mensaje', id: '3', texto: 'cambien la factura a mi razón social' },
], { full: { label: 'full', mode: 'full' }, local: { label: 'local', mode: 'local' } });
assert.equal(casos.filter(c => c.solo).length, 1);
assert.equal(casos.find(c => c.id === '2').solo, true);
assert.equal(casos.find(c => c.id === '3').solo, false);
assert.equal(casos.find(c => c.id === '1').solo, false);

const texto = resumenEnTexto(casos, { ahora: Date.parse('2026-11-11T10:00:00Z') });
assert.match(texto, /Necesitan tu ayuda \(2\)/);
assert.match(texto, /Se pueden resolver solos \(1\)/);
assert.match(texto, /vence/);
assert.ok(texto.indexOf('Necesitan tu ayuda') < texto.indexOf('Se pueden resolver solos'));
// Vencido se marca
assert.match(resumenEnTexto(casos, { ahora: Date.parse('2026-11-20T10:00:00Z') }), /VENCIDO/);
// Sin nada
assert.match(resumenEnTexto([]), /No hay reclamos abiertos/);

console.log('✅ reclamos: todo OK');
