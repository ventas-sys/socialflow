import JSZip from 'jszip'
import { compressImage, MAX_PHOTOS, MAX_PHOTOS_BYTES, photosSize } from './images'

// Extrae las imágenes pegadas en un .xlsx y las devuelve agrupadas por fila
// de la hoja (0 = encabezado, 1 = primer producto, etc.). Las imágenes deben
// estar insertadas ancladas a la fila del producto correspondiente.
export async function extractImagesByRow(buffer) {
  const byRow = new Map()
  try {
    const zip = await JSZip.loadAsync(buffer)
    const drawingNames = Object.keys(zip.files).filter(n =>
      /^xl\/drawings\/drawing\d+\.xml$/.test(n)
    )

    for (const name of drawingNames) {
      const xmlText = await zip.file(name).async('text')
      const doc = new DOMParser().parseFromString(xmlText, 'application/xml')

      // Relaciones rId -> archivo de imagen en xl/media/
      const relsName = name.replace('xl/drawings/', 'xl/drawings/_rels/') + '.rels'
      const rels = {}
      const relsFile = zip.file(relsName)
      if (relsFile) {
        const relsDoc = new DOMParser().parseFromString(
          await relsFile.async('text'),
          'application/xml'
        )
        const relEls = relsDoc.getElementsByTagName('Relationship')
        for (const rel of relEls) {
          rels[rel.getAttribute('Id')] = rel.getAttribute('Target')
        }
      }

      const anchors = [
        ...doc.getElementsByTagNameNS('*', 'twoCellAnchor'),
        ...doc.getElementsByTagNameNS('*', 'oneCellAnchor'),
      ]

      for (const anchor of anchors) {
        const fromEl = anchor.getElementsByTagNameNS('*', 'from')[0]
        if (!fromEl) continue
        const rowEl = fromEl.getElementsByTagNameNS('*', 'row')[0]
        if (!rowEl) continue
        const row = parseInt(rowEl.textContent, 10)
        if (isNaN(row)) continue

        const blip = anchor.getElementsByTagNameNS('*', 'blip')[0]
        if (!blip) continue
        const rid =
          blip.getAttribute('r:embed') ||
          blip.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed')
        let target = rels[rid]
        if (!target) continue
        target = target.replace(/^\.\.\//, 'xl/').replace(/^\//, '')
        const imgFile = zip.file(target)
        if (!imgFile) continue

        const blob = new Blob([await imgFile.async('arraybuffer')])
        let dataUrl
        try {
          dataUrl = await compressImage(blob)
        } catch {
          continue
        }

        const list = byRow.get(row) || []
        if (list.length < MAX_PHOTOS && photosSize([...list, dataUrl]) <= MAX_PHOTOS_BYTES) {
          list.push(dataUrl)
          byRow.set(row, list)
        }
      }
    }
  } catch (e) {
    console.warn('No se pudieron extraer imágenes del Excel:', e)
  }
  return byRow
}
