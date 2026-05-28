import { httpRequest, cors } from '../_http.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
      'User-Agent': 'Uniproveedores Agencia (ventas@distribuidorauniverso.com)'
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
