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

export async function guideUser({ userText, currentRuleReply, menuOptions, lastBotMessage, recentHistory }) {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) {
    return { reply: currentRuleReply || 'Disculpá, no entendí. ¿Podrías indicar una de las opciones del menú? 🙏', needsHuman: false, intent: 'unknown' };
  }

  const menuText = menuOptions.length
    ? menuOptions.map(o => `- "${o.key}" → ${o.preview}`).join('\n')
    : '(sin submenú activo, está en el menú raíz: a=ubicación/horarios, b=mayoristas, c=reclamos, d=precio local)';

  const historyText = (recentHistory || [])
    .slice(-6)
    .map(h => `${h.role === 'user' ? 'Cliente' : 'Bot'}: ${h.text}`)
    .join('\n') || '(primer mensaje)';

  const prompt = `${BUSINESS_CONTEXT}

El cliente escribió un mensaje. Tu tarea: clasificar la INTENCIÓN y, si corresponde, extraer datos. NO inventes textos largos: para los casos con plantilla, el sistema arma el mensaje; vos solo clasificás (y para "producto" extraés la palabra clave).

OPCIONES DEL MENÚ DISPONIBLES EN ESTE PUNTO:
${menuText}

ÚLTIMO MENSAJE DEL BOT:
${lastBotMessage || '(ninguno)'}

HISTORIAL RECIENTE:
${historyText}

MENSAJE DEL CLIENTE A INTERPRETAR:
"${userText}"

Respondé EXCLUSIVAMENTE con un JSON válido:
{
  "intent": "horario_ubicacion" | "producto" | "mayorista" | "reclamo_ml" | "answer" | "redirect" | "human",
  "productKeyword": "<solo si intent='producto': el sustantivo principal del artículo, singular y sin acentos, ej 'tapon', 'mosqueton', 'termo'. Si no, null>",
  "matchedKey": "<solo si intent='redirect': la 'key' del menú, o null>",
  "reply": "<texto SOLO para intent 'answer' o 'human' o 'redirect'. Para los demás dejá string vacío "">",
  "confidence": <0-1>
}

Reglas de intent (en orden de prioridad):
- "horario_ubicacion": pregunta por horarios, si están abiertos, dónde quedan, dirección, cómo llegar. (El sistema responde con los datos reales.)
- "producto": pregunta por un artículo/producto puntual o su precio (ej "tenés tapones para termo?", "cuánto sale el mosquetón?", "precio del termo X"). Extraé productKeyword. (El sistema manda el link de la tienda filtrado.)
- "mayorista": quiere comprar al por mayor, lista mayorista, precios mayoristas, revender. (El sistema manda la lista + descuentos y deriva.)
- "reclamo_ml": tiene un problema con una compra de Mercado Libre (llegó tarde, llegó mal/errado, roto, faltante, no llegó). (El sistema pide fotos + usuario y deriva.)
- "answer": duda trivial respondible con el contexto (medios de pago básicos, si hacen envíos, etc.). Respondé directo y breve en "reply".
- "redirect": encaja claramente en una opción del menú de arriba. Poné matchedKey y un "reply" corto confirmando.
- "human": pide hablar con una persona, O está enojado/frustrado, O es algo que requiere juicio humano que no encaja en los casos de arriba.

Para intent="human" el "reply" DEBE sonar al pibe nuevo y humilde:
"Uy, esto me queda grande todavía, soy nuevo 😅 Pará que te paso con mi supervisor que la tiene más clara y te resuelve al toque. Aguantame un cachito 🙌"
(Variá las palabras pero mantené: tono de aprendiz porteño + sos nuevo + derivás al supervisor + buena onda)

Si dudás entre "answer" y "human", elegí "human". Si dudás entre "producto" y "answer" para algo que claramente es un artículo, elegí "producto".`;

  try {
    const data = await gemini(prompt, key);
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = extractJson(text);
    if (!parsed?.reply) {
      // Diagnóstico visible en los logs de Vercel + campo debug para el curl.
      const apiErr = data?.error?.message || null;
      const finishReason = data?.candidates?.[0]?.finishReason || null;
      console.error('[ia-guide] Gemini sin reply. finishReason=%s apiError=%s textLen=%d', finishReason, apiErr, (text || '').length);
      return {
        reply: currentRuleReply || 'Disculpá, no te entendí 🙏 ¿Podrías escribir una de las opciones del menú?',
        needsHuman: false,
        intent: 'unknown',
        debug: { stage: 'no_reply', finishReason, apiError: apiErr, textLen: (text || '').length },
      };
    }
    return {
      reply: parsed.reply || '',
      needsHuman: parsed.intent === 'human',
      intent: parsed.intent || 'unknown',
      matchedKey: parsed.matchedKey || null,
      productKeyword: parsed.productKeyword || null,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    };
  } catch (e) {
    console.error('[ia-guide] Gemini excepción:', e.message);
    return { reply: currentRuleReply || 'Disculpá, hubo un problema técnico 🙏 Un asesor te va a responder en breve.', needsHuman: true, intent: 'error', debug: { stage: 'exception', error: e.message } };
  }
}
