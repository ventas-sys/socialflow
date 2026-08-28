import React, { useState, useEffect, useRef } from 'react'

// Miniatura que carga su foto solo cuando entra en pantalla (IntersectionObserver)
// y solo si el producto/combo tiene fotos (flag hasPhotos). Así el listado no
// descarga miles de imágenes de golpe.
export default function LazyThumb({ id, hasPhotos, kind, loadPhotos, className = 'row-thumb' }) {
  const [src, setSrc] = useState(null)
  const ref = useRef(null)

  useEffect(() => {
    setSrc(null)
    if (!hasPhotos || !id) return
    const el = ref.current
    if (!el) return
    let cancelled = false
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          obs.disconnect()
          loadPhotos(id).then(photos => {
            if (!cancelled && photos?.length) setSrc(photos[0])
          })
        }
      },
      { rootMargin: '150px' }
    )
    obs.observe(el)
    return () => {
      cancelled = true
      obs.disconnect()
    }
  }, [id, hasPhotos, loadPhotos])

  const placeholder = kind === 'combo' ? '🧩' : '🏷️'

  if (src) {
    return <img ref={ref} className={className} src={src} alt="" />
  }
  return (
    <div ref={ref} className={`${className} placeholder`}>
      {placeholder}
    </div>
  )
}
