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

// Lee un valor JSON del store (KV si está configurado, si no memoria).
export async function readJson(key) {
  const kv = kvConfig();
  if (kv) {
    try {
      const r = await httpRequest('GET', `${kv.url}/get/${encodeURIComponent(key)}`,
        { 'Authorization': 'Bearer ' + kv.token });
      const raw = r.body?.result;
      if (raw) return typeof raw === 'string' ? JSON.parse(raw) : raw;
      return null;
    } catch { /* si el KV falla, caemos a memoria */ }
  }
  return mem.get(key) ?? null;
}

// Guarda un valor JSON. Nunca rompe el flujo: si el KV falla, queda en memoria.
export async function writeJson(key, value) {
  mem.set(key, value);
  const kv = kvConfig();
  if (!kv) return;
  try {
    await httpRequest('POST', `${kv.url}/set/${encodeURIComponent(key)}`,
      { 'Authorization': 'Bearer ' + kv.token, 'Content-Type': 'application/json' },
      JSON.stringify(value));
  } catch { /* idem */ }
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

function topicKey(topic) {
  return String(topic || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
}
