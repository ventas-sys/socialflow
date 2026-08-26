// Una sola puerta de entrada a Gemini para TEXTO (Tatiana, WhatsApp, copys).
//
// ⚠️ POR QUÉ EXISTE (26-ago-2026):
// Al separar las keys, la key nueva quedó en un proyecto NUEVO de Google, y a
// los proyectos nuevos Google ya no les habilita `gemini-2.5-flash`:
//     "This model models/gemini-2.5-flash is no longer available to new users.
//      Please update your code to use models/gemini-3.6-flash"
// Tatiana se quedó muda de nuevo. Pero cambiar solo el nombre del modelo NO
// alcanzaba: Gemini 3 no deja apagar el "pensamiento".
//   - `thinkingBudget: 0` en un modelo 3.x devuelve 400.
//   - Los tokens de pensamiento se descuentan de `maxOutputTokens`, así que con
//     un presupuesto chico la respuesta salía VACÍA (el mismo bug que ya nos
//     había pasado con 2.5 y por el que habíamos puesto thinkingBudget: 0).
//
// Este módulo concentra las tres decisiones —qué modelo, cómo pedirle que no
// piense de más, y a qué modelo caer si el primero no está disponible— para que
// el próximo cambio de Google se arregle en un solo lugar y no en seis.
import { httpRequest } from '../api/_http.js';
import { keyTexto } from './gemini-keys.js';

// En orden de preferencia. `gemini-flash-latest` es el alias que Google mantiene
// siempre apuntando al flash vigente: es la red de seguridad para la próxima vez.
const BASE = ['gemini-3.6-flash', 'gemini-flash-latest', 'gemini-2.5-flash'];

export const MODELOS_TEXTO = (() => {
  const forzado = (process.env.GEMINI_MODEL_TEXTO || '').trim();
  return forzado ? [forzado, ...BASE.filter(m => m !== forzado)] : BASE;
})();

// El primero que contestó bien. Se recuerda mientras la función sigue caliente
// para no pagar el reintento en cada pregunta.
let modeloQueAnda = null;

export function modeloTexto() { return modeloQueAnda || MODELOS_TEXTO[0]; }

function candidatos() {
  return modeloQueAnda
    ? [modeloQueAnda, ...MODELOS_TEXTO.filter(m => m !== modeloQueAnda)]
    : MODELOS_TEXTO;
}

// Gemini 3.x: el pensamiento no se apaga, se baja a "minimal".
// Gemini 2.x: se apaga con presupuesto 0.
function pensamientoMinimo(modelo) {
  return /gemini-[3-9]/.test(modelo) ? { thinkingLevel: 'minimal' } : { thinkingBudget: 0 };
}

const url = (modelo, key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${key}`;

const esModeloInexistente = (msg) =>
  /no longer available|not found|is not supported|unsupported model|does not exist/i.test(msg || '');

const esProblemaDePensamiento = (msg) =>
  /thinking|thought/i.test(msg || '');

// Ojo: Gemini 3 puede devolver el razonamiento como una parte más, marcada con
// `thought: true`. Si no se filtra, Tatiana le publicaría al cliente lo que
// estuvo pensando en vez de la respuesta.
//
// ⚠️ Se filtra SOLO por `thought: true`. El campo `thoughtSignature` NO sirve
// para distinguir: Gemini 3 se lo pega también a la respuesta buena (es una
// firma para conversaciones multi-turno). Filtrar por él tiraba la respuesta
// entera a la basura y Tatiana quedaba muda con la IA andando (26-ago-2026).
function textoDe(body) {
  const partes = body?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(partes)) return '';
  return partes
    .filter(p => p && p.thought !== true)
    .map(p => p.text || '')
    .join('')
    .trim();
}

// Llama a Gemini y devuelve { ok, texto, body, modelo, error }.
//
// `generationConfig` va tal cual salvo el thinkingConfig, que lo pone este
// módulo según el modelo que termine usando. `minOutputTokens` asegura un
// presupuesto de salida suficiente para que el pensamiento no se coma la
// respuesta (Gemini 3 siempre piensa un poco).
// El piso de 4096 no cuesta nada (solo se cobran los tokens que realmente
// salen): es seguro para el caso en que Gemini rechace el thinkingConfig y
// termine pensando a nivel normal, donde un techo chico devuelve texto vacío.
export async function generarTexto({ prompt, generationConfig = {}, minOutputTokens = 4096 }) {
  const key = keyTexto();
  if (!key) return { ok: false, error: 'falta GEMINI_API_KEY (o GEMINI_API_KEY_TEXTO)' };

  const { thinkingConfig: _ignorado, ...cfg } = generationConfig;
  cfg.maxOutputTokens = Math.max(Number(cfg.maxOutputTokens) || 0, minOutputTokens);

  let ultimo = null;
  for (const modelo of candidatos()) {
    // Primer intento con el pensamiento al mínimo; si el modelo se queja
    // justamente de eso, se reintenta sin tocarlo.
    for (const thinking of [pensamientoMinimo(modelo), null]) {
      const body = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: thinking ? { ...cfg, thinkingConfig: thinking } : cfg,
      };
      let r;
      try {
        r = await httpRequest('POST', url(modelo, key), { 'Content-Type': 'application/json' }, body);
      } catch (e) {
        ultimo = { modelo, error: e.message };
        break; // error de red: no tiene sentido reintentar el thinking
      }
      const texto = textoDe(r.body);
      if (texto) {
        modeloQueAnda = modelo;
        return { ok: true, texto, body: r.body, modelo };
      }
      const err = r.body?.error;
      const msg = err?.message || JSON.stringify(r.body || {}).slice(0, 250);
      ultimo = { modelo, codigo: err?.code || r.status, error: msg };

      if (thinking && esProblemaDePensamiento(msg)) continue;  // reintento sin thinkingConfig
      if (esModeloInexistente(msg)) break;                      // probar el modelo siguiente
      return { ok: false, ...ultimo };                          // 429, key inválida, etc.: no insistir
    }
  }
  return { ok: false, ...(ultimo || { error: 'sin respuesta de Gemini' }) };
}
