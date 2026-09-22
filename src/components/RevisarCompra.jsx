import React, { useMemo, useState } from 'react'
import { barcodesOf } from '../utils/refMatch'
import './RevisarCompra.css'

// Revisión de una compra ANTES de tocar el stock.
//
// Antes esto era una tabla de sólo lectura: lo que la foto (o el Excel) había
// entendido se aplicaba tal cual, y si un renglón caía en el producto
// equivocado no había forma de corregirlo — había que cancelar todo. Peor
// todavía: dos renglones distintos podían caer en el MISMO producto y se
// sumaban sin avisar.
//
// Ahora cada renglón de la factura es una fila editable: se le puede cambiar el
// producto, cambiar la cantidad o sacarlo. Abajo se ve, en vivo, cómo queda el
// stock de cada producto con lo que está cargado en ese momento.

const nrm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export default function RevisarCompra({
  preview, products, combos, onChange, onConfirm, onCancel, aplicando,
}) {
  const [buscandoEn, setBuscandoEn] = useState(null)  // uid del renglón que está eligiendo producto
  const [q, setQ] = useState('')

  const items = preview.items || []

  const porClave = useMemo(() => {
    const m = new Map()
    products.forEach(p => m.set('p:' + p.id, p))
    combos.forEach(c => m.set('c:' + c.id, c))
    return m
  }, [products, combos])

  const elegido = (it) => (it.refId ? porClave.get((it.tipo === 'combo' ? 'c:' : 'p:') + it.refId) : null)

  const cambiar = (uid, cambios) =>
    onChange(items.map(it => (it.uid === uid ? { ...it, ...cambios } : it)))

  // Cómo queda el stock con lo que está cargado ahora mismo
  const resumen = useMemo(() => {
    const m = new Map()
    const sumar = (p, delta, uid) => {
      if (!m.has(p.id)) {
        m.set(p.id, { id: p.id, name: p.name, current: p.quantity || 0, delta: 0, renglones: new Set() })
      }
      const e = m.get(p.id)
      e.delta += delta
      e.renglones.add(uid)
    }
    items.forEach(it => {
      if (!it.incluir || !it.refId || !it.cantidad) return
      const x = elegido(it)
      if (!x) return
      if (it.tipo === 'combo') {
        x.items?.forEach(ci => {
          const bp = products.find(p => p.id === ci.productId)
          if (bp) sumar(bp, (ci.quantity || 0) * it.cantidad, it.uid)
        })
      } else {
        sumar(x, it.cantidad, it.uid)
      }
    })
    return [...m.values()]
  }, [items, products, porClave])

  const repetidos = useMemo(
    () => new Set(resumen.filter(r => r.renglones.size > 1).flatMap(r => [...r.renglones])),
    [resumen],
  )

  const candidatos = useMemo(() => {
    const t = nrm(q).trim()
    if (t.length < 2) return []
    const pega = (x) =>
      nrm(x.name).includes(t) ||
      nrm(x.code).includes(t) ||
      barcodesOf(x).some(b => nrm(b).includes(t))
    return [
      ...products.filter(pega).slice(0, 8).map(p => ({ tipo: 'producto', x: p })),
      ...combos.filter(pega).slice(0, 4).map(c => ({ tipo: 'combo', x: c })),
    ]
  }, [q, products, combos])

  const listos = items.filter(it => it.incluir && it.refId && it.cantidad)
  const sinAsignar = items.filter(it => it.incluir && (!it.refId || !it.cantidad))

  const abrirBuscador = (it) => {
    setBuscandoEn(it.uid)
    setQ(it.texto || '')
  }

  const asignar = (uid, cand) => {
    cambiar(uid, { tipo: cand.tipo, refId: cand.x.id, match: 'elegido' })
    setBuscandoEn(null)
    setQ('')
  }

  return (
    <div className="rc">
      <div className="rc-head">
        <h3>Revisá renglón por renglón</h3>
        {preview.reference && <span className="rc-ref">{preview.reference}</span>}
      </div>
      <p className="rc-hint">
        Esto todavía no tocó el stock. Corregí el producto o la cantidad donde haga falta,
        sacá lo que no va, y recién ahí confirmá.
      </p>

      <div className="rc-items">
        {items.map(it => {
          const x = elegido(it)
          const apagado = !it.incluir
          return (
            <div className={`rc-item ${apagado ? 'apagado' : ''} ${!x && !apagado ? 'sinprod' : ''}`} key={it.uid}>
              <div className="rc-item-top">
                <span className="rc-texto">{it.texto || '(sin descripción)'}</span>
                <button
                  className="rc-quitar"
                  onClick={() => cambiar(it.uid, { incluir: !it.incluir })}
                  title={it.incluir ? 'No cargar este renglón' : 'Volver a cargarlo'}
                >
                  {it.incluir ? '🗑' : '↩'}
                </button>
              </div>

              {it.incluir && (
                <>
                  <div className="rc-fila">
                    <span className="rc-etiqueta">Producto</span>
                    {buscandoEn === it.uid ? (
                      <div className="rc-buscador">
                        <input
                          autoFocus
                          value={q}
                          onChange={e => setQ(e.target.value)}
                          placeholder="Buscá por nombre, SKU o código de barras"
                        />
                        <div className="rc-resultados">
                          {candidatos.length === 0 && (
                            <p className="rc-vacio">
                              {q.trim().length < 2 ? 'Escribí al menos 2 letras' : 'No hay nada que coincida'}
                            </p>
                          )}
                          {candidatos.map(c => (
                            <button key={c.tipo + c.x.id} onClick={() => asignar(it.uid, c)}>
                              {c.tipo === 'combo' && <span className="rc-tag">combo</span>}
                              <span className="rc-cand-nombre">{c.x.name}</span>
                              {c.x.code && <span className="rc-cand-code">{c.x.code}</span>}
                            </button>
                          ))}
                        </div>
                        <button className="rc-cancelar-busq" onClick={() => { setBuscandoEn(null); setQ('') }}>
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button className="rc-elegir" onClick={() => abrirBuscador(it)}>
                        {x ? (
                          <>
                            {it.tipo === 'combo' && <span className="rc-tag">combo</span>}
                            {x.name}
                          </>
                        ) : (
                          <span className="rc-falta">Sin asignar — tocá para elegir</span>
                        )}
                      </button>
                    )}
                  </div>

                  <div className="rc-fila">
                    <span className="rc-etiqueta">Cantidad</span>
                    <div className="rc-cant">
                      <button onClick={() => cambiar(it.uid, { cantidad: it.cantidad - 1 })}>−</button>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={it.cantidad}
                        onChange={e => cambiar(it.uid, { cantidad: Math.round(Number(e.target.value) || 0) })}
                      />
                      <button onClick={() => cambiar(it.uid, { cantidad: it.cantidad + 1 })}>+</button>
                    </div>
                  </div>

                  <div className="rc-avisos">
                    {it.match === 'parecido' && (
                      <span className="rc-aviso naranja">Lo asoció por parecido — controlalo</span>
                    )}
                    {it.match === 'ninguno' && !it.refId && (
                      <span className="rc-aviso rojo">No lo encontró en tus productos</span>
                    )}
                    {repetidos.has(it.uid) && (
                      <span className="rc-aviso naranja">Otro renglón va al mismo producto y se suman</span>
                    )}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>

      {resumen.length > 0 && (
        <div className="rc-resumen">
          <h4>Cómo queda el stock</h4>
          <table>
            <thead>
              <tr><th>Producto</th><th>Ahora</th><th>Cambio</th><th>Queda</th></tr>
            </thead>
            <tbody>
              {resumen.map(r => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.current}</td>
                  <td className={r.delta >= 0 ? 'mas' : 'menos'}>{r.delta >= 0 ? `+${r.delta}` : r.delta}</td>
                  <td className="queda">{r.current + r.delta}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sinAsignar.length > 0 && (
        <p className="rc-pendientes">
          ⚠️ {sinAsignar.length} {sinAsignar.length === 1 ? 'renglón queda' : 'renglones quedan'} sin cargar
          porque {sinAsignar.length === 1 ? 'no tiene' : 'no tienen'} producto o cantidad.
          Asignalos o sacalos con la papelera.
        </p>
      )}

      <div className="rc-acciones">
        <button className="btn-primary" onClick={onConfirm} disabled={aplicando || listos.length === 0}>
          {aplicando ? '⏳ Aplicando...' : `✓ Confirmar y aplicar (${listos.length})`}
        </button>
        <button className="btn-secondary" onClick={onCancel} disabled={aplicando}>Cancelar</button>
      </div>
    </div>
  )
}
