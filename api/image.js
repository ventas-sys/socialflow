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

  const { platform, productName, price, badge, photoDesc, scenePrompt, photoB64, photoMime } = req.body || {};
  const GK = (process.env.GEMINI_API_KEY || '').trim();
  if (!GK) return res.status(500).json({ error: 'API key no configurada' });

  const isSquare = (platform === 'ig' || platform === 'wa' || platform === 'tk' || platform === 'yt');
  const ar = isSquare ? '1:1' : '16:9';

  // --- CAMINO A: hay foto real -> armar un CARTEL PUBLICITARIO cinematográfico ---
  // usando el producto REAL de la foto como protagonista (imagen->imagen).
  if (photoB64) {
    const editPrompt = scenePrompt || buildAdPrompt({ productName, price, badge, photoDesc, ar });

    const body = JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: photoMime || 'image/jpeg', data: photoB64 } },
          { text: editPrompt },
        ],
      }],
      generationConfig: { responseModalities: ['IMAGE'], temperature: 0.9 },
    });

    return callGemini(res, GK,
      '/v1beta/models/gemini-2.5-flash-image:generateContent?key=' + GK,
      body, 'gemini');
  }

  // --- CAMINO B: sin foto -> texto->imagen (respaldo con Imagen 4) ----------
  const prompt =
    `Professional cinematic advertising poster for a hardware/ecommerce product, ` +
    `high visual impact, dramatic premium lighting, photorealistic, high detail. ` +
    `Product: ${productName || 'producto'}${photoDesc ? ' (' + photoDesc + ')' : ''}, ` +
    `shown large in the foreground within a realistic scene matching its real-world use. ` +
    `Ready for social media advertising, no watermark.`;
  const body = JSON.stringify({
    instances: [{ prompt }],
    parameters: { sampleCount: 1, aspectRatio: ar, safetyFilterLevel: 'block_some', personGeneration: 'allow_adult' },
  });
  return callGemini(res, GK,
    '/v1beta/models/imagen-4.0-fast-generate-001:predict?key=' + GK,
    body, 'imagen');
}

// Arma el prompt del CARTEL PUBLICITARIO cinematográfico, al estilo de lo que
// genera ChatGPT: escena dramática, producto REAL de la foto como protagonista,
// iluminación premium y el logo UNIPROVEEDORES. El modelo infiere el ambiente
// (taller, obra, exterior, cocina, etc.) según el producto de la foto.
function buildAdPrompt({ productName, price, badge, photoDesc, ar }) {
  const prod = (productName || 'el producto de la foto').trim();
  const desc = photoDesc ? ` (${photoDesc.trim()})` : '';

  // Chapa/etiqueta promocional: solo si hay oferta y precio.
  let promo = '';
  const badgeTxt = (badge || '').trim();
  const priceTxt = (price || '').trim();
  if (badgeTxt && badgeTxt.toUpperCase() !== 'NINGUNO') {
    promo =
      ` Agregá una chapa/etiqueta promocional integrada al diseño (esquina inferior o superior derecha) ` +
      `con la palabra "${badgeTxt}"` + (priceTxt ? ` y el precio "${priceTxt}"` : '') +
      ` en tipografía moderna, bien legible, sin tapar el producto.`;
  }

  return (
    `Diseño de cartel publicitario profesional para producto de ferretería/ecommerce, ` +
    `estilo moderno, cinematográfico y de alto impacto visual. ` +
    `PRODUCTO PRINCIPAL: usá EXACTAMENTE el producto de la foto adjunta — "${prod}"${desc} — ` +
    `mismísima forma, color, marca, textos y detalles reales, NO lo inventes ni lo cambies, ` +
    `mostralo grande en primer plano, hiperrealista, con reflejos y materiales realistas. ` +
    `AMBIENTE: creá un fondo/escena dramática y creíble acorde al USO real de ese producto ` +
    `(taller, obra, exterior, hogar, aventura, según corresponda), con profundidad, ` +
    `iluminación cinematográfica premium y contraste de alto impacto. ` +
    `Podés incluir a una persona usando el producto de forma natural si le suma realismo. ` +
    `LOGO: en la parte superior izquierda, colocá el texto "UNIPROVEEDORES" como logo estilo ` +
    `ferretería, con la paleta verde manzana (#c6de00), blanco, gris y negro. ` +
    promo +
    ` Estética premium y realista, lista para publicar en Mercado Libre, WhatsApp e Instagram. ` +
    `Encuadre ${ar}. Nada de marcas de agua ni texto de relleno; que se vea profesional y limpio.`
  );
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
