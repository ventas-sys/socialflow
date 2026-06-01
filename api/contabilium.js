import https from 'https';
import { httpRequest, cors } from './_http.js';

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
    if (data?.error) return res.status(500).json({ error: data.error.message || 'Error Gemini' });
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    const parsed = extractJson(text);
    if (!parsed) return res.status(500).json({ error: 'IA no devolvio JSON valido', raw: text.substring(0,300) });
    return res.status(200).json({ ok: true, factura: parsed });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

async function handleUpload(req, res) {
  const { clientId, clientSecret, factura } = req.body || {};
  if (!clientId || !clientSecret) return res.status(400).json({ ok: false, error: 'Falta clientId/clientSecret' });
  if (!factura) return res.status(400).json({ ok: false, error: 'Falta factura' });

  try {
    const auth = await getContaToken(clientId, clientSecret);
    const token = auth.access_token;

    const tipoMap = {
      'Factura A': 'FCA',
      'Factura B': 'FCB',
      'Factura C': 'FCC',
      'Factura E': 'FCE',
      'Nota de Credito': 'NCA',
      'Ticket': 'TKT',
      'Recibo': 'REC'
    };

    const items = (factura.items || []).map(it => ({
      IdConcepto: it.idConcepto ? Number(it.idConcepto) : 0,
      Cantidad: Number(it.cantidad || 1),
      Concepto: it.descripcion || 'Item',
      PrecioUnitario: Number(it.precioUnitario || it.subtotal || 0),
      Iva: Number(it.iva || 21),
      Bonificacion: 0,
      Codigo: it.codigo || '',
      Tipo: 'P'
    }));

    if (!items.length) {
      items.push({
        IdConcepto: 0,
        Cantidad: 1,
        Concepto: factura.observaciones || 'Compra segun comprobante',
        PrecioUnitario: Number(factura.totales?.total || 0),
        Iva: 21,
        Bonificacion: 0,
        Codigo: '',
        Tipo: 'P'
      });
    }

    const comprobante = {
      TipoFc: tipoMap[factura.tipoComprobante] || 'FCB',
      IdProveedor: Number(factura.proveedor?.idContabilium || 0),
      PuntoVenta: Number(factura.puntoVenta) || 1,
      IDMoneda: factura.moneda === 'USD' ? 1356 : 1355,
      Fecha: factura.fechaEmision || new Date().toISOString().split('T')[0],
      Items: items,
      Observaciones: 'Cargado por Agente Contabilidad Uniproveedores. ' + (factura.observaciones || ''),
      ProveedorRazonSocial: factura.proveedor?.razonSocial || '',
      ProveedorCuit: (factura.proveedor?.cuit || '').replace(/-/g, '')
    };

    // Probamos varios endpoints porque el bot de Contabilium no sabia el exacto para compras
    const endpoints = [
      'https://rest.contabilium.com/api/comprobantescompras/crear',
      'https://rest.contabilium.com/api/compras/crear',
      'https://rest.contabilium.com/api/comprobantes/crear'
    ];

    const attempts = [];
    for (const url of endpoints) {
      const r = await httpRequest('POST', url, {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }, comprobante);

      attempts.push({ url, status: r.status, body: r.body });

      if (r.status === 200 || r.status === 201) {
        return res.status(200).json({
          ok: true,
          comprobanteId: r.body?.Id || r.body?.id,
          result: r.body,
          endpoint: url
        });
      }
      // Si es 401/403 cortamos (problema de auth, no de URL)
      if (r.status === 401 || r.status === 403) break;
    }

    const last = attempts[attempts.length - 1];
    return res.status(200).json({
      ok: false,
      error: last?.body?.Message || last?.body?.message || last?.body?.error_description || ('Todos los endpoints fallaron. Último HTTP ' + last?.status),
      attempts: attempts.map(a => ({ url: a.url, status: a.status, msg: a.body?.Message || a.body?.message || (typeof a.body === 'string' ? a.body.substring(0,200) : null) })),
      sentBody: comprobante
    });
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const action = req.query?.action || req.body?.action || '';
  if (action === 'test') return handleTest(req, res);
  if (action === 'extract') return handleExtract(req, res);
  if (action === 'upload') return handleUpload(req, res);
  return res.status(400).json({ error: 'action requerida: test | extract | upload' });
}
