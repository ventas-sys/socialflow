// Cuánto se le paga al motoquero por zona. ML no sabe este número (sale del
// bolsillo nuestro), así que se carga a mano desde la solapa Envíos.
//
// Se guarda por VIGENCIA, no como un valor suelto: cuando suben los precios se
// agrega una vigencia nueva con su fecha y los envíos viejos siguen valiendo lo
// que valían ese día. Si se pisara el valor único, el reporte del mes pasado
// cambiaría solo y dejaría de cerrar con lo que realmente se pagó.

export const ZONAS = [
  ['cercana', 'Cercana'],
  ['media', 'Media dist.'],
  ['lejana', 'Lejana'],
  ['muylejana', 'Muy lejana'],
]

export const TARIFAS_DEFAULT = [
  { desde: '2000-01-01', cercana: 2750, media: 4500, lejana: 6000, muylejana: 8000 },
  { desde: '2026-09-01', cercana: 3000, media: 4500, lejana: 6000, muylejana: 7500 },
]

const ymd = (fecha) => {
  if (!fecha) return ''
  const ms = fecha?.toMillis ? fecha.toMillis() : new Date(fecha).getTime()
  if (!ms) return ''
  // En hora argentina: un envío de las 22hs no tiene que contar como del día siguiente
  return new Date(ms - 3 * 3600 * 1000).toISOString().slice(0, 10)
}

/** La vigencia que corresponde a esa fecha (la última que empezó antes o ese día) */
export function tarifaEn(fecha, tarifas = TARIFAS_DEFAULT) {
  const lista = (tarifas?.length ? tarifas : TARIFAS_DEFAULT)
    .slice()
    .sort((a, b) => String(a.desde).localeCompare(String(b.desde)))
  const dia = ymd(fecha)
  let elegida = lista[0]
  for (const t of lista) {
    if (!dia || String(t.desde) <= dia) elegida = t
  }
  return elegida || {}
}

/** Cuánto se le paga al motoquero por un envío de esa zona en esa fecha */
export function pagoMoto(zona, fecha, tarifas) {
  if (!zona) return 0
  return Number(tarifaEn(fecha, tarifas)[zona]) || 0
}

export default tarifaEn
