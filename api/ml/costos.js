import { httpRequest, cors } from '../../lib/http.js';
import { calcularCostos, mapReputacion } from '../../lib/ml/costos.js';

const LISTING_TYPE = { 'Clásica': 'gold_special', Premium: 'gold_pro' };

function extractItemId(input) {
  const s = String(input || '').trim();
  const m = s.match(/MLA-?(\d{6,})/i);
  if (m) return 'MLA' + m[1];
  const n = s.match(/^\d{6,}$/);
  if (n) return 'MLA' + n[0];
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
  const { url, cost, otherCosts, installments, condicionFiscal } = body;
  if (!url) return res.status(400).json({ ok: false, error: 'Falta el link de la publicación' });
  const itemId = extractItemId(url);
  if (!itemId) return res.status(400).json({ ok: false, error: 'No pude identificar el ID de la publicación (formato MLA123456789) en ese link' });

  const itemR = await httpRequest('GET', 'https://api.mercadolibre.com/items/' + itemId, {}, null);
  if (itemR.status !== 200) {
    return res.status(200).json({ ok: false, error: itemR.body?.message || ('No encontré esa publicación (HTTP ' + itemR.status + ')') });
  }
  const item = itemR.body;
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

  const { comisionMonto, comisionFuente } = await fetchComisionMonto(price, listingTypeId, categoryId);

  const calc = calcularCostos({
    price, cost: Number(cost) || 0, otherCosts: Number(otherCosts) || 0,
    weight, full: isFull, freeShipping, reputation,
    installments: Number(installments) || 0, condicionFiscal: condicionFiscal || 'Monotributo',
    comisionMonto,
  });

  return res.status(200).json({
    ok: true,
    item: {
      id: item.id, title: item.title, price, permalink: item.permalink,
      categoryId, listingTypeId, freeShipping, isFull, weight, reputation,
    },
    comisionFuente,
    ...calc,
  });
}

async function calcularPorArticulo(body, res) {
  const {
    titulo, price, cost, otherCosts, weight, full, freeShipping,
    reputation, installments, condicionFiscal, tipoPublicacion,
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
  const { comisionMonto, comisionFuente } = await fetchComisionMonto(Number(price), listingTypeId, categoryId);

  const calc = calcularCostos({
    price: Number(price), cost: Number(cost) || 0, otherCosts: Number(otherCosts) || 0,
    weight: Number(weight) || 0, full: !!full,
    freeShipping: freeShipping === undefined || freeShipping === '' ? undefined : !!freeShipping,
    reputation: reputation || 'roja', installments: Number(installments) || 0,
    condicionFiscal: condicionFiscal || 'Monotributo', comisionMonto,
  });

  return res.status(200).json({
    ok: true, categoryId, categoryName, path, listingTypeId, comisionFuente, ...calc,
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
