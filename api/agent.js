import https from 'https';
import { keyTexto } from '../lib/gemini-keys.js';

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

  if (agent === 'youtube') {
    return `Sos guionista de videos cortos de venta (YouTube Shorts) para Uniproveedores.com.ar, distribuidora argentina que vende en Mercado Libre. Los videos los narra un avatar IA (un "ferretero del mostrador") y sirven para vender un producto puntual mandando al link de compra.

Producto: ${input.name}
Precio ARS: ${input.price || 'no especificado'}
Diferencial: ${input.diff || 'envío y garantía de Mercado Libre'}
Link de compra: ${input.link || 'no especificado'}
Público: ${input.target || 'consumidor general argentino'}

Escribí todo en español rioplatense (Argentina), tono cercano, directo y vendedor, con gancho fuerte en los primeros 3 segundos. Respondé EXCLUSIVAMENTE con un JSON válido (sin markdown, sin texto extra) con esta estructura exacta:

{
  "guion": "Guion hablado de 38-45 segundos, máximo 110 palabras, para que el avatar lo diga tal cual. Estructura: gancho (pregunta o dolor) → qué es el producto → 2-3 beneficios concretos → precio + garantía Mercado Libre → llamado a la acción al link. SIN emojis, SIN acotaciones de escena, SIN nombres de secciones. Escribí el precio en números (ej: 73.140 pesos).",
  "captions": ["Frases cortas de 3 a 6 palabras que son el MISMO guion partido para subtítulos, en orden. 10-16 items. Sin emojis."],
  "titles": ["3 títulos para el Short, cada uno máximo 60 caracteres, con 1 emoji, con gancho y beneficio"],
  "description": "Descripción lista para pegar en YouTube. Primera línea: 🛒 Comprá [producto] acá 👉 ${input.link || '[link de Mercado Libre]'} . Después 2-3 líneas de beneficios con ✅ y la garantía de Mercado Libre. Cerrá con 'Más ofertas de Uniproveedores en cada video'. NO incluyas los hashtags acá.",
  "hashtags": ["7-9 hashtags relevantes en minúscula sin espacios, incluyendo #uniproveedores #mercadolibre #argentina y otros según el producto"],
  "comment": "Comentario para fijar: 👉 Link de compra: ${input.link || '[link de Mercado Libre]'}"
}`;
  }

  if (agent === 'verification') {
    return `Sos consultor senior en verificacion de cuentas, reputacion digital y trust signals para empresas argentinas. Trabajas para Uniproveedores.com.ar.

Empresa: ${input.company || 'Uniproveedores.com.ar — distribuidora mayorista argentina'}
Plataforma: ${input.platform}
Tipo: ${input.type}
Requisitos generales: ${input.requirements}

Genera un PLAN ESTRATEGICO COMPLETO y accionable en espanol argentino, sin frases genericas. Pensalo como si lo armaras para presentar al directorio: tiene que cubrir desde el "por que" hasta el ultimo detalle operativo.

Usa exactamente este formato (texto plano, sin markdown, sin emojis decorativos):

=== POR QUE CONVIENE VERIFICAR ===
3-4 lineas con el ROI concreto: incremento esperado de conversion, autoridad, alcance, indexacion, costo de oportunidad de NO verificarse. Numeros aproximados si los hay.

=== ESTADO INICIAL Y BRECHA ===
- Que se necesita cumplir vs que probablemente ya tenga la empresa.
- 3-5 puntos especificos a auditar antes de aplicar.

=== ROADMAP DIA POR DIA ===
SEMANA 1 (dias 1-7):
- Dia 1: ...
- Dia 2-3: ...
- Dia 4-7: ...
SEMANA 2 (dias 8-14): ...
SEMANA 3-4 (dias 15-30): ...
DIA DE LA APLICACION: ...
(Total 8-15 pasos concretos con fechas y entregables por paso)

=== DOCUMENTOS Y EVIDENCIAS A PREPARAR ===
Lista numerada. Por cada documento:
- Nombre
- Donde obtenerlo (link/oficina/sistema)
- Formato requerido (PDF, JPG, tamano max)
- Tiempo estimado para conseguirlo

=== COSTOS DETALLADOS EN ARS (cotizacion mayo 2026) ===
- Costo mensual/anual de la verificacion oficial
- Costos indirectos (sesion fotos, redactor, gestor)
- Inversion en contenido previo para fortalecer cuenta
- Total minimo y total recomendado

=== KPIs Y OBJETIVOS MEDIBLES (60 dias post verificacion) ===
3-5 metricas con valor objetivo: ej "alcance organico +30%", "tasa de respuesta DM <2h", "rating promedio >=4.7", etc.

=== RIESGOS DE RECHAZO Y MITIGACION ===
Top 5 razones por las que rechazan en esta plataforma, con accion preventiva concreta para cada una.

=== PLAN B (si te rechazan) ===
- Tiempo de espera antes de reintentar
- Que cambiar entre intento 1 y 2
- Vias alternativas (partners, programas oficiales, agencias)

=== CHECKLIST FINAL PRE-APLICACION ===
12-18 items binarios (SI/NO) que la empresa debe poder responder "SI" antes de mandar la solicitud.

=== PROXIMA ACCION CONCRETA EN LAS PROXIMAS 2 HORAS ===
Una sola tarea ultra-especifica que el responsable tiene que hacer apenas termine de leer este plan. Que abra, que pegue, que botone tocar.

Estilo: tecnico, directo, argentino formal. Sin saludos, sin disclaimer, sin "espero te sirva". Cero relleno. Maximo 4500 caracteres totales.`;
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
  const GK = keyTexto();
  if (!GK) return res.status(500).json({ error: 'GEMINI_API_KEY no configurada en Vercel (ni GEMINI_API_KEY_TEXTO)' });
  if (!agent || !input) return res.status(400).json({ error: 'Faltan parámetros: agent + input' });

  const prompt = buildPrompt(agent, input);
  if (!prompt) return res.status(400).json({ error: 'Agente desconocido: ' + agent });

  const isJsonAgent = agent === 'ml' || agent === 'tiendanube' || agent === 'youtube';
  const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GK}`;

  try {
    const data = await makeRequest(GEMINI_URL, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: isJsonAgent ? 0.55 : 0.7,
        maxOutputTokens: isJsonAgent ? 4000 : 8000,
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
