export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { platform, info, tone, photoB64 } = req.body;
    const GK = process.env.GEMINI_API_KEY;

  if (!GK) return res.status(500).json({ error: 'API key no configurada' });

  const tips = {
        ig: 'copy para Instagram con emojis y hasta 10 hashtags relevantes al final. Entre 200 y 400 caracteres.',
        fb: 'copy amigable para Facebook con precio incluido. Entre 150 y 300 caracteres.',
        wa: 'copy MUY corto para WhatsApp. Maximo 2 lineas. Incluir precio.',
        li: 'copy profesional para LinkedIn enfocado en valor. Entre 150 y 280 caracteres.',
        tw: 'copy conciso para Twitter/X con precio. Maximo 230 caracteres.'
  };

  const platNames = { ig: 'Instagram', fb: 'Facebook', wa: 'WhatsApp', li: 'LinkedIn', tw: 'X/Twitter' };

  try {
        // Si hay foto, primero describirla
      let photoDesc = '';
        if (photoB64) {
                const descResp = await fetch(
                          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GK}`,
                  {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                            contents: [{ parts: [
                                              { inline_data: { mime_type: 'image/jpeg', data: photoB64 } },
                                              { text: 'Describe this product photo in detail in English for an AI image generator. Focus on: the product, colors, textures, background, lighting. Max 120 words.' }
                                                          ] }]
                              })
                  }
                        );
                const descData = await descResp.json();
                photoDesc = descData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        }

      // Generar copia
      const prompt = `Sos experto en marketing digital argentino. Tono: ${tone}.
      Genera una copia de venta en espanol para ${platNames[platform]}.
      Producto: ${info}
      Requisito: ${tips[platform]}
      Responde UNICAMENTE con el texto del copy listo para publicar. Sin comillas, sin explicaciones.`;

      const copyResp = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GK}`,
        {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                              contents: [{ parts: [{ text: prompt }] }],
                              generationConfig: { temperature: 0.85, maxOutputTokens: 400 }
                  })
        }
            );
        const copyData = await copyResp.json();
        const copy = copyData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

      res.status(200).json({ copy, photoDesc });
  } catch (e) {
        res.status(500).json({ error: e.message });
  }
}
