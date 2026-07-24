import { httpRequest, cors } from '../_http.js';
import { calcularCostos } from '../../lib/ml/costos.js';

const LISTING_TYPE = { 'Clásica': 'gold_special', Premium: 'gold_pro' };

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const {
    titulo, price, cost, otherCosts, weight, full, freeShipping,
    reputation, installments, condicionFiscal, tipoPublicacion,
  } = req.body || {};
  if (!titulo) return res.status(400).json({ ok: false, error: 'Falta el título/descripción del artículo' });
  if (!price) return res.status(400).json({ ok: false, error: 'Falta el precio de venta estimado' });

  try {
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
    let comisionMonto = null;
    let comisionFuente = 'estimada';
    try {
      const feeUrl = 'https://api.mercadolibre.com/sites/MLA/listing_prices?price=' + Number(price) +
        '&listing_type_id=' + listingTypeId + '&category_id=' + categoryId;
      const feeR = await httpRequest('GET', feeUrl, {}, null);
      const feeBody = Array.isArray(feeR.body) ? feeR.body[0] : feeR.body;
      if (feeR.status === 200 && feeBody && feeBody.sale_fee_amount != null) {
        comisionMonto = feeBody.sale_fee_amount;
        comisionFuente = 'real (API de Mercado Libre)';
      }
    } catch (e) { /* si falla, calcularCostos cae al % estimado */ }

    const calc = calcularCostos({
      price: Number(price),
      cost: Number(cost) || 0,
      otherCosts: Number(otherCosts) || 0,
      weight: Number(weight) || 0,
      full: !!full,
      freeShipping: freeShipping === undefined || freeShipping === '' ? undefined : !!freeShipping,
      reputation: reputation || 'roja',
      installments: Number(installments) || 0,
      condicionFiscal: condicionFiscal || 'Monotributo',
      comisionMonto,
    });

    return res.status(200).json({
      ok: true,
      categoryId,
      categoryName,
      path,
      listingTypeId,
      comisionFuente,
      ...calc,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
