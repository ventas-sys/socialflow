import https from 'https';
import { cors } from '../_http.js';

function geminiRequest(apiKey, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = {
      hostname: 'generativelanguage.googleapis.com',
      path: '/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    };
    const req = https.request(opts, (r) => {
      let data = '';
      r.on('data', (c) => { data += c; });
      r.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e){ resolve({ error: 'Parse error', raw: data.substring(0,300) }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(45000, () => { req.destroy(); reject(new Error('Timeout 45s')); });
    req.write(payload);
    req.end();
  });
}

function extractJson(text) {
  if (!text) return null;
  let t = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first === -1 || last === -1) return null;
  try { return JSON.parse(t.substring(first, last + 1)); }
  catch(e) { return null; }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { photoB64, mimeType } = req.body || {};
  const GK = (process.env.GEMINI_API_KEY || '').trim();
  if (!GK) return res.status(500).json({ error: 'GEMINI_API_KEY no configurada' });
  if (!photoB64) return res.status(400).json({ error: 'Falta photoB64' });

  const prompt = `Sos un experto en lectura de facturas argentinas (Facturas A, B, C, E, M, ticket fiscal, recibos).

Analiza la imagen adjunta y extraé los datos. Respondé EXCLUSIVAMENTE con un JSON valido (sin markdown, sin texto extra):

{
  "tipoComprobante": "Factura A" | "Factura B" | "Factura C" | "Factura E" | "Ticket" | "Recibo" | "Nota de Credito" | "desconocido",
  "puntoVenta": "00001" (4 digitos o vacio),
  "numeroComprobante": "00001234" (8 digitos o vacio),
  "fechaEmision": "YYYY-MM-DD" (o vacio si no se lee),
  "proveedor": {
    "razonSocial": "nombre completo del proveedor emisor",
    "cuit": "20-12345678-9" o vacio,
    "domicilio": "" o vacio,
    "condicionIva": "Responsable Inscripto" | "Monotributo" | "Exento" | "Consumidor Final" | ""
  },
  "items": [
    {"descripcion": "...", "cantidad": 1, "precioUnitario": 0, "subtotal": 0}
  ],
  "totales": {
    "subtotal": 0,
    "iva21": 0,
    "iva105": 0,
    "ivaOtros": 0,
    "percepciones": 0,
    "total": 0
  },
  "moneda": "ARS" | "USD",
  "formaPago": "Efectivo" | "Transferencia" | "Tarjeta" | "Cuenta Corriente" | "",
  "observaciones": "comentario libre si hay algo relevante",
  "confianza": "alta" | "media" | "baja"
}

REGLAS:
- Los importes en numero plano sin formato (1234.56 no "$1.234,56")
- Si un campo no se ve o no se entiende, dejalo vacio "" o 0
- "confianza" baja si la imagen esta borrosa o cortada
- Si NO es una factura, todos los campos vacios y observaciones explica que es`;

  try {
    const data = await geminiRequest(GK, {
      contents: [{
        parts: [
          { inline_data: { mime_type: mimeType || 'image/jpeg', data: photoB64 } },
          { text: prompt }
        ]
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 4000,
        responseMimeType: 'application/json'
      }
    });

    if (data?.error) return res.status(500).json({ error: data.error.message || 'Error Gemini' });

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    const parsed = extractJson(text);
    if (!parsed) return res.status(500).json({ error: 'IA no devolvio JSON valido', raw: text.substring(0,300) });

    return res.status(200).json({ ok: true, factura: parsed });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
