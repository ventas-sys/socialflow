import { httpRequest, cors } from './_http.js';

// Lectura pública de datos de YouTube (Data API v3, solo API Key, sin OAuth).
//   POST /api/youtube?action=test    -> valida API Key + canal, devuelve info del canal
//   POST /api/youtube?action=videos  -> lista los últimos videos/Shorts subidos
const YT_API = 'https://www.googleapis.com/youtube/v3';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const action = (req.query?.action || req.body?.action || 'test').toString();
  try {
    if (action === 'videos') return await videos(req, res);
    return await test(req, res);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// Acepta un ID de canal (UC...), un @handle o una URL de canal, y devuelve el channelId real.
async function resolveChannelId(apiKey, channelInput) {
  const raw = (channelInput || '').trim();
  if (!raw) throw new Error('Falta el ID o @handle del canal');
  const m = raw.match(/UC[\w-]{20,}/);
  if (m) return m[0];

  const handle = raw.replace(/^https?:\/\/(www\.)?youtube\.com\//i, '').replace(/^@/, '').trim();
  const r = await httpRequest('GET', `${YT_API}/channels?part=id&forHandle=${encodeURIComponent(handle)}&key=${encodeURIComponent(apiKey)}`);
  const id = r.body?.items?.[0]?.id;
  if (!id) throw new Error(r.body?.error?.message || 'No encontré el canal con ese ID/handle');
  return id;
}

function parseISODuration(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return 0;
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}

async function test(req, res) {
  const { apiKey, channel } = req.body || {};
  if (!apiKey || !channel) return res.status(400).json({ ok: false, error: 'Falta API Key o Canal (ID / @handle)' });

  const channelId = await resolveChannelId(apiKey, channel);
  const r = await httpRequest('GET', `${YT_API}/channels?part=snippet,statistics&id=${channelId}&key=${encodeURIComponent(apiKey)}`);
  if (r.status !== 200) {
    return res.status(200).json({ ok: false, error: r.body?.error?.message || ('HTTP ' + r.status) });
  }
  const item = r.body?.items?.[0];
  if (!item) return res.status(200).json({ ok: false, error: 'Canal no encontrado' });

  return res.status(200).json({
    ok: true,
    info: {
      channelId,
      title: item.snippet?.title,
      subs: item.statistics?.subscriberCount,
      videoCount: item.statistics?.videoCount,
      viewCount: item.statistics?.viewCount,
      thumbnail: item.snippet?.thumbnails?.default?.url,
    }
  });
}

async function videos(req, res) {
  const { apiKey, channel, max } = req.body || {};
  if (!apiKey || !channel) return res.status(400).json({ ok: false, error: 'Falta API Key o Canal (ID / @handle)' });

  const channelId = await resolveChannelId(apiKey, channel);

  const ch = await httpRequest('GET', `${YT_API}/channels?part=contentDetails&id=${channelId}&key=${encodeURIComponent(apiKey)}`);
  if (ch.status !== 200) return res.status(200).json({ ok: false, error: ch.body?.error?.message || ('HTTP ' + ch.status) });
  const uploadsId = ch.body?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsId) return res.status(200).json({ ok: false, error: 'No encontré la lista de videos subidos del canal' });

  const limit = Math.min(Number(max) || 24, 50);
  const pl = await httpRequest('GET', `${YT_API}/playlistItems?part=contentDetails&playlistId=${uploadsId}&maxResults=${limit}&key=${encodeURIComponent(apiKey)}`);
  if (pl.status !== 200) return res.status(200).json({ ok: false, error: pl.body?.error?.message || ('HTTP ' + pl.status) });

  const ids = (pl.body?.items || []).map(it => it.contentDetails?.videoId).filter(Boolean);
  if (!ids.length) return res.status(200).json({ ok: true, channelId, totalItems: 0, items: [] });

  const vid = await httpRequest('GET', `${YT_API}/videos?part=snippet,contentDetails,statistics&id=${ids.join(',')}&key=${encodeURIComponent(apiKey)}`);
  if (vid.status !== 200) return res.status(200).json({ ok: false, error: vid.body?.error?.message || ('HTTP ' + vid.status) });

  const items = (vid.body?.items || []).map(v => {
    const seconds = parseISODuration(v.contentDetails?.duration);
    const isShort = seconds > 0 && seconds <= 60;
    return {
      videoId: v.id,
      title: v.snippet?.title,
      thumbnail: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url,
      publishedAt: v.snippet?.publishedAt,
      seconds,
      isShort,
      viewCount: v.statistics?.viewCount,
      url: isShort ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}`,
    };
  }).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  return res.status(200).json({ ok: true, channelId, totalItems: items.length, items });
}
