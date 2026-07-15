import https from 'https';
import { LOGO_B64, LOGO_MIME } from '../lib/brand-logo.js';

// Genera el CARTEL PUBLICITARIO del producto.
//
// Estrategia en 2 pasos (la que pidió el cliente: "usar otra IA para el prompt"):
//   1) Gemini (texto) mira la FOTO REAL y saca 3 virtudes cortas del producto.
//   2) Un modelo de imagen arma el cartel con el producto REAL, el logo
//      UNIPROVEEDORES, los colores de marca y esas 3 virtudes, en el formato
//      de cada red social.
//
// Motor de imagen:
//   - Si hay OPENAI_API_KEY -> gpt-image-1 (el motor de ChatGPT). EDITA la foto
//     real, respeta el producto y escribe bien el logo/textos. RECOMENDADO.
//   - Si no, cae a Gemini (gemini-2.5-flash-image) con el mismo prompt.
//   - Sin foto -> Imagen 4 (texto->imagen) como último respaldo.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { platform, productName, price, badge, photoDesc, photoB64, photoMime } = req.body || {};
  const OK = (process.env.OPENAI_API_KEY || '').trim();
  const GK = (process.env.GEMINI_API_KEY || '').trim();
  if (!OK && !GK) return res.status(500).json({ error: 'Falta OPENAI_API_KEY o GEMINI_API_KEY' });

  // --- PASO 1: 3 virtudes reales del producto (Gemini texto) --------------
  let virtues = [];
  let prodLabel = (productName || '').trim();
  if (GK) {
    try {
      const copy = await geminiCopy(GK, { productName, price, photoDesc, photoB64, photoMime });
      if (Array.isArray(copy.virtues)) virtues = copy.virtues.filter(Boolean).slice(0, 3);
      if (!prodLabel && copy.product) prodLabel = copy.product;
    } catch (_) { /* si falla, seguimos con virtudes genéricas */ }
  }
  if (virtues.length < 3) {
    virtues = ['Calidad garantizada', 'Envío rápido', 'Mejor precio'].slice(0, 3);
  }

  const logo = (LOGO_B64 && LOGO_B64.length > 100) ? { b64: LOGO_B64, mime: LOGO_MIME || 'image/png' } : null;
  const prompt = buildAdPrompt({ productName: prodLabel, price, badge, virtues, hasLogo: !!logo });

  // --- PASO 2: generar la imagen -----------------------------------------
  if (photoB64) {
    if (OK) {
      return openaiEdit(res, OK, { photoB64, photoMime, prompt, size: openaiSize(platform), logo });
    }
    return geminiImage(res, GK, {
      photoB64, photoMime,
      prompt: prompt + ' Encuadre ' + geminiAr(platform) + '.',
      note: 'Falta OPENAI_API_KEY en Vercel (Production) o falta redeploy — usando Gemini (respaldo)',
    });
  }

  // Sin foto -> texto->imagen (respaldo)
  if (!GK) return res.status(500).json({ error: 'Subí la foto del producto para generar el cartel' });
  const tprompt =
    `Professional cinematic advertising poster for a hardware/ecommerce product, ` +
    `high visual impact, dramatic premium lighting, photorealistic. ` +
    `Product: ${prodLabel || 'producto'}${photoDesc ? ' (' + photoDesc + ')' : ''}, ` +
    `shown large in a realistic scene matching its real-world use. ` +
    `Text "UNIPROVEEDORES" logo top-left, brand colors lime green #C6DE00, white, gray, black. ` +
    `Ready for social media, no watermark.`;
  const body = JSON.stringify({
    instances: [{ prompt: tprompt }],
    parameters: { sampleCount: 1, aspectRatio: geminiAr(platform), safetyFilterLevel: 'block_some', personGeneration: 'allow_adult' },
  });
  return callGeminiPredict(res, GK, body);
}

// ---- Formatos por red social ------------------------------------------------
// gpt-image-1 acepta: 1024x1024, 1536x1024 (horizontal), 1024x1536 (vertical).
function openaiSize(p) {
  if (p === 'fb' || p === 'yt') return '1536x1024';  // horizontal
  if (p === 'tk') return '1024x1536';                // vertical (TikTok/Reels)
  return '1024x1024';                                // ig / wa / cuadrado
}
function geminiAr(p) {
  if (p === 'fb' || p === 'yt') return '16:9';
  if (p === 'tk') return '9:16';
  return '1:1';
}

// ---- Prompt del cartel ------------------------------------------------------
function buildAdPrompt({ productName, price, badge, virtues, hasLogo }) {
  const v = (virtues || []).slice(0, 3);
  const badgeTxt = (badge || '').trim();
  const priceTxt = (price || '').trim();
  let promo = '';
  if (badgeTxt && badgeTxt.toUpperCase() !== 'NINGUNO') {
    promo = ` Incluí una cápsula/sello promocional verde manzana con la palabra "${badgeTxt}"` +
      (priceTxt ? ` y el precio "${priceTxt}"` : '') +
      `, integrada al diseño y sin tapar el producto.`;
  } else if (priceTxt) {
    promo = ` Mostrá el precio "${priceTxt}" en una cápsula verde manzana, bien claro.`;
  }

  // Con logo real: la 2ª imagen ES el logo -> copiarlo exacto.
  // Sin logo: describirlo lo más fiel posible a la marca.
  const logoInstr = hasLogo
    ? `Hay DOS imágenes adjuntas: la 1ª es el PRODUCTO y la 2ª es el LOGO OFICIAL de ` +
      `UNIPROVEEDORES. Colocá ESE logo de la 2ª imagen arriba a la izquierda, COPIÁNDOLO ` +
      `EXACTO (mismos colores, engranaje, rayo y tipografía), sin redibujarlo, sin ` +
      `deformarlo y sin cambiarle los colores, con aire alrededor. `
    : `Arriba a la izquierda poné el logo de UNIPROVEEDORES estilo ferretería industrial: ` +
      `un engranaje metálico con un rayo verde manzana en el centro, y el texto con "UNI" ` +
      `en verde manzana y "PROVEEDORES" en gris metálico, en tipografía industrial bold con ` +
      `contorno negro. `;

  return (
    `Diseñá un cartel publicitario profesional para redes sociales usando EXACTAMENTE ` +
    `el producto de la PRIMERA imagen adjunta como protagonista${productName ? ' ("' + productName + '")' : ''}: ` +
    `mantené su forma, color, marca y detalles reales, IDÉNTICO, sin inventarlo, deformarlo ` +
    `ni pegarle textos falsos encima del producto. ` +
    `Escena moderna sobre fondo oscuro/negro, de alto impacto, con iluminación premium ` +
    `y un ambiente acorde al uso real del producto. ` +
    logoInstr +
    `Paleta de marca OBLIGATORIA: verde manzana #A4D72B (color estrella), gris metálico #9AA0A6, ` +
    `negro #0D0D0D y blanco. El verde manzana brilla sobre el negro. ` +
    `Destacá SIEMPRE estas 3 virtudes del producto como 3 textos cortos, prolijos y bien ` +
    `legibles (una debajo de la otra): ` +
    v.map(x => '"' + x + '"').join(', ') + '.' +
    promo +
    ` Todo el texto correctamente escrito en español, tipografía industrial bold y legible. ` +
    `Resultado premium, realista, listo para publicar.`
  );
}

// ---- PASO 1: Gemini texto -> {product, virtues[3]} --------------------------
function geminiCopy(GK, { productName, price, photoDesc, photoB64, photoMime }) {
  return new Promise((resolve, reject) => {
    const parts = [];
    if (photoB64) parts.push({ inline_data: { mime_type: photoMime || 'image/jpeg', data: photoB64 } });
    parts.push({
      text:
        `Sos redactor publicitario de una ferretería/distribuidora. ` +
        `Producto: "${productName || '(mirá la foto)'}"${price ? ', precio ' + price : ''}. ` +
        `Devolvé SOLO un JSON: {"product":"nombre corto del producto","virtues":["v1","v2","v3"]}. ` +
        `Las 3 virtudes: beneficios/atributos reales del producto, MUY cortos (máx 3 palabras c/u), en español, para destacar en un cartel.`,
    });
    const body = JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 400, temperature: 0.7, thinkingConfig: { thinkingBudget: 0 } },
    });
    const opts = {
      hostname: 'generativelanguage.googleapis.com',
      path: '/v1beta/models/gemini-2.5-flash:generateContent?key=' + GK,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const r = https.request(opts, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const txt = parsed?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
          const obj = JSON.parse(txt);
          resolve({ product: obj.product || '', virtues: obj.virtues || [] });
        } catch (e) { reject(e); }
      });
    });
    r.on('error', reject);
    r.setTimeout(20000, () => { r.destroy(); reject(new Error('Timeout copy')); });
    r.write(body); r.end();
  });
}

// ---- PASO 2a: gpt-image-1 (OpenAI) edita la foto real -----------------------
// Si viene `logo`, se manda como 2ª imagen (image[]) para que copie el logo real.
function openaiEdit(res, key, { photoB64, photoMime, prompt, size, logo }) {
  return new Promise((resolve) => {
    const boundary = '----socialflow' + Math.random().toString(16).slice(2);
    const CRLF = '\r\n';
    const mime = photoMime || 'image/jpeg';
    const ext = mime.includes('png') ? 'png' : (mime.includes('webp') ? 'webp' : 'jpg');
    const field = (name, val) =>
      Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${val}${CRLF}`);
    // Con logo -> field name "image[]" (múltiples imágenes). Sin logo -> "image".
    const imgField = logo ? 'image[]' : 'image';
    const imagePart = (fname, fmime, b64) => [
      Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="${imgField}"; filename="${fname}"${CRLF}Content-Type: ${fmime}${CRLF}${CRLF}`),
      Buffer.from(b64, 'base64'),
      Buffer.from(CRLF),
    ];
    const chunks = [
      field('model', 'gpt-image-1'),
      field('prompt', prompt),
      field('size', size),
      field('quality', 'medium'),
      field('n', '1'),
      ...imagePart(`product.${ext}`, mime, photoB64),
    ];
    if (logo) {
      const lmime = logo.mime || 'image/png';
      const lext = lmime.includes('png') ? 'png' : (lmime.includes('webp') ? 'webp' : 'jpg');
      chunks.push(...imagePart(`logo.${lext}`, lmime, logo.b64));
    }
    chunks.push(Buffer.from(`--${boundary}--${CRLF}`));
    const body = Buffer.concat(chunks);
    const opts = {
      hostname: 'api.openai.com',
      path: '/v1/images/edits',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + key,
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': body.length,
      },
    };
    const r = https.request(opts, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.error) { res.status(500).json({ error: 'OpenAI: ' + (j.error.message || 'error') }); return resolve(); }
          const b64 = j?.data?.[0]?.b64_json;
          if (!b64) { res.status(500).json({ error: 'OpenAI sin imagen: ' + data.substring(0, 200) }); return resolve(); }
          res.status(200).json({ url: 'data:image/png;base64,' + b64, engine: 'gpt-image-1' });
          resolve();
        } catch (e) { res.status(500).json({ error: 'Parse OpenAI: ' + e.message }); resolve(); }
      });
    });
    r.on('error', (e) => { res.status(500).json({ error: 'OpenAI request: ' + e.message }); resolve(); });
    r.setTimeout(115000, () => { r.destroy(); res.status(500).json({ error: 'Timeout generando imagen (OpenAI)' }); resolve(); });
    r.write(body); r.end();
  });
}

// ---- PASO 2b: Gemini imagen (respaldo, edita la foto real) ------------------
function geminiImage(res, GK, { photoB64, photoMime, prompt, note }) {
  const body = JSON.stringify({
    contents: [{
      parts: [
        { inline_data: { mime_type: photoMime || 'image/jpeg', data: photoB64 } },
        { text: prompt },
      ],
    }],
    generationConfig: { responseModalities: ['IMAGE'], temperature: 0.9 },
  });
  return callGeminiContent(res, GK, body, note);
}

// ---- Helpers de respuesta de Gemini ----------------------------------------
function callGeminiContent(res, GK, body, note) {
  return geminiCall(res, GK, '/v1beta/models/gemini-2.5-flash-image:generateContent?key=' + GK, body, 'content', note);
}
function callGeminiPredict(res, GK, body, note) {
  return geminiCall(res, GK, '/v1beta/models/imagen-4.0-fast-generate-001:predict?key=' + GK, body, 'predict', note);
}
function geminiCall(res, GK, path, body, kind, note) {
  return new Promise((resolve) => {
    const opts = {
      hostname: 'generativelanguage.googleapis.com',
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const r = https.request(opts, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) { res.status(500).json({ error: parsed.error.message || 'Image API error' }); return resolve(); }
          let b64 = '', mime = 'image/png';
          if (kind === 'content') {
            const parts = parsed?.candidates?.[0]?.content?.parts || [];
            const imgPart = parts.find(p => p.inline_data?.data || p.inlineData?.data);
            const inl = imgPart?.inline_data || imgPart?.inlineData;
            b64 = inl?.data || '';
            mime = inl?.mime_type || inl?.mimeType || 'image/png';
          } else {
            b64 = parsed?.predictions?.[0]?.bytesBase64Encoded || '';
          }
          if (!b64) { res.status(500).json({ error: 'No image: ' + data.substring(0, 200) }); return resolve(); }
          res.status(200).json({ url: 'data:' + mime + ';base64,' + b64, engine: 'gemini', note: note || undefined });
          resolve();
        } catch (e) { res.status(500).json({ error: 'Parse error: ' + e.message }); resolve(); }
      });
    });
    r.on('error', (e) => { res.status(500).json({ error: 'Request error: ' + e.message }); resolve(); });
    r.setTimeout(60000, () => { r.destroy(); res.status(500).json({ error: 'Timeout 60s generando imagen' }); resolve(); });
    r.write(body); r.end();
  });
}
