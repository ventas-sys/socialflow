import https from 'https';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { platform, productName, price, badge, photoDesc } = req.body;
    const GK = (process.env.GEMINI_API_KEY || '').trim();

  if (!GK) return res.status(500).json({ error: 'API key no configurada' });

  const styleMap = {
        ig: 'square Instagram post format (1:1), vibrant lifestyle aesthetic, eye-catching colors',
        fb: 'wide Facebook ad banner format (16:9), horizontal layout, clean professional look',
        li: 'professional LinkedIn product photo (16:9), corporate style, neutral background',
        tw: 'wide Twitter/X card format (16:9), bold and modern design',
        wa: 'square WhatsApp sharing format (1:1), clean background, product focused'
  };

  const photoContext = photoDesc ? `The product looks like this: ${photoDesc}.` : '';
    const badgeText = badge && badge !== 'NINGUNO'
      ? `Include a bold "${badge}" promotional badge/ribbon in a corner of the image, with large visible text.`
          : '';
    const priceText = price ? `Display the price "$${price}" prominently in the image.` : '';

  const prompt = `RESOLUCION 8K ULTRA HD, 1200 X 1200 PIXELES EXTREMA ATENCION A LOS DETALLES FINOS Y LAS TEXTURAS REALISTAS COLORES VIBRANTES Y PRECISOS ILUMINACION CINEMATOGRAFICA HIPERREALISMO FOTOGRAFICO EFECTOS VISUALES DE ALTA CALIDAD POSTPROCESAMIENTO PROFESIONAL EFECTOS DE LENS FLARE Y BOKEH. Ultra-realistic premium product advertisement photograph. ${photoContext} Product: ${productName}. Format: ${styleMap[platform]}. ${badgeText} ${priceText} The image must look like a professional commercial photograph ready for social media advertising.`;

  const requestBody = JSON.stringify({
        instances: [{ prompt }],
        parameters: {
                sampleCount: 1,
                aspectRatio: (platform === 'ig' || platform === 'wa') ? '1:1' : '16:9',
                safetyFilterLevel: 'block_some',
                personGeneration: 'allow_adult'
        }
  });

  return new Promise((resolve) => {
        const options = {
                hostname: 'generativelanguage.googleapis.com',
                path: `/v1beta/models/imagen-3.0-generate-002:predict?key=${GK}`,
                method: 'POST',
                headers: {
                          'Content-Type': 'application/json',
                          'Content-Length': Buffer.byteLength(requestBody)
                }
        };

                         const request = https.request(options, (response) => {
                                 let data = '';
                                 response.on('data', (chunk) => { data += chunk; });
                                 response.on('end', () => {
                                           try {
                                                       const parsed = JSON.parse(data);
                                                       if (parsed.error) {
                                                                     res.status(500).json({ error: parsed.error.message || 'Imagen API error' });
                                                                     return resolve();
                                                       }
                                                       const b64 = parsed?.predictions?.[0]?.bytesBase64Encoded || '';
                                                       if (!b64) {
                                                                     res.status(500).json({ error: 'No image returned: ' + data.substring(0, 200) });
                                                                     return resolve();
                                                       }
                                                       const url = `data:image/png;base64,${b64}`;
                                                       res.status(200).json({ url });
                                                       resolve();
                                           } catch (e) {
                                                       res.status(500).json({ error: 'Parse error: ' + e.message });
                                                       resolve();
                                           }
                                 });
                         });

                         request.on('error', (e) => {
                                 res.status(500).json({ error: 'Request error: ' + e.message });
                                 resolve();
                         });

                         request.write(requestBody);
        request.end();
  });
}
}
