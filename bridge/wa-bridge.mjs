#!/usr/bin/env node
/**
 * Bridge whatsapp-web.js <-> SocialFlow.
 *
 * Mantiene la sesion de WhatsApp Web y delega cada mensaje entrante al
 * cerebro en Vercel (/api/wa/webhook). El estado por contacto vive en
 * memoria + se persiste a disco cada 60s.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';

const { Client, LocalAuth } = pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '.state.json');
const WEBHOOK_URL = process.env.WA_WEBHOOK_URL || '';
const TOKEN = process.env.WA_BRIDGE_TOKEN || '';
const SESSION_NAME = process.env.WA_SESSION || 'uniproveedores';
const HUMAN_LABEL_NAME = process.env.WA_HUMAN_LABEL || 'HUMANO';

if (!WEBHOOK_URL) {
  console.error('Falta WA_WEBHOOK_URL en .env');
  process.exit(1);
}

const states = new Map();
const histories = new Map();
const labeledChats = new Set();
let humanLabelId = null;

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

async function resolveHumanLabel(client) {
  try {
    const labels = await client.getLabels();
    const found = (labels || []).find(l => (l.name || '').toUpperCase() === HUMAN_LABEL_NAME.toUpperCase());
    if (found) {
      humanLabelId = found.id;
      console.log(`Etiqueta "${HUMAN_LABEL_NAME}" encontrada: id=${humanLabelId}`);
    } else {
      console.log(`⚠️  Etiqueta "${HUMAN_LABEL_NAME}" no existe en WhatsApp Business. Crearla manualmente.`);
    }
  } catch (e) {
    console.log(`⚠️  No se pudieron leer etiquetas (¿es WhatsApp Business?): ${e.message}`);
  }
}

async function markChatForHuman(client, chatId) {
  if (!humanLabelId) return;
  if (labeledChats.has(chatId)) return;
  try {
    const chat = await client.getChatById(chatId);
    await chat.changeLabels([humanLabelId]);
    labeledChats.add(chatId);
    console.log(`[${chatId}] 🟡 etiqueta HUMANO aplicada`);
  } catch (e) {
    console.error(`No se pudo etiquetar ${chatId}:`, e.message);
  }
}

async function handleIncoming(client, msg) {
  try {
    if (msg.fromMe) return;
    const chat = await msg.getChat();
    if (chat.isGroup) return;
    const from = msg.from;
    const text = msg.body || '';
    console.log(`[${from}] -> ${text.slice(0, 80)}`);
    recordHistory(from, 'user', text);

    const result = await postWebhook(from, text);
    states.set(from, result.state);

    for (const m of (result.messages || [])) {
      if (m.delaySec) await new Promise(r => setTimeout(r, m.delaySec * 1000));
      await client.sendMessage(from, m.body);
      recordHistory(from, 'bot', m.body);
      console.log(`[${from}] <- ${m.body.slice(0, 80)}`);
    }

    if (result.state?.escalated) {
      console.log(`[${from}] *** marcado para humano ***`);
      await markChatForHuman(client, from);
    }
  } catch (e) {
    console.error('handleIncoming error:', e.message);
  }
}

const client = new Client({
  authStrategy: new LocalAuth({ clientId: SESSION_NAME, dataPath: path.join(__dirname, '.wwebjs_auth') }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
    ],
  },
});

client.on('qr', qr => {
  console.log('\n=== Escaneá este QR desde WhatsApp Business del 011-3551-0715 ===');
  console.log('   (Config → Dispositivos vinculados → Vincular un dispositivo)\n');
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => console.log('✅ Autenticado'));
client.on('auth_failure', e => console.error('❌ Falló auth:', e));

client.on('ready', async () => {
  console.log('✅ Bridge listo. Esperando mensajes...');
  await resolveHumanLabel(client);
});

client.on('disconnected', reason => {
  console.error('⚠️  Desconectado:', reason);
  process.exit(1);
});

client.on('message', msg => handleIncoming(client, msg));

client.initialize();
