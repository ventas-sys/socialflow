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
export async function markWebhook(info) {
  return writeJson('ml:webhook:last', { at: new Date().toISOString(), ...info });
}
export async function lastWebhook() { return readJson('ml:webhook:last'); }
