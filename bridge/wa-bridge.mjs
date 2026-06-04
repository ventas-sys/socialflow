#!/usr/bin/env node
/**
 * Bridge open-wa <-> SocialFlow.
 *
 * Mantiene la sesion de WhatsApp (open-wa-easy-api o @open-wa/wa-automate)
 * y delega cada mensaje al cerebro en la nube (/api/wa/webhook).
 * El estado por contacto vive en memoria + se persiste a disco cada 60s.
 *
 * Uso:
 *   npm install @open-wa/wa-automate dotenv
 *   WA_WEBHOOK_URL=https://TU-VERCEL.vercel.app/api/wa/webhook \
 *   WA_BRIDGE_TOKEN=secreto-fuerte \
 *   node bridge/wa-bridge.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '.state.json');
const WEBHOOK_URL = process.env.WA_WEBHOOK_URL || '';
const TOKEN = process.env.WA_BRIDGE_TOKEN || '';
const SESSION_NAME = process.env.WA_SESSION || 'uniproveedores';

if (!WEBHOOK_URL) {
  console.error('Falta WA_WEBHOOK_URL (apuntar a https://TU-PROYECTO.vercel.app/api/wa/webhook)');
  process.exit(1);
}

const states = new Map();
const histories = new Map();

try {
  if (fs.existsSync(STATE_FILE)) {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    for (const [k, v] of Object.entries(raw.states || {})) states.set(k, v);
    for (const [k, v] of Object.entries(raw.histories || {})) histories.set(k, v);
    console.log(`Estado cargado: ${states.size} contactos`);
  }
} catch (e) { console.error('No se pudo cargar estado previo:', e.message); }

setInterval(() => {
  try {
    const out = { states: Object.fromEntries(states), histories: Object.fromEntries(histories) };
    fs.writeFileSync(STATE_FILE, JSON.stringify(out));
  } catch (e) { console.error('persist fail:', e.message); }
}, 60_000);

async function postWebhook(from, text) {
  const state = states.get(from) || { parentRow: null, fallbackStreak: 0 };
  const history = histories.get(from) || [];
  const body = JSON.stringify({ from, text, state, history: history.slice(-10) });

  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': TOKEN },
    body,
  });
  if (!res.ok) throw new Error(`webhook ${res.status}`);
  return res.json();
}

function recordHistory(from, role, text) {
  const arr = histories.get(from) || [];
  arr.push({ role, text, at: Date.now() });
  if (arr.length > 30) arr.splice(0, arr.length - 30);
  histories.set(from, arr);
}

async function handleIncoming(client, msg) {
  try {
    const from = msg.from;
    const text = msg.body || '';
    if (msg.isGroupMsg || msg.fromMe) return;
    console.log(`[${from}] -> ${text.slice(0, 80)}`);
    recordHistory(from, 'user', text);

    const result = await postWebhook(from, text);
    states.set(from, result.state);

    for (const m of (result.messages || [])) {
      if (m.delaySec) await new Promise(r => setTimeout(r, m.delaySec * 1000));
      await client.sendText(from, m.body);
      recordHistory(from, 'bot', m.body);
      console.log(`[${from}] <- ${m.body.slice(0, 80)}`);
    }

    if (result.state?.escalated) {
      console.log(`[${from}] *** marcado para humano ***`);
    }
  } catch (e) {
    console.error('handleIncoming error:', e.message);
  }
}

async function main() {
  let create;
  try {
    ({ create } = await import('@open-wa/wa-automate'));
  } catch (e) {
    console.error('Falta dependencia: npm install @open-wa/wa-automate');
    process.exit(1);
  }

  const client = await create({
    sessionId: SESSION_NAME,
    multiDevice: true,
    qrTimeout: 0,
    authTimeout: 60,
    headless: true,
    cacheEnabled: false,
    useChrome: false,
    autoRefresh: true,
  });

  client.onMessage(msg => handleIncoming(client, msg));
  console.log('Bridge corriendo. Esperando mensajes...');
}

main().catch(e => { console.error(e); process.exit(1); });
