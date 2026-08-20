import { httpRequest, cors } from '../../lib/http.js';
import { calcularCostos, mapReputacion, precioSugerido, COMISION_CATEGORIAS_FALLBACK } from '../../lib/ml/costos.js';

const LISTING_TYPE = { 'Clásica': 'gold_special', Premium: 'gold_pro' };

// Mercado Libre usa varios formatos de link/ID para lo mismo, y no publica un mapeo
// oficial y estable entre ellos:
//  - publicación puntual de un vendedor: .../MLA-123456789-titulo-_JM  -> ítem directo (MLA...)
//  - página de catálogo (varios vendedores compitiendo): .../p/MLA123456   -> "producto" (buy box)
//  - "user product" (variaciones sin catálogo compartido): .../up/MLAU123456 -> producto de 1 vendedor
// En vez de mantener una lista rígida de formatos de URL (frágil ante cambios de ML),
// se extrae cualquier token con pinta de ID de Mercado Libre y se prueba a resolverlo
// contra los 3 recursos posibles, en orden, hasta encontrar un ítem real.
function extractMlToken(input) {
  const s = String(input || '').trim();
  // Los links de "Compartir" y los de catálogo suelen traer el ítem puntual como parámetro
  // (pdp_filters=item_id:MLA... o wid=MLA...) — ese es el ID más preciso, va primero.
  const param = s.match(/(?:item_id[:=]|[?&#]wid=)(ML[A-Z]{0,2})-?(\d{6,})/i);
  if (param) return (param[1] + param[2]).toUpperCase();
  const m = s.match(/\bML[A-Z]{0,2}-?(\d{6,})\b/i);
  if (m) return m[0].replace('-', '').toUpperCase();
  const bare = s.match(/^\d{6,}$/);
  if (bare) return 'MLA' + bare[0];
  return null;
}

// Busca publicaciones activas parecidas en ML y arma min / promedio / mediana / max.
// El endpoint de búsqueda de ML puede exigir token según la app — si hay token de
// /conexiones se usa; si la búsqueda falla se devuelve el motivo en vez de romper.
async function buscarMercado(query, token) {
  try {
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    const r = await httpRequest('GET',
      'https://api.mercadolibre.com/sites/MLA/search?q=' + encodeURIComponent(query) + '&limit=50',
      headers, null);
    const results = r.body?.results;
    if (r.status !== 200 || !Array.isArray(results)) {
      return { ok: false, motivo: 'Mercado Libre no dejó buscar (HTTP ' + r.status + ')' + (token ? '' : ' — conectá tu cuenta en /conexiones para habilitar el análisis de mercado') };
    }
    const items = results
      .filter(x => Number.isFinite(x.price) && x.price > 0)
      .map(x => ({ title: x.title, price: x.price, permalink: x.permalink }));
    if (!items.length) return { ok: false, motivo: 'No encontré publicaciones parecidas' };
    const orden = [...items].sort((a, b) => a.price - b.price);
    const precios = orden.map(x => x.price);
    const mid = Math.floor(precios.length / 2);
    return {
      ok: true,
      consulta: query,
      cantidad: precios.length,
      promedio: Math.round(precios.reduce((a, b) => a + b, 0) / precios.length),
      mediana: Math.round(precios.length % 2 ? precios[mid] : (precios[mid - 1] + precios[mid]) / 2),
      masBarato: orden[0],
      masCaro: orden[orden.length - 1],
    };
  } catch (e) {
    return { ok: false, motivo: e.message };
  }
}

async function resolveToItem(token) {
  const direct = await httpRequest('GET', 'https://api.mercadolibre.com/items/' + token, {}, null);
  if (direct.status === 200) return direct.body;

  if (/^MLAU/i.test(token)) {
    const upR = await httpRequest('GET', 'https://api.mercadolibre.com/user-products/' + token, {}, null);
    if (upR.status === 200) {
      const b = upR.body || {};
      const candidate = b.item_id || b.buy_box_winner?.item_id
        || (Array.isArray(b.items) && b.items[0]?.id)
        || (Array.isArray(b.variations) && b.variations[0]?.item_id);
      if (candidate) {
        const r = await httpRequest('GET', 'https://api.mercadolibre.com/items/' + candidate, {}, null);
        if (r.status === 200) return r.body;
      }
    }
  }

  const prodR = await httpRequest('GET', 'https://api.mercadolibre.com/products/' + token, {}, null);
  if (prodR.status === 200) {
    const b = prodR.body || {};
    const candidate = b.buy_box_winner?.item_id || b.buy_box_winner_item_id;
    if (candidate) {
      const r = await httpRequest('GET', 'https://api.mercadolibre.com/items/' + candidate, {}, null);
      if (r.status === 200) return r.body;
    }
  }

  return null;
}

function extractWeightKg(item) {
  const attr = (item.attributes || []).find(a => a.id === 'WEIGHT' || a.id === 'PACKAGE_WEIGHT' || a.id === 'PACKAGE_HEIGHT_WEIGHT');
  const raw = attr?.value_name;
  if (!raw) return 0;
  const m = String(raw).match(/([\d.,]+)\s*(kg|g)/i);
  if (!m) return 0;
  let v = parseFloat(m[1].replace(',', '.'));
  if (/^g/i.test(m[2])) v = v / 1000;
  return Number.isFinite(v) ? v : 0;
}

async function fetchComisionMonto(price, listingTypeId, categoryId) {
  try {
    const feeUrl = 'https://api.mercadolibre.com/sites/MLA/listing_prices?price=' + price +
      '&listing_type_id=' + encodeURIComponent(listingTypeId) + '&category_id=' + encodeURIComponent(categoryId);
    const feeR = await httpRequest('GET', feeUrl, {}, null);
    const feeBody = Array.isArray(feeR.body) ? feeR.body[0] : feeR.body;
    if (feeR.status === 200 && feeBody && feeBody.sale_fee_amount != null) {
      return { comisionMonto: feeBody.sale_fee_amount, comisionFuente: 'real (API de Mercado Libre)' };
    }
  } catch (e) { /* si falla, calcularCostos cae al % estimado */ }
  return { comisionMonto: null, comisionFuente: 'estimada' };
}

async function calcularPorItem(body, res) {
  const { url, cost, otherCosts, installments, condicionFiscal, gananciaPct, mlToken } = body;
  if (!url) return res.status(400).json({ ok: false, error: 'Falta el link de la publicación' });
  const token = extractMlToken(url);
  if (!token) return res.status(400).json({ ok: false, error: 'No pude identificar el ID de la publicación en ese link' });

  const item = await resolveToItem(token);
  if (!item) {
    return res.status(200).json({
      ok: false,
      error: 'No pude resolver esa publicación (' + token + '). Puede ser un link de catálogo o de variación que Mercado Libre no me deja resolver del todo. Probá con el link de una publicación puntual (formato .../MLA-123456789-titulo) o con el link corto del botón "Compartir" de la publicación.',
    });
  }
  const price = item.price;
  const categoryId = item.category_id;
  const listingTypeId = item.listing_type_id;
  const freeShipping = !!item.shipping?.free_shipping;
  const isFull = item.shipping?.logistic_type === 'fulfillment';
  const weight = extractWeightKg(item);

  let reputation = 'roja';
  try {
    const sellerR = await httpRequest('GET', 'https://api.mercadolibre.com/users/' + item.seller_id, {}, null);
    if (sellerR.status === 200) reputation = mapReputacion(sellerR.body?.seller_reputation);
  } catch (e) { /* la reputación es un dato secundario, seguimos sin ella */ }

  const [{ comisionMonto, comisionFuente }, mercado] = await Promise.all([
    fetchComisionMonto(price, listingTypeId, categoryId),
    buscarMercado(item.title, mlToken),
  ]);

  const opciones = {
    cost: Number(cost) || 0, otherCosts: Number(otherCosts) || 0,
    weight, full: isFull, freeShipping, reputation,
    installments: Number(installments) || 0, condicionFiscal: condicionFiscal || 'Monotributo',
  };
  const calc = calcularCostos({ ...opciones, price, comisionMonto });

  let sugerido = null;
  const g = Number(gananciaPct);
  if (g > 0 && (opciones.cost + opciones.otherCosts) > 0) {
    const pct = comisionMonto != null && price > 0 ? comisionMonto / price : COMISION_CATEGORIAS_FALLBACK;
    sugerido = { gananciaPct: g, ...precioSugerido({ ...opciones, gananciaPct: g, comisionPct: pct }) };
  }

  return res.status(200).json({
    ok: true,
    item: {
      id: item.id, title: item.title, price, permalink: item.permalink,
      categoryId, listingTypeId, freeShipping, isFull, weight, reputation,
    },
    comisionFuente,
    mercado,
    sugerido,
    ...calc,
  });
}

async function calcularPorArticulo(body, res) {
  const {
    titulo, price, cost, otherCosts, weight, full, freeShipping,
    reputation, installments, condicionFiscal, tipoPublicacion, gananciaPct, mlToken,
  } = body;
  if (!titulo) return res.status(400).json({ ok: false, error: 'Falta el título/descripción del artículo' });
  if (!price) return res.status(400).json({ ok: false, error: 'Falta el precio de venta estimado' });

  const predictR = await httpRequest('GET',
    'https://api.mercadolibre.com/sites/MLA/category_predictor/predict?title=' + encodeURIComponent(titulo),
    {}, null);
  if (predictR.status !== 200 || !predictR.body?.id) {
    return res.status(200).json({ ok: false, error: predictR.body?.message || 'No pude predecir la categoría para ese artículo' });
  }
  const categoryId = predictR.body.id;
  const categoryName = predictR.body.name;
  const path = (predictR.body.path_from_root || []).map(p => p.name).join(' › ');

  const listingTypeId = LISTING_TYPE[tipoPublicacion] || 'gold_special';
  const [{ comisionMonto, comisionFuente }, mercado] = await Promise.all([
    fetchComisionMonto(Number(price), listingTypeId, categoryId),
    buscarMercado(titulo, mlToken),
  ]);

  const opciones = {
    cost: Number(cost) || 0, otherCosts: Number(otherCosts) || 0,
    weight: Number(weight) || 0, full: !!full,
    freeShipping: freeShipping === undefined || freeShipping === '' ? undefined : !!freeShipping,
    reputation: reputation || 'roja', installments: Number(installments) || 0,
    condicionFiscal: condicionFiscal || 'Monotributo',
  };
  const calc = calcularCostos({ ...opciones, price: Number(price), comisionMonto });

  let sugerido = null;
  const g = Number(gananciaPct);
  if (g > 0 && (opciones.cost + opciones.otherCosts) > 0) {
    const pct = comisionMonto != null && Number(price) > 0 ? comisionMonto / Number(price) : COMISION_CATEGORIAS_FALLBACK;
    sugerido = { gananciaPct: g, ...precioSugerido({ ...opciones, gananciaPct: g, comisionPct: pct }) };
  }

  return res.status(200).json({
    ok: true, categoryId, categoryName, path, listingTypeId, comisionFuente, mercado, sugerido, ...calc,
  });
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const body = req.body || {};
  const mode = body.mode || (body.url ? 'item' : 'articulo');

  try {
    if (mode === 'item') return await calcularPorItem(body, res);
    return await calcularPorArticulo(body, res);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
