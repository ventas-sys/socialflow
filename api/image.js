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

  const { platform, productName, price, badge, photoDesc, mlDesc, briefOnly, quality, photoB64, photoMime } = req.body || {};
  const q = (['high', 'medium', 'low'].includes(quality)) ? quality : 'high';
  const OK = (process.env.OPENAI_API_KEY || '').trim();
  const GK = (process.env.GEMINI_API_KEY || '').trim();
  if (!briefOnly && !OK && !GK) return res.status(500).json({ error: 'Falta OPENAI_API_KEY o GEMINI_API_KEY' });
  if (briefOnly && !GK) return res.status(500).json({ error: 'Falta GEMINI_API_KEY' });

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

  // Modo BRIEF: devolver solo el texto para que el front arme la plantilla (Plan B).
  if (briefOnly) {
    return res.status(200).json({
      ok: true,
      brief: { product: prodLabel, spec: brief.spec || '', tagline: brief.tagline || '', features, usos },
    });
  }

  const logo = (LOGO_B64 && LOGO_B64.length > 100) ? { b64: LOGO_B64, mime: LOGO_MIME || 'image/png' } : null;
  const prompt = buildAdPrompt({
    productName: prodLabel, titulo: brief.titulo || '', price, badge, hasLogo: !!logo,
    spec: brief.spec || '', tagline: brief.tagline || '',
    contexto: brief.contexto || '', sello: brief.sello || '', tipo: brief.tipo || '',
    materiales: brief.materiales || [], virtudes: brief.virtudes || [], usos,
  });

  // --- PASO 2: generar la imagen -----------------------------------------
  // Nota: NO mandamos el logo a la IA (lo estampa el front por código, exacto).
  if (photoB64) {
    if (OK) {
      return openaiEdit(res, OK, { photoB64, photoMime, prompt, size: openaiSize(platform), quality: q });
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
// Tamaño de GENERACIÓN de gpt-image-1 (solo admite 1024x1024, 1024x1536, 1536x1024).
// Elegimos el más cercano a la orientación de cada red; el front reformatea
// después al tamaño EXACTO de la red (con relleno desenfocado, sin cortar).
function openaiSize(p) {
  if (p === 'yt' || p === 'tw') return '1536x1024';  // horizontal
  if (p === 'li') return '1024x1024';                // cuadrado
  return '1024x1536';                                // ig / fb / wa / tk -> vertical
}
function geminiAr(p) {
  if (p === 'yt') return '16:9';
  if (p === 'fb') return '1:1';
  return '9:16';
}

// ---- Prompt del cartel (estructura tipo REFERENCIA PH2 del cliente) ---------
function buildAdPrompt({ productName, titulo: tituloIn, price, badge, hasLogo, spec, tagline, contexto, sello, tipo, materiales, virtudes, usos }) {
  const prod = (productName || 'el producto de la foto').trim();
  const titulo = ((tituloIn && tituloIn.trim()) || productName || 'PRODUCTO').toUpperCase();
  const subtitulo = (spec || '').trim();          // cinta subtítulo (modelo/uso)
  const gancho = (tagline || '').trim();
  const ctx = (contexto || 'uso diario, taller y hogar').trim();
  const tipoTxt = (tipo || '').trim();            // hexágono de tipo/modelo (ej PH2)
  const mats = (materiales || []).filter(Boolean).slice(0, 2);
  const usosTxt = (usos || []).slice(0, 5).join(', ');

  // Virtudes como lista de viñetas con tilde (✔), estilo PH2.
  const v = (virtudes || []).slice(0, 4);
  while (v.length < 3) v.push({ t: ['Calce preciso', 'Alta resistencia', 'Mayor durabilidad'][v.length], d: '' });
  const checklist = v.map(x => `✔ ${x.t}${x.d ? ' (' + x.d + ')' : ''}`).join('  ');

  const badgeTxt = (badge || '').trim();
  const priceTxt = (price || '').trim();
  let selloTxt = (sello || '').trim() || 'CALIDAD PREMIUM';
  if (badgeTxt && !/sin|ninguno/i.test(badgeTxt)) selloTxt = badgeTxt.toUpperCase() + (priceTxt ? ' $' + priceTxt.replace(/^\$/, '') : '');

  // El logo real se agrega por código en una barra superior aparte.
  const logoInstr =
    `NO dibujes ningún logo, isotipo ni nombre de marca (el logo se agrega aparte en una barra ` +
    `superior). Dejá aire/margen arriba para que el título no quede pegado al borde.`;

  // Estructura calcada de la referencia PH2 (folleto profesional de ecommerce).
  return (
    `Diseñá un CARTEL PUBLICITARIO PROFESIONAL VERTICAL para ecommerce/ferretería, marca ` +
    `UNIPROVEEDORES, estilo folleto premium de alto impacto (nivel agencia). ` +
    `PRODUCTO: usá EXACTAMENTE el de la PRIMERA imagen adjunta (misma forma, color y detalles ` +
    `reales, sin inventarlo): protagonista grande y nítido en el centro, hiperrealista. ` +
    `FONDO industrial oscuro y cinematográfico (relacionado con ${ctx}), texturas metálicas, ` +
    `profundidad, reflejos, partículas y textura sutil de hexágonos. ` +
    `PALETA de marca obligatoria: VERDE MANZANA LIMA #A4D72B (verde lima, NO amarillo ni dorado), ` +
    `negro, blanco y gris metálico. ${logoInstr} ` +
    `MAQUETA (como un folleto ordenado): ` +
    `• Arriba: TÍTULO enorme en 2 colores (blanco + verde lima), en tipografía industrial ` +
    `condensada MAYÚSCULAS: "${titulo}". ` +
    (subtitulo ? `Debajo, una CINTA/PASTILLA con el subtítulo "${subtitulo}". ` : ``) +
    (gancho ? `Un gancho comercial: "${gancho}". ` : ``) +
    `• A un costado, una LISTA de beneficios con TILDES verdes (✔), bien legible: ${checklist}. ` +
    (tipoTxt ? `• Un HEXÁGONO verde grande con el tipo/modelo "${tipoTxt}". ` : ``) +
    (subtitulo ? `• Un BADGE circular con la medida destacada. ` : ``) +
    `• Un RECUADRO/callout con un PRIMER PLANO del producto y una característica destacada. ` +
    (mats.length ? `• Al pie, ${mats.length} BADGES técnicos con íconos (escudo, hexágono): ` + mats.map(m => '"' + m + '"').join(' y ') + '. ' : ``) +
    (usosTxt ? `• Opcional: una fila de íconos de usos (${usosTxt}). ` : ``) +
    `• Un SELLO comercial que diga "${selloTxt}". ` +
    `Tipografía industrial gruesa condensada en MAYÚSCULAS, jerarquía clara, muy legible desde el ` +
    `teléfono. Ultra HD, iluminación cinematográfica, hiperrealismo, alto contraste, postproducción ` +
    `profesional. TODO el texto perfectamente escrito en español, SIN errores de ortografía.`
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
        `{"product":"nombre corto y comercial",` +
        `"titulo":"título publicitario corto y potente en MAYÚSCULAS (ej PULPOS ELÁSTICOS MULTIUSO)",` +
        `"spec":"subtítulo con MODELO/MEDIDA/COMPATIBILIDAD real (ej '1.5 metros','SET x4 con ganchos','18 mm'); NO inventes; si no hay, ''",` +
        `"tagline":"gancho comercial corto con signos de exclamación (ej ¡Asegurá tu carga en segundos!)",` +
        `"contexto":"contexto de uso real para el fondo (ej 'auto, moto y camping', 'obra y taller')",` +
        `"sello":"sello comercial corto (ej CALIDAD PREMIUM, OFERTA)",` +
        `"tipo":"tipo/modelo corto para un hexágono si aplica (ej 'PH2','1/4\\"','M8'); si no aplica, ''",` +
        `"materiales":["1 o 2 specs técnicas cortas del material/encastre (ej 'ACERO S2 TEMPLADO','ENCASTRE HEX 1/4\\"'); si no hay, []"],` +
        `"virtudes":[{"t":"VIRTUD 1 corta","d":"descripción breve"},{"t":"VIRTUD 2","d":"..."},{"t":"VIRTUD 3","d":"..."}],` +
        `"features":["3 a 4 beneficios cortos, máx 3 palabras c/u"],` +
        `"usos":["4 a 6 usos/ideal para, 1 palabra c/u (ej Moto, Auto, Bici, Camping, Carga)"]}. ` +
        `Todo real y coherente con el producto, ortografía perfecta en español de Argentina. Nada fuera del JSON.`,
    });
    const body = JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 900, temperature: 0.7, thinkingConfig: { thinkingBudget: 0 } },
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
          const virt = Array.isArray(obj.virtudes) ? obj.virtudes.map(x => ({ t: x.t || x.title || '', d: x.d || x.desc || '' })).filter(x => x.t) : [];
          let feats = Array.isArray(obj.features) ? obj.features.filter(Boolean) : [];
          if (!feats.length && virt.length) feats = virt.map(x => x.t);
          resolve({
            product: obj.product || '',
            titulo: obj.titulo || '',
            spec: obj.spec || '',
            tagline: obj.tagline || '',
            contexto: obj.contexto || '',
            sello: obj.sello || '',
            tipo: obj.tipo || '',
            materiales: Array.isArray(obj.materiales) ? obj.materiales.filter(Boolean) : [],
            virtudes: virt,
            features: feats,
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
function openaiEdit(res, key, { photoB64, photoMime, prompt, size, logo, quality }) {
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
      field('quality', quality || 'high'),
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
    r.setTimeout(56000, () => { r.destroy(); res.status(500).json({ error: 'La imagen en calidad alta tardó demasiado (límite de Vercel). Probá de nuevo o usá el Cartel Pro.' }); resolve(); });
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
