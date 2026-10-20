import React, { useMemo, useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import JsBarcode from 'jsbarcode'
import './Etiquetas.css'

// Etiquetas de 10x15 cm para los bultos grandes del sector aparte.
//
// Qué lleva y por qué en ese orden: lo primero que se busca desde lejos es
// DÓNDE va y QUÉ es, así que la ubicación y el código van enormes arriba. El
// nombre abajo, el proveedor al pie, y el código de barras al final.
//
// El código de barras lleva el código de 4 números del producto base, que es
// lo que el sistema escanea en Compra, Ajuste y Empaquetado. Si llevara el
// nombre, escanearlo no serviría para nada: la app no busca por nombre.
//
// Code 128: acepta letras y números, y no exige largo fijo como EAN-13 (que
// pide 12 dígitos + verificador y no podría con "0438").

const nrm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

function CodigoDeBarras({ valor }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!ref.current || !valor) return
    try {
      JsBarcode(ref.current, String(valor), {
        format: 'CODE128', width: 2.2, height: 60, margin: 0,
        displayValue: true, fontSize: 18, textMargin: 2, font: 'monospace',
      })
    } catch { /* un código que la librería no pueda dibujar no rompe la etiqueta */ }
  }, [valor])
  return <svg ref={ref} className="et-barcode" />
}

export default function Etiquetas({ products, onCerrar }) {
  const [busca, setBusca] = useState('')
  const [ubic, setUbic] = useState('')
  const [elegidos, setElegidos] = useState(() => new Set())

  // Las etiquetas se montan FUERA de #root y al imprimir se esconde #root
  // entero. Es la única forma segura de que no salgan el encabezado de la app,
  // las solapas ni la lista: ocultar "todo menos esto" desde adentro deja
  // huecos en blanco y páginas de más.
  useEffect(() => {
    document.body.classList.add('etiquetas-abiertas')
    return () => document.body.classList.remove('etiquetas-abiertas')
  }, [])

  const ubicaciones = useMemo(
    () => [...new Set(products.map(p => String(p.location || '').trim()).filter(Boolean))].sort(),
    [products],
  )

  const filtrados = useMemo(() => {
    const t = nrm(busca).trim()
    return products.filter(p => {
      if (ubic === '__sin__' && String(p.location || '').trim()) return false
      if (ubic && ubic !== '__sin__' && String(p.location || '').trim() !== ubic) return false
      if (!t) return true
      return nrm(p.name).includes(t) || nrm(p.code).includes(t) || nrm(p.supplier).includes(t)
    })
  }, [products, busca, ubic])

  const alternar = (id) => setElegidos(s => {
    const n = new Set(s)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })
  const marcarTodos = () => setElegidos(s => {
    const n = new Set(s)
    filtrados.forEach(p => n.add(p.id))
    return n
  })

  const paraImprimir = useMemo(
    () => products.filter(p => elegidos.has(p.id)),
    [products, elegidos],
  )
  const sinCodigo = paraImprimir.filter(p => !String(p.code || '').trim()).length

  return (
    <div className="et">
      <div className="et-barra no-imprimir">
        <div className="et-barra-top">
          <h2>🏷️ Etiquetas de bulto (10 × 15 cm)</h2>
          <button className="btn-secondary" onClick={onCerrar}>✕ Volver al inventario</button>
        </div>

        <div className="et-filtros">
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nombre, código o proveedor"
          />
          <select value={ubic} onChange={e => setUbic(e.target.value)}>
            <option value="">Todas las ubicaciones</option>
            <option value="__sin__">Sin ubicación cargada</option>
            {ubicaciones.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <button className="btn-secondary" onClick={marcarTodos}>
            Marcar los {filtrados.length} de la lista
          </button>
          {elegidos.size > 0 && (
            <button className="btn-secondary" onClick={() => setElegidos(new Set())}>
              Desmarcar todo
            </button>
          )}
          <button
            className="btn-primary"
            disabled={paraImprimir.length === 0}
            onClick={() => window.print()}
          >
            🖨️ Imprimir {paraImprimir.length || ''}
          </button>
        </div>

        {sinCodigo > 0 && (
          <p className="et-aviso">
            ⚠️ {sinCodigo} de los marcados no tienen código cargado: esas etiquetas salen sin
            código de barras y no se van a poder escanear.
          </p>
        )}

        <div className="et-lista">
          {filtrados.slice(0, 300).map(p => (
            <label className={`et-fila ${elegidos.has(p.id) ? 'si' : ''}`} key={p.id}>
              <input type="checkbox" checked={elegidos.has(p.id)} onChange={() => alternar(p.id)} />
              <span className="et-cod">{p.code || '—'}</span>
              <span className="et-nom">{p.name}</span>
              <span className="et-ubi">{p.location || <i>sin ubicación</i>}</span>
              <span className="et-prov">{p.supplier || ''}</span>
            </label>
          ))}
          {filtrados.length > 300 && (
            <p className="et-aviso">
              Se muestran los primeros 300 de {filtrados.length}. Afiná la búsqueda o filtrá por ubicación.
            </p>
          )}
          {filtrados.length === 0 && <p className="et-aviso">No hay productos con ese filtro.</p>}
        </div>
      </div>

      {createPortal(
        <div className="et-hojas">
        {paraImprimir.map(p => (
          <div className="et-hoja" key={p.id}>
            <div className="et-ubicacion"><strong>{p.location || '—'}</strong></div>
            <div className="et-codigo">{p.code || '—'}</div>
            <div className="et-nombre">{p.name}</div>
            <div className="et-pie">
              {p.code ? <CodigoDeBarras valor={p.code} /> : <span className="et-rotulo">Sin código</span>}
              {p.supplier && (
                <div className="et-proveedor">
                  <span className="et-rotulo">Proveedor</span>
                  <strong>{p.supplier}</strong>
                </div>
              )}
            </div>
          </div>
        ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
