import nodemailer from 'nodemailer';
import { processMessage } from '../../lib/wa/brain.js';
import { loadRules, menuOptionsAt } from '../../lib/wa/rules.js';

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
    return res.status(200).json({
      ok: true,
      totalRules: data.totalRules,
      roots: data.roots,
      rootOptions: menuOptionsAt(null, data),
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

  if (req.body?.event === 'new-client') {
    try {
      const result = await handleNewClient(req.body);
      return res.status(200).json(result);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  const { from, text, state, history } = req.body || {};
  if (!from || typeof text !== 'string') {
    return res.status(400).json({ error: 'faltan from + text' });
  }

  try {
    const result = await processMessage({ from, text, state, history });
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
