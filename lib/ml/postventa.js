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

// ⚠️ EL COSTO EN COMANDOS IMPORTA (28-sep-2026)
// El KV gratuito de Upstash da 500.000 comandos por mes y se agotaron:
// "ERR max requests limit exceeded. Limit: 500000, Usage: 500000".
//
// La culpa era de encolar(): hacía 2 lecturas y 1 escritura POR ENTREGA. Con
// 221 entregas por pasada son 663 comandos, y con el cron cada 5 minutos,
// 190.000 por día — la cuota de un mes en menos de tres días. Peor: como la
// cola no llegaba a guardarse, cada pasada volvía a encontrar las mismas 221.
//
// Por eso ahora se trabaja SIEMPRE de a lotes: una lectura y una escritura por
// pasada, entren 1 o 300 entregas. Son ~6 comandos por pasada, unos 52.000 al
// mes: entra cómodo. Nunca volver a meter un readJson/writeJson adentro de un
// for sobre órdenes.
const MAX_COLA = 2000;

// Cuántos días se recuerda a quién ya se le escribió. Tiene que cubrir la
// ventana que recorre el barrido: si se olvida antes, el barrido vuelve a
// encontrar esa entrega y el comprador recibe el mensaje DOS veces.
const RECORDAR_DIAS = Number(process.env.ML_POSTVENTA_RECORDAR_DIAS || 20);

// ⚠️ PROTECCIÓN CONTRA EL ARRANQUE EN FRÍO
// La lista de avisados es lo único que impide escribirle dos veces al mismo
// comprador. Si esa lista está vacía —primera vez que se enciende, o el KV
// estuvo caído— el barrido recorre 12 días de ventas, encuentra MILES de
// entregas y les escribe a todas: gente que recibió el pedido hace una semana
// recibiría un "¿llegó todo bien?" fuera de lugar, de golpe y en masa.
//
// Por eso se guarda la fecha desde la cual este sistema está activo: a una
// orden vendida ANTES de esa marca no se le escribe nunca. La primera pasada
// deja la marca en el momento y no manda nada retroactivo.
const KEY_DESDE = 'ml:postventa:desde';

export async function desdeCuando(ahora = Date.now()) {
  const guardado = await readJson(KEY_DESDE);
  if (guardado?.desde) return { desde: guardado.desde, recien_arrancado: false };
  const desde = new Date(ahora).toISOString();
  await writeJson(KEY_DESDE, { desde });
  return { desde, recien_arrancado: true };
}

export const DEMORA_MS = 5 * 60 * 1000; // los 5 minutos pedidos

// ML limita el mensaje del VENDEDOR a 350 caracteres (lo dice el propio
// `seller_max_message_length` de la conversación; al comprador le permite
// 3500). El texto base mide 295, así que con un título largo —y en ML abundan—
// se pasa: "Cubo Mágico Arbetter 7x7cm 9 Piezas Didáctico Regalo Eventos Negro"
// lo llevaba a 354. Por eso el título se recorta lo justo, cortando en una
// palabra entera, y si aun así no entra se manda sin título.
const MAX_LARGO = Number(process.env.ML_POSTVENTA_MAX_LARGO || 350);

// Texto del mensaje. Editable desde lib/ml/qa-config.js.
export function armarMensaje({ titulo } = {}) {
  const armar = (t) => MENSAJE_POSTVENTA
    .replaceAll('{agente}', NEGOCIO.agente)
    .replaceAll('{negocio}', NEGOCIO.nombre)
    .replaceAll('{producto}', t ? `"${t}"` : 'tu pedido')
    .replace(/\s+/g, ' ')
    .trim();

  const completo = armar(titulo);
  if (completo.length <= MAX_LARGO || !titulo) return completo;

  const sobra = completo.length - MAX_LARGO;
  const recortado = String(titulo)
    .slice(0, Math.max(12, String(titulo).length - sobra - 1))
    .replace(/\s+\S*$/, '')   // no cortar una palabra por la mitad
    .trim() + '…';
  const conRecorte = armar(recortado);
  return conRecorte.length <= MAX_LARGO ? conRecorte : armar(null);
}

export async function verCola() { return (await readJson(KEY_COLA)) || []; }

// Los ya avisados se guardan como { orderId: 'YYYY-MM-DD' } y se purgan por
// antigüedad. Antes era una lista con tope de 500: con ~1.000 entregas por día
// se desbordaba en medio día y los compradores más viejos volvían a entrar,
// o sea que recibían el mensaje de nuevo.
export async function verEnviados() {
  const guardado = await readJson(KEY_ENVIADOS);
  if (!guardado) return {};
  // Formato viejo (lista): se convierte al vuelo, sin perder a nadie.
  if (Array.isArray(guardado)) {
    const salida = {};
    for (const e of guardado) {
      if (e?.orderId) salida[String(e.orderId)] = String(e.at || '').slice(0, 10);
    }
    return salida;
  }
  return guardado;
}

export function purgarEnviados(enviados, ahora = Date.now()) {
  const corte = new Date(ahora - RECORDAR_DIAS * 86_400_000).toISOString().slice(0, 10);
  const salida = {};
  for (const [id, dia] of Object.entries(enviados || {})) {
    if (!dia || dia >= corte) salida[id] = dia;
  }
  return salida;
}

// Agenda un LOTE de entregas de una sola vez. Idempotente: descarta las que ya
// están en la cola y las que ya recibieron el mensaje.
// Devuelve { agendadas, ya_en_cola, ya_avisadas, sin_datos, desbordo }.
export async function encolarLote(items, { ahora = Date.now() } = {}) {
  const r = { agendadas: 0, ya_en_cola: 0, ya_avisadas: 0, sin_datos: 0, previas_al_arranque: 0, desbordo: 0 };
  if (!items?.length) return r;

  const [cola, enviados, arranque] = await Promise.all([verCola(), verEnviados(), desdeCuando(ahora)]);
  r.activo_desde = arranque.desde;
  const enCola = new Set(cola.map(c => String(c.orderId)));
  const nuevos = [];

  for (const it of items) {
    if (!it?.orderId || !it?.buyerId) { r.sin_datos++; continue; }
    // Vendida antes de que esto existiera: no se le escribe (ver KEY_DESDE).
    if (it.vendida && String(it.vendida) < arranque.desde) { r.previas_al_arranque++; continue; }
    const id = String(it.orderId);
    if (enviados[id]) { r.ya_avisadas++; continue; }
    if (enCola.has(id)) { r.ya_en_cola++; continue; }
    enCola.add(id);   // por si el mismo lote trae la orden repetida
    nuevos.push({
      orderId: id,
      packId: String(it.packId || it.orderId),
      buyerId: String(it.buyerId),
      cuenta: it.cuenta,
      titulo: it.titulo || '',
      agendado: new Date(ahora).toISOString(),
      enviar_a_partir_de: new Date(ahora + DEMORA_MS).toISOString(),
    });
  }

  if (!nuevos.length) return r;
  const completa = [...cola, ...nuevos];
  // El tope es una red de seguridad, no algo esperado: si se llegara a tocar
  // se pierden mensajes, así que queda contado para que se vea.
  if (completa.length > MAX_COLA) r.desbordo = completa.length - MAX_COLA;
  await writeJson(KEY_COLA, completa.slice(-MAX_COLA));
  r.agendadas = nuevos.length;
  return r;
}

// Los que ya cumplieron los 5 minutos.
export async function vencidos(ahora = Date.now()) {
  const cola = await verCola();
  return cola.filter(c => new Date(c.enviar_a_partir_de).getTime() <= ahora);
}

// Saca de la cola y deja constancia, también de a lotes: una lectura y dos
// escrituras para todos los mensajes de la pasada.
export async function marcarEnviadoLote(orderIds, { ahora = Date.now() } = {}) {
  if (!orderIds?.length) return;
  const ids = new Set(orderIds.map(String));
  const [cola, enviados] = await Promise.all([verCola(), verEnviados()]);
  const dia = new Date(ahora).toISOString().slice(0, 10);
  const actualizados = purgarEnviados(enviados, ahora);
  for (const id of ids) actualizados[id] = dia;
  await Promise.all([
    writeJson(KEY_COLA, cola.filter(c => !ids.has(String(c.orderId)))),
    writeJson(KEY_ENVIADOS, actualizados),
  ]);
}

// Aviso para el diagnóstico: sin KV la cola no sobrevive.
export function necesitaKv() { return storeKind() !== 'kv'; }
