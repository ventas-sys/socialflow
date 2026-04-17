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

  const isSquare = (platform === 'ig' || platform === 'wa');
      const photoCtx = photoDesc ? 'The product looks like this: ' + photoDesc + '.' : '';
      const badgeTxt = (badge && badge !== 'NINGUNO') ? 'Include a bold "' + badge + '" promotional badge in a corner.' : '';
      const priceTxt = price ? 'Display the price "$' + price + '" prominently.' : '';

  const prompt = 'RESOLUCION 8K ULTRA HD EXTREMA ATENCION A LOS DETALLES FINOS Y LAS TEXTURAS REALISTAS COLORES VIBRANTES Y PRECISOS ILUMINACION CINEMATOGRAFICA HIPERREALISMO FOTOGRAFICO EFECTOS DE LENS FLARE Y BOKEH. Ultra-realistic premium product advertisement photograph. ' + photoCtx + ' Product: ' + productName + '. ' + badgeTxt + ' ' + priceTxt + ' Professional commercial photograph ready for social media advertising.';

  const body = JSON.stringify({
          instances: [{ prompt: prompt }],
          parameters: {
                    sampleCount: 1,
                    aspectRatio: isSquare ? '1:1' : '16:9',
                    safetyFilterLevel: 'block_some',
                    personGeneration: 'allow_adult'
          }
  });

  return new Promise(function(resolve) {
          const opts = {
                    hostname: 'generativelanguage.googleapis.com',
                    path: '/v1beta/models/imagen-4.0-fast-generate-001:predict?key=' + GK,
                    method: 'POST',
                    headers: {
                                'Content-Type': 'application/json',
                                'Content-Length': Buffer.byteLength(body)
                    }
          };

                         const req2 = https.request(opts, function(r) {
                                   let data = '';
                                   r.on('data', function(c) { data += c; });
                                   r.on('end', function() {
                                               try {
                                                             const parsed = JSON.parse(data);
                                                             if (parsed.error) {
                                                                             res.status(500).json({ error: parsed.error.message || 'Imagen API error' });
                                                                             return resolve();
                                                             }
                                                             const b64 = (parsed.predictions && parsed.predictions[0] && parsed.predictions[0].bytesBase64Encoded) || '';
                                                             if (!b64) {
                                                                             res.status(500).json({ error: 'No image: ' + data.substring(0, 200) });
                                                                             return resolve();
                                                             }
                                                             res.status(200).json({ url: 'data:image/png;base64,' + b64 });
                                                             resolve();
                                               } catch(e) {
                                                             res.status(500).json({ error: 'Parse error: ' + e.message });
                                                             resolve();
                                               }
                                   });
                         });

                         req2.on('error', function(e) {
                                   res.status(500).json({ error: 'Request error: ' + e.message });
                                   resolve();
                         });

                         req2.write(body);
          req2.end();
  });
}
