import { httpRequest, cors } from './_http.js';

const UA = 'Uniproveedores Agencia (ventas@distribuidorauniverso.com)';

async function handleTest(req, res) {
  const { token, storeId } = req.body || {};
  if (!token || !storeId) return res.status(400).json({ ok: false, error: 'Falta token y/o storeId' });

  try {
    const r = await httpRequest('GET', `https://api.tiendanube.com/v1/${storeId}/store`, {
      'Authentication': 'bearer ' + token,
      'User-Agent': UA
    });
    if (r.status !== 200) {
      return res.status(200).json({
        ok: false,
        error: r.body?.message || r.body?.description || ('HTTP ' + r.status),
        status: r.status,
        details: r.body
      });
    }
    return res.status(200).json({
      ok: true,
      info: {
        storeId: r.body.id,
        storeName: r.body.name?.es || r.body.name?.pt || (typeof r.body.name === 'string' ? r.body.name : 'Mi Tienda'),
        url: r.body.url,
        country: r.body.country,
        currency: r.body.main_currency,
        plan: r.body.plan_name,
        domains: r.body.domains
      }
    });
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

async function handleExchange(req, res) {
  const { clientId, clientSecret, code } = req.body || {};
  if (!clientId || !clientSecret || !code) {
    return res.status(400).json({ ok: false, error: 'Faltan: clientId, clientSecret, code' });
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code
  }).toString();

  try {
    const r = await httpRequest('POST', 'https://www.tiendanube.com/apps/authorize/token', {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    }, body);

    if (r.status !== 200 || !r.body?.access_token) {
      return res.status(200).json({
        ok: false,
        error: r.body?.error_description || r.body?.error || r.body?.message || ('HTTP ' + r.status),
        details: r.body
      });
    }

    return res.status(200).json({
      ok: true,
      accessToken: r.body.access_token,
      storeId: r.body.user_id,
      tokenType: r.body.token_type,
      scope: r.body.scope
    });
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

async function handlePublish(req, res) {
  const { token, storeId, product } = req.body || {};
  if (!token || !storeId) return res.status(400).json({ ok: false, error: 'Falta token y/o storeId' });
  if (!product?.name || product.price === undefined) return res.status(400).json({ ok: false, error: 'Faltan campos: name, price' });

  const body = {
    name: { es: product.name },
    description: { es: product.htmlDescription || product.description || '' },
    handle: product.slug ? { es: product.slug } : undefined,
    seo_title: product.metaTitle ? { es: product.metaTitle } : undefined,
    seo_description: product.metaDesc ? { es: product.metaDesc } : undefined,
    tags: Array.isArray(product.tags) ? product.tags.join(',') : (product.tags || ''),
    published: product.published === true,
    free_shipping: !!product.freeShipping,
    variants: [{
      price: String(product.price),
      promotional_price: product.promoPrice ? String(product.promoPrice) : null,
      stock_management: true,
      stock: Number(product.stock || 1),
      weight: String(product.weight || '0.500'),
      sku: product.sku || null
    }],
    images: (product.images || []).map(src => ({ src }))
  };

  Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);

  try {
    const r = await httpRequest('POST', `https://api.tiendanube.com/v1/${storeId}/products`, {
      'Authentication': 'bearer ' + token,
      'Content-Type': 'application/json',
      'User-Agent': UA
    }, body);
    if (r.status >= 400) {
      return res.status(200).json({
        ok: false,
        error: r.body?.message || r.body?.description || ('HTTP ' + r.status),
        details: r.body
      });
    }
    return res.status(200).json({
      ok: true,
      productId: r.body.id,
      handle: r.body.handle,
      adminUrl: 'https://' + (r.body.canonical_url || ('mitienda.tiendanube.com/admin/products/' + r.body.id))
    });
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const action = req.query?.action || req.body?.action || '';
  if (action === 'test') return handleTest(req, res);
  if (action === 'exchange') return handleExchange(req, res);
  if (action === 'publish') return handlePublish(req, res);
  return res.status(400).json({ error: 'action requerida: test | exchange | publish' });
}
