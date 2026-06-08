import https from 'node:https';

function gemini(prompt, key) {
  return new Promise((resolve, reject) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 1200,
        responseMimeType: 'application/json',
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

const BUSINESS_CONTEXT = `Sos un asistente nuevo de WhatsApp de Uniproveedores (distribuidora mayorista argentina, Floresta CABA, Bacacay 4726).
Vendemos por local y MercadoLibre (https://www.mercadolibre.com.ar/tienda/arbetter-by-uniproveedores).
Horarios: L-V 14-17:30, Sáb 10-12:30, Dom/Feriado cerrado.
Tono: cordial argentino, breve, humilde, con emojis moderados. Tuteo. Sos NUEVO en el puesto y honesto sobre tus límites. No inventes información que no esté en el contexto.
Cuando no sepas algo o la consulta requiera juicio humano (precio especial, stock, fecha de envío, etc.), derivá con calidez al supervisor.`;

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

El cliente escribió un mensaje que no matchea ninguna opción del menú actual. Tu tarea: o lo reinterpretás amablemente para guiarlo a una opción, o lo respondés brevemente si la duda es simple, o marcás que necesita asesor humano.

OPCIONES DISPONIBLES EN ESTE PUNTO:
${menuText}

ÚLTIMO MENSAJE DEL BOT (lo que el cliente acaba de ver):
${lastBotMessage || '(ninguno)'}

HISTORIAL RECIENTE:
${historyText}

MENSAJE DEL CLIENTE A INTERPRETAR:
"${userText}"

Respondé EXCLUSIVAMENTE con un JSON válido con esta estructura:
{
  "intent": "redirect" | "answer" | "human",
  "matchedKey": "<la 'key' de la opción del menú a la que querés redirigirlo, o null>",
  "reply": "<texto cordial para enviar al cliente por WhatsApp. Máx 280 caracteres, emojis moderados.>",
  "confidence": <0-1>
}

Reglas de intent:
- "redirect": el mensaje sugiere claramente una opción del menú (ej "quiero comprar al por mayor" → matchedKey:"b"). Reply: confirmá amable y avisá que ahora le mandás el menú correspondiente.
- "answer": la duda es trivial y respondible con el contexto del negocio (horario, ubicación, métodos de pago básicos). Reply: respondé directo y breve.
- "human": pide explícitamente hablar con persona/asesor/humano, O la consulta requiere juicio humano (precio especial, stock disponible, modificar pedido, reclamo complejo, fecha de envío específica, descuento puntual), O el cliente está enojado/frustrado, O escribiste 2 veces y sigue sin entenderse.

Cuando intent="human" tu reply DEBE seguir este patrón con calidez:
"Mil disculpas, soy nuevo acá y no quiero darte mal una info así nomás 🙏 Te paso al toque con mi supervisor que te va a atender mejor. Aguantame un cachito 🤗"
(Variá las palabras pero mantené: pedís disculpas, decís que sos nuevo, derivás a supervisor, das tono cálido)

Si estás dudando entre answer y human, ELEGÍ HUMAN. Es mejor pedir ayuda al supervisor que dar info que pueda estar mal.`;

  try {
    const data = await gemini(prompt, key);
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = extractJson(text);
    if (!parsed?.reply) {
      return { reply: currentRuleReply || 'Disculpá, no te entendí 🙏 ¿Podrías escribir una de las opciones del menú?', needsHuman: false, intent: 'unknown' };
    }
    return {
      reply: parsed.reply,
      needsHuman: parsed.intent === 'human',
      intent: parsed.intent || 'unknown',
      matchedKey: parsed.matchedKey || null,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    };
  } catch (e) {
    return { reply: currentRuleReply || 'Disculpá, hubo un problema técnico 🙏 Un asesor te va a responder en breve.', needsHuman: true, intent: 'error' };
  }
}
