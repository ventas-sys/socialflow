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

const BUSINESS_CONTEXT = `Sos asistente de WhatsApp de Uniproveedores (distribuidora mayorista argentina, Floresta CABA, Bacacay 4726).
Vendemos por local y MercadoLibre (https://www.mercadolibre.com.ar/tienda/arbetter-by-uniproveedores).
Horarios: L-V 14-17:30, Sáb 10-12:30, Dom/Feriado cerrado.
Tono: cordial argentino, breve, con emojis moderados. Tuteo. No inventes información que no esté en el contexto.`;

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
  "reply": "<texto cordial para enviar al cliente por WhatsApp. Si intent=redirect, sugerile que responda con el número/letra correspondiente. Si intent=answer, contestá brevemente la duda. Si intent=human, decile con calidez que un asesor lo va a atender. Máx 280 caracteres, emojis moderados.>",
  "confidence": <0-1>
}

Reglas:
- Si el mensaje sugiere claramente una opción del menú (ej cliente dice "quiero comprar al por mayor" estando en menú raíz → matchedKey:"b"), intent="redirect".
- Si pide hablar con persona, asesor, humano, "que me llame alguien" → intent="human".
- Si pregunta horario, ubicación, métodos de pago básicos y la respuesta es trivial desde el contexto → intent="answer".
- Si está perdido pero podés guiarlo → intent="redirect" con matchedKey=null y reply que liste 2-3 opciones más probables.`;

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
