import https from 'https';
import { httpRequest, cors } from './_http.js';
// OJO: pdf-lib y nodemailer NO están en package.json — solo los usa el flujo
// de mail a Contabilium, así que se importan dinámicamente dentro de
// handleEmail. Un import estático acá rompe TODA la función (incluido
// action=extract) con FUNCTION_INVOCATION_FAILED.

function geminiVision(apiKey, body) {
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

async function getContaToken(clientId, clientSecret) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret
  }).toString();
  const r = await httpRequest('POST', 'https://rest.contabilium.com/token', {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json'
  }, body);
  if (r.status !== 200 || !r.body?.access_token) {
    throw new Error(r.body?.error_description || r.body?.error || ('Auth failed HTTP ' + r.status));
  }
  return r.body;
}

async function handleTest(req, res) {
  const { clientId, clientSecret } = req.body || {};
  if (!clientId || !clientSecret) return res.status(400).json({ ok: false, error: 'Falta clientId y/o clientSecret' });
  try {
    const auth = await getContaToken(clientId, clientSecret);
    return res.status(200).json({
      ok: true,
      info: { tokenType: auth.token_type, expiresIn: auth.expires_in, scope: auth.scope }
    });
  } catch(e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
}

async function handleExtract(req, res) {
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
    {"codigo": "codigo/SKU del articulo si figura en el renglon, sino vacio", "descripcion": "...", "cantidad": 1, "precioUnitario": 0, "subtotal": 0}
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
    const data = await geminiVision(GK, {
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
    if (data?.error) return res.status(500).json({ error: data.error.message || 'Error Gemini', detail: data.error });
    const candidate = data?.candidates?.[0];
    const finishReason = candidate?.finishReason;
    const blockReason = data?.promptFeedback?.blockReason;
    const text = candidate?.content?.parts?.[0]?.text?.trim() || '';

    if (blockReason) {
      return res.status(500).json({ error: 'Gemini bloqueo la imagen: ' + blockReason, detail: data.promptFeedback });
    }
    if (finishReason && finishReason !== 'STOP' && !text) {
      return res.status(500).json({ error: 'Gemini termino con motivo "' + finishReason + '" sin devolver texto. Probable causa: imagen muy grande, bloqueo de safety o limite de tokens.', finishReason });
    }
    if (!text) {
      return res.status(500).json({ error: 'Gemini devolvio respuesta vacia', rawResponse: JSON.stringify(data).substring(0,500) });
    }

    const parsed = extractJson(text);
    if (!parsed) return res.status(500).json({ error: 'IA no devolvio JSON valido', raw: text.substring(0,500), finishReason });
    return res.status(200).json({ ok: true, factura: parsed });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

// Soporte de Contabilium (Leydy Pulgarin, 2026-06-01) confirmó que la API REST
// no expone POST para crear comprobantes de compra. Pero descubrimos que tienen
// importación por mail: enviando un PDF al inbox <CUIT>@compras.contabilium.com,
// su propia IA lee la factura y la deja lista para importar en su web.
// handleEmail toma la foto, la envuelve en un PDF y la manda por Gmail SMTP.

async function imageToPdfBytes(photoB64, mimeType) {
  const { PDFDocument } = await import('pdf-lib');
  const imgBytes = Buffer.from(photoB64, 'base64');
  const pdf = await PDFDocument.create();
  const isPng = (mimeType || '').toLowerCase().includes('png');
  const img = isPng ? await pdf.embedPng(imgBytes) : await pdf.embedJpg(imgBytes);
  const maxDim = 1700; // A4-ish a 200dpi para que pese poco
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = img.width * scale, h = img.height * scale;
  const page = pdf.addPage([w, h]);
  page.drawImage(img, { x: 0, y: 0, width: w, height: h });
  return Buffer.from(await pdf.save());
}

async function handleEmail(req, res) {
  const { photoB64, mimeType, inbox, subject } = req.body || {};
  const gmailUser = (process.env.GMAIL_USER || '').trim();
  const gmailPass = (process.env.GMAIL_APP_PASSWORD || '').trim();

  if (!gmailUser || !gmailPass) return res.status(500).json({ ok: false, error: 'GMAIL_USER y GMAIL_APP_PASSWORD no configuradas en Vercel' });
  if (!photoB64) return res.status(400).json({ ok: false, error: 'Falta photoB64' });
  if (!inbox || !/@compras\.contabilium\.com$/i.test(inbox)) return res.status(400).json({ ok: false, error: 'Inbox de Contabilium invalido. Formato esperado: <CUIT>@compras.contabilium.com' });

  try {
    let pdfBuf;
    if ((mimeType || '').toLowerCase().includes('pdf')) {
      pdfBuf = Buffer.from(photoB64, 'base64');
    } else {
      pdfBuf = await imageToPdfBytes(photoB64, mimeType);
    }

    const nodemailer = (await import('nodemailer')).default;
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailPass }
    });

    const filename = 'factura-' + Date.now() + '.pdf';
    const info = await transporter.sendMail({
      from: gmailUser,
      to: inbox,
      subject: subject || 'Factura compra ' + new Date().toLocaleString('es-AR'),
      text: 'Enviado automaticamente por SocialFlow (Agente Contabilidad).',
      attachments: [{ filename, content: pdfBuf, contentType: 'application/pdf' }]
    });

    return res.status(200).json({ ok: true, messageId: info.messageId, sentTo: inbox, pdfSize: pdfBuf.length, filename });
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message, code: e.code });
  }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const action = req.query?.action || req.body?.action || '';
  if (action === 'test') return handleTest(req, res);
  if (action === 'extract') return handleExtract(req, res);
  if (action === 'email') return handleEmail(req, res);
  return res.status(400).json({ error: 'action requerida: test | extract | email' });
}
