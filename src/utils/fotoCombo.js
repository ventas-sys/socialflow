// De dónde sale la foto de un combo.
//
// Casi todos los combos son UN SOLO artículo repetido (3 llaveros, 10 trabas):
// ahí la foto del producto base es exactamente lo que hay que ver al armarlo.
// Si el combo mezcla productos DISTINTOS ninguna foto lo representa, y mostrar
// la del primero engaña a quien arma, así que queda sin foto.
//
// Esto vivía copiado en Inventario y en Envío a Full, y la solapa Combos ni
// siquiera lo aplicaba: mostraba sólo la foto propia. Por eso está acá.
//
// `byId` puede ser un Map de productos o un array.
export function fotoDeCombo(combo, byId) {
  const buscar = byId instanceof Map
    ? (id) => byId.get(id)
    : (id) => byId.find(p => p.id === id)

  if (combo?.hasPhotos) {
    return { fotoId: combo.id, fotoKind: 'combo', hasPhotos: true, motivo: 'propia' }
  }

  const ids = [...new Set((combo?.items || []).map(it => it.productId).filter(Boolean))]

  if (ids.length === 0) {
    return { fotoId: combo.id, fotoKind: 'combo', hasPhotos: false, motivo: 'sin-armado' }
  }
  if (ids.length > 1) {
    return { fotoId: combo.id, fotoKind: 'combo', hasPhotos: false, motivo: 'mezcla' }
  }

  const base = buscar(ids[0])
  if (!base) {
    return { fotoId: combo.id, fotoKind: 'combo', hasPhotos: false, motivo: 'base-borrado' }
  }
  if (!base.hasPhotos) {
    return {
      fotoId: combo.id, fotoKind: 'combo', hasPhotos: false,
      motivo: 'base-sin-foto', baseId: base.id, baseNombre: base.name,
    }
  }
  return {
    fotoId: base.id, fotoKind: 'product', hasPhotos: true,
    motivo: 'heredada', baseId: base.id, baseNombre: base.name,
  }
}

// Por qué un combo no muestra foto, en criollo y listo para poner en pantalla.
export const porQueSinFoto = (f) => ({
  'mezcla': 'Mezcla productos distintos: ninguna foto lo representa',
  'sin-armado': 'No tiene armado cargado',
  'base-borrado': 'El producto base ya no existe',
  'base-sin-foto': `Falta la foto del producto base${f?.baseNombre ? `: ${f.baseNombre}` : ''}`,
}[f?.motivo] || '')
