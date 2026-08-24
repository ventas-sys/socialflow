// Mensaje post-entrega de Mercado Libre.
//
// Cuando ML avisa que el envío quedó ENTREGADO, se agenda un mensaje para 5
// minutos después: agradecer, preguntar si llegó todo bien y ofrecer resolver
// cualquier problema. Va por la mensajería post-venta de ML (la única vía
// permitida para escribirle a un comprador).
//
// ⚠️ REGLAS QUE NO SE TOCAN (política de Mercado Libre + defensa del consumidor):
//   - NO se pide una calificación POSITIVA, ni se sugiere qué puntaje poner.
//   - NO se ofrece plata, descuentos ni premios a cambio de una reseña
//     (las reseñas incentivadas están prohibidas y hacen caer la reputación).
//   - NO se mandan links externos ni se invita a las redes por este canal
//     (ML los bloquea y usar los datos del comprador para promoción va contra
//     sus términos). Las redes van en el folleto/QR dentro del paquete.
//
// La cola vive en el KV (lib/ml/token-store.js). SIN KV configurado esto no
// funciona: la cola se perdería en cada arranque en frío de la función.
import { readJson, writeJson, storeKind } from './token-store.js';
import { NEGOCIO, MENSAJE_POSTVENTA } from './qa-config.js';

const KEY_COLA = 'ml:postventa:cola';
const KEY_ENVIADOS = 'ml:postventa:enviados';
const MAX_ENVIADOS = 500;

export const DEMORA_MS = 5 * 60 * 1000; // los 5 minutos pedidos

// Texto del mensaje. Editable desde lib/ml/qa-config.js.
export function armarMensaje({ titulo } = {}) {
  return MENSAJE_POSTVENTA
    .replaceAll('{agente}', NEGOCIO.agente)
    .replaceAll('{negocio}', NEGOCIO.nombre)
    .replaceAll('{producto}', titulo ? `"${titulo}"` : 'tu pedido')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function verCola() { return (await readJson(KEY_COLA)) || []; }
export async function verEnviados() { return (await readJson(KEY_ENVIADOS)) || []; }

// Agenda el mensaje. Idempotente: no repite una orden ya encolada ni ya enviada.
export async function encolar({ orderId, packId, buyerId, cuenta, titulo, ahora = Date.now() }) {
  if (!orderId || !buyerId) return { ok: false, motivo: 'faltan datos de la orden' };
  const [cola, enviados] = await Promise.all([verCola(), verEnviados()]);
  const id = String(orderId);
  if (enviados.some(e => String(e.orderId) === id)) return { ok: false, motivo: 'ya se le escribió a esta orden' };
  if (cola.some(c => String(c.orderId) === id)) return { ok: false, motivo: 'ya estaba agendado' };
  const item = {
    orderId: id,
    packId: String(packId || orderId),
    buyerId: String(buyerId),
    cuenta,
    titulo: titulo || '',
    agendado: new Date(ahora).toISOString(),
    enviar_a_partir_de: new Date(ahora + DEMORA_MS).toISOString(),
  };
  await writeJson(KEY_COLA, [...cola, item].slice(-200));
  return { ok: true, item };
}

// Los que ya cumplieron los 5 minutos.
export async function vencidos(ahora = Date.now()) {
  const cola = await verCola();
  return cola.filter(c => new Date(c.enviar_a_partir_de).getTime() <= ahora);
}

// Saca de la cola y deja constancia (para no escribir dos veces).
export async function marcarEnviado(orderId, resultado) {
  const [cola, enviados] = await Promise.all([verCola(), verEnviados()]);
  const id = String(orderId);
  await Promise.all([
    writeJson(KEY_COLA, cola.filter(c => String(c.orderId) !== id)),
    writeJson(KEY_ENVIADOS, [...enviados, { orderId: id, at: new Date().toISOString(), ...resultado }].slice(-MAX_ENVIADOS)),
  ]);
}

// Aviso para el diagnóstico: sin KV la cola no sobrevive.
export function necesitaKv() { return storeKind() !== 'kv'; }
