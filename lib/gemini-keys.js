// Qué API key de Gemini usa cada cosa.
//
// ⚠️ POR QUÉ EXISTE ESTO (24-ago-2026):
// Todo el repo compartía una sola `GEMINI_API_KEY`. El proyecto de Google AI
// Studio llegó al tope de gasto mensual, Gemini empezó a devolver 429 y se
// cayeron de golpe LOS DOS BOTS QUE VENDEN:
//   - Tatiana (preguntas de Mercado Libre) se quedó muda.
//   - El bot de WhatsApp contestaba "no te llegué a entender bien" a todo el mundo.
// Lo que consumió el presupuesto no fue ninguno de los dos —gastan centavos—
// sino generar imágenes y videos para las redes (imagen-4.0, flash-image, Veo),
// que es órdenes de magnitud más caro.
//
// Separando las keys, quemar el presupuesto haciendo contenido ya no puede
// dejar sin atención a los clientes.
//
// Variables:
//   GEMINI_API_KEY_TEXTO  -> bots que atienden clientes (ML, WhatsApp, copys)
//   GEMINI_API_KEY_MEDIA  -> imágenes y video (api/image.js), lo caro
//   GEMINI_API_KEY        -> la de siempre; se usa como respaldo de las dos
//
// Si no se configura ninguna de las nuevas, todo sigue funcionando igual que
// antes con la key única: este cambio no rompe nada.

import { createHash } from 'node:crypto';
import { httpRequest } from '../api/_http.js';

// Texto: Tatiana, el bot de WhatsApp, los copys de redes, el agente y contabilidad.
export function keyTexto() {
  return (process.env.GEMINI_API_KEY_TEXTO || process.env.GEMINI_API_KEY || '').trim();
}

// Imagen y video: lo caro. Que se quede sin crédito NO debe callar a los bots.
export function keyMedia() {
  return (process.env.GEMINI_API_KEY_MEDIA || process.env.GEMINI_API_KEY || '').trim();
}

// Huella de una key, para poder comparar dos variables sin mostrar ninguna.
//
// El diagnóstico decía qué VARIABLE usa cada cosa, pero no si adentro tienen la
// MISMA key: con GEMINI_API_KEY_TEXTO cargada y GEMINI_API_KEY_MEDIA vacía, no
// había forma de saber desde afuera si Tatiana ya estaba protegida o si las dos
// puntas seguían pegando contra el mismo proyecto de Google.
//
// Es un hash, no un pedazo de la key: de la huella no se puede volver a la key.
// Importa porque /api/ml/questions?action=diag se abre sin contraseña.
function huella(valor) {
  const v = (valor || '').trim();
  if (!v) return null;
  return createHash('sha256').update(v).digest('hex').slice(0, 8);
}

// Para el diagnóstico: si están separadas o si siguen compartiendo la misma.
export function resumenKeys() {
  const texto = (process.env.GEMINI_API_KEY_TEXTO || '').trim();
  const media = (process.env.GEMINI_API_KEY_MEDIA || '').trim();
  const unica = (process.env.GEMINI_API_KEY || '').trim();
  const separadas = !!texto && !!media && texto !== media;
  // Lo que cada cosa usa DE VERDAD, después de los respaldos de arriba.
  const usaTexto = texto || unica;
  const usaMedia = media || unica;
  return {
    separadas,
    texto: texto ? 'GEMINI_API_KEY_TEXTO' : (unica ? 'GEMINI_API_KEY (compartida)' : 'FALTA'),
    media: media ? 'GEMINI_API_KEY_MEDIA' : (unica ? 'GEMINI_API_KEY (compartida)' : 'FALTA'),
    // Si las dos huellas coinciden, los bots y la generación de imágenes están
    // pegando contra la MISMA key, aunque las variables se llamen distinto.
    huella_texto: huella(usaTexto),
    huella_media: huella(usaMedia),
    misma_key: !!usaTexto && !!usaMedia && usaTexto === usaMedia,
  };
}

// PRUEBA REAL DE LA KEY DE IMAGEN Y VIDEO.
//
// ⚠️ POR QUÉ (5-oct-2026): el diagnóstico probaba de verdad la key de TEXTO
// (probarIA), pero de la de media solo decía qué variable la provee. El día que
// Rodo borró una key de AI Studio que Google marcó como expuesta, no había forma
// de saber desde el diagnóstico si esa era justo la que usa imagen/video: había
// que ir a generar una imagen a mano para enterarse.
//
// Pide la LISTA de modelos, que no genera nada y no gasta: alcanza para saber si
// la key existe y está habilitada. Generar una imagen para probar costaría
// plata justo en la key cara.
export async function probarKeyMedia() {
  const key = keyMedia();
  if (!key) return { ok: false, error: 'falta GEMINI_API_KEY (o GEMINI_API_KEY_MEDIA)' };
  // La key nunca puede salir en la respuesta: ?action=diag se abre sin contraseña.
  const limpiar = (t) => String(t || '').split(key).join('***').slice(0, 250);
  try {
    const r = await httpRequest('GET',
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=' + encodeURIComponent(key), {});
    if (r.status === 200) return { ok: true };
    return { ok: false, codigo: r.body?.error?.status || r.status, error: limpiar(r.body?.error?.message || ('HTTP ' + r.status)) };
  } catch (e) {
    return { ok: false, error: limpiar(e.message) };
  }
}
