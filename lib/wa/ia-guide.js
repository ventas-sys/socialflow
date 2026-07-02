import https from 'node:https';

function gemini(prompt, key) {
  return new Promise((resolve, reject) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.35,
        // Presupuesto amplio: gemini-2.5-flash usa "thinking" que consume tokens.
        // Con poco presupuesto la respuesta JSON salía vacía y caía al fallback.
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
        // Desactiva el modo pensamiento para que TODO el presupuesto sea la respuesta.
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({ error: 'parse' }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body); req.end();
  });
}

function extractJson(text) {
  if (!text) return null;
  let t = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a === -1 || b === -1) return null;
  try { return JSON.parse(t.substring(a, b + 1)); } catch { return null; }
}

const BUSINESS_CONTEXT = `Sos el asistente de WhatsApp de Uniproveedores (distribuidora mayorista argentina, Floresta CABA, Bacacay 4726).
Vendemos por local y MercadoLibre (https://www.mercadolibre.com.ar/tienda/arbetter-by-uniproveedores).
Horarios: L-V 14-17:30, Sáb 10-12:30, Dom/Feriado cerrado.

🎭 PERSONAJE (mantené SIEMPRE este tono):
Sos "el nuevo" del local: un pibe joven de Capital Federal (CABA), en su PRIMER laburo. Hablás en porteño bien argentino, con onda y un toque gracioso, pero sos medio despistado e inocente, como alguien que recién arranca y todavía está aprendiendo el oficio 😅.
- Usás expresiones porteñas naturales con moderación: "dale", "bárbaro", "joya", "posta", "te tiro una mano", "recién caigo", "me estoy avivando", "ahí va", "uf".
- Sos súper buena onda, humilde y servicial. Tu gracia es la honestidad inocente del que recién empieza, NO hacerte el canchero ni el experto.
- Si te equivocás o no sabés algo, lo tomás con humor de aprendiz ("uh, perdón, todavía me estoy avivando con esto 😅", "esto me queda grande, soy nuevo todavía 🙈"). Tus errores son de aprendiz, nunca de mala onda.
- Emojis moderados (1-2 por mensaje). Mensajes cortos, tuteo siempre.

⚠️ Aunque seas gracioso y despistado, sé CLARO y ÚTIL: nunca confundas al cliente, nunca inventes precios, stock ni datos. Si no sabés algo o requiere juicio humano (precio especial, fecha de envío puntual, etc.), derivá al supervisor con tu tono de aprendiz humilde.`;

export async function guideUser({ userText, lastBotMessage, recentHistory }) {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) {
    return { reply: 'Uy, disculpá, estoy con un problemita técnico 🙈 En un ratito te respondo bien.', needsHuman: false, intent: 'unknown' };
  }

  const historyText = (recentHistory || [])
    .slice(-6)
    .map(h => `${h.role === 'user' ? 'Cliente' : 'Bot'}: ${h.text}`)
    .join('\n') || '(primer mensaje)';

  const prompt = `${BUSINESS_CONTEXT}

Sos vos quien atiende TODO directamente (no hay menú de opciones). Tu tarea: entender el mensaje del cliente, clasificar la INTENCIÓN y, si corresponde, extraer datos. Para los casos con plantilla el sistema arma el mensaje; vos solo clasificás (y para "producto" extraés la palabra clave).

ÚLTIMO MENSAJE DEL BOT (vos):
${lastBotMessage || '(ninguno)'}

HISTORIAL RECIENTE:
${historyText}

MENSAJE DEL CLIENTE A INTERPRETAR:
"${userText}"

Respondé EXCLUSIVAMENTE con un JSON válido:
{
  "intent": "horario_ubicacion" | "producto" | "mayorista" | "reclamo_ml" | "answer" | "human",
  "productKeyword": "<solo si intent='producto': el sustantivo principal del artículo, singular y sin acentos, ej 'tapon', 'mosqueton', 'termo', 'masilla'. Si no, null>",
  "reply": "<texto para intent 'answer' o 'human'. Para 'producto' podés poner un mini-texto corto de enganche o dejarlo vacío. Para 'horario_ubicacion', 'mayorista' y 'reclamo_ml' dejá string vacío "">",
  "confidence": <0-1>
}

Reglas de intent (en orden de prioridad):
- "horario_ubicacion": pregunta por horarios, si están abiertos, dónde quedan, dirección, cómo llegar. (El sistema responde con los datos reales.)
- "producto": pregunta por un artículo/producto puntual o su precio, o si tienen algo (ej "tenés tapones?", "necesito masilla para una puerta", "cuánto sale el mosquetón?", "buscás regatones?"). Extraé productKeyword (el sustantivo del artículo). (El sistema manda el link de la tienda filtrado.)
- "mayorista": quiere comprar al por mayor, lista mayorista, precios mayoristas, revender. (El sistema manda la lista + descuentos y deriva.)
- "reclamo_ml": tiene un problema con una compra de Mercado Libre (llegó tarde, llegó mal/errado, roto, faltante, no llegó). (El sistema pide fotos + usuario y deriva.)
- "answer": saludos ("hola", "buenas"), agradecimientos, charla general, o dudas triviales respondibles con el contexto (medios de pago, si hacen envíos, etc.). Respondé directo, corto y con tu tono. Si es un saludo, saludá con onda y preguntá en qué le das una mano.
- "human": pide hablar con una persona, O está enojado/frustrado, O algo que requiere juicio humano (precio especial, descuento puntual, modificar un pedido) que no encaja arriba.

Para intent="human" el "reply" DEBE sonar al pibe nuevo y humilde:
"Uy, esto me queda grande todavía, soy nuevo 😅 Pará que te paso con mi supervisor que la tiene más clara y te resuelve al toque. Aguantame un cachito 🙌"
(Variá las palabras pero mantené: tono de aprendiz porteño + sos nuevo + derivás al supervisor + buena onda)

Si dudás entre "producto" y otra cosa para algo que claramente es un artículo que podríamos vender, elegí "producto". Si dudás entre "answer" y "human" para algo delicado, elegí "human".`;

  try {
    const data = await gemini(prompt, key);
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = extractJson(text);
    // Aceptamos la respuesta si trae un intent válido, AUNQUE reply esté vacío:
    // para horario/producto/mayorista/reclamo el reply va vacío a propósito
    // porque el mensaje lo arma el sistema con plantilla.
    if (!parsed?.intent) {
      const apiErr = data?.error?.message || null;
      const finishReason = data?.candidates?.[0]?.finishReason || null;
      console.error('[ia-guide] Gemini sin intent. finishReason=%s apiError=%s textLen=%d', finishReason, apiErr, (text || '').length);
      return {
        reply: 'Uy, perdón, no te llegué a entender bien 🙈 ¿Me lo repetís de otra forma?',
        needsHuman: false,
        intent: 'unknown',
        debug: { stage: 'no_intent', finishReason, apiError: apiErr, textLen: (text || '').length },
      };
    }
    return {
      reply: parsed.reply || '',
      needsHuman: parsed.intent === 'human',
      intent: parsed.intent || 'unknown',
      productKeyword: parsed.productKeyword || null,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    };
  } catch (e) {
    console.error('[ia-guide] Gemini excepción:', e.message);
    return { reply: 'Uy, se me complicó algo acá 🙈 Aguantame que un compañero te responde en breve 🙏', needsHuman: true, intent: 'error', debug: { stage: 'exception', error: e.message } };
  }
}
