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

  const { platform, productName, price, badge, photoDesc, mlDesc, photoB64, photoMime } = req.body || {};
  const OK = (process.env.OPENAI_API_KEY || '').trim();
  const GK = (process.env.GEMINI_API_KEY || '').trim();
  if (!OK && !GK) return res.status(500).json({ error: 'Falta OPENAI_API_KEY o GEMINI_API_KEY' });

  // --- PASO 1: brief del producto (Gemini texto lee la foto + desc ML) -----
  // Devuelve: producto, spec (medida estrella), tagline, features[4], usos[].
  let brief = {};
  let prodLabel = (productName || '').trim();
  if (GK) {
    try {
      brief = await geminiBrief(GK, { productName, price, photoDesc, mlDesc, photoB64, photoMime });
      if (!prodLabel && brief.product) prodLabel = brief.product;
    } catch (_) { /* si falla, seguimos con defaults */ }
  }
  const features = (Array.isArray(brief.features) ? brief.features.filter(Boolean) : []).slice(0, 4);
  while (features.length < 3) features.push(['Calidad garantizada', 'Resistente', 'Fácil de usar'][features.length]);
  const usos = (Array.isArray(brief.usos) ? brief.usos.filter(Boolean) : []).slice(0, 6);

  const logo = (LOGO_B64 && LOGO_B64.length > 100) ? { b64: LOGO_B64, mime: LOGO_MIME || 'image/png' } : null;
  const prompt = buildAdPrompt({
    productName: prodLabel, price, badge, hasLogo: !!logo,
    spec: brief.spec || '', tagline: brief.tagline || '', features, usos,
  });

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
  if (p === 'yt') return '1536x1024';  // horizontal (miniatura YouTube)
  if (p === 'fb') return '1024x1024';  // cuadrado (feed Facebook)
  return '1024x1536';                  // ig / wa / tk -> infografía vertical
}
function geminiAr(p) {
  if (p === 'yt') return '16:9';
  if (p === 'fb') return '1:1';
  return '9:16';
}

// ---- Prompt del cartel (INFOGRAFÍA publicitaria) ---------------------------
function buildAdPrompt({ productName, price, badge, hasLogo, spec, tagline, features, usos }) {
  const f = (features || []).slice(0, 4);
  const u = (usos || []).slice(0, 6);
  const badgeTxt = (badge || '').trim();
  const priceTxt = (price || '').trim();

  let promo = '';
  if (badgeTxt && badgeTxt.toUpperCase() !== 'NINGUNO') {
    promo = ` Poné una cápsula/sello promocional verde manzana con "${badgeTxt}"` +
      (priceTxt ? ` y el precio "${priceTxt}"` : '') + `, sin tapar el producto.`;
  } else if (priceTxt) {
    promo = ` Mostrá el precio "${priceTxt}" en una cápsula verde manzana.`;
  }

  // Logo real como 2ª imagen -> copiar exacto. Si no, describirlo.
  const logoInstr = hasLogo
    ? `Hay DOS imágenes adjuntas: la 1ª es el PRODUCTO y la 2ª es el LOGO OFICIAL de ` +
      `UNIPROVEEDORES. Usá EXACTAMENTE ese logo (copialo tal cual: engranaje, rayo, ` +
      `colores y tipografía), sin redibujarlo ni deformarlo, ubicado como remate ABAJO ` +
      `centrado (o como banda superior), bien visible. `
    : `Poné el logo de UNIPROVEEDORES (engranaje metálico con rayo verde manzana, "UNI" ` +
      `verde + "PROVEEDORES" gris, industrial bold con contorno negro) abajo centrado. `;

  const specTxt = (spec || '').trim();
  const tagTxt = (tagline || '').trim();

  return (
    `Diseñá una PLACA PUBLICITARIA tipo INFOGRAFÍA de ecommerce, profesional, moderna, ` +
    `estilo folleto de ferretería, alto impacto comercial y muy vendedora. ` +
    `PRODUCTO: usá EXACTAMENTE el de la PRIMERA imagen adjunta como protagonista central, ` +
    `grande y nítido${productName ? ' ("' + productName + '")' : ''} — mismísima forma, color, ` +
    `marca y detalles reales, IDÉNTICO, sin inventarlo, deformarlo ni pegarle textos encima. ` +
    `MAQUETA (de arriba hacia abajo): ` +
    `1) Título grande en tipografía industrial extra-bold: "${(productName || 'PRODUCTO').toUpperCase()}"` +
    (specTxt ? `, con un subtítulo/medalla destacando "${specTxt}". ` : `. `) +
    (tagTxt ? `2) Frase gancho llamativa: "${tagTxt}". ` : ``) +
    `3) El producto en el centro, protagonista. ` +
    `4) Una BANDA con 3 palabras clave separadas por puntos (ej: "RESISTENTE · SEGURO · FÁCIL DE USAR"). ` +
    `5) Fila de ${f.length} FEATURES, cada una con un ícono lineal simple en círculo verde manzana y su texto corto: ` +
    f.map(x => '"' + x + '"').join(', ') + '. ' +
    (u.length ? `6) Sección "IDEAL PARA:" con ${u.length} íconos y etiquetas: ` + u.map(x => '"' + x + '"').join(', ') + '. ' : ``) +
    logoInstr +
    `ESTILO: fondo oscuro/negro con toques gris metálico; paleta de marca OBLIGATORIA ` +
    `verde manzana #A4D72B (estrella), gris metálico #9AA0A6, negro #0D0D0D y blanco; ` +
    `el verde brilla sobre el negro; detalles industriales (hexágonos, brochazos). ` +
    promo +
    ` TODO el texto correctamente escrito en español, ortografía perfecta, tipografía ` +
    `industrial bold, prolijo y legible, bien alineado y con jerarquía visual clara. ` +
    `Resultado nivel agencia, listo para publicar en Mercado Libre y redes.`
  );
}

// ---- PASO 1: Gemini texto -> brief {product, spec, tagline, features[4], usos[]} ----
function geminiBrief(GK, { productName, price, photoDesc, mlDesc, photoB64, photoMime }) {
  return new Promise((resolve, reject) => {
    const parts = [];
    if (photoB64) parts.push({ inline_data: { mime_type: photoMime || 'image/jpeg', data: photoB64 } });
    parts.push({
      text:
        `Sos redactor publicitario de una ferretería/distribuidora argentina. ` +
        `Producto: "${productName || '(mirá la foto)'}"${price ? ', precio ' + price : ''}. ` +
        (photoDesc ? `Notas: ${photoDesc}. ` : ``) +
        (mlDesc ? `Descripción de Mercado Libre (usala para specs y usos reales): """${String(mlDesc).slice(0, 1500)}""" ` : ``) +
        `Devolvé SOLO un JSON con esta forma exacta: ` +
        `{"product":"nombre corto y comercial","spec":"medida o atributo estrella corto (ej '1.5 metros','x4','18mm') o ''",` +
        `"tagline":"frase gancho corta con signos de exclamación","features":["4 beneficios cortos, máx 3 palabras c/u"],` +
        `"usos":["4 a 6 usos/ideal para, 1 palabra c/u (ej Motos, Autos, Bicicletas, Equipaje)"]}. ` +
        `Todo real y coherente con el producto, en español de Argentina. Nada fuera del JSON.`,
    });
    const body = JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 600, temperature: 0.7, thinkingConfig: { thinkingBudget: 0 } },
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
          resolve({
            product: obj.product || '',
            spec: obj.spec || '',
            tagline: obj.tagline || '',
            features: Array.isArray(obj.features) ? obj.features : [],
            usos: Array.isArray(obj.usos) ? obj.usos : [],
          });
        } catch (e) { reject(e); }
      });
    });
    r.on('error', reject);
    r.setTimeout(20000, () => { r.destroy(); reject(new Error('Timeout brief')); });
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
