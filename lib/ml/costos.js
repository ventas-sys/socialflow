// Lógica de costos, margen y rentabilidad para ventas en Mercado Libre Argentina.
// Mismos supuestos y tramos que recursos/Calculadora-Costos-Rentabilidad-MercadoLibre-Argentina.xlsx
// (hoja "Parámetros") — mantener ambos sincronizados si Mercado Libre cambia tarifas.

export const UMBRAL_ENVIO_GRATIS = 33000;

// IMPORTANTE (verificado contra los reportes de facturación 10/2026): los montos que
// cobra ML (comisión, costo fijo, envíos, colecta, almacenamiento) son FINALES con el
// IVA ya incluido adentro. El IVA contenido (monto × 0,21/1,21) es crédito fiscal para
// Responsable Inscripto.

// Tabla de respaldo: solo se usa si la API de Mercado Libre no devuelve la comisión real.
// Final c/IVA. Reales por categoría: Bazar 14,35% · Herramientas 14,5% · rango 13,5%-16%.
export const COMISION_CATEGORIAS_FALLBACK = 0.1435;

// [desde $, costo fijo FINAL c/IVA] — producto por debajo del umbral, por Mercado Envíos.
// Reales de liquidaciones 09-10/2026: <15k $1.330 (subiendo: se vieron $1.370-1.470);
// 15-25k $2.740-2.780. El tramo 25-33k sigue ESTIMADO: confirmar con una venta real.
// OJO: el tramo lo define el PRECIO DE VENTA FINAL (con IVA), no el costo.
export const TRAMOS_PRECIO = [[0, 1330], [15000.01, 2780], [25000.01, 3300]];

// [desde kg, costo de envío FINAL c/IVA] — precio ≥ umbral (envío gratis obligatorio).
// Cargos reales observados en liquidaciones 10/2026 de la cuenta (reputación verde):
// típico $7.490-8.990, pesados hasta $17.490. Asignación por peso aproximada.
export const TRAMOS_PESO = [[0, 7490], [1.01, 8590], [5.01, 11490], [10.01, 14190], [20.01, 17490]];

// Los TRAMOS_PESO ya son los cargos reales de una cuenta verde: no se aplica descuento extra.
export const DESCUENTO_FULL = { verde: 0, amarilla: 0, roja: 0 };
export const CARGO_CUOTAS = { 0: 0, 3: 0.0575, 6: 0.1075, 12: 0.18 };
export const IVA_PCT = 0.21;
// Retenciones reales por cobro (ICD 0,6% + SIRTAC 0,1% + IIBB provincial) — informativo.
export const IIBB_PCT = 0.0072;
// Almacenamiento Full por unidad/mes, tamaño pequeño ($0,75/día). Mediana $72, grande $600, XG $1.950.
export const ALMACEN_FULL_MENSUAL = 22.5;

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
  // Todos los cargos son finales con IVA incluido; `iva` es el IVA CONTENIDO en ellos
  // (crédito fiscal para RI), no un adicional.
  const subtotal = comision + costoEnvio + cargoCuotas;
  const iva = Math.round(subtotal * IVA_PCT / (1 + IVA_PCT));
  const almacenamiento = full ? ALMACEN_FULL_MENSUAL : 0;
  const totalCostosML = subtotal + almacenamiento;
  const iibb = Math.round(price * IIBB_PCT);
  const ingresoNeto = price - totalCostosML;

  const ivaRecuperable = condicionFiscal === 'Responsable Inscripto';
  // RI trabaja a netos: ingreso neto de IVA débito (price/1,21) menos costo neto menos
  // cargos ML netos (sin el IVA contenido, que es crédito). Monotributo/Exento: el precio
  // es ingreso final y los cargos se pagan completos.
  const ganancia = ivaRecuperable
    ? Math.round(price / (1 + IVA_PCT) - cost - otherCosts - (totalCostosML - iva))
    : ingresoNeto - cost - otherCosts;
  const baseIngreso = ivaRecuperable ? price / (1 + IVA_PCT) : price;
  const margen = price > 0 ? ganancia / baseIngreso : 0;
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
  // comisionPct ya es final (IVA incluido), no se le agrega IVA.
  let precio = Math.max(100, baseCosto * (1 + gananciaPct) / (1 - comisionPct));
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
