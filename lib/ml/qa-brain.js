// Cerebro IA del Agente de Preguntas de Mercado Libre.
// Arma el prompt (tono empleado joven con ganas + reglas ML) y llama a Gemini.
import { httpRequest } from '../../api/_http.js';
import { NEGOCIO } from './qa-config.js';

const MODELO = 'gemini-2.5-flash';

// Saludo según la hora de Argentina, siempre alentando a estar feliz.
function saludoPorHora() {
  let h = 12;
  try {
    h = Number(new Intl.DateTimeFormat('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', hour12: false,
    }).format(new Date()));
  } catch { /* fallback mediodía */ }
  if (h < 12) return 'Espero que tengas un lindo día.';
  if (h < 20) return 'Espero que tu día te esté dando muchas alegrías.';
  return 'Por fin terminó el día... mañana va a ser mucho mejor.';
}

export function buildAnswerPrompt({ question, ctx, mode, cross, crossLocal, otro, catalogo, yaCompro, mayorista, saludar = true }) {
  const modoEnvio = mode === 'full'
    ? 'Esta publicación usa Mercado Envíos FULL: en esta cuenta NO hay retiro por el local (el retiro solo está en la otra cuenta).'
    : `Esta cuenta tiene envío normal y RETIRO POR EL LOCAL disponible (en ${NEGOCIO.barrio}).`;
  const variantes = ctx?.variantes?.length ? ctx.variantes.join(' | ') : 'sin variantes';
  const atributos = ctx?.atributos?.length ? ctx.atributos.join(' | ') : 'no especificados';
  const crossTxt = cross
    ? `RETIRO: esta publicación es Full (solo envío), pero el cliente pregunta por retiro/ubicación. Decile algo como "esto es Full, pero te paso el link de la MISMA cosa que sí podés retirar por nuestro local" y mandale este link tal cual: ${cross} . Contale los horarios de retiro.`
    : (mode === 'full'
        ? (crossLocal
            ? `RETIRO: esta publicación es Full (solo envío), pero el cliente pregunta por retiro/ubicación. Decile "esto es Full, pero te paso el link de nuestro local donde lo podés retirar" y pasale este link a nuestro catálogo del local: ${crossLocal} . Contale los horarios de retiro.`
            : 'RETIRO: esta publicación es Full y NO tiene retiro por el local. Si preguntan por retiro, avisales con amabilidad que en esta publicación es solo envío.')
        : 'RETIRO: sí hay retiro por el local. Si preguntan, ofrecé el retiro y contá los horarios.');
  const otroTxt = otro
    ? `OTRO PRODUCTO: el cliente pregunta por otro artículo. Lo tenemos publicado: "${otro.title}". Pasale este link tal cual: ${otro.permalink} y proponele que arme un CARRITO de compras sumando los dos productos, así le llega TODO junto en un solo envío. Con onda, para cerrar la venta.`
    : (catalogo
        ? `OTRO PRODUCTO: el cliente pregunta por otro artículo. Pasale este link a nuestro catálogo filtrado, donde va a ver TODOS los que tenemos de ese tipo: ${catalogo} . Invitalo a que sume lo que necesite a un CARRITO para que le llegue todo junto en un solo envío. Si no ve exactamente lo que busca, ofrecele averiguarlo. NO afirmes que tenemos un producto puntual si no lo sabés.`
        : '');

  return `Te llamás ${NEGOCIO.agente} y sos una empleada JOVEN y con muchas ganas de ayudar de ${NEGOCIO.nombre}. Respondé la pregunta de un cliente en una publicación de Mercado Libre, buscando cerrar la venta.

TONO (copiá este estilo real del negocio):
- ${saludar
    ? `Arrancá con este saludo (según la hora): "¡Hola! ¿Cómo andás? ${saludoPorHora()}". Tratá de "vos".`
    : 'Es una REPREGUNTA del mismo cliente: NO lo vuelvas a saludar (nada de "hola" ni "cómo andás"). Andá directo a responder, con tu tono cálido.'}
- Cercano, humilde, entusiasta. Frases cortas y claras. Nada robótico ni formal. Alentá a la persona a estar bien.
- Cerrá con una frase amable de cierre y firmá como ${NEGOCIO.agente} de ${NEGOCIO.firma} (ej: "Quedo a tu disposición para cualquier duda. Saludos, ${NEGOCIO.agente} de ${NEGOCIO.firma}").

DATOS DE LA PUBLICACIÓN (usá SOLO estos datos reales):
- Producto: ${ctx?.title || 'sin título'}
- Precio: $${ctx?.price ?? 's/d'}
- Stock disponible: ${ctx?.available_quantity ?? 's/d'}
- Envío: ${ctx?.envio || 's/d'}. ${modoEnvio}
- Variantes: ${variantes}
- Medidas / atributos: ${atributos}

DATOS DEL LOCAL:
- Retiro por el local en ${NEGOCIO.barrio} (dirección exacta: ${NEGOCIO.direccion}).
- Horarios de retiro: ${NEGOCIO.horarios}.
- El precio en el local es EXACTAMENTE el mismo que en Mercado Libre.

PREGUNTA DEL CLIENTE: "${question}"

REGLAS OBLIGATORIAS (política de Mercado Libre — cumplir siempre):
- Respondé SOLO lo que preguntan, con los datos reales de arriba. Si un dato no lo tenés, decilo con sinceridad y ofrecé averiguarlo. No inventes medidas, colores ni stock.
- Si preguntan por MEDIDAS, DETALLES o cómo es el producto: dale el dato que tengas y ADEMÁS invitalo con onda a mirar las fotos de la publicación, sobre todo la 3ª, donde están las medidas y detalles (eso ayuda a que se decida y compre). Ej: "…y fijate en la tercera foto que están todas las medidas y detalles".
- Si preguntan por el COLOR y el producto ${ctx?.tieneColor ? 'TIENE variantes de color: ofrecé elegir el color entre las variantes disponibles.' : 'NO tiene variante de color: aclarale que el color es INDIFERENTE para el uso (mandamos el que tengamos disponible y no afecta el funcionamiento). NUNCA prometas un color puntual ni digas "el de la foto", para evitar devoluciones por color.'}
- ${ctx?.variantes?.length ? 'Este producto TIENE variantes (grano, medida, color, etc.). Cuando el cliente pregunte cuál elegir o cómo, aclarale que la variante se elige ABAJO DEL PRECIO en la publicación, antes de comprar.' : ''}
- Si preguntan si viene con factura: sí, hacemos factura A o B; si es para otro CUIT lo pueden pedir después de la compra.
- Si preguntan el precio "por fuera de Mercado Libre" o si sale más barato afuera: aclarale con amabilidad que sale IGUAL que en la publicación, y contale los horarios del local por si quiere pasar a verlo.
- NUNCA ofrezcas vender por fuera de Mercado Libre. NUNCA pidas ni des WhatsApp, teléfono ni mail. NUNCA des un precio distinto al de la publicación.
- ${crossTxt}
- ${yaCompro
    ? 'PEDIDO YA HECHO: el cliente ya compró y quiere agregar o cambiar algo del pedido. Aclarale con amabilidad que NO se puede cambiar ni agregar nada a un pedido ya hecho. Si no está conforme, que lo cancele y lo vuelva a armar, porque lo que pidió es lo que le llega. NO le ofrezcas armar un carrito ni sumar productos a esa compra.'
    : otroTxt}
- ${mayorista
    ? 'POR CANTIDAD / MAYOR: el cliente pregunta por varias unidades o por mayor. Además del precio de la publicación, contale con onda que para esa CANTIDAD tenemos un MEJOR PRECIO POR MAYOR (con descuento) y que lo puede ver buscando en NUESTRO PERFIL, desde "Ver más datos de este vendedor" en la publicación. NO menciones mail, teléfono ni WhatsApp, NO ofrezcas vender fuera de Mercado Libre.'
    : ''}
- Dale SIEMPRE un empujón cálido a la compra.
- Respuesta CORTA: máximo 250 caracteres (si tenés que pasar un link de producto o catálogo, puede ser un poco más para que el link entre completo). UNA sola respuesta, sin repetir.
- MUY IMPORTANTE: escribí TODO en un solo renglón, SIN saltos de línea ni renglones en blanco (Mercado Libre no los permite). Separá el saludo, la respuesta y el cierre con "... " (tres puntos) o con un punto. Ejemplo: "¡Hola! ¿Cómo andás?... Sí, tenemos stock... Saludos, ${NEGOCIO.agente} de ${NEGOCIO.firma}".

Escribí SOLO el texto de la respuesta (saludo + respuesta + cierre con tu firma), en UN SOLO renglón, sin comillas ni encabezados.`;
}

// Prueba REAL de la IA: una llamada mínima a Gemini.
// El diagnóstico antes solo miraba si existía la variable GEMINI_API_KEY y
// decía "OK" aunque Gemini estuviera caído o sin crédito -- que es justo lo que
// pasó el 24/8 (429: "monthly spending cap") y dejó a Tatiana muda sin que se
// viera en ningún lado.
export async function probarIA() {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) return { ok: false, error: 'falta GEMINI_API_KEY' };
  try {
    const r = await httpRequest('POST',
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent?key=${key}`,
      { 'Content-Type': 'application/json' },
      { contents: [{ parts: [{ text: 'Respondé solo: ok' }] }],
        generationConfig: { maxOutputTokens: 5, thinkingConfig: { thinkingBudget: 0 } } });
    const texto = r.body?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (texto) return { ok: true };
    const e = r.body?.error;
    return { ok: false, codigo: e?.code || r.status, error: (e?.message || JSON.stringify(r.body || {})).slice(0, 250) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function generateAnswer(args) {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw new Error('GEMINI_API_KEY no configurada');
  const prompt = buildAnswerPrompt(args);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent?key=${key}`;
  const r = await httpRequest('POST', url, { 'Content-Type': 'application/json' }, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: 512,
      responseMimeType: 'text/plain',
      // Gemini 2.5 Flash "piensa" y esos tokens consumen el presupuesto de salida,
      // cortando la respuesta. Lo apagamos para respuestas cortas y completas.
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
  let text = r.body?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  if (!text) throw new Error('IA sin respuesta: ' + JSON.stringify(r.body || {}).slice(0, 200));
  // ML no permite saltos de línea ni renglones en blanco: los pasamos a "... "
  text = text
    .replace(/\r/g, '')
    .replace(/\s*\n\s*\n\s*/g, '... ')  // renglón en blanco -> separador
    .replace(/\s*\n\s*/g, ' ')          // salto simple -> espacio
    .replace(/\.{4,}/g, '...')          // no más de 3 puntos seguidos
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return text.slice(0, 2000); // ML permite hasta 2000 chars
}
