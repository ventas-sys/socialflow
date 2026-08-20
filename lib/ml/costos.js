// Lógica de costos, margen y rentabilidad para ventas en Mercado Libre Argentina.
// Mismos supuestos y tramos que recursos/Calculadora-Costos-Rentabilidad-MercadoLibre-Argentina.xlsx
// (hoja "Parámetros") — mantener ambos sincronizados si Mercado Libre cambia tarifas.

export const UMBRAL_ENVIO_GRATIS = 33000;

// Tabla de respaldo: solo se usa si la API de Mercado Libre no devuelve la comisión real.
export const COMISION_CATEGORIAS_FALLBACK = 0.135; // "Otras categorías (default)" de la planilla

// [desde $, costo fijo] — producto por debajo del umbral, con envío gratis
export const TRAMOS_PRECIO = [[0, 1100], [15000.01, 2250], [25000.01, 2700]];

// [desde kg, costo de envío] — Full o precio ≥ umbral (envío gratis obligatorio)
export const TRAMOS_PESO = [[0, 2500], [1.01, 4500], [5.01, 7500], [10.01, 11000], [20.01, 15500]];

export const DESCUENTO_FULL = { verde: 0.5, amarilla: 0.4, roja: 0 };
export const CARGO_CUOTAS = { 0: 0, 3: 0.0575, 6: 0.1075, 12: 0.18 };
export const IVA_PCT = 0.21;
export const IIBB_PCT = 0.035;
export const ALMACEN_FULL_MENSUAL = 300;

function buscarTramo(valor, tramos) {
  let costo = tramos[0][1];
  for (const [desde, c] of tramos) {
    if (valor >= desde) costo = c;
    else break;
  }
  return costo;
}

// Mapea la reputación de Mercado Libre (endpoint público /users/{id}) a los 3 niveles
// de descuento Full de la planilla. Aproximación documentada — ML no publica la regla exacta.
export function mapReputacion(sellerReputation) {
  const level = sellerReputation?.level_id;
  const power = sellerReputation?.power_seller_status;
  if (level === '5_green' || power === 'gold' || power === 'platinum') return 'verde';
  if (level === '4_light_green' || level === '3_yellow') return 'amarilla';
  return 'roja';
}

/**
 * Calcula comisión, costo fijo/envío, IVA, ingreso neto, ganancia, margen y rentabilidad.
 * @param {object} p
 * @param {number} p.price            Precio de venta ($)
 * @param {number} [p.cost=0]         Costo del producto ($)
 * @param {number} [p.otherCosts=0]   Otros costos directos ($)
 * @param {number} [p.weight=0]       Peso (kg), para el tramo de envío por peso
 * @param {boolean} [p.full=false]    Se despacha con Mercado Envíos Full
 * @param {boolean} [p.mercadoEnvios=true]  Se despacha por Mercado Envíos (Full, correo, colecta, puntos). false = retiro en persona / envío propio.
 * @param {boolean} [p.freeShipping]  Envío gratis (default: true si price >= UMBRAL_ENVIO_GRATIS)
 * @param {'verde'|'amarilla'|'roja'} [p.reputation='roja']
 * @param {0|3|6|12} [p.installments=0]  Cuotas sin interés ofrecidas
 * @param {'Responsable Inscripto'|'Monotributo'|'Exento'} [p.condicionFiscal='Monotributo']
 * @param {number|null} [p.comisionMonto=null]  Comisión real en $ (de la API de ML). Si es null, se estima con COMISION_CATEGORIAS_FALLBACK.
 */
export function calcularCostos({
  price,
  cost = 0,
  otherCosts = 0,
  weight = 0,
  full = false,
  mercadoEnvios = true,
  freeShipping,
  reputation = 'roja',
  installments = 0,
  condicionFiscal = 'Monotributo',
  comisionMonto = null,
}) {
  price = Number(price) || 0;
  cost = Number(cost) || 0;
  otherCosts = Number(otherCosts) || 0;
  weight = Number(weight) || 0;
  if (full) mercadoEnvios = true;
  const gratis = freeShipping === undefined ? price >= UMBRAL_ENVIO_GRATIS : !!freeShipping;

  const comision = comisionMonto != null ? Math.round(comisionMonto) : Math.round(price * COMISION_CATEGORIAS_FALLBACK);

  // Costo fijo por unidad vendida: lo pagan los productos < $33.000 despachados por
  // Mercado Envíos, AUNQUE el envío lo pague el comprador (ayuda ML "cambios-costos-venta").
  // No aplica a retiro en persona / envío propio.
  const costoFijoUnidad = mercadoEnvios && price > 0 && price < UMBRAL_ENVIO_GRATIS
    ? buscarTramo(price, TRAMOS_PRECIO) : 0;

  // Costo de envío gratis: obligatorio desde el umbral, opcional por debajo.
  // Con Full tiene descuento por reputación.
  let costoEnvioGratis = 0;
  if (gratis) {
    const descuento = full ? (DESCUENTO_FULL[reputation] ?? 0) : 0;
    costoEnvioGratis = Math.round(buscarTramo(weight, TRAMOS_PESO) * (1 - descuento));
  }
  const costoEnvio = costoFijoUnidad + costoEnvioGratis;

  const cargoCuotas = Math.round(price * (CARGO_CUOTAS[installments] ?? 0));
  const subtotal = comision + costoEnvio + cargoCuotas;
  const iva = Math.round(subtotal * IVA_PCT);
  const almacenamiento = full ? ALMACEN_FULL_MENSUAL : 0;
  const totalCostosML = subtotal + iva + almacenamiento;
  const iibb = Math.round(price * IIBB_PCT);
  const ingresoNeto = price - totalCostosML;

  const ivaRecuperable = condicionFiscal === 'Responsable Inscripto';
  const ganancia = ingresoNeto - cost - otherCosts + (ivaRecuperable ? iva : 0);
  const margen = price > 0 ? ganancia / price : 0;
  const baseCosto = cost + otherCosts;
  const rentabilidad = baseCosto > 0 ? ganancia / baseCosto : 0;

  return {
    freeShipping: gratis,
    mercadoEnvios,
    comision, comisionPct: price > 0 ? comision / price : 0,
    costoFijoUnidad, costoEnvioGratis,
    costoEnvio, costoEnvioPct: price > 0 ? costoEnvio / price : 0,
    cargoCuotas, cargoCuotasPct: price > 0 ? cargoCuotas / price : 0,
    subtotal,
    iva, ivaPct: price > 0 ? iva / price : 0,
    almacenamiento,
    totalCostosML, totalCostosMLPct: price > 0 ? totalCostosML / price : 0,
    iibb, iibbPct: price > 0 ? iibb / price : 0,
    ingresoNeto, ingresoNetoPct: price > 0 ? ingresoNeto / price : 0,
    ganancia, margen,
    rentabilidad,
    ivaRecuperable,
  };
}

/**
 * Precio de venta necesario para ganar `gananciaPct` sobre el costo (rentabilidad objetivo).
 * Resuelve por iteración porque los costos de ML no son lineales (tramos de costo fijo,
 * umbral de envío gratis). `comisionPct` es la comisión como fracción del precio
 * (de la API de ML si se conoce, o el default de la planilla).
 * Devuelve { precio, detalle } donde detalle es el desglose calcularCostos a ese precio.
 */
export function precioSugerido({ gananciaPct, comisionPct = COMISION_CATEGORIAS_FALLBACK, cost = 0, otherCosts = 0, ...opciones }) {
  const baseCosto = (Number(cost) || 0) + (Number(otherCosts) || 0);
  const objetivo = baseCosto * gananciaPct;
  let precio = Math.max(100, baseCosto * (1 + gananciaPct) / (1 - comisionPct * (1 + IVA_PCT)));
  let detalle = null;
  for (let i = 0; i < 60; i++) {
    detalle = calcularCostos({ ...opciones, price: precio, cost, otherCosts, comisionMonto: precio * comisionPct });
    const err = detalle.ganancia - objetivo;
    if (Math.abs(err) < 1) break;
    // la ganancia sube ~0.8 por cada peso de precio (1 - comisión con IVA); paso amortiguado
    precio = Math.max(100, precio - err / 0.8);
  }
  precio = Math.ceil(precio);
  detalle = calcularCostos({ ...opciones, price: precio, cost, otherCosts, comisionMonto: precio * comisionPct });
  return { precio, gananciaObjetivo: Math.round(objetivo), detalle };
}
