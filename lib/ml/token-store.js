// Store de tokens del Agente de Preguntas de Mercado Libre.
//
// ⚠️ POR QUÉ EXISTE ESTO:
// Mercado Libre ROTA el refresh_token en CADA renovación: al llamar
// /oauth/token con grant_type=refresh_token, la respuesta trae un refresh_token
// NUEVO y el anterior queda INVALIDADO (es de un solo uso).
// Como las cuentas se leen de la variable de entorno ML_ACCOUNTS (que no se
// puede reescribir en runtime), si el token rotado no se guarda en ningún lado
// la SIGUIENTE renovación falla con "invalid_grant" y el agente deja de
// responder preguntas.
//
// Backends (en este orden):
//   1) KV por REST (Vercel KV o Upstash Redis) -> PERSISTENTE, es el bueno.
//      Vars: KV_REST_API_URL + KV_REST_API_TOKEN
//         (o UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)
//   2) Memoria del proceso (fallback) -> solo dura mientras la función esté
//      "tibia" en Vercel. Sirve para no quemar un refresh_token por request,
//      pero NO sobrevive a un arranque en frío.
import { httpRequest } from '../../api/_http.js';

const mem = new Map();

function kvConfig() {
  const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
  return url && token ? { url, token } : null;
}

// Para el diagnóstico: ¿estamos guardando de verdad o solo en memoria?
export function storeKind() {
  return kvConfig() ? 'kv' : 'memoria';
}

// Por qué el KV no está andando. Sin esto, "memoria" no dice si la variable
// falta, si quedó con otro nombre o si se pegó mal (con comillas, que es el
// error más común al copiar de Upstash).
export function kvDetalle() {
  const NOMBRES = ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'];
  const encontradas = NOMBRES.filter(n => (process.env[n] || '').trim());
  const kv = kvConfig();
  if (!kv) {
    return {
      variables_encontradas: encontradas,
      problema: encontradas.length
        ? 'Hay variables cargadas pero falta el par completo: se necesitan URL **y** TOKEN (KV_REST_API_* o UPSTASH_REDIS_REST_*).'
        : 'No llega NINGUNA de las 4 variables a la función. Revisá que estén en el proyecto correcto, marcadas para Production, y que hayas hecho Redeploy DESPUÉS de guardarlas (las variables entran recién en el deploy siguiente).',
    };
  }
  // Están las dos, pero puede que el valor se haya pegado mal.
  const avisos = [];
  if (!/^https:\/\//.test(kv.url)) avisos.push(`La URL no arranca con https:// (llega como ${JSON.stringify(kv.url.slice(0, 40))}). ¿Se pegó con comillas?`);
  if (/^["']|["']$/.test(kv.token)) avisos.push('El TOKEN tiene comillas al principio o al final: pegá el valor sin las comillas.');
  return { variables_encontradas: encontradas, problema: avisos.length ? avisos.join(' · ') : null };
}

// ⚠️ httpRequest resuelve con CUALQUIER código de estado: un 401 o un 413 del
// KV no lanza excepción. Antes eso se tragaba en silencio y una escritura
// fallida se veía igual que una exitosa — el 28-sep-2026 el barrido agendó 221
// entregas y `en_cola` dio 0 en la misma respuesta, sin un solo error a la
// vista. Por eso ahora se mira el estado y se guarda el último fallo.
let ultimoErrorKv = null;

function anotarErrorKv(op, key, detalle) {
  ultimoErrorKv = { op, key, detalle, cuando: new Date().toISOString() };
  console.error('[kv] falló', ultimoErrorKv);
}

// Para el diagnóstico: el último fallo del KV, o null si viene todo bien.
export function kvUltimoError() { return ultimoErrorKv; }

// Lee un valor JSON del store (KV si está configurado, si no memoria).
export async function readJson(key) {
  const kv = kvConfig();
  if (kv) {
    try {
      const r = await httpRequest('GET', `${kv.url}/get/${encodeURIComponent(key)}`,
        { 'Authorization': 'Bearer ' + kv.token });
      if (r.status !== 200) {
        // El KV contestó pero con error: NO es que la clave no exista. Caer a
        // memoria, que al menos sirve mientras la función siga tibia.
        anotarErrorKv('leer', key, `HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
        return mem.get(key) ?? null;
      }
      const raw = r.body?.result;
      if (raw) return typeof raw === 'string' ? JSON.parse(raw) : raw;
      return null;   // acá sí: la clave no existe
    } catch (e) {
      anotarErrorKv('leer', key, e.message);
    }
  }
  return mem.get(key) ?? null;
}

// Guarda un valor JSON. Nunca rompe el flujo: si el KV falla, queda en memoria
// y el fallo queda anotado para que el diagnóstico lo muestre.
export async function writeJson(key, value) {
  mem.set(key, value);
  const kv = kvConfig();
  if (!kv) return { ok: true, donde: 'memoria' };
  try {
    const r = await httpRequest('POST', `${kv.url}/set/${encodeURIComponent(key)}`,
      { 'Authorization': 'Bearer ' + kv.token, 'Content-Type': 'application/json' },
      JSON.stringify(value));
    if (r.status !== 200) {
      const detalle = `HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`;
      anotarErrorKv('guardar', key, detalle);
      return { ok: false, donde: 'memoria', error: detalle };
    }
    return { ok: true, donde: 'kv' };
  } catch (e) {
    anotarErrorKv('guardar', key, e.message);
    return { ok: false, donde: 'memoria', error: e.message };
  }
}

// Prueba de ida y vuelta: escribe una clave, la lee y compara. Es la única
// forma de saber si el KV guarda DE VERDAD — que las variables estén cargadas
// (storeKind() === 'kv') no dice nada sobre si las escrituras funcionan.
export async function kvPrueba() {
  const kv = kvConfig();
  if (!kv) return { funciona: false, motivo: 'No hay KV configurado: todo queda en memoria y se pierde.' };
  const key = 'ml:prueba:kv';
  const valor = { escrito: new Date().toISOString(), n: Math.round(Math.random() * 1e9) };
  const escritura = await writeJson(key, valor);
  if (!escritura.ok) return { funciona: false, motivo: 'No pudo escribir', detalle: escritura.error };
  const leido = await readJson(key);
  if (!leido) return { funciona: false, motivo: 'Escribió sin error pero al leer volvió vacío.' };
  if (leido.n !== valor.n) {
    return { funciona: false, motivo: 'Lo que volvió no es lo que se guardó.', esperado: valor.n, recibido: leido.n };
  }
  // Segunda prueba, con un valor del tamaño de una cola real (~120 entregas).
  // Un token pesa 300 bytes y la cola pesa decenas de KB: si el KV rechaza por
  // tamaño, los tokens se guardan bien y la cola no, que es justo lo que se vio.
  const grande = { relleno: Array.from({ length: 120 }, (_, i) =>
    ({ orderId: '200001860000' + i, packId: '200001860000' + i, buyerId: '1234567' + i,
       cuenta: 'full', titulo: 'Producto de prueba con un título de largo parecido al real ' + i,
       agendado: new Date().toISOString(), enviar_a_partir_de: new Date().toISOString() })) };
  const bytes = JSON.stringify(grande).length;
  const escrituraGrande = await writeJson(key, grande);
  const leidoGrande = escrituraGrande.ok ? await readJson(key) : null;
  const grandeOk = !!leidoGrande?.relleno && leidoGrande.relleno.length === 120;

  return {
    funciona: grandeOk,
    prueba_chica: 'ok',
    prueba_grande: grandeOk ? 'ok' : 'FALLÓ',
    bytes_probados: bytes,
    motivo: grandeOk ? null
      : `El KV guarda valores chicos (un token) pero NO uno de ${bytes} bytes como la cola de entregas.`,
    detalle: escrituraGrande.error || null,
  };
}

const tokenKey = (label) => `ml:token:${label || 'default'}`;

export async function readToken(label) { return readJson(tokenKey(label)); }
export async function writeToken(label, data) { return writeJson(tokenKey(label), data); }

// Marca de tiempo del último webhook recibido de ML (para saber si ML nos llama).
// Guardamos el último de CUALQUIER topic y además el último de CADA topic por
// separado: las notificaciones de "payments" son muchísimas y pisaban el
// registro, así que nunca se llegaba a ver si ML nos estaba avisando de
// PREGUNTAS, que es lo único que le importa a este agente.
export async function markWebhook(info) {
  const data = { at: new Date().toISOString(), ...info };
  await writeJson('ml:webhook:last', data);
  const topic = topicKey(info?.topic);
  if (topic) await writeJson('ml:webhook:last:' + topic, data);
  return data;
}

// Sin topic -> el último de todos. Con topic -> el último de ese topic.
export async function lastWebhook(topic) {
  const t = topic ? topicKey(topic) : null;
  return readJson(t ? 'ml:webhook:last:' + t : 'ml:webhook:last');
}

// Resultado de lo ÚLTIMO que hicimos con un webhook de ese topic.
// Sin esto, cuando el bot no contesta una pregunta que ML sí nos notificó, el
// error queda solo en los logs de Vercel y no hay forma de verlo desde afuera.
export async function markWebhookResultado(topic, data) {
  const t = topicKey(topic);
  if (!t) return;
  return writeJson('ml:webhook:resultado:' + t, { at: new Date().toISOString(), ...data });
}
export async function lastWebhookResultado(topic) {
  const t = topicKey(topic);
  return t ? readJson('ml:webhook:resultado:' + t) : null;
}

// POR QUÉ NO SE CONTESTÓ UNA PREGUNTA.
//
// markWebhookResultado guarda SOLO la última: si entran tres preguntas y la
// primera falla, a los dos minutos ya no queda rastro de cuál fue ni por qué.
// Acá se anota una línea por pregunta que quedó sin respuesta, para que el aviso
// de WhatsApp pueda decir el motivo en vez de un "no contestó" pelado.
//
// ⚠️ EL COSTO EN COMANDOS IMPORTA (ver el aviso de arriba): esto son 1 lectura +
// 1 escritura, y SOLO se llama cuando una pregunta NO se pudo contestar. Nunca
// llamarlo en el camino feliz ni adentro de un for sobre todas las preguntas.
const KEY_FALLAS = 'ml:preguntas:sin-responder';
const MAX_FALLAS = 40;

export async function anotarPreguntaSinResponder(questionId, motivo, extra = {}) {
  const id = String(questionId || '').trim();
  if (!id || !motivo) return null;
  const guardado = (await readJson(KEY_FALLAS)) || {};
  guardado[id] = { motivo: String(motivo).slice(0, 200), at: new Date().toISOString(), ...extra };
  // Se queda con las últimas MAX_FALLAS por fecha: si no, el registro crece
  // para siempre y el KV termina rechazando el valor por tamaño.
  const ids = Object.keys(guardado).sort((a, b) =>
    String(guardado[b]?.at || '').localeCompare(String(guardado[a]?.at || '')));
  const recortado = {};
  for (const k of ids.slice(0, MAX_FALLAS)) recortado[k] = guardado[k];
  await writeJson(KEY_FALLAS, recortado);
  return recortado[id];
}

export async function verPreguntasSinResponder() {
  return (await readJson(KEY_FALLAS)) || {};
}

function topicKey(topic) {
  return String(topic || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
}
