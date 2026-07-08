import https from 'https';

// Genera la foto publicitaria del producto.
// CLAVE: usa la FOTO REAL subida (photoB64) con un modelo imagen->imagen
// (gemini-2.5-flash-image, "Nano Banana"), que mejora la foto manteniendo el
// producto idéntico. Si no hay foto, cae a texto->imagen (Imagen 4) como respaldo.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { platform, productName, photoB64, photoMime } = req.body || {};
  const GK = (process.env.GEMINI_API_KEY || '').trim();
  if (!GK) return res.status(500).json({ error: 'API key no configurada' });

  const isSquare = (platform === 'ig' || platform === 'wa' || platform === 'tk' || platform === 'yt');
  const ar = isSquare ? '1:1' : '16:9';

  // --- CAMINO A: hay foto real -> editar/mejorar esa foto (imagen->imagen) ---
  if (photoB64) {
    const editPrompt =
      `Sos fotógrafo publicitario de producto. Tomá ESTE MISMO producto de la foto y ` +
      `generá una foto publicitaria premium para redes sociales, manteniendo el producto ` +
      `EXACTAMENTE IGUAL (misma forma, color, marca, texto y detalles reales — NO lo inventes ni lo cambies). ` +
      `Mejorá SOLO: iluminación de estudio suave, fondo limpio y elegante (degradé neutro o superficie premium), ` +
      `nitidez, sombras y reflejos realistas, encuadre ${ar}. Sin texto, sin logos agregados, sin marcas de agua. ` +
      `Resultado: fotografía comercial hiperrealista, lista para publicar${productName ? ', del producto: ' + productName : ''}.`;

    const body = JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: photoMime || 'image/jpeg', data: photoB64 } },
          { text: editPrompt },
        ],
      }],
      generationConfig: { responseModalities: ['IMAGE'], temperature: 0.4 },
    });

    return callGemini(res, GK,
      '/v1beta/models/gemini-2.5-flash-image:generateContent?key=' + GK,
      body, 'gemini');
  }

  // --- CAMINO B: sin foto -> texto->imagen (respaldo con Imagen 4) ----------
  const prompt =
    `Ultra-realistic premium product advertisement photograph, cinematic studio lighting, ` +
    `clean elegant background, photorealistic, high detail. Product: ${productName || 'producto'}. ` +
    `No text, no watermark. Ready for social media advertising.`;
  const body = JSON.stringify({
    instances: [{ prompt }],
    parameters: { sampleCount: 1, aspectRatio: ar, safetyFilterLevel: 'block_some', personGeneration: 'allow_adult' },
  });
  return callGemini(res, GK,
    '/v1beta/models/imagen-4.0-fast-generate-001:predict?key=' + GK,
    body, 'imagen');
}

// Llama a la API de Google y devuelve la imagen como data URL. Soporta las dos
// formas de respuesta: generateContent (parts.inlineData) y predict (predictions).
function callGemini(res, GK, path, body, kind) {
  return new Promise(function (resolve) {
    const opts = {
      hostname: 'generativelanguage.googleapis.com',
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req2 = https.request(opts, function (r) {
      let data = '';
      r.on('data', function (c) { data += c; });
      r.on('end', function () {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            res.status(500).json({ error: parsed.error.message || 'Image API error' });
            return resolve();
          }
          let b64 = '', mime = 'image/png';
          if (kind === 'gemini') {
            const parts = parsed?.candidates?.[0]?.content?.parts || [];
            const imgPart = parts.find(p => p.inline_data?.data || p.inlineData?.data);
            const inl = imgPart?.inline_data || imgPart?.inlineData;
            b64 = inl?.data || '';
            mime = inl?.mime_type || inl?.mimeType || 'image/png';
          } else {
            b64 = parsed?.predictions?.[0]?.bytesBase64Encoded || '';
          }
          if (!b64) {
            res.status(500).json({ error: 'No image: ' + data.substring(0, 200) });
            return resolve();
          }
          res.status(200).json({ url: 'data:' + mime + ';base64,' + b64 });
          resolve();
        } catch (e) {
          res.status(500).json({ error: 'Parse error: ' + e.message });
          resolve();
        }
      });
    });
    req2.on('error', function (e) { res.status(500).json({ error: 'Request error: ' + e.message }); resolve(); });
    req2.setTimeout(60000, function () { req2.destroy(); res.status(500).json({ error: 'Timeout 60s generando imagen' }); resolve(); });
    req2.write(body);
    req2.end();
  });
}
