// Abstraccion de envio: misma firma sirve para Meta Cloud API y open-wa bridge.
// El provider se elige por env: WA_PROVIDER=meta | openwa
// - meta: usa WA_META_PHONE_NUMBER_ID + WA_META_ACCESS_TOKEN
// - openwa: usa WA_BRIDGE_URL + WA_BRIDGE_SECRET (el bridge corre en VPS/Railway)

import { httpRequest } from '../_http.js';

export function getProvider() {
  return (process.env.WA_PROVIDER || 'openwa').toLowerCase();
}

export async function sendMessage(to, text) {
  const provider = getProvider();
  if (provider === 'meta') return sendViaMeta(to, text);
  if (provider === 'openwa') return sendViaBridge(to, text);
  throw new Error('Provider WhatsApp no configurado. Seteá WA_PROVIDER=meta o openwa');
}

async function sendViaMeta(to, text) {
  const phoneId = (process.env.WA_META_PHONE_NUMBER_ID || '').trim();
  const token = (process.env.WA_META_ACCESS_TOKEN || '').trim();
  if (!phoneId || !token) throw new Error('Faltan env vars WA_META_PHONE_NUMBER_ID o WA_META_ACCESS_TOKEN');

  const url = 'https://graph.facebook.com/v21.0/' + phoneId + '/messages';
  const r = await httpRequest('POST', url,
    { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }
  );
  if (r.status !== 200) throw new Error('Meta send HTTP ' + r.status + ': ' + JSON.stringify(r.body).substring(0, 200));
  return { provider: 'meta', id: r.body?.messages?.[0]?.id, status: 'sent' };
}

async function sendViaBridge(to, text) {
  const url = (process.env.WA_BRIDGE_URL || '').trim().replace(/\/$/, '');
  const secret = (process.env.WA_BRIDGE_SECRET || '').trim();
  if (!url) throw new Error('Falta env var WA_BRIDGE_URL (URL del bridge open-wa en Railway/Fly.io)');

  const r = await httpRequest('POST', url + '/send',
    { 'Content-Type': 'application/json', 'X-Bridge-Secret': secret },
    { to, text }
  );
  if (r.status !== 200) throw new Error('Bridge send HTTP ' + r.status + ': ' + JSON.stringify(r.body).substring(0, 200));
  return { provider: 'openwa', id: r.body?.id || null, status: 'sent' };
}

// Normaliza un payload entrante (puede venir en formato Meta o formato bridge)
// y devuelve { from, text, name, provider, raw } o null si no es un mensaje de texto.
export function normalizeIncoming(body) {
  // Formato Meta Cloud API (webhook oficial)
  // body.entry[0].changes[0].value.messages[0]
  if (body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const v = body.entry[0].changes[0].value;
    const m = v.messages[0];
    const contact = v.contacts?.[0];
    if (m.type !== 'text') return null;
    return {
      provider: 'meta',
      from: m.from,
      text: m.text?.body || '',
      name: contact?.profile?.name || '',
      raw: m
    };
  }

  // Formato bridge open-wa: { from, text, name?, type? }
  if (body?.from && body?.text != null) {
    return {
      provider: 'openwa',
      from: String(body.from),
      text: String(body.text),
      name: body.name || '',
      raw: body
    };
  }

  return null;
}
