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
const HUMAN_TAKEOVER_HOURS = Number(process.env.WA_HUMAN_TAKEOVER_HOURS || 3);
const AUTOREPLY_WINDOW_MS = Number(process.env.WA_AUTOREPLY_MS || 3000);
const FOLLOWUP_MINUTES = Number(process.env.WA_FOLLOWUP_MINUTES || 60);
const NEW_CLIENTS_CSV = path.join(__dirname, 'new-clients.csv');

if (!WEBHOOK_URL) {
  console.error('Falta WA_WEBHOOK_URL en .env');
  process.exit(1);
}

const states = new Map();
const histories = new Map();
const labeledChats = new Set();
const humanHandled = new Map();
const lastActivityAt = new Map();
const lastIncomingAt = new Map();
const botSentRecent = [];
const followupSent = new Map();
const knownContacts = new Set();
let humanLabelId = null;

try {
  if (fs.existsSync(STATE_FILE)) {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    for (const [k, v] of Object.entries(raw.states || {})) states.set(k, v);
    for (const [k, v] of Object.entries(raw.histories || {})) histories.set(k, v);
    for (const [k, v] of Object.entries(raw.humanHandled || {})) humanHandled.set(k, v);
    for (const k of (raw.knownContacts || [])) knownContacts.add(k);
    console.log(`Estado cargado: ${states.size} contactos · ${humanHandled.size} con asesor activo · ${knownContacts.size} ya conocidos`);
  }
} catch (e) { console.error('No se pudo cargar estado previo:', e.message); }

setInterval(() => {
  try {
    const now = Date.now();
    for (const [k, v] of humanHandled.entries()) {
      if (!v?.until || v.until < now) humanHandled.delete(k);
    }
    const out = {
      states: Object.fromEntries(states),
      histories: Object.fromEntries(histories),
      humanHandled: Object.fromEntries(humanHandled),
      knownContacts: Array.from(knownContacts),
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(out));
  } catch (e) { console.error('persist fail:', e.message); }
}, 60_000);

function isAsesorActive(chatId) {
  const h = humanHandled.get(chatId);
  if (!h?.until) return false;
  if (h.until < Date.now()) { humanHandled.delete(chatId); return false; }
  return true;
}

function markAsesorActive(chatId) {
  const until = Date.now() + HUMAN_TAKEOVER_HOURS * 3_600_000;
  humanHandled.set(chatId, { until });
  followupSent.delete(chatId);
  const mins = HUMAN_TAKEOVER_HOURS * 60;
  console.log(`[${chatId}] 🧑 asesor humano respondió — bot silenciado por ${mins}min`);
}

async function logNewClientIfFirst(client, msg) {
  const from = msg.from;
  if (knownContacts.has(from)) return;
  knownContacts.add(from);

  let name = '';
  try {
    const contact = await msg.getContact();
    name = contact.pushname || contact.shortName || contact.name || contact.number || '';
  } catch {}

  const timestamp = new Date().toISOString();
  const phone = from.split('@')[0];
  const firstMessage = (msg.body || '').slice(0, 200).replace(/[\r\n]/g, ' ');

  try {
    if (!fs.existsSync(NEW_CLIENTS_CSV)) {
      fs.writeFileSync(NEW_CLIENTS_CSV, 'timestamp,phone,name,first_message\n');
    }
    const csvLine = [
      timestamp,
      phone,
      `"${name.replace(/"/g, '""')}"`,
      `"${firstMessage.replace(/"/g, '""')}"`,
    ].join(',') + '\n';
    fs.appendFileSync(NEW_CLIENTS_CSV, csvLine);
  } catch (e) { console.error('CSV append fail:', e.message); }

  console.log(`[${from}] 🆕 cliente nuevo: ${name || '(sin nombre)'} → ${firstMessage.slice(0, 50)}`);

  notifyNewClient({ phone, name, firstMessage, timestamp }).catch(e =>
    console.error('notifyNewClient fail:', e.message)
  );
}

async function notifyNewClient(data) {
  if (!WEBHOOK_URL) return;
  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': TOKEN },
      body: JSON.stringify({ event: 'new-client', ...data }),
    });
  } catch (e) { console.error('webhook new-client fail:', e.message); }
}

async function sendFollowupIfDue(client) {
  const now = Date.now();
  const cutoff = FOLLOWUP_MINUTES * 60_000;
  for (const [chatId, h] of humanHandled.entries()) {
    if (followupSent.has(chatId)) continue;
    if (h.escalated) continue;
    const last = lastActivityAt.get(chatId) || 0;
    if (now - last < cutoff) continue;

    const msg = '¿Te puedo ayudar en algo más? 🙂\nSi querés volver a ver el menú, escribí *a*, *b*, *c* o *d*.';
    try {
      await client.sendMessage(chatId, msg);
      botSentRecent.push({ chatId, body: msg, at: now });
      followupSent.set(chatId, now);
      humanHandled.delete(chatId);
      lastActivityAt.set(chatId, now);
      console.log(`[${chatId}] 💬 follow-up "¿algo más?" enviado tras ${FOLLOWUP_MINUTES}min sin actividad — bot retoma`);
    } catch (e) {
      console.error(`follow-up fail ${chatId}:`, e.message);
    }
  }
}

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
    const list = labels || [];
    if (!list.length) {
      console.log('⚠️  getLabels() devolvió 0 etiquetas. Asegurate de tener WhatsApp Business (no la app común).');
      return;
    }
    console.log(`📋 Etiquetas detectadas en WhatsApp Business (${list.length}):`);
    for (const l of list) console.log(`   • "${l.name}" → id=${l.id}`);
    const target = HUMAN_LABEL_NAME.toUpperCase();
    const found = list.find(l => (l.name || '').toUpperCase().includes(target));
    if (found) {
      humanLabelId = found.id;
      console.log(`✅ Usando etiqueta "${found.name}" (id=${humanLabelId}) para marcar chats que necesitan asesor humano.`);
    } else {
      console.log(`⚠️  Ninguna etiqueta contiene "${HUMAN_LABEL_NAME}". Crear una con ese texto en el nombre (o cambiar WA_HUMAN_LABEL en .env).`);
    }
  } catch (e) {
    console.log(`⚠️  No se pudieron leer etiquetas: ${e.message}`);
  }
}

async function markChatForHuman(client, chatId) {
  if (!humanLabelId) {
    console.log(`[${chatId}] no se pudo etiquetar: humanLabelId es null (etiqueta no encontrada al arranque)`);
    return;
  }
  if (labeledChats.has(chatId)) return;
  try {
    const chat = await client.getChatById(chatId);
    await chat.changeLabels([humanLabelId]);
    labeledChats.add(chatId);
    console.log(`[${chatId}] 🟡 etiqueta HUMANO aplicada`);
  } catch (e) {
    console.error(`[${chatId}] no se pudo etiquetar:`, e.message);
  }
}

async function handleIncoming(client, msg) {
  try {
    if (msg.fromMe) return;
    if (msg.from === 'status@broadcast') return;
    const from = msg.from;
    const now = Date.now();
    lastIncomingAt.set(from, now);
    lastActivityAt.set(from, now);
    const text = (msg.body || '').trim();
    if (!text) {
      console.log(`[${from}] -> (sin texto: ${msg.type}) [ignorado]`);
      return;
    }
    const chat = await msg.getChat();
    if (chat.isGroup) return;

    await logNewClientIfFirst(client, msg);

    if (isAsesorActive(from)) {
      const h = humanHandled.get(from);
      const minsLeft = Math.round((h.until - now) / 60000);
      console.log(`[${from}] -> ${text.slice(0, 60)} [silenciado: asesor activo ${minsLeft}min restantes]`);
      recordHistory(from, 'user', text);
      return;
    }

    console.log(`[${from}] -> ${text.slice(0, 80)}`);
    recordHistory(from, 'user', text);

    const result = await postWebhook(from, text);
    states.set(from, result.state);

    for (const m of (result.messages || [])) {
      if (m.delaySec) await new Promise(r => setTimeout(r, m.delaySec * 1000));
      await client.sendMessage(from, m.body);
      botSentRecent.push({ chatId: from, body: m.body, at: Date.now() });
      lastActivityAt.set(from, Date.now());
      recordHistory(from, 'bot', m.body);
      console.log(`[${from}] <- ${m.body.slice(0, 80)}`);
    }

    if (result.state?.escalated) {
      console.log(`[${from}] *** marcado para humano ***`);
      await markChatForHuman(client, from);
      markAsesorActive(from);
    }
  } catch (e) {
    console.error('handleIncoming error:', e.message);
  }
}

async function handleOutgoing(client, msg) {
  try {
    if (!msg.fromMe) return;
    const chatId = msg.to;
    if (!chatId || chatId === 'status@broadcast') return;
    const body = (msg.body || '').trim();
    if (!body) return;

    const cutoff = Date.now() - 60_000;
    while (botSentRecent.length && botSentRecent[0].at < cutoff) botSentRecent.shift();
    const idx = botSentRecent.findIndex(s => s.chatId === chatId && s.body === body);
    if (idx !== -1) {
      botSentRecent.splice(idx, 1);
      lastActivityAt.set(chatId, Date.now());
      return;
    }

    const lastIn = lastIncomingAt.get(chatId);
    if (lastIn && Date.now() - lastIn < AUTOREPLY_WINDOW_MS) {
      console.log(`[${chatId}] auto-reply nativo detectado (${Date.now() - lastIn}ms) — no marca asesor`);
      return;
    }

    lastActivityAt.set(chatId, Date.now());
    markAsesorActive(chatId);
    await markChatForHuman(client, chatId);
  } catch (e) {
    console.error('handleOutgoing error:', e.message);
  }
}

const client = new Client({
  authStrategy: new LocalAuth({ clientId: SESSION_NAME, dataPath: path.join(__dirname, '.wwebjs_auth') }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
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
  setInterval(() => sendFollowupIfDue(client).catch(e => console.error('followup tick fail:', e.message)), 5 * 60_000);
  console.log(`📋 Follow-up "¿algo más?" cada 5min para chats con ${FOLLOWUP_MINUTES}min sin actividad`);
});

client.on('disconnected', reason => {
  console.error('⚠️  Desconectado:', reason);
  process.exit(1);
});

client.on('message', msg => handleIncoming(client, msg));
client.on('message_create', msg => handleOutgoing(client, msg));

client.initialize();
