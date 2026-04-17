export default async function handler(req, res) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') return res.status(200).end();
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { platform, info, tone, photoB64 } = req.body;
        const GK = process.env.GEMINI_API_KEY;

  if (!GK) return res.status(500).json({ error: 'API key no configurada' });
        if (!info) return res.status(400).json({ error: 'Falta nombre del producto' });

  const tips = {
            ig: 'copy para Instagram con emojis y hasta 10 hashtags relevantes al final. Entre 200 y 400 caracteres.',
            fb: 'copy amigable para Facebook con precio incluido. Entre 150 y 300 caracteres.',
            wa: 'copy MUY corto para WhatsApp. Maximo 2 lineas. Incluir precio.',
            li: 'copy profesional para LinkedIn enfocado en valor. Entre 150 y 280 caracteres.',
            tw: 'copy conciso para Twitter/X con precio. Maximo 230 caracteres.'
  };

  const platNames = { ig: 'Instagram', fb: 'Facebook', wa: 'WhatsApp', li: 'LinkedIn', tw: 'X/Twitter' };
        const GEMINI_URL = `https://generativelanguage.googleapis.comh/v1beta/models/gemini-2.5-flash:generateContent?key=${GK}`;

  try {
            let photoDesc = '';
            if (photoB64) {
                        const descResp = await fetch(GEMINI_URL, {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                                      contents: [{ parts: [
                                                            { inline_data: { mime_type: 'image/jpeg', data: photoB64 } },
                                                            { text: 'Describe this product photo briefly in English. Max 60 words.' }
                                                                      ] }]
                                      })
                        });
                        const descData = await descResp.json();
                        photoDesc = descData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
            }

          const prompt = `Sos experto en marketing digital argentino. Tono: ${tone}.
          Genera una copia de venta en espanol para ${platNames[platform]}.
          Producto: ${info}
          Requisito: ${tips[platform]}
          Responde UNICAMENTE con el texto del copy listo para publicar. Sin comillas, sin explicaciones.`;

          const copyResp = await fetch(GEMINI_URL, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                                    contents: [{ parts: [{ text: prompt }] }],
                                    generationConfig: { temperature: 0.85, maxOutputTokens: 2000 }
                      })
          });

          const copyData = await copyResp.json();

          if (copyData?.error) {
                      return res.status(200).json({ copy: copyData.error.message || 'Error de API', photoDesc });
          }

          const copy = copyData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
            return res.status(200).json({ copy, photoDesc });

  } catch (e) {
            return res.status(500).json({ error: e.message });
  }
}
