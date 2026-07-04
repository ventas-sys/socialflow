// Comprime una imagen a JPEG chico para guardarla dentro del documento de
// Firestore (límite 1 MB por documento) sin necesitar Firebase Storage.
export function compressImage(file, maxDim = 700, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
        const width = Math.round(img.width * scale)
        const height = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d').drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.onerror = () => reject(new Error('No se pudo leer la imagen'))
      img.src = reader.result
    }
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'))
    reader.readAsDataURL(file)
  })
}

export const MAX_PHOTOS = 5

// Tamaño total máximo de fotos por producto (margen bajo el límite de 1 MB de Firestore)
export const MAX_PHOTOS_BYTES = 850_000

export function photosSize(photos) {
  return photos.reduce((sum, p) => sum + p.length, 0)
}
