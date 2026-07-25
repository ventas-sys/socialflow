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
              ig: 'Instagram: HOOK potente en la 1ra linea (frena el scroll), 2-3 lineas de beneficios con emojis, CTA claro. Al final 8-12 hashtags relevantes (mezcla generales del rubro + especificos del producto). 200-400 caracteres (sin contar hashtags).',
              fb: 'Facebook: HOOK en la 1ra linea, beneficios y precio, CTA. Al final 3-5 hashtags. 150-320 caracteres.',
              wa: 'WhatsApp: HOOK corto y directo + precio + CTA. Maximo 3 lineas. SIN hashtags (en WhatsApp no se usan).',
              li: 'LinkedIn: HOOK profesional enfocado en valor/beneficio para el negocio, tono serio pero cercano. 3-4 hashtags profesionales al final. 150-300 caracteres.',
              tw: 'X/Twitter: HOOK filoso en la 1ra linea + beneficio + precio + CTA. 2-3 hashtags. Maximo 250 caracteres en total.',
              tk: 'TikTok: HOOK muy fuerte en la 1ra linea, beneficio, CTA. Maximo 150 caracteres. 4-6 hashtags virales al final (#fyp #parati + del rubro).',
              yt: 'YouTube Shorts: 1ra linea = TITULO gancho de hasta 70 caracteres. Linea en blanco. Despues descripcion con keywords del producto y 3-5 hashtags al final tipo #Shorts. 200-350 caracteres.'
  };

  const platNames = { ig: 'Instagram', fb: 'Facebook', wa: 'WhatsApp', li: 'LinkedIn', tw: 'X/Twitter', tk: 'TikTok', yt: 'YouTube Shorts' };
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

            const prompt = `Sos redactor publicitario experto, argentino. Tono: ${tone}.
            Escribi una copia de VENTA en castellano de Argentina para ${platNames[platform]}.
            Producto y datos: ${info}
            Requisito de formato: ${tips[platform]}
            REGLAS:
            - Arranca SIEMPRE con un HOOK potente en la primera linea (una frase que frene el scroll: pregunta, dolor, promesa o dato).
            - Ortografia perfecta, natural, sin sonar a robot. Emojis con moderacion.
            - Si en los datos hay un link de Mercado Libre, incluilo EXACTAMENTE IGUAL (no lo cambies, acortes ni inventes) con un CTA tipo "Comprá acá 👉".
            - Cerra con los hashtags que corresponden a la red (si la red no usa hashtags, no pongas).
            Responde UNICAMENTE con el texto del copy listo para publicar. Sin comillas, sin encabezados, sin explicaciones.`;

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
