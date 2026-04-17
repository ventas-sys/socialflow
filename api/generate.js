import https from 'https';

function makeRequest(url, body) {
          return new Promise((resolve, reject) => {
                      const urlObj = new URL(url);
                      const postData = JSON.stringify(body);
                      const options = {
                                    hostname: urlObj.hostname,
                                    path: urlObj.pathname + urlObj.search,
                                    method: 'POST',
                                    headers: {
                                                    'Content-Type': 'application/json',
                                                    'Content-Length': Buffer.byteLength(postData)
                                    }
                      };
                      const req = https.request(options, (res) => {
                                    let data = '';
                                    res.on('data', (chunk) => { data += chunk; });
                                    res.on('end', () => {
                                                    try { resolve(JSON.parse(data)); }
                                                    catch(e) { resolve({ error: 'Parse error: ' + data.substring(0, 100) }); }
                                    });
                      });
                      req.on('error', (e) => reject(e));
                      req.setTimeout(25000, () => { req.destroy(); reject(new Error('Request timeout after 25s')); });
                      req.write(postData);
                      req.end();
          });
}

export default async function handler(req, res) {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          if (req.method === 'OPTIONS') return res.status(200).end();
          if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { platform, info, tone, photoB64 } = req.body;
          const GK = (process.env.GEMINI_API_KEY || '').trim();

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
          const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GK}`;

  try {
              let photoDesc = '';
              if (photoB64) {
                            const descData = await makeRequest(GEMINI_URL, {
                                            contents: [{ parts: [
                                                    { inline_data: { mime_type: 'image/jpeg', data: photoB64 } },
                                                    { text: 'Describe this product photo briefly in English. Max 60 words.' }
                                                            ] }],
                                            generationConfig: { maxOutputTokens: 500 }
                            });
                            photoDesc = descData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
              }

            const prompt = `Sos experto en marketing digital argentino. Tono: ${tone}.
            Genera una copia de venta en espanol para ${platNames[platform]}.
            Producto: ${info}
            Requisito: ${tips[platform]}
            Responde UNICAMENTE con el texto del copy listo para publicar. Sin comillas, sin explicaciones.`;

            const copyData = await makeRequest(GEMINI_URL, {
                          contents: [{ parts: [{ text: prompt }] }],
                          generationConfig: { temperature: 0.85, maxOutputTokens: 10000 }
            });

            if (copyData?.error) {
                          return res.status(200).json({ copy: copyData.error.message || 'Error de API', photoDesc });
            }

            const copy = copyData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
              return res.status(200).json({ copy, photoDesc });

  } catch (e) {
              return res.status(500).json({ error: e.message });
  }
}
