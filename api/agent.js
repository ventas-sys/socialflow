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
        catch(e) { resolve({ error: 'Parse error: ' + data.substring(0, 200) }); }
      });
    });
    req.on('error', (e) => reject(e));
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout after 30s')); });
    req.write(postData);
    req.end();
  });
}

function extractJson(text) {
  if (!text) return null;
  // Strip code fences
  let t = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  // Find first { and last }
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first === -1 || last === -1) return null;
  try { return JSON.parse(t.substring(first, last + 1)); }
  catch(e) { return null; }
}

function buildPrompt(agent, input) {
  if (agent === 'ml') {
    return `Sos un experto argentino en publicaciones de Mercado Libre. Trabajás para Uniproveedores.com.ar, distribuidora mayorista.

Producto: ${input.name}
Categoría: ${input.cat || 'no especificada'}
Precio ARS: ${input.price || 'no especificado'}
Tipo de publicación: ${input.type || 'clásica'}
Descripción del vendedor: ${input.desc || 'no especificada'}

Generá un listing optimizado para Mercado Libre Argentina. Respondé EXCLUSIVAMENTE con un JSON válido (sin comillas markdown, sin texto extra) con esta estructura exacta:

{
  "title": "título SEO de máximo 60 caracteres, sin mayúsculas sostenidas, con palabra clave principal al inicio",
  "bullets": ["5 puntos clave breves y específicos, beneficios concretos, cada uno menos de 80 caracteres"],
  "description": "descripción larga de 600-1000 caracteres, con saltos de línea, secciones tipo CARACTERÍSTICAS, BENEFICIOS, ENVÍO. Usá emojis simples (✓ 📦 🚚) con moderación. Cerrá con call-to-action y nombre Uniproveedores.",
  "keywords": ["10 palabras clave de búsqueda en ML, una palabra o frase corta cada una"],
  "strategy": "Plan accionable en 4-6 puntos numerados: cómo escalar la publicación, precio sugerido vs competencia, pasos para alcanzar MercadoLíder, tips de reputación. 400-700 caracteres."
}`;
  }

  if (agent === 'tiendanube') {
    return `Sos un experto en e-commerce argentino y SEO. Trabajás para Uniproveedores.com.ar, distribuidora mayorista que vende por Tienda Nube.

Producto: ${input.name}
Categoría: ${input.cat || 'no especificada'}
Precio ARS: ${input.price || 'no especificado'}
Beneficios/características: ${input.desc || 'no especificadas'}
Público objetivo: ${input.target || 'consumidor general argentino'}

Generá una ficha SEO completa para Tienda Nube. Respondé EXCLUSIVAMENTE con un JSON válido (sin markdown, sin texto extra):

{
  "metaTitle": "máximo 60 caracteres, con palabra clave al inicio + marca Uniproveedores al final",
  "metaDesc": "máximo 160 caracteres, gancho + beneficio + call to action, sin clickbait",
  "slug": "slug-en-minusculas-con-guiones-sin-tildes",
  "tags": ["8-12 etiquetas relevantes para búsqueda interna"],
  "htmlDescription": "descripción HTML lista para pegar en TN: usar <h2>, <h3>, <ul><li>, <p>, <strong>. Incluir secciones: descripción gancho, beneficios (lista), modo de uso, qué incluye, garantía. 700-1200 caracteres con tags.",
  "tips": "5-7 tips numerados accionables: cómo configurar pixel Meta + Google Ads, email recuperación de carrito, descuento primera compra, opiniones, fotos producto, envío. 400-700 caracteres."
}`;
  }

  if (agent === 'verification') {
    return `Sos consultor experto en verificación de cuentas y reputación digital para empresas argentinas.

Empresa: ${input.company || 'Uniproveedores.com.ar — distribuidora mayorista argentina'}
Plataforma: ${input.platform}
Tipo: ${input.type}
Requisitos generales: ${input.requirements}

Generá un PLAN PERSONALIZADO accionable en español argentino, sin frases genéricas. Estructurá la respuesta así (texto plano, sin markdown):

PASO A PASO (30-60 días):
1. ...
2. ...
3. ...
(5-8 pasos concretos, fechas estimadas, qué documentación tener lista)

DOCUMENTOS A PREPARAR:
- ...

COSTOS ESTIMADOS EN ARS:
- ...

RIESGO DE RECHAZO Y CÓMO EVITARLO:
- ...

PRÓXIMA ACCIÓN HOY (lo primero que tiene que hacer apenas termine de leer):
...

Sé concreto, técnico, sin relleno. Máximo 1500 caracteres total.`;
  }

  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { agent, input } = req.body || {};
  const GK = (process.env.GEMINI_API_KEY || '').trim();
  if (!GK) return res.status(500).json({ error: 'GEMINI_API_KEY no configurada en Vercel' });
  if (!agent || !input) return res.status(400).json({ error: 'Faltan parámetros: agent + input' });

  const prompt = buildPrompt(agent, input);
  if (!prompt) return res.status(400).json({ error: 'Agente desconocido: ' + agent });

  const isJsonAgent = agent === 'ml' || agent === 'tiendanube';
  const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GK}`;

  try {
    const data = await makeRequest(GEMINI_URL, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: isJsonAgent ? 0.55 : 0.7,
        maxOutputTokens: 4000,
        responseMimeType: isJsonAgent ? 'application/json' : 'text/plain'
      }
    });

    if (data?.error) {
      return res.status(500).json({ error: data.error.message || 'Error API Gemini' });
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    if (isJsonAgent) {
      const parsed = extractJson(text);
      if (!parsed) return res.status(500).json({ error: 'IA respondió fuera de formato. Probá de nuevo.', raw: text.substring(0, 300) });
      return res.status(200).json({ output: parsed });
    }

    return res.status(200).json({ output: text });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
