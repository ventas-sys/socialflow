import https from 'node:https';
import nodemailer from 'nodemailer';
import { processMessage } from '../../lib/wa/brain.js';
import { loadRules, menuOptionsAt } from '../../lib/wa/rules.js';

let lastBotHeartbeat = null;

// Transcribe una nota de voz de WhatsApp con Gemini 2.5 (soporta audio nativo).
function transcribeAudio(audioB64, mime) {
  return new Promise((resolve, reject) => {
    const key = (process.env.GEMINI_API_KEY || '').trim();
    if (!key) return resolve('');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
    const body = JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: mime || 'audio/ogg', data: audioB64 } },
          { text: 'Transcribí este audio al español rioplatense. Devolvé SOLO el texto transcripto, sin comillas ni explicaciones.' },
        ],
      }],
      generationConfig: { temperature: 0, maxOutputTokens: 500 },
    });
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          resolve((j?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim());
        } catch { resolve(''); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('timeout transcribiendo')); });
    req.write(body); req.end();
  });
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Bridge-Token');
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function handleNewClient(body) {
  const { phone, name, firstMessage, timestamp } = body || {};
  if (!phone) return { ok: false, error: 'falta phone' };

  const gmailUser = (process.env.GMAIL_USER || '').trim();
  const gmailPass = (process.env.GMAIL_APP_PASSWORD || '').trim();
  const notifyTo = (process.env.WA_NEW_CLIENT_NOTIFY_EMAIL || gmailUser).trim();

  if (!gmailUser || !gmailPass) {
    return { ok: true, emailSent: false, reason: 'GMAIL_USER/GMAIL_APP_PASSWORD no configurados' };
  }

  const when = timestamp ? new Date(timestamp).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) : new Date().toLocaleString('es-AR');
  const displayName = name || '(sin nombre guardado)';
  const message = firstMessage || '(sin texto)';
  const waLink = `https://wa.me/${phone.replace(/[^0-9]/g, '')}`;

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: gmailUser, pass: gmailPass },
  });

  const html = `
    <h2 style="color:#25D366;">🆕 Nuevo cliente WhatsApp</h2>
    <table cellpadding="6" style="font-family:Arial,sans-serif;font-size:14px;">
      <tr><td><b>Fecha</b></td><td>${escapeHtml(when)}</td></tr>
      <tr><td><b>Teléfono</b></td><td><a href="${waLink}">+${escapeHtml(phone)}</a></td></tr>
      <tr><td><b>Nombre WhatsApp</b></td><td>${escapeHtml(displayName)}</td></tr>
      <tr><td><b>Primer mensaje</b></td><td style="background:#f5f5f5;padding:8px;border-radius:4px;">${escapeHtml(message)}</td></tr>
    </table>
    <p style="color:#666;font-size:12px;">Registrado automáticamente por SocialFlow (Agente WhatsApp).</p>
  `;

  const info = await transporter.sendMail({
    from: `"SocialFlow WA" <${gmailUser}>`,
    to: notifyTo,
    subject: `🆕 Nuevo cliente WhatsApp: ${displayName} (+${phone})`,
    html,
  });

  return { ok: true, emailSent: true, messageId: info.messageId, to: notifyTo };
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const data = loadRules();
    const bot = lastBotHeartbeat
      ? {
          online: Date.now() - lastBotHeartbeat.at < 180_000,
          lastSeenAt: lastBotHeartbeat.at,
          secondsAgo: Math.round((Date.now() - lastBotHeartbeat.at) / 1000),
          stats: lastBotHeartbeat.stats || {},
        }
      : { online: false, neverSeen: true };
    return res.status(200).json({
      ok: true,
      totalRules: data.totalRules,
      roots: data.roots,
      rootOptions: menuOptionsAt(null, data),
      bot,
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const bridgeToken = (process.env.WA_BRIDGE_TOKEN || '').trim();
  if (bridgeToken) {
    const provided = req.headers['x-bridge-token'] || '';
    const isSim = req.body?.simulate === true;
    if (!isSim && provided !== bridgeToken) {
      return res.status(401).json({ error: 'invalid bridge token' });
    }
  }

  if (req.body?.event === 'heartbeat') {
    lastBotHeartbeat = { at: Date.now(), stats: req.body.stats || {} };
    return res.status(200).json({ ok: true });
  }

  if (req.body?.event === 'new-client') {
    try {
      const result = await handleNewClient(req.body);
      return res.status(200).json(result);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  const { from, state, history, audioB64, mime } = req.body || {};
  let { text } = req.body || {};

  // Si llega una nota de voz, la transcribimos y seguimos el flujo normal.
  let transcribed = null;
  if (audioB64 && typeof audioB64 === 'string') {
    try {
      transcribed = await transcribeAudio(audioB64, mime);
      text = transcribed;
    } catch (e) {
      return res.status(200).json({
        messages: [{ body: 'Perdón, no pude escuchar bien el audio 🙏 ¿Me lo escribís o lo grabás de nuevo?', delaySec: 0 }],
        state: state || { parentRow: null, fallbackStreak: 0 },
        reason: 'audio_transcribe_error',
      });
    }
  }

  if (!from || typeof text !== 'string') {
    return res.status(400).json({ error: 'faltan from + text (o audioB64)' });
  }

  try {
    const result = await processMessage({ from, text, state, history });
    if (transcribed != null) result.transcribed = transcribed;
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
