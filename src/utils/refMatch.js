// Búsqueda de productos/combos por código, SKU o código de barras.
//
// Excel guarda "0558" como el número 558 y al leerlo se pierden los ceros de
// adelante, así que un armado que apunta al producto 0558 llega como "558" y no
// matchea. Por eso, si no hay coincidencia exacta, se compara ignorando los
// ceros iniciales — pero SOLO si esa comparación deja un único candidato, para
// no confundir dos productos distintos (0075 y 75) y descontar el equivocado.

export const barcodesOf = (x) =>
  (x?.barcodes?.length ? x.barcodes : (x?.barcode ? [x.barcode] : []))

const sinCeros = (v) => String(v).replace(/^0+/, '')

const refsOf = (x) => [x?.code, ...barcodesOf(x)].filter(Boolean).map(v => String(v))

export function findByRef(list, ref) {
  const q = String(ref ?? '').trim().toLowerCase()
  if (!q || !Array.isArray(list)) return null

  const exacto = list.find(x => refsOf(x).some(v => v.toLowerCase() === q))
  if (exacto) return exacto

  // Solo códigos numéricos: "0558" vs "558"
  if (!/^\d+$/.test(q)) return null
  const n = sinCeros(q)
  const candidatos = list.filter(x =>
    refsOf(x).some(v => /^\d+$/.test(v) && sinCeros(v) === n)
  )
  return candidatos.length === 1 ? candidatos[0] : null
}

// Busca primero entre productos y después entre combos
export function findProductOrCombo(products, combos, ref) {
  const p = findByRef(products, ref)
  if (p) return { type: 'product', p }
  const c = findByRef(combos, ref)
  if (c) return { type: 'combo', c }
  return null
}
