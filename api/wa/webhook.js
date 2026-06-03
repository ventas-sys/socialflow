// Webhook universal de WhatsApp.
// - GET: verificacion de Meta (challenge handshake). Tambien sirve como healthcheck.
// - POST: recibe mensajes entrantes de Meta o del bridge open-wa, procesa con _process
//   y manda la respuesta.

import { cors } from '../_http.js';
import { normalizeIncoming, sendMessage } from '../../lib/wa/provider.js';
import { processMessage } from '../../lib/wa/process.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: verificacion de webhook de Meta
  if (req.method === 'GET') {
    const verifyToken = (process.env.WA_META_VERIFY_TOKEN || '').trim();
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && verifyToken && token === verifyToken) {
      return res.status(200).send(challenge);
    }
    // Si no es handshake, respondemos status simple (healthcheck)
    return res.status(200).json({ ok: true, service: 'whatsapp-webhook' });
  }

  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  // Validamos secret del bridge open-wa para evitar que cualquiera nos POSTee mensajes falsos.
  // Meta no manda este header — para Meta confiamos en el verify_token del handshake.
  const bridgeSecret = (process.env.WA_BRIDGE_SECRET || '').trim();
  const incomingSecret = req.headers['x-bridge-secret'];
  const looksLikeBridge = !req.body?.entry; // Meta siempre manda body.entry
  if (looksLikeBridge && bridgeSecret && incomingSecret !== bridgeSecret) {
    return res.status(401).json({ ok: false, error: 'Bridge secret invalido' });
  }

  const msg = normalizeIncoming(req.body);
  if (!msg) {
    // Puede ser un evento de status (delivered, read) — lo aceptamos en silencio
    return res.status(200).json({ ok: true, ignored: true });
  }

  try {
    const result = await processMessage(msg);

    // Respondemos al cliente si tenemos algo para decir
    let sendResult = null;
    if (result.reply) {
      try {
        sendResult = await sendMessage(msg.from, result.reply);
      } catch (e) {
        sendResult = { error: e.message };
      }
    }

    // Log a stdout para que se vea en Vercel logs (debugging)
    console.log('[WA]', JSON.stringify({ from: msg.from, name: msg.name, text: msg.text.substring(0, 200), category: result.category, replied: !!result.reply, needs_human: !!result.needs_human }));

    return res.status(200).json({
      ok: true,
      from: msg.from,
      text: msg.text,
      category: result.category,
      reply: result.reply,
      needs_human: !!result.needs_human,
      sendResult
    });
  } catch (e) {
    console.error('[WA][error]', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
