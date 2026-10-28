// Calcula el "Precio de lista" (original_price) de una publicación: un
// número redondo que, comparado con el precio de venta, deja un descuento
// de entre minOff y maxOff (apuntando a anchorOff, por default 30%).
//
// Preferimos redondear al millar; si eso no cae dentro del rango de
// descuento buscado, probamos con pasos más chicos (500, 100, 50, 10) para
// que nunca se pase del máximo: con precios bajos (< ~$10.000) el millar o
// el 500 suelen dejar 33-35% OFF.
//
// Verificado contra publicaciones reales de Uniproveedores:
//   $15.454,43 -> $22.000 (29.8% OFF, coincide con el cargado a mano)
//   $2.278,94  -> $3.300  (30.9% OFF; con 500 daba $3.500 = 34.9%)
//
// Devuelve null si ningún redondeo deja el descuento en rango (precios
// ínfimos, ej. $11): en ese caso no conviene cargar precio de lista.
export function computeListPrice(price, opts = {}) {
  const { minOff = 0.25, maxOff = 0.31, anchorOff = 0.30 } = opts;
  if (!(price > 0)) throw new Error('precio inválido: ' + price);
  const raw = price / (1 - anchorOff);
  for (const step of [1000, 500, 100, 50, 10]) {
    const rounded = Math.round(raw / step) * step;
    const off = 1 - price / rounded;
    if (off >= minOff && off <= maxOff) return { original_price: rounded, off };
  }
  return null;
}
