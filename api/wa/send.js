// Envia un mensaje de WhatsApp via el provider configurado.
// Body: { to: "5491155551234", text: "Hola desde SocialFlow" }
// Pensado para testing desde el panel /whatsapp.

import { cors } from '../_http.js';
import { sendMessage, getProvider } from '../../lib/wa/provider.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, provider: getProvider() });
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const { to, text } = req.body || {};
  if (!to || !text) return res.status(400).json({ ok: false, error: 'Falta to o text' });

  // Normalizamos el numero: sacamos +, espacios, guiones
  const cleanTo = String(to).replace(/[^\d]/g, '');
  if (cleanTo.length < 8) return res.status(400).json({ ok: false, error: 'Numero de destino invalido' });

  try {
    const result = await sendMessage(cleanTo, text);
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
