// Calcula el "Precio de lista" (original_price) de una publicación: un
// número redondo que, comparado con el precio de venta, deja un descuento
// de entre minOff y maxOff (apuntando a anchorOff, por default 30%).
//
// Preferimos redondear al millar; si eso no cae dentro del rango de
// descuento buscado, caemos a redondear a 500 (el mínimo que se usa acá).
//
// Verificado contra 2 publicaciones reales de Uniproveedores:
//   $15.454,43 -> $22.000 (29.7% OFF)
//   $6.544     -> $9.000  (27.3% OFF, redondeado al millar)
export function computeListPrice(price, opts = {}) {
  const { minOff = 0.25, maxOff = 0.31, anchorOff = 0.30 } = opts;
  if (!(price > 0)) throw new Error('precio inválido: ' + price);
  const raw = price / (1 - anchorOff);
  for (const step of [1000, 500]) {
    const rounded = Math.round(raw / step) * step;
    const off = 1 - price / rounded;
    if (off >= minOff && off <= maxOff) return { original_price: rounded, off };
  }
  // Ningún redondeo cayó en el rango (precios muy chicos/raros): usamos 500
  // igual, es el mejor esfuerzo.
  const rounded = Math.round(raw / 500) * 500;
  return { original_price: rounded, off: 1 - price / rounded };
}
