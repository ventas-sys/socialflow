import { httpRequest, cors } from '../_http.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

// Publica en la página de Facebook y/o en la cuenta de Instagram Business.
// Body: { pageToken, pageId, igId, message, imageUrl, targets:{fb,ig} }
//  - FB con imageUrl -> /{pageId}/photos ; sin imagen -> /{pageId}/feed
//  - IG SIEMPRE requiere imageUrl pública: crea container y media_publish
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { pageToken, pageId, igId, message = '', imageUrl = '', targets = {} } = req.body || {};
  if (!pageToken) return res.status(400).json({ ok: false, error: 'Falta pageToken (autorizá Meta en Conexiones)' });

  const wantFb = targets.fb !== false;
  const wantIg = targets.ig === true;
  const results = {};

  try {
    // ---- Facebook ----
    if (wantFb && pageId) {
      let fbUrl, params;
      if (imageUrl) {
        params = new URLSearchParams({ url: imageUrl, caption: message, access_token: pageToken });
        fbUrl = `${GRAPH}/${pageId}/photos?` + params.toString();
      } else {
        params = new URLSearchParams({ message, access_token: pageToken });
        fbUrl = `${GRAPH}/${pageId}/feed?` + params.toString();
      }
      const r = await httpRequest('POST', fbUrl, {});
      results.fb = r.status < 400
        ? { ok: true, id: r.body?.post_id || r.body?.id }
        : { ok: false, error: r.body?.error?.message || ('HTTP ' + r.status) };
    }

    // ---- Instagram ----
    if (wantIg && igId) {
      if (!imageUrl) {
        results.ig = { ok: false, error: 'Instagram requiere una imagen con URL pública' };
      } else {
        // 1) container
        const createUrl = `${GRAPH}/${igId}/media?` + new URLSearchParams({
          image_url: imageUrl,
          caption: message,
          access_token: pageToken
        }).toString();
        const c = await httpRequest('POST', createUrl, {});
        if (c.status >= 400 || !c.body?.id) {
          results.ig = { ok: false, error: c.body?.error?.message || ('HTTP ' + c.status) };
        } else {
          // 2) publish
          const pubUrl = `${GRAPH}/${igId}/media_publish?` + new URLSearchParams({
            creation_id: c.body.id,
            access_token: pageToken
          }).toString();
          const p = await httpRequest('POST', pubUrl, {});
          results.ig = p.status < 400
            ? { ok: true, id: p.body?.id }
            : { ok: false, error: p.body?.error?.message || ('HTTP ' + p.status) };
        }
      }
    }

    const anyOk = Object.values(results).some(r => r.ok);
    return res.status(200).json({ ok: anyOk, results });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
