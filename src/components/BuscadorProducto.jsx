import React, { useState, useMemo, useRef, useEffect } from 'react'
import './BuscadorProducto.css'

// Buscador de productos para elegir uno de una lista larga.
//
// Reemplaza al <select> de siempre: con 1500 productos el desplegable del
// navegador sólo salta a lo que EMPIEZA con lo que se tipea, y encima se
// olvida de lo escrito a los pocos segundos. Acá se escribe cualquier parte
// del nombre (o el código) y filtra de verdad.
const TOPE = 60

const norm = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '') // saca tildes

export default function BuscadorProducto({
  products, value, onChange, disabled, placeholder = 'Escribí parte del nombre o el código...',
}) {
  const [texto, setTexto] = useState('')
  const [abierto, setAbierto] = useState(false)
  const [marcado, setMarcado] = useState(0) // el que está resaltado con las flechas
  const caja = useRef(null)

  const elegido = useMemo(
    () => products.find(p => p.id === value) || null,
    [products, value])

  // Cerrar al tocar afuera
  useEffect(() => {
    const fuera = (e) => { if (caja.current && !caja.current.contains(e.target)) setAbierto(false) }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [])

  // Todas las palabras tienen que estar, en cualquier orden y en cualquier
  // parte del nombre o del código. Así "aislante 20" encuentra
  // "AISLANTE BAJO PILETA BLANCO 10MM X 20MT".
  const lista = useMemo(() => {
    const palabras = norm(texto).split(/\s+/).filter(Boolean)
    if (!palabras.length) return products.slice(0, TOPE)
    const res = []
    for (const p of products) {
      const donde = norm(p.name) + ' ' + norm(p.code)
      if (palabras.every(w => donde.includes(w))) {
        res.push(p)
        if (res.length >= TOPE) break
      }
    }
    return res
  }, [products, texto])

  const elegir = (p) => {
    onChange(p.id)
    setTexto('')
    setAbierto(false)
  }

  const teclas = (e) => {
    if (!abierto && (e.key === 'ArrowDown' || e.key === 'Enter')) { setAbierto(true); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setMarcado(m => Math.min(m + 1, lista.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setMarcado(m => Math.max(m - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (lista[marcado]) elegir(lista[marcado]) }
    else if (e.key === 'Escape') { setAbierto(false) }
  }

  return (
    <div className="bp" ref={caja}>
      <input
        className={`bp-input ${elegido && !abierto ? 'elegido' : ''}`}
        type="text"
        disabled={disabled}
        placeholder={elegido ? '' : placeholder}
        value={abierto ? texto : (elegido ? `${elegido.name} (Stock: ${elegido.quantity || 0})` : '')}
        onFocus={() => { setTexto(''); setMarcado(0); setAbierto(true) }}
        onChange={e => { setTexto(e.target.value); setMarcado(0); setAbierto(true) }}
        onKeyDown={teclas}
      />
      {abierto && (
        <div className="bp-lista">
          {!lista.length ? (
            <div className="bp-vacio">Ningún producto con “{texto}”.</div>
          ) : (
            <>
              {lista.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  className={`bp-op ${i === marcado ? 'marcado' : ''} ${p.id === value ? 'actual' : ''}`}
                  // Sin esto el input pierde el foco antes del click y la
                  // lista se cierra sin elegir nada
                  onMouseDown={e => e.preventDefault()}
                  onMouseEnter={() => setMarcado(i)}
                  onClick={() => elegir(p)}
                >
                  <span className="bp-nom">{p.name}</span>
                  <span className={`bp-stock ${(p.quantity || 0) <= 0 ? 'cero' : ''}`}>
                    {p.quantity || 0}
                  </span>
                </button>
              ))}
              {lista.length >= TOPE && (
                <div className="bp-vacio">Hay más — escribí algo más para achicar la lista.</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
