// Pruebas del clasificador de reclamos y mensajes (sin red). node scripts/test-reclamos.mjs
import assert from 'node:assert/strict';
import { clasificarTexto, motivoLegible, vencimientoReclamo, vendedorPuedeActuar, accionesDelVendedor, productosConMasReclamos, respuestaSugerida, armarCasos, resumenEnTexto } from '../lib/ml/reclamos.mjs';

// Mensajes de compradores
// Retiro por el local: hace falta intención de ir a buscarlo.
assert.equal(clasificarTexto('Hola, se puede retirar por el local el sábado?'), 'retiro_horarios');
assert.equal(clasificarTexto('¿Hasta qué hora atienden? Quiero pasar a retirarlo'), 'retiro_horarios');
assert.equal(clasificarTexto('Puedo ir a buscarlo mañana'), 'retiro_horarios');
// Factura
assert.equal(clasificarTexto('Necesito que cambien la factura a nombre de mi empresa, CUIT 30-1234'), 'cambio_factura');
assert.equal(clasificarTexto('La factura tiene que ser A, soy responsable inscripto'), 'cambio_factura');
assert.equal(clasificarTexto('Hola! Me mandas la factura A por favor'), 'cambio_factura');
assert.equal(clasificarTexto('me pasas la factura\n'), 'cambio_factura');
assert.equal(clasificarTexto('Paso a retirar mañana, ¿me cambian la factura?'), 'cambio_factura');
// Casos REALES de FULL (14-nov-2026) que la primera versión clasificaba mal como "retiro":
// son consultas por el horario de entrega o por cambiar el domicilio.
assert.equal(clasificarTexto('Hola en qué horario llegarían?'), 'envio_horario');
assert.equal(clasificarTexto('Hola buen día tenés forma de saber aproximadamente en qué horario pasan por colegiales porque está muy amplio entre las tres y las 9 de la noche'), 'envio_horario');
assert.equal(clasificarTexto('Hola disculpa mira quería cambiar el domicilio porque no va a llegar a un horario que haya gente en mi casa'), 'cambio_domicilio');
assert.equal(clasificarTexto('¿cuándo llega mi pedido?'), 'envio_horario');
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
assert.equal(respuestaSugerida('cambio_domicilio', { mode: 'full' }), null);
// Envío demorado/horario: pide actualizar la app y NO promete ninguna hora
const envio = respuestaSugerida('envio_horario', { mode: 'full' });
assert.match(envio, /Actualizá la app de Mercado Libre/);
assert.doesNotMatch(envio, /\b\d{1,2}(:\d\d)? ?(hs|horas)\b/);
assert.doesNotMatch(envio, /https?:|whatsapp|Bacacay/i);

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
  { cuenta: 'full', tipo: 'mensaje', id: '4', texto: 'Hola en qué horario llegarían?' },
  { cuenta: 'full', tipo: 'mensaje', id: '5', texto: 'quería cambiar el domicilio de entrega' },
], cuentas);
assert.equal(casos.filter(c => c.solo).length, 2);
assert.equal(casos.find(c => c.id === '4').categoria, 'envio_horario');
assert.equal(casos.find(c => c.id === '5').solo, false);
assert.equal(casos.filter(c => c.ml).length, 2);
assert.equal(casos.find(c => c.id === '2').solo, true);
assert.equal(casos.find(c => c.id === '3').solo, false);
assert.equal(casos.find(c => c.id === '1').solo, false);
assert.equal(casos.find(c => c.id === '1').ml, false);
assert.equal(casos.find(c => c.id === '9').ml, true);

const texto = resumenEnTexto(casos, { ahora: Date.parse('2026-11-11T10:00:00Z') });
assert.match(texto, /Reclamos que necesitan tu respuesta \(1\)/);
assert.match(texto, /Piden factura o cambio de factura \(1\)/);
assert.match(texto, /Otros mensajes que necesitan a una persona \(1\)/);
assert.match(texto, /En mediación de ML, sin acción tuya \(2\)/);
assert.match(texto, /FULL: 2/);
assert.match(texto, /Se pueden resolver con una respuesta fija \(2\)/);
assert.match(texto, /vence/);
assert.match(texto, /orden 2000018873403020/);
// Los reclamos en mediación NO se listan uno por uno (serían puro ruido)
assert.doesNotMatch(texto, /2000019348482628/);
assert.ok(texto.indexOf('Reclamos que necesitan') < texto.indexOf('En mediación') && texto.indexOf('En mediación') < texto.indexOf('Se pueden resolver'));
// Vencido se marca
assert.match(resumenEnTexto(casos, { ahora: Date.parse('2026-11-20T10:00:00Z') }), /VENCIDO/);
// Solo mediación: no pide ayuda
const soloML = resumenEnTexto(armarCasos([{ cuenta: 'full', tipo: 'reclamo', id: '9', accion_vendedor: false }], cuentas));
assert.match(soloML, /Ningún reclamo necesita tu respuesta/);
// Sin nada
assert.match(resumenEnTexto([]), /No hay reclamos abiertos/);

// Acciones del vendedor y productos con más reclamos
assert.deepEqual(accionesDelVendedor({ players: [{ role: 'respondent', available_actions: [{ action: 'refund' }, { action: 'refund' }, { action: 'send_message' }] }] }), ['refund', 'send_message']);
assert.deepEqual(accionesDelVendedor(null), []);
const prod = productosConMasReclamos([
  { tipo: 'reclamo', producto: 'Tapa de arranque' }, { tipo: 'reclamo', producto: 'Tapa de arranque' },
  { tipo: 'reclamo', producto: 'Disco' }, { tipo: 'reclamo', producto: 'Pad pulir' }, { tipo: 'reclamo', producto: 'Pad pulir' }, { tipo: 'reclamo', producto: 'Pad pulir' },
  { tipo: 'mensaje', producto: 'Disco' },
]);
assert.deepEqual(prod, [['Pad pulir', 3], ['Tapa de arranque', 2]]);
assert.match(resumenEnTexto(armarCasos([
  { cuenta: 'full', tipo: 'reclamo', id: 'a', motivo: 'x', accion_vendedor: true, producto: 'Pad pulir' },
  { cuenta: 'full', tipo: 'reclamo', id: 'b', motivo: 'x', accion_vendedor: true, producto: 'Pad pulir' },
], cuentas)), /Productos con más reclamos[\s\S]*2 × Pad pulir/);

console.log('✅ reclamos: todo OK');
