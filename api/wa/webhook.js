import { processMessage } from '../../lib/wa/brain.js';
import { loadRules, menuOptionsAt } from '../../lib/wa/rules.js';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Bridge-Token');
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
