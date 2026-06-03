// Brain del bot: recibe un mensaje normalizado y devuelve la respuesta.
// Es usado tanto por webhook (Meta y open-wa bridge) como para test desde el panel.
// El mensaje normalizado tiene la forma: { from, text, name }.

import { httpRequest } from '../_http.js';

// Reglas de FAQ por keyword. Se matchea con palabras sueltas (no substring) en
// el texto en minusculas. Si quieren editar respuestas, tocan acá y redeploy.
const FAQ = [
  {
    keys: ['horario', 'horarios', 'abierto', 'abren', 'cierran', 'atencion', 'atienden'],
    reply: '🕐 *Horarios de atención*\nLunes a viernes de 9 a 18 hs.\nSábados de 9 a 13 hs.\n\n¿En qué más puedo ayudarte?'
  },
  {
    keys: ['pago', 'pagos', 'tarjeta', 'efectivo', 'transferencia', 'mercadopago', 'mercado pago', 'cuotas'],
    reply: '💳 *Formas de pago*\n• Transferencia bancaria\n• Mercado Pago (hasta 12 cuotas)\n• Efectivo en local\n• Tarjetas de crédito y débito\n\n¿Necesitás el CBU o link de pago?'
  },
  {
    keys: ['envio', 'envios', 'envian', 'mandan', 'flete', 'correo', 'andreani', 'oca'],
    reply: '📦 *Envíos*\nHacemos envíos a todo el país por:\n• Mercado Envíos (más rápido)\n• Andreani / OCA\n• Moto Flex (CABA y GBA, mismo día)\n\nDecime tu CP y te paso costo + tiempo.'
  },
  {
    keys: ['donde estan', 'direccion', 'local', 'sucursal', 'ubicacion', 'mapa'],
    reply: '📍 *Nuestro local*\nUNIPROVEEDORES — BP IMPORT SRL\nConsultanos la dirección por privado.\n\nTambién podés retirar por sucursal o coordinar envío.'
  },
  {
    keys: ['cambio', 'cambios', 'devolucion', 'devoluciones', 'garantia', 'roto', 'falla'],
    reply: '🔄 *Cambios y devoluciones*\nTenés 10 días corridos desde la recepción para cambiar tu producto. Debe estar sin uso y con su embalaje original.\nGarantía oficial del fabricante en todos los productos.\n\nContame qué pasó con tu compra.'
  },
  {
    keys: ['factura', 'factura a', 'a b', 'consumidor final', 'iva'],
    reply: '🧾 *Facturación*\nEmitimos factura A y B. Pasame por privado:\n• Razón social\n• CUIT\n• Domicilio fiscal\nY te emitimos sin problema.'
  }
];

function matchFAQ(text) {
  const lower = text.toLowerCase();
  for (const f of FAQ) {
    if (f.keys.some(k => lower.includes(k))) return f.reply;
  }
  return null;
}

// Tracking: extrae numero de orden y consulta ML
async function maybeTrackOrder(text) {
  // Buscamos patrones: #123, orden 123, pedido 123, o numero solo de 9-13 digitos
  const m = text.match(/(?:#|orden\s*|pedido\s*|n[°º]\s*)(\d{4,15})/i) ||
            text.match(/\b(\d{9,13})\b/);
  if (!m) return null;
  const orderId = m[1];
  // TODO: cuando esté la tabla de mapeo, llamamos a /api/ml o /api/tn para
  // resolver el estado. Por ahora respondemos con placeholder para no romper.
  return '📦 *Consulta sobre orden #' + orderId + '*\nEstoy revisando el estado de tu pedido. En unos minutos te confirmo por acá.\n\n_Si es urgente avisanos al alta_';
}

// Catalogo: si pregunta "tenes X" o "precio de X" intentamos detectar producto
function maybeCatalogQuery(text) {
  const lower = text.toLowerCase();
  const patterns = [
    /tene[ns]\s+(.+?)(?:[.?!,]|$)/i,
    /tienen\s+(.+?)(?:[.?!,]|$)/i,
    /hay\s+(.+?)(?:[.?!,]|$)/i,
    /precio\s+(?:de\s+)?(.+?)(?:[.?!,]|$)/i,
    /cuanto\s+(?:sale|cuesta|vale)\s+(?:el\s+|la\s+|los\s+|las\s+)?(.+?)(?:[.?!,]|$)/i,
    /busco\s+(.+?)(?:[.?!,]|$)/i,
    /necesito\s+(.+?)(?:[.?!,]|$)/i
  ];
  for (const p of patterns) {
    const m = lower.match(p);
    if (m && m[1]) {
      const producto = m[1].trim().replace(/[?!.]/g, '');
      if (producto.length >= 3 && producto.length <= 50) {
        // TODO: integrar busqueda en inventario ML/TN
        return '🔍 Estoy buscando "*' + producto + '*" en nuestro stock. En un momento te paso opciones disponibles con precio y foto.';
      }
    }
  }
  return null;
}

// Triage con Gemini: clasifica el tipo de mensaje cuando no matcheo nada local
async function triageWithIA(text, name) {
  const GK = (process.env.GEMINI_API_KEY || '').trim();
  if (!GK) return { category: 'desconocido', reply: null };

  const prompt = 'Sos un clasificador de mensajes de WhatsApp para una tienda online (UNIPROVEEDORES). ' +
    'El cliente "' + (name || 'desconocido') + '" escribió: "' + text + '"\n\n' +
    'Devolveme JSON con esta forma exacta:\n' +
    '{"category": "venta|soporte|reclamo|spam|saludo|otro", "needs_human": true|false, "suggested_reply": "respuesta corta y amable en español rioplatense que el bot puede mandar si needs_human es false, o null si needs_human es true"}\n\n' +
    'Reglas: si es un saludo simple (hola, buenas), devolvé saludo + suggested_reply con un saludo amable preguntando en qué ayudás. ' +
    'Si pide algo concreto que requiere humano (cotización custom, problema serio, reclamo), needs_human=true. ' +
    'Si es spam o boludez, category=spam, needs_human=false, suggested_reply=null. ' +
    'Solo JSON, sin markdown ni explicaciones.';

  try {
    const r = await httpRequest('POST',
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + GK,
      { 'Content-Type': 'application/json' },
      { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, responseMimeType: 'application/json' } }
    );
    const out = r.body?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const parsed = JSON.parse(out);
    return parsed;
  } catch (e) {
    return { category: 'desconocido', needs_human: true, suggested_reply: null };
  }
}

export async function processMessage(msg) {
  const { from, text, name } = msg;
  if (!text || !text.trim()) return { reply: null, category: 'vacio' };

  // 1. FAQ por keyword (mas rapido y barato)
  const faq = matchFAQ(text);
  if (faq) return { reply: faq, category: 'faq' };

  // 2. Tracking
  const track = await maybeTrackOrder(text);
  if (track) return { reply: track, category: 'tracking', needs_human: true };

  // 3. Catalogo
  const cat = maybeCatalogQuery(text);
  if (cat) return { reply: cat, category: 'catalogo', needs_human: true };

  // 4. Triage IA + fallback
  const triage = await triageWithIA(text, name);
  return {
    reply: triage.suggested_reply || null,
    category: triage.category || 'otro',
    needs_human: !!triage.needs_human
  };
}
