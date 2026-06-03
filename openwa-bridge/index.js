// Bridge entre WhatsApp Web (open-wa) y SocialFlow (Vercel).
//
// Flujo:
//   WhatsApp -> open-wa -> POST {VERCEL_WEBHOOK_URL} -> {reply:"..."} -> open-wa -> WhatsApp
//   Panel SocialFlow -> POST /send a este bridge -> open-wa -> WhatsApp
//
// Variables de entorno requeridas:
//   VERCEL_WEBHOOK_URL  URL absoluta del webhook (ej https://socialflow-flax.vercel.app/api/wa/webhook)
//   BRIDGE_SECRET       Secret compartido para autenticar con Vercel (debe coincidir con WA_BRIDGE_SECRET)
//   PORT                Puerto donde escucha el bridge (default 3000)
//   SESSION_ID          Nombre de la sesion de open-wa (default "uniproveedores")

import { create } from '@open-wa/wa-automate';
import express from 'express';
import fetch from 'node-fetch';

const VERCEL_WEBHOOK_URL = (process.env.VERCEL_WEBHOOK_URL || '').trim();
const BRIDGE_SECRET = (process.env.BRIDGE_SECRET || '').trim();
const PORT = parseInt(process.env.PORT || '3000', 10);
const SESSION_ID = process.env.SESSION_ID || 'uniproveedores';

if (!VERCEL_WEBHOOK_URL) {
  console.error('FATAL: falta env var VERCEL_WEBHOOK_URL');
  process.exit(1);
}

let waClient = null;
let lastQr = null;
let waReady = false;

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'socialflow-openwa-bridge',
    ready: waReady,
    hasQr: !!lastQr,
    session: SESSION_ID
  });
});

// Devuelve el QR de WhatsApp para escanear desde el celu. Se accede desde /qr en el navegador.
app.get('/qr', (_req, res) => {
  if (waReady) return res.send('<h2>WhatsApp ya conectado ✅</h2><p>Sesion: ' + SESSION_ID + '</p>');
  if (!lastQr) return res.send('<h2>Esperando QR...</h2><p>Refrescá en unos segundos.</p>');
  res.send('<html><body style="background:#0a0a16;color:#fff;font-family:sans-serif;text-align:center;padding:20px;">' +
    '<h2>Escanea con WhatsApp</h2>' +
    '<img src="' + lastQr + '" style="max-width:400px;background:#fff;padding:10px;border-radius:10px;"/>' +
    '<p>WhatsApp en tu celu → ⋮ → Dispositivos vinculados → Vincular dispositivo</p>' +
    '</body></html>');
});

app.post('/send', async (req, res) => {
  if (BRIDGE_SECRET && req.headers['x-bridge-secret'] !== BRIDGE_SECRET) {
    return res.status(401).json({ ok: false, error: 'Secret invalido' });
  }
  if (!waReady || !waClient) return res.status(503).json({ ok: false, error: 'WhatsApp no conectado todavia' });

  const { to, text } = req.body || {};
  if (!to || !text) return res.status(400).json({ ok: false, error: 'Falta to o text' });

  const cleanTo = String(to).replace(/[^\d]/g, '');
  const chatId = cleanTo + '@c.us';

  try {
    const id = await waClient.sendText(chatId, text);
    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => console.log('[bridge] HTTP escuchando en ' + PORT));

create({
  sessionId: SESSION_ID,
  multiDevice: true,
  authTimeout: 60,
  blockCrashLogs: true,
  disableSpins: true,
  headless: true,
  hostNotificationLang: 'PT_BR',
  logConsole: false,
  popup: false,
  qrTimeout: 0,
  qrCallback: (qrBase64) => {
    lastQr = qrBase64;
    console.log('[bridge] QR generado — abrí /qr en el navegador del bridge');
  }
}).then(client => {
  waClient = client;
  waReady = true;
  console.log('[bridge] WhatsApp conectado, sesion ' + SESSION_ID);

  client.onMessage(async (message) => {
    // Ignoramos status updates, mensajes de grupos por ahora, y stickers/media
    if (message.isGroupMsg) return;
    if (message.type !== 'chat') return; // solo texto por ahora

    const payload = {
      from: message.from.replace('@c.us', ''),
      text: message.body || '',
      name: message.sender?.pushname || message.sender?.formattedName || ''
    };

    try {
      const r = await fetch(VERCEL_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Bridge-Secret': BRIDGE_SECRET },
        body: JSON.stringify(payload)
      });
      const data = await r.json();
      console.log('[bridge] ' + payload.from + ' "' + payload.text.substring(0, 60) + '" -> ' + data.category + (data.reply ? ' [replied]' : ''));
      // Si Vercel ya mando el reply via /send, no hacemos nada.
      // Si solo devolvio { reply } sin mandar (modo eco), lo mandamos nosotros:
      if (data.reply && !data.sendResult?.status) {
        await client.sendText(message.from, data.reply);
      }
    } catch (e) {
      console.error('[bridge] error procesando mensaje:', e.message);
    }
  });
}).catch(err => {
  console.error('[bridge] FATAL al iniciar open-wa:', err.message);
  process.exit(1);
});
