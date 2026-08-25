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
import { RECORDATORIO } from '../lib/wa/business-config.js';
import { agendarContacto } from '../lib/google/contacts.js';

const { Client, LocalAuth } = pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '.state.json');
const WEBHOOK_URL = process.env.WA_WEBHOOK_URL || '';
const TOKEN = process.env.WA_BRIDGE_TOKEN || '';
const SESSION_NAME = process.env.WA_SESSION || 'uniproveedores';
const HUMAN_LABEL_NAME = process.env.WA_HUMAN_LABEL || 'HUMANO';
const HUMAN_LABEL_ID_OVERRIDE = (process.env.WA_HUMAN_LABEL_ID || '').trim();
// En la cuenta hay DOS etiquetas que dicen "HUMANO" y el equipo solo ve una.
// El bot venía usando la otra (id=18, "HUMANO ☹️"), así que marcaba chats con
// una etiqueta invisible para el equipo. Elegimos por el EMOJI, que es lo único
// que las distingue. Se puede cambiar con WA_HUMAN_LABEL_EMOJI en el .env.
const HUMAN_LABEL_EMOJI = process.env.WA_HUMAN_LABEL_EMOJI || '🧐';
// Limpieza única de la etiqueta HUMANO vieja. Los chats que el bot marcó cuando
// usaba la etiqueta equivocada quedaron con un punto de color que el equipo ve
// pero NO puede destildar, porque esa lista no le aparece en WhatsApp.
//   WA_LIMPIAR_HUMANO=contar  -> solo dice cuántos chats la tienen, no toca nada
//   WA_LIMPIAR_HUMANO=si      -> se la saca de verdad
const LIMPIAR_HUMANO = (process.env.WA_LIMPIAR_HUMANO || '').trim().toLowerCase();
const HUMAN_TAKEOVER_HOURS = Number(process.env.WA_HUMAN_TAKEOVER_HOURS || 3);
// Cuando el asesor toma un chat, el bot se calla por HUMAN_TAKEOVER_HOURS para
// no escribirle encima. El problema: si después el asesor se olvida, el cliente
// escribe y NO le contesta nadie (ni el bot, que está en silencio, ni la
// persona). Pasados estos minutos sin que el asesor hable, avisamos al
// supervisor para que alguien lo agarre. El bot sigue sin hablar.
const AVISO_SIN_ATENDER_MIN = Number(process.env.WA_AVISO_SIN_ATENDER_MIN || 20);
const AUTOREPLY_WINDOW_MS = Number(process.env.WA_AUTOREPLY_MS || 3000);
const FOLLOWUP_MINUTES = Number(process.env.WA_FOLLOWUP_MINUTES || 120);
const REMINDER_DAYS = Number(process.env.WA_REMINDER_DAYS || RECORDATORIO.diasDespues || 5);
const SEND_NEW_CLIENT_EMAIL = (process.env.WA_NEW_CLIENT_EMAIL || '').toLowerCase() === 'true';
const NEW_CLIENTS_CSV = path.join(__dirname, 'new-clients.csv');

// De todas las etiquetas que dicen "HUMANO", elegí la del emoji configurado.
// Si ninguna lo tiene, cae en la primera (comportamiento de antes).
function pickHumanLabel(list) {
  const target = HUMAN_LABEL_NAME.toUpperCase();
  const candidatos = (list || []).filter(l => (l.name || '').toUpperCase().includes(target));
  return candidatos.find(l => (l.name || '').includes(HUMAN_LABEL_EMOJI)) || candidatos[0] || null;
}

// Códigos Unicode de los emojis de un texto, para distinguir etiquetas que en
// el terminal se ven parecidas (ej: dos "HUMANO" con emojis distintos).
function emojiCodes(name) {
  const codes = [...String(name || '')]
    .filter(c => c.codePointAt(0) > 0x2000)
    .map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase());
  return codes.length ? ` [${codes.join(' ')}]` : '';
}

// Día calendario local (YYYY-MM-DD) para limitar follow-up a 1 por día por chat.
function dayKey(ts) {
  return new Date(ts).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
}

if (!WEBHOOK_URL) {
  console.error('Falta WA_WEBHOOK_URL en .env');
  process.exit(1);
}

const states = new Map();
const histories = new Map();
const labeledChats = new Set();
const chatOpenFail = new Map();  // chatId -> último aviso de "no se pudo abrir el chat"
const humanHandled = new Map();
const lastActivityAt = new Map();
const lastIncomingAt = new Map();
const botSentRecent = [];
const sentIds = new Set(); // IDs de mensajes enviados por el BOT: reconocimiento infalible
const followupSent = new Map();
// Anti-loop: si el bot manda la MISMA respuesta varias veces seguidas al mismo
// chat (típico cuando del otro lado hay otro bot/IA), corta y deriva a un humano.
const botReplyStreak = new Map();  // chatId -> { fp, count }
const MAX_IDENTICAL_REPLIES = 3;   // a la 3ra respuesta idéntica: parar + esperar humano

// Candado anti-carrera: mientras el bot está enviando a un chat, cualquier
// evento fromMe de ese chat es del bot. El evento message_create se dispara
// ANTES de que client.sendMessage() resuelva, así que registrar "después de
// enviar" siempre llega tarde (visto en logs: detectaba el 2º mensaje de una
// secuencia como "asesor respondió" y silenciaba el bot 3 horas).
const botSendingUntil = new Map();

// TODO envío del bot pasa por acá. Registra la huella ANTES de enviar (para
// que el evento la encuentre aunque llegue en plena transmisión) + candado
// de 20s por chat + ID único del mensaje al confirmar.
async function botSend(client, chatId, body) {
  botSentRecent.push({ chatId, body, at: Date.now() });      // pre-registro
  botSendingUntil.set(chatId, Date.now() + 20_000);          // candado
  const sent = await client.sendMessage(chatId, body);
  try {
    const id = sent?.id?._serialized;
    if (id) {
      sentIds.add(id);
      if (sentIds.size > 800) {
        const it = sentIds.values();
        for (let i = 0; i < 300; i++) sentIds.delete(it.next().value);
      }
    }
  } catch {}
  return sent;
}

// Huella del texto: solo letras/números, sin emojis, negritas ni espacios.
// Tolera cualquier decoración que WhatsApp agregue o saque.
function textFingerprint(t) {
  return String(t || '').normalize('NFD').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase().slice(0, 160);
}
const knownContacts = new Set();
const firstContactAt = new Map();   // chatId -> timestamp del primer contacto
const reminderSent = new Set();      // chatId que ya recibieron el recordatorio de 5 días
const productFollowup = new Map();   // chatId -> ts del link de producto (para "¿pudiste comprarlo?")
const agendadosGoogle = new Set();   // chatId ya agendados en Google Contactos (evita duplicados tipo "Cliente 28..32")
let humanLabelId = null;

try {
  if (fs.existsSync(STATE_FILE)) {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    for (const [k, v] of Object.entries(raw.states || {})) states.set(k, v);
    for (const [k, v] of Object.entries(raw.histories || {})) histories.set(k, v);
    for (const [k, v] of Object.entries(raw.humanHandled || {})) humanHandled.set(k, v);
    for (const k of (raw.knownContacts || [])) knownContacts.add(k);
    for (const [k, v] of Object.entries(raw.firstContactAt || {})) firstContactAt.set(k, v);
    for (const k of (raw.reminderSent || [])) reminderSent.add(k);
    for (const [k, v] of Object.entries(raw.productFollowup || {})) productFollowup.set(k, v);
    for (const [k, v] of Object.entries(raw.lastActivityAt || {})) lastActivityAt.set(k, v);
    for (const [k, v] of Object.entries(raw.followupSent || {})) followupSent.set(k, v);
    for (const k of (raw.agendadosGoogle || [])) agendadosGoogle.add(k);
    console.log(`Estado cargado: ${states.size} contactos · ${humanHandled.size} con asesor activo · ${knownContacts.size} ya conocidos · ${reminderSent.size} con recordatorio enviado`);
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
      firstContactAt: Object.fromEntries(firstContactAt),
      reminderSent: Array.from(reminderSent),
      productFollowup: Object.fromEntries(productFollowup),
      lastActivityAt: Object.fromEntries(lastActivityAt),
      followupSent: Object.fromEntries(followupSent),
      agendadosGoogle: Array.from(agendadosGoogle),
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
  // asesorAt se refresca en cada mensaje manual del asesor: sirve para saber
  // hace cuánto que no atiende el chat (ver el aviso más abajo).
  humanHandled.set(chatId, { until, asesorAt: Date.now() });
  followupSent.delete(chatId);
  const mins = HUMAN_TAKEOVER_HOURS * 60;
  console.log(`[${chatId}] 🧑 asesor humano respondió — bot silenciado por ${mins}min`);
}

// La charla se cerró (mensaje de despedida): bloquea el "¿algo más?".
// Si cerró el BOT, se libera para futuras charlas. Si cerró el ASESOR,
// el bot QUEDA en silencio (el humano dio por terminado el chat: no hay
// que re-escribirle nada al cliente, ni siquiera si contesta "gracias").
function marcarCierre(chatId, quien) {
  if (quien === 'bot') humanHandled.delete(chatId);
  followupSent.set(chatId, Date.now());
  productFollowup.delete(chatId);
  console.log(`[${chatId}] ✋ cierre (${quien}) — follow-ups suprimidos${quien === 'asesor' ? ' · bot sigue en silencio' : ''}`);
}

const CLOSING_PATTERNS = [
  /gracias por (escribir|contactar|consultar|comunicarte|comunicarse)(nos|me|te|se)?\b/i,
  /gracias por (tu|su|la|el|las|los) (consulta|mensaje|tiempo|comunicaci[oó]n|compra)/i,
  /cualquier (otra )?(consulta|duda|cosa)[, ]+(nos|me) (avis|escrib|consult|llam)/i,
  /cualquier (otra )?(consulta|duda|cosa)[\s,]*(h[aá]blame|avisame|av[ií]same|escribime|escr[ií]bime|decime|consultame|chiflame)/i,
  /(te|los|lo|las|la) esperamos\b/i,
  /que teng(a|as|an) (un |una |unos |unas )?(buen|buena|buenos|buenas|gran|lindo|linda|lindos|lindas|hermoso|hermosa|hermosos|hermosas|excelente)s? (d[ií]a|finde|fin de semana|noche|tarde|jornada|semana)/i,
  /saludos cordiales/i,
  /hasta (luego|pronto|ma[nñ]ana|la pr[oó]xima|el lunes|el martes|el mi[eé]rcoles|el jueves|el viernes)/i,
  /^saludos[\s!.😊🙂👍]*$/i,
  /^(un )?(gran )?abrazo[\s!.😊🙂🤗]*$/i,
  /buen finde\b/i,
];

function isClosingMessage(text) {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  if (t.length > 200) return false;
  return CLOSING_PATTERNS.some(re => re.test(t));
}

// Cierres típicos DEL CLIENTE ("dale, te aviso", "gracias", "listo"...).
// Si el cliente dio por terminada la charla, no lo molestamos con follow-ups.
const CLIENT_CLOSING_PATTERNS = [
  /^(muchas |mil |ok |dale )?gracias+[\s!.,🙌👍🙂😊❤️🌟⭐🤝]*$/i,
  /^(dale|listo|ok+a?|okey|joya|b[aá]rbaro|genial|perfecto|buen[ií]simo|de una|igualmente|tranqui)[\s!.,🙌👍🙂😊❤️🤝]*$/i,
  /\b(te|les) aviso\b/i,
  /\blo (veo|miro|reviso) y (te|les) (aviso|digo|escribo)\b/i,
  /\bdespu[eé]s (te|les) (aviso|digo|escribo|hablo)\b/i,
  /\bcualquier cosa (te|les) (aviso|escribo|hablo|digo)\b/i,
  /\bnos vemos\b/i,
  /\bhasta (luego|ma[nñ]ana)\b/i,
];

function isClientClosing(text) {
  if (!text) return false;
  const t = text.trim();
  if (t.length > 120) return false;
  if (t.includes('?')) return false; // si pregunta algo, la charla sigue
  return CLIENT_CLOSING_PATTERNS.some(re => re.test(t));
}

async function logNewClientIfFirst(client, msg) {
  const from = msg.from;
  if (knownContacts.has(from)) return;
  knownContacts.add(from);
  if (!firstContactAt.has(from)) firstContactAt.set(from, Date.now());

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
  if (!SEND_NEW_CLIENT_EMAIL) return;
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
    // Máximo 1 follow-up por día calendario por chat.
    const lastFu = followupSent.get(chatId);
    if (lastFu && dayKey(lastFu) === dayKey(now)) continue;
    if (h.escalated) continue;
    const last = lastActivityAt.get(chatId) || 0;
    // Sin registro de actividad (ej: reinicio con estado viejo): NO disparar
    // el follow-up "a ciegas" — esperar a que haya actividad real.
    if (!last || now - last < cutoff) continue;

    const msg = '¿Te puedo ayudar en algo más? 🙂';
    try {
      await botSend(client, chatId, msg);
      followupSent.set(chatId, now);
      humanHandled.delete(chatId);
      lastActivityAt.set(chatId, now);
      console.log(`[${chatId}] 💬 follow-up "¿algo más?" enviado tras ${FOLLOWUP_MINUTES}min sin actividad — bot retoma`);
    } catch (e) {
      console.error(`follow-up fail ${chatId}:`, e.message);
    }
  }

  // Follow-up post-producto: le mandamos el link y no volvió a escribir.
  for (const [chatId, ts] of productFollowup.entries()) {
    if (now - ts < cutoff) continue;
    productFollowup.delete(chatId);
    if (isAsesorActive(chatId)) continue;
    const lastFu = followupSent.get(chatId);
    if (lastFu && dayKey(lastFu) === dayKey(now)) continue; // máx 1 por día
    const msg2 = '¿Cómo vas? 🙂 ¿Pudiste comprarlo desde el link, o te doy una mano con algo más?';
    try {
      await botSend(client, chatId, msg2);
      followupSent.set(chatId, now);
      lastActivityAt.set(chatId, now);
      console.log(`[${chatId}] 🛒 follow-up post-producto ("¿pudiste comprarlo?") tras ${FOLLOWUP_MINUTES}min`);
    } catch (e) {
      console.error(`follow-up producto fail ${chatId}:`, e.message);
    }
  }
}

// Recordatorio a los N días del primer contacto: promo + incentivo de calificación.
// Solo aplica a contactos que escribieron DESPUÉS del deploy (firstContactAt vacío al inicio),
// así no se dispara masivamente sobre clientes viejos.
async function sendRemindersIfDue(client) {
  const now = Date.now();
  const cutoff = REMINDER_DAYS * 86_400_000;
  for (const [chatId, firstAt] of firstContactAt.entries()) {
    if (reminderSent.has(chatId)) continue;
    if (now - firstAt < cutoff) continue;
    if (isAsesorActive(chatId)) continue; // no interrumpir una charla con humano
    try {
      await botSend(client, chatId, RECORDATORIO.mensaje);
      reminderSent.add(chatId);
      lastActivityAt.set(chatId, Date.now());
      console.log(`[${chatId}] 🎁 recordatorio ${REMINDER_DAYS}d enviado (promo + calificación)`);
    } catch (e) {
      console.error(`recordatorio fail ${chatId}:`, e.message);
    }
  }
}

const startedAt = Date.now();

async function sendHeartbeat() {
  if (!WEBHOOK_URL) return;
  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': TOKEN },
      body: JSON.stringify({
        event: 'heartbeat',
        stats: {
          contactsKnown: knownContacts.size,
          asesorActive: humanHandled.size,
          uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        },
      }),
    });
  } catch {}
}

async function postWebhook(from, text, audio) {
  const state = states.get(from) || { parentRow: null, fallbackStreak: 0 };
  const history = histories.get(from) || [];
  const payload = { from, text, state, history: history.slice(-10) };
  if (audio?.audioB64) {
    payload.audioB64 = audio.audioB64;
    payload.mime = audio.mime;
  }

  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': TOKEN },
    body: JSON.stringify(payload),
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

// Saca de todos los chats cualquier etiqueta "HUMANO" que NO sea la elegida.
// Corre una sola vez al arranque y solo si WA_LIMPIAR_HUMANO está seteada.
async function limpiarHumanoViejo(client) {
  if (!LIMPIAR_HUMANO) return;
  if (!humanLabelId) {
    console.log('🧹 limpieza: no se pudo resolver la etiqueta HUMANO, no se limpia nada.');
    return;
  }
  const soloContar = LIMPIAR_HUMANO !== 'si';
  let viejas = [];
  try {
    const labels = await client.getLabels();
    const target = HUMAN_LABEL_NAME.toUpperCase();
    viejas = (labels || [])
      .filter(l => (l.name || '').toUpperCase().includes(target) && String(l.id) !== String(humanLabelId))
      .map(l => ({ id: String(l.id), name: l.name }));
  } catch (e) {
    console.error('🧹 limpieza: no se pudieron leer las etiquetas:', e.message);
    return;
  }
  if (!viejas.length) {
    console.log('🧹 limpieza: no hay ninguna otra etiqueta HUMANO para sacar. Todo en orden.');
    return;
  }
  const ids = viejas.map(v => v.id);
  console.log(`🧹 limpieza ${soloContar ? 'EN MODO PRUEBA (no toca nada)' : 'REAL'}: sacando ${viejas.map(v => `"${v.name}" (id=${v.id})`).join(', ')} · se conserva id=${humanLabelId}`);

  let chats = [];
  try { chats = await client.getChats(); }
  catch (e) { console.error('🧹 limpieza: no se pudo listar los chats:', e.message); return; }

  let conEtiqueta = 0, limpiados = 0, ilegibles = 0;
  for (const chat of chats) {
    try {
      if (typeof chat.getLabels !== 'function' || typeof chat.changeLabels !== 'function') continue;
      const actuales = ((await chat.getLabels()) || []).map(l => String(l.id));
      if (!actuales.some(id => ids.includes(id))) continue;
      conEtiqueta++;
      const quedan = actuales.filter(id => !ids.includes(id));
      const quien = chat.name || chat.id?._serialized || '?';
      if (soloContar) {
        console.log(`   · ${String(quien).slice(0, 40)} — le quedarían ${quedan.length} etiqueta(s)`);
      } else {
        await chat.changeLabels(quedan);
        limpiados++;
        console.log(`   ✓ ${String(quien).slice(0, 40)} — limpiado`);
      }
    } catch { ilegibles++; }
  }
  console.log(`🧹 limpieza terminada: ${conEtiqueta} chat(s) tenían la etiqueta vieja` +
    (ilegibles ? ` · ${ilegibles} chat(s) no se pudieron leer (típico de los @lid)` : '') +
    (soloContar
      ? `. No se tocó nada: poné WA_LIMPIAR_HUMANO=si en el .env y reiniciá para aplicarlo.`
      : ` · ${limpiados} limpiado(s). Ya podés sacar WA_LIMPIAR_HUMANO del .env.`));
}

async function resolveHumanLabel(client) {
  if (HUMAN_LABEL_ID_OVERRIDE) {
    humanLabelId = HUMAN_LABEL_ID_OVERRIDE;
    console.log(`✅ Usando WA_HUMAN_LABEL_ID="${humanLabelId}" del .env (override manual).`);
    return;
  }

  const maxAttempts = 6;
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const labels = await client.getLabels();
      const list = labels || [];
      if (list.length) {
        console.log(`📋 Intento ${i}: ${list.length} etiqueta(s) detectada(s):`);
        // Los emojis se ven distinto en cada terminal, así que dos etiquetas que
        // parecen iguales pueden no serlo. Mostramos el código de cada emoji
        // (U+XXXX) para poder identificarlas sin lugar a dudas.
        for (const l of list) console.log(`   • "${l.name}"${emojiCodes(l.name)} → id=${l.id}`);
        const target = HUMAN_LABEL_NAME.toUpperCase();
        const candidatos = list.filter(l => (l.name || '').toUpperCase().includes(target));
        if (candidatos.length > 1) {
          console.log(`⚠️  Hay ${candidatos.length} etiquetas que dicen "${HUMAN_LABEL_NAME}": ${candidatos.map(l => `id=${l.id} "${l.name}"${emojiCodes(l.name)}`).join(' · ')}`);
          console.log(`   Se elige la del emoji ${HUMAN_LABEL_EMOJI} (WA_HUMAN_LABEL_EMOJI). Para forzar otra: WA_HUMAN_LABEL_ID="<id>" en el .env.`);
        }
        const found = pickHumanLabel(list);
        if (found) {
          humanLabelId = found.id;
          console.log(`✅ Usando etiqueta "${found.name}" (id=${humanLabelId}) para marcar chats que necesitan asesor humano.`);
          return;
        }
        console.log(`⚠️  Ninguna etiqueta contiene "${HUMAN_LABEL_NAME}". Crear una con ese texto en el nombre, o usar WA_HUMAN_LABEL_ID="<id>" en .env con uno de los IDs de arriba.`);
        return;
      }
      console.log(`⏳ Intento ${i}/${maxAttempts}: getLabels() devolvió 0 — reintentando en 30s...`);
    } catch (e) {
      console.log(`⚠️  Intento ${i} falló: ${e.message}`);
    }
    if (i < maxAttempts) await new Promise(r => setTimeout(r, 30_000));
  }
  console.log(`⚠️  Después de ${maxAttempts * 30}s las etiquetas siguen vacías. Posibles causas:`);
  console.log(`   - No es WhatsApp Business (es la app común)`);
  console.log(`   - Las etiquetas no se sincronizaron al dispositivo vinculado`);
  console.log(`   - Probá: abrí WhatsApp Business en el cel, tocá la etiqueta HUMANO, después pm2 restart wa-bridge`);
}

// WhatsApp Business migró "Etiquetas" a "Listas": el API de labels puede
// dejar de andar según la versión. Por eso el marcado para humano usa un
// esquema de 3 niveles, del más confiable al menos:
//   1) Marcar el chat como NO LEÍDO (funciona siempre, con o sin Listas)
//   2) Avisar por WhatsApp al supervisor (si WA_SUPERVISOR_NUMBER está en .env)
//   3) Etiqueta HUMANO (best-effort; con re-resolución lazy post-migración)
let lastLabelResolveAt = 0;

async function markChatForHuman(client, chatId) {
  if (chatId.endsWith('@newsletter') || chatId.endsWith('@broadcast')) return;
  let chat = null;
  try { chat = await client.getChatById(chatId); } catch (e) {
    // Pasa con los chats migrados a "@lid": la librería no puede abrirlos, así
    // que NO se puede marcar como no leído ni etiquetar. El aviso al supervisor
    // sí sale (no necesita el objeto chat). Se loguea 1 vez por hora por chat
    // para no tapar el log, que es lo que venía pasando.
    const ultimo = chatOpenFail.get(chatId) || 0;
    if (Date.now() - ultimo > 3_600_000) {
      chatOpenFail.set(chatId, Date.now());
      console.error(`[${chatId}] no se pudo abrir el chat (${e.message}) — sin marca de NO LEÍDO ni etiqueta. El aviso al supervisor sale igual. Típico de chats @lid: requiere actualizar whatsapp-web.js.`);
    }
    return;
  }

  // 1) No leído: el chat queda pendiente a la vista, sin depender de Listas.
  try {
    if (typeof chat.markUnread === 'function') {
      await chat.markUnread();
      console.log(`[${chatId}] 🔵 marcado como NO LEÍDO (pendiente para humano)`);
    }
  } catch (e) { console.error(`[${chatId}] markUnread fail:`, e.message); }

  // 3) Etiqueta (best-effort). Si al arranque no había (migración a Listas),
  //    reintenta resolverla como mucho una vez cada 10 minutos.
  if (!humanLabelId && Date.now() - lastLabelResolveAt > 10 * 60_000) {
    lastLabelResolveAt = Date.now();
    try {
      const labels = await client.getLabels();
      const found = pickHumanLabel(labels);
      if (found) {
        humanLabelId = found.id;
        console.log(`✅ Etiqueta "${found.name}" re-detectada (id=${humanLabelId}) tras la migración a Listas.`);
      }
    } catch {}
  }
  if (!humanLabelId) {
    console.log(`[${chatId}] sin etiqueta disponible (¿WhatsApp Listas?) — queda como no leído + aviso a supervisor`);
    return;
  }
  if (labeledChats.has(chatId)) return;
  try {
    if (typeof chat.changeLabels !== 'function') { labeledChats.add(chatId); return; }
    let existingIds = [];
    try {
      const existing = await chat.getLabels();
      existingIds = (existing || []).map(l => String(l.id));
    } catch {}
    const humanIdStr = String(humanLabelId);
    if (existingIds.includes(humanIdStr)) {
      labeledChats.add(chatId);
      return;
    }
    const merged = [...existingIds, humanIdStr];
    await chat.changeLabels(merged);
    labeledChats.add(chatId);
    console.log(`[${chatId}] 🟡 etiqueta HUMANO aplicada (se conservan ${existingIds.length} existentes)`);
  } catch (e) {
    console.error(`[${chatId}] no se pudo etiquetar:`, e.message);
  }
}

// 2) Aviso directo al supervisor por WhatsApp con link al chat del cliente.
//    Se activa poniendo WA_SUPERVISOR_NUMBER en el .env (solo dígitos, con
//    código de país, ej: 5491122334455). Máximo 1 aviso por chat cada 6 horas.
const SUPERVISOR_NUMBER = (process.env.WA_SUPERVISOR_NUMBER || '').replace(/[^0-9]/g, '');
const supervisorNotified = new Map();

function motivoHumano(reason) {
  if (reason === 'ia_reclamo_ml' || reason === 'ia_reclamo_datos') return 'Reclamo de compra ML 📦';
  if (reason === 'ia_mayorista') return 'Consulta mayorista 🧾';
  if (reason === 'ia_escalate_human') return 'Pidió hablar con una persona 🧑';
  if (reason === 'loop_repetido') return 'Posible loop: el bot repitió la misma respuesta 🔁 (¿otro bot del otro lado?)';
  if (reason === 'cliente_sin_atender') return 'El cliente escribió y NO le contestó nadie ⏳ (el bot está en silencio porque un asesor tomó el chat)';
  return 'Necesita atención';
}

// Chat real del supervisor. Armar "<numero>@c.us" a mano no siempre funciona:
// WhatsApp migró cuentas al formato "@lid" y ahí el envío falla ("no se pudo
// abrir el chat"). getNumberId() devuelve el ID que WhatsApp usa de verdad.
// Se cachea porque no cambia, y si falla queda el @c.us de siempre.
let supervisorChatId = null;
async function resolveSupervisorChat(client) {
  if (supervisorChatId) return supervisorChatId;
  try {
    const r = await client.getNumberId(SUPERVISOR_NUMBER);
    if (r?._serialized) {
      supervisorChatId = r._serialized;
      if (supervisorChatId !== SUPERVISOR_NUMBER + '@c.us') {
        console.log(`🔔 supervisor resuelto como ${supervisorChatId} (no ${SUPERVISOR_NUMBER}@c.us)`);
      }
      return supervisorChatId;
    }
    console.error(`aviso a supervisor: getNumberId(+${SUPERVISOR_NUMBER}) no devolvió ID — ¿el número tiene WhatsApp?`);
  } catch (e) {
    console.error(`aviso a supervisor: no se pudo resolver el número (${e.message}) — se prueba con @c.us`);
  }
  supervisorChatId = SUPERVISOR_NUMBER + '@c.us';
  return supervisorChatId;
}

async function notifySupervisor(client, chatId, reason, lastText) {
  if (!SUPERVISOR_NUMBER) return;
  const supervisorChat = await resolveSupervisorChat(client);
  // No avisarle al supervisor sobre su propio chat, en cualquiera de los dos formatos.
  if (chatId === supervisorChat || chatId === SUPERVISOR_NUMBER + '@c.us') return;
  const last = supervisorNotified.get(chatId) || 0;
  if (Date.now() - last < 6 * 3_600_000) return;
  const phone = chatId.split('@')[0];
  const body =
    `🔔 *Atención requerida*\n` +
    `Cliente: +${phone}\n` +
    `Motivo: ${motivoHumano(reason)}\n` +
    (lastText ? `Último mensaje: "${String(lastText).slice(0, 120)}"\n` : '') +
    `👉 https://wa.me/${phone}`;
  try {
    await botSend(client, supervisorChat, body);
    supervisorNotified.set(chatId, Date.now());
    console.log(`[${chatId}] 📣 aviso enviado al supervisor (+${SUPERVISOR_NUMBER})`);
  } catch (e) {
    console.error(`aviso a supervisor fail:`, e.message);
  }
}

// Resuelve el teléfono REAL del contacto para agendarlo.
// WhatsApp ahora identifica muchos chats con "<id>@lid": ese ID es interno y NO
// es un teléfono (por privacidad esconde el número real). getContact() a veces
// tampoco lo devuelve: en ese caso intentamos resolver el @lid -> teléfono con
// el store interno de WhatsApp. Si no lo logramos, devolvemos null y NO agendamos
// (mejor no guardar nada que guardar un número inventado como +185229138464948).
async function telefonoReal(client, msg, from) {
  if (from.endsWith('@c.us')) return '+' + from.split('@')[0];
  const lid = from.split('@')[0];
  const esTelReal = n => n && n !== lid && /^\d{10,15}$/.test(n);
  try {
    // 1) Número directo del contacto (sirve si WhatsApp lo expone).
    let num = '';
    try {
      const contact = await msg.getContact();
      num = String(contact?.number || '').replace(/\D/g, '');
      if (esTelReal(num)) return '+' + num;
    } catch {}

    // 2) Resolver @lid -> teléfono con el store interno de WhatsApp. Los nombres
    //    internos cambian por versión: probamos varios candidatos y logueamos lo
    //    disponible para afinar el arreglo si hiciera falta.
    let diag = null;
    try {
      diag = await client.pupPage.evaluate((lidSer) => {
        const info = {};
        try {
          const S = window.Store;
          info.hasStore = !!S;
          if (S) {
            const keys = Object.keys(S);
            info.storeKeys = keys.length;
            info.lidish = keys.filter(k => /lid|pn|phone|wid|jid|number|migrat/i.test(k)).slice(0, 30);
            // Módulos que tengan funciones relacionadas a teléfono / lid.
            info.fnHits = [];
            for (const k of keys) {
              const m = S[k];
              if (m && typeof m === 'object') {
                try {
                  const fns = Object.keys(m).filter(f => typeof m[f] === 'function' && /phone|pn|lid/i.test(f));
                  if (fns.length) info.fnHits.push(k + ':[' + fns.slice(0, 10).join(',') + ']');
                } catch {}
              }
            }
            info.sample = keys.slice(0, 40);
          }
          info.hasWPP = !!window.WPP;
          info.waGlobals = Object.keys(window).filter(k => /store|wpp|wweb|require/i.test(k)).slice(0, 15);
        } catch (e) { info.err = e.message; }
        return info;
      }, from);
    } catch (e) { diag = { evalErr: e.message }; }

    const pnDigits = String(diag?.pn || '').replace(/\D/g, '');
    console.log(`[DIAG-LID] from=${from} number=${num || '-'} store=${JSON.stringify(diag)}`);
    if (esTelReal(pnDigits)) return '+' + pnDigits;
  } catch (e) {
    console.log(`[DIAG-LID] telefonoReal fail: ${e.message}`);
  }
  return null;
}

async function handleIncoming(client, msg) {
  try {
    if (msg.fromMe) return;
    if (msg.from === 'status@broadcast') return;
    const from = msg.from;
    const now = Date.now();
    lastIncomingAt.set(from, now);
    lastActivityAt.set(from, now);
    productFollowup.delete(from); // el cliente volvió a escribir: la charla sigue viva
    let text = (msg.body || '').trim();

    // Nota de voz: la bajamos y la mandamos al webhook para transcribir.
    let audio = null;
    if (!text && (msg.type === 'ptt' || msg.type === 'audio') && msg.hasMedia) {
      try {
        const media = await msg.downloadMedia();
        if (media?.data) {
          audio = { audioB64: media.data, mime: media.mimetype || 'audio/ogg' };
          console.log(`[${from}] -> 🎤 nota de voz (${media.mimetype || 'audio/ogg'}) — transcribiendo...`);
        }
      } catch (e) {
        console.error(`[${from}] audio download fail:`, e.message);
      }
    }

    // Foto/video/archivo sin texto: no lo descargamos, pero le avisamos al
    // cerebro para que responda en contexto (ej: reclamo esperando la foto).
    // Grupos excluidos: no son clientes 1-a-1.
    if (!text && !audio && !from.endsWith('@g.us') && ['image', 'video', 'document'].includes(msg.type)) {
      text = msg.type === 'image' ? '(el cliente mandó una foto 📸)'
           : msg.type === 'video' ? '(el cliente mandó un video 🎬)'
           : '(el cliente mandó un archivo 📎)';
      console.log(`[${from}] -> 📎 media (${msg.type}) — se avisa al cerebro`);
    }

    if (!text && !audio) {
      console.log(`[${from}] -> (sin texto: ${msg.type}) [ignorado]`);
      return;
    }
    // NO usamos msg.getChat(): con el formato nuevo de WhatsApp (@lid) esa llamada
    // falla ("no se pudo abrir el chat") y tiraba abajo TODA la respuesta.
    // Los grupos se detectan por el sufijo del ID, sin abrir el chat.
    if (from.endsWith('@g.us')) return;

    // El cliente cerró la charla ("gracias", "dale, te aviso", "listo"):
    // NO le re-escribimos nada (ni "de nada" ni "¿algo más?"). Chat cerrado.
    if (text && isClientClosing(text)) {
      followupSent.set(from, now);
      productFollowup.delete(from);
      recordHistory(from, 'user', text);
      console.log(`[${from}] ✋ cierre del cliente ("${text.slice(0, 40)}") — chat cerrado, sin respuesta`);
      return;
    }

    await logNewClientIfFirst(client, msg);

    if (isAsesorActive(from)) {
      const h = humanHandled.get(from);
      const minsLeft = Math.round((h.until - now) / 60000);
      // Si fue audio durante asesor activo, igual lo dejamos en historial (transcripto si se puede).
      if (audio) {
        try {
          const r = await postWebhook(from, '', audio);
          if (r?.transcribed) recordHistory(from, 'user', r.transcribed);
        } catch {}
      } else {
        recordHistory(from, 'user', text);
      }
      // El bot NO habla (el asesor tiene el chat), pero si hace rato que el
      // asesor no dice nada, que no quede el cliente esperando al vacío.
      const minsSinAsesor = Math.round((now - (h.asesorAt || 0)) / 60000);
      if (h.asesorAt && minsSinAsesor >= AVISO_SIN_ATENDER_MIN) {
        console.log(`[${from}] ⏳ cliente escribió y el asesor no contesta hace ${minsSinAsesor}min — avisando al supervisor`);
        await notifySupervisor(client, from, 'cliente_sin_atender', text);
      }
      console.log(`[${from}] -> ${(text || '🎤audio').slice(0, 60)} [silenciado: asesor activo ${minsLeft}min restantes]`);
      return;
    }

    if (text) {
      console.log(`[${from}] -> ${text.slice(0, 80)}`);
      recordHistory(from, 'user', text);
    }

    const result = await postWebhook(from, text, audio);
    if (audio && result.transcribed) {
      text = result.transcribed;
      console.log(`[${from}] -> 🎤 "${text.slice(0, 80)}"`);
      recordHistory(from, 'user', text);
    }
    states.set(from, result.state);

    // --- ANTI-LOOP: no mandar la MISMA respuesta 3 veces seguidas ---------
    // Si del otro lado hay otro bot/IA, el nuestro puede quedar contestando lo
    // mismo en bucle. A la 3ra respuesta idéntica: NO la mandamos, marcamos el
    // chat para humano, silenciamos el bot y avisamos al supervisor.
    const replyBodies = (result.messages || []).map(m => m.body).join(' ');
    const replyFp = textFingerprint(replyBodies);
    if (replyFp) {
      const prev = botReplyStreak.get(from);
      const count = (prev && prev.fp === replyFp) ? prev.count + 1 : 1;
      if (count >= MAX_IDENTICAL_REPLIES) {
        console.log(`[${from}] 🔁 respuesta idéntica x${count} — posible loop con otro bot. Corto y derivo a humano (sin enviar).`);
        botReplyStreak.delete(from);
        await markChatForHuman(client, from);
        markAsesorActive(from);   // silencia el bot: no vuelve a responder hasta que un humano intervenga
        await notifySupervisor(client, from, 'loop_repetido', text);
        return;                   // NO enviamos el mensaje repetido
      }
      botReplyStreak.set(from, { fp: replyFp, count });
    }

    for (const m of (result.messages || [])) {
      if (m.delaySec) await new Promise(r => setTimeout(r, m.delaySec * 1000));
      await botSend(client, from, m.body);
      lastActivityAt.set(from, Date.now());
      recordHistory(from, 'bot', m.body);
      console.log(`[${from}] <- ${m.body.slice(0, 80)}`);
    }

    // Agendar el contacto en Google Contactos (cliente / mayorista / proveedor).
    // Fire-and-forget: nunca frena ni rompe la conversación.
    const contacto = result.ia?.contacto;
    if (contacto && !agendadosGoogle.has(from)) {
      agendadosGoogle.add(from); // marcar ANTES: evita duplicados si llegan varios mensajes seguidos
      telefonoReal(client, msg, from)
        .then(phone => agendarContacto({ ...contacto, phone, chatId: from })
          .then(r => {
            if (r?.ok) console.log(`[${from}] 📇 agendado: ${r.nombre}${phone ? ' (' + phone + ')' : ' (sin número: chat @lid)'}`);
            else if (r?.error) { agendadosGoogle.delete(from); console.error(`[${from}] agendar contacto:`, r.error); }
            else if (r?.skipped && r.skipped !== 'ya agendado') agendadosGoogle.delete(from);
          }))
        .catch(e => { agendadosGoogle.delete(from); console.error(`[${from}] agendar contacto:`, e.message); });
    }

    // Mandó el link de un producto: si el cliente no vuelve a escribir en
    // FOLLOWUP_MINUTES, le preguntamos si pudo comprarlo o necesita ayuda.
    if (result.reason === 'ia_producto') {
      productFollowup.set(from, Date.now());
    }

    // Si el BOT cerró la charla (despedida), no mandamos "¿algo más?" después.
    const botCerro = (result.messages || []).some(m => isClosingMessage(m.body));
    if (botCerro) {
      marcarCierre(from, 'bot');
    } else if (result.state?.escalated) {
      // Pidió supervisor o requiere humano: marcado + aviso + bot silenciado.
      console.log(`[${from}] *** marcado para humano (bot en pausa) ***`);
      await markChatForHuman(client, from);
      markAsesorActive(from);
      await notifySupervisor(client, from, result.reason, text);
    } else if (result.state?.flagHuman) {
      // Mayorista/reclamo: marcado + aviso para que un humano lo siga,
      // pero el bot SIGUE respondiendo las dudas del cliente.
      console.log(`[${from}] 🟡 marcado para humano (bot sigue activo)`);
      await markChatForHuman(client, from);
      await notifySupervisor(client, from, result.reason, text);
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
    // Ignorar canales/newsletters, difusión y grupos: no son clientes 1-a-1.
    if (chatId.endsWith('@newsletter') || chatId.endsWith('@broadcast') || chatId.endsWith('@g.us')) return;
    const body = (msg.body || '').trim();
    if (!body) return;

    // ¿Es un mensaje que mandó el PROPIO BOT?
    // 0) Candado de envío: si el bot está mandando a este chat AHORA MISMO
    //    (ventana de 20s), el evento es suyo. Cubre la carrera en la que el
    //    evento llega antes de que sendMessage() termine de resolver.
    if (Date.now() < (botSendingUntil.get(chatId) || 0)) {
      lastActivityAt.set(chatId, Date.now());
      return;
    }
    // 1) Por ID único del mensaje (botSend registra el id de todo lo enviado).
    const msgId = msg.id?._serialized;
    if (msgId && sentIds.has(msgId)) {
      lastActivityAt.set(chatId, Date.now());
      return;
    }
    // 2) Respaldo por huella de texto (solo letras/números): tolera que
    //    WhatsApp altere negritas, emojis o el preview del link en el evento.
    const cutoff = Date.now() - 5 * 60_000;
    while (botSentRecent.length && botSentRecent[0].at < cutoff) botSentRecent.shift();
    const fpBody = textFingerprint(body);
    const esDelBot = fpBody && botSentRecent.some(s => {
      if (s.chatId !== chatId) return false;
      const fpSent = textFingerprint(s.body);
      if (!fpSent) return false;
      return fpSent === fpBody || fpSent.startsWith(fpBody) || fpBody.startsWith(fpSent);
    });
    if (esDelBot) {
      lastActivityAt.set(chatId, Date.now());
      return;
    }

    const lastIn = lastIncomingAt.get(chatId);
    if (lastIn && Date.now() - lastIn < AUTOREPLY_WINDOW_MS) {
      console.log(`[${chatId}] auto-reply nativo detectado (${Date.now() - lastIn}ms) — no marca asesor`);
      return;
    }

    console.log(`[${chatId}] 🧑 mensaje manual del asesor detectado: "${body.slice(0, 50)}"`);
    lastActivityAt.set(chatId, Date.now());
    productFollowup.delete(chatId);
    markAsesorActive(chatId);
    await markChatForHuman(client, chatId);

    if (isClosingMessage(body)) {
      marcarCierre(chatId, 'asesor');
    }
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
  await limpiarHumanoViejo(client);
  setInterval(() => sendFollowupIfDue(client).catch(e => console.error('followup tick fail:', e.message)), 5 * 60_000);
  setInterval(() => sendRemindersIfDue(client).catch(e => console.error('reminder tick fail:', e.message)), 60 * 60_000);
  sendHeartbeat();
  setInterval(() => sendHeartbeat(), 60_000);
  console.log(`📋 Follow-up "¿algo más?" cada 5min para chats con ${FOLLOWUP_MINUTES}min sin actividad (máx 1/día por chat)`);
  console.log(`🎁 Recordatorio a los ${REMINDER_DAYS} días del primer contacto (chequeo cada 1h)`);
  console.log(`💓 Heartbeat al panel cada 60s`);
  // Que se vea en el arranque si el aviso al supervisor va a salir o no: sin
  // WA_SUPERVISOR_NUMBER, notifySupervisor sale sin hacer nada y el cliente que
  // escribe durante el silencio del asesor queda sin atender y sin aviso.
  console.log(SUPERVISOR_NUMBER
    ? `🔔 Avisos al supervisor (+${SUPERVISOR_NUMBER}) · también si el cliente escribe y el asesor no contesta hace ${AVISO_SIN_ATENDER_MIN}min`
    : `⚠️ SIN avisos al supervisor: falta WA_SUPERVISOR_NUMBER en el .env — si un cliente escribe mientras el bot está en silencio, nadie se entera`);
});

client.on('disconnected', reason => {
  console.error('⚠️  Desconectado:', reason);
  process.exit(1);
});

client.on('message', msg => handleIncoming(client, msg));
client.on('message_create', msg => handleOutgoing(client, msg));

client.initialize();
