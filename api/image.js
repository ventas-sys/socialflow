export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { platform, productName, price, badge, photoDesc } = req.body;
  const OK = process.env.OPENAI_API_KEY;

  if (!OK) return res.status(500).json({ error: 'API key no configurada' });

  const sizeMap = { ig: '1024x1024', fb: '1792x1024', li: '1792x1024', tw: '1792x1024', wa: '1024x1024' };
  const styleMap = {
    ig: 'square Instagram post, vibrant lifestyle aesthetic, eye-catching colors',
    fb: 'wide Facebook ad banner, horizontal format, clean professional look',
    li: 'professional LinkedIn product photo, corporate style, neutral background',
    tw: 'wide Twitter/X card format, bold and modern design',
    wa: 'square product photo, clean background, WhatsApp sharing format'
  };

  const photoContext = photoDesc ? `The product looks like this: ${photoDesc}.` : '';
  const badgeText = badge && badge !== 'NINGUNO'
    ? `Include a bold "${badge}" promotional badge/ribbon in a corner of the image, with large visible text.`
    : '';
  const priceText = price ? `Display the price "$${price}" prominently in the image.` : '';

  const prompt = `Ultra-realistic premium product advertisement photograph.
${photoContext}
Product: ${productName}.
Format: ${styleMap[platform]}.
Visual style requirements: 8K ULTRA HD photorealistic quality, extreme attention to fine details and realistic textures, vibrant and precise colors, cinematic lighting, photographic hyperrealism, high quality visual effects, professional post-processing, lens flare and bokeh effects, premium e-commerce advertisement look.
${badgeText}
${priceText}
The image must look like a professional commercial photograph ready for social media advertising.`;

  try {
    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OK}`
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: sizeMap[platform] || '1024x1024',
        quality: 'hd',
        style: 'vivid'
      })
    });

    if (!r.ok) {
      const e = await r.json();
      throw new Error(e?.error?.message || `HTTP ${r.status}`);
    }

    const d = await r.json();
    const url = d?.data?.[0]?.url || '';
    res.status(200).json({ url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
