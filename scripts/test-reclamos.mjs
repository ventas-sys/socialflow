// Pruebas del clasificador de reclamos y mensajes (sin red). node scripts/test-reclamos.mjs
import assert from 'node:assert/strict';
import { clasificarTexto, motivoLegible, vencimientoReclamo, vendedorPuedeActuar, respuestaSugerida, armarCasos, resumenEnTexto } from '../lib/ml/reclamos.mjs';

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

// ¿El vendedor puede actuar? Forma real de un reclamo de FULL en mediación de ML:
// mediador interno y available_actions vacías en las dos partes.
const enMediacion = { id: 5608193678, stage: 'dispute', type: 'mediations', reason_id: 'PDD9939', players: [
  { role: 'complainant', type: 'buyer', available_actions: [] },
  { role: 'respondent', type: 'seller', available_actions: [] },
  { role: 'mediator', type: 'internal', available_actions: [] },
] };
assert.equal(vendedorPuedeActuar(enMediacion), false);
const conAccion = { players: [{ role: 'respondent', available_actions: [{ action: 'send_message', due_date: '2026-11-12T10:00:00Z' }] }] };
assert.equal(vendedorPuedeActuar(conAccion), true);
assert.equal(vendedorPuedeActuar({}), false);
assert.equal(vendedorPuedeActuar(null), false);

// Armado + resumen
const cuentas = { full: { label: 'full', mode: 'full' }, local: { label: 'local', mode: 'local' } };
const casos = armarCasos([
  { cuenta: 'full', tipo: 'reclamo', id: '1', motivo: 'no le llegó (PNR1)', vence: Date.parse('2026-11-12T10:00:00Z'), accion_vendedor: true, orden: '2000018873403020' },
  { cuenta: 'full', tipo: 'reclamo', id: '9', motivo: 'motivo PDD9939', accion_vendedor: false, orden: '2000019348482628' },
  { cuenta: 'full', tipo: 'reclamo', id: '10', motivo: 'motivo PDD9939', accion_vendedor: false },
  { cuenta: 'local', tipo: 'mensaje', id: '2', texto: 'a qué hora abren? quiero retirar' },
  { cuenta: 'full', tipo: 'mensaje', id: '3', texto: 'cambien la factura a mi razón social' },
], cuentas);
assert.equal(casos.filter(c => c.solo).length, 1);
assert.equal(casos.filter(c => c.ml).length, 2);
assert.equal(casos.find(c => c.id === '2').solo, true);
assert.equal(casos.find(c => c.id === '3').solo, false);
assert.equal(casos.find(c => c.id === '1').solo, false);
assert.equal(casos.find(c => c.id === '1').ml, false);
assert.equal(casos.find(c => c.id === '9').ml, true);

const texto = resumenEnTexto(casos, { ahora: Date.parse('2026-11-11T10:00:00Z') });
assert.match(texto, /Necesitan tu ayuda \(2\)/);
assert.match(texto, /En mediación de ML, sin acción tuya \(2\)/);
assert.match(texto, /FULL: 2/);
assert.match(texto, /Se pueden resolver solos \(1\)/);
assert.match(texto, /vence/);
assert.match(texto, /orden 2000018873403020/);
// Los reclamos en mediación NO se listan uno por uno (serían puro ruido)
assert.doesNotMatch(texto, /2000019348482628/);
assert.ok(texto.indexOf('Necesitan tu ayuda') < texto.indexOf('En mediación') && texto.indexOf('En mediación') < texto.indexOf('Se pueden resolver solos'));
// Vencido se marca
assert.match(resumenEnTexto(casos, { ahora: Date.parse('2026-11-20T10:00:00Z') }), /VENCIDO/);
// Solo mediación: no pide ayuda
const soloML = resumenEnTexto(armarCasos([{ cuenta: 'full', tipo: 'reclamo', id: '9', accion_vendedor: false }], cuentas));
assert.match(soloML, /Nada necesita tu ayuda/);
// Sin nada
assert.match(resumenEnTexto([]), /No hay reclamos abiertos/);

console.log('✅ reclamos: todo OK');
