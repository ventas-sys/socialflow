// Endpoint unico de WhatsApp. Por limite de Vercel free tier consolidamos
// webhook + send en un mismo archivo.
//
// Rutas:
//   GET                         healthcheck + handshake de Meta
//   POST                        mensaje entrante (Meta o bridge open-wa)
//   POST ?action=send           enviar mensaje manual (panel /whatsapp.html)

import { cors } from '../_http.js';
import { normalizeIncoming, sendMessage, getProvider } from '../../lib/wa/provider.js';
import { processMessage } from '../../lib/wa/process.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: verificacion de webhook de Meta + healthcheck
  if (req.method === 'GET') {
    const verifyToken = (process.env.WA_META_VERIFY_TOKEN || '').trim();
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && verifyToken && token === verifyToken) {
      return res.status(200).send(challenge);
    }
    return res.status(200).json({ ok: true, service: 'whatsapp', provider: getProvider() });
  }

  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  // ?action=send -> envio manual desde el panel
  if (req.query?.action === 'send') {
    const { to, text } = req.body || {};
    if (!to || !text) return res.status(400).json({ ok: false, error: 'Falta to o text' });
    const cleanTo = String(to).replace(/[^\d]/g, '');
    if (cleanTo.length < 8) return res.status(400).json({ ok: false, error: 'Numero invalido' });
    try {
      const result = await sendMessage(cleanTo, text);
      return res.status(200).json({ ok: true, ...result });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // POST sin action: mensaje entrante de WhatsApp
  // Validamos secret del bridge open-wa para evitar POSTs falsos.
  // Meta no manda este header — para Meta confiamos en verify_token del handshake.
  const bridgeSecret = (process.env.WA_BRIDGE_SECRET || '').trim();
  const incomingSecret = req.headers['x-bridge-secret'];
  const looksLikeBridge = !req.body?.entry;
  if (looksLikeBridge && bridgeSecret && incomingSecret !== bridgeSecret) {
    return res.status(401).json({ ok: false, error: 'Bridge secret invalido' });
  }

  const msg = normalizeIncoming(req.body);
  if (!msg) {
    return res.status(200).json({ ok: true, ignored: true });
  }

  try {
    const result = await processMessage(msg);

    let sendResult = null;
    if (result.reply) {
      try {
        sendResult = await sendMessage(msg.from, result.reply);
      } catch (e) {
        sendResult = { error: e.message };
      }
    }

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
