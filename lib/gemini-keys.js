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

// Texto: Tatiana, el bot de WhatsApp, los copys de redes, el agente y contabilidad.
export function keyTexto() {
  return (process.env.GEMINI_API_KEY_TEXTO || process.env.GEMINI_API_KEY || '').trim();
}

// Imagen y video: lo caro. Que se quede sin crédito NO debe callar a los bots.
export function keyMedia() {
  return (process.env.GEMINI_API_KEY_MEDIA || process.env.GEMINI_API_KEY || '').trim();
}

// Para el diagnóstico: si están separadas o si siguen compartiendo la misma.
export function resumenKeys() {
  const texto = (process.env.GEMINI_API_KEY_TEXTO || '').trim();
  const media = (process.env.GEMINI_API_KEY_MEDIA || '').trim();
  const unica = (process.env.GEMINI_API_KEY || '').trim();
  const separadas = !!texto && !!media && texto !== media;
  return {
    separadas,
    texto: texto ? 'GEMINI_API_KEY_TEXTO' : (unica ? 'GEMINI_API_KEY (compartida)' : 'FALTA'),
    media: media ? 'GEMINI_API_KEY_MEDIA' : (unica ? 'GEMINI_API_KEY (compartida)' : 'FALTA'),
  };
}
