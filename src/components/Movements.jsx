import React, { useState, useCallback, useMemo } from 'react'
import Scanner from './Scanner'
import { comboAvailable } from './Combos'
import './Movements.css'

const EMPTY_FORM = {
  type: 'entrada',
  itemKey: '', // "p:<id>" producto | "c:<id>" combo
  quantity: '',
  reason: '',
  reference: '',
}

export default function Movements({ products, combos, movements, onAdd, canEdit = true }) {
  const [showForm, setShowForm] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [scanMessage, setScanMessage] = useState('')
  const [formData, setFormData] = useState(EMPTY_FORM)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)
  const [filterType, setFilterType] = useState('all') // all | entrada | salida | hoy
  const [searchMov, setSearchMov] = useState('')
  const [pickSearch, setPickSearch] = useState('') // buscador del formulario

  // Buscador del formulario: SOLO productos (los combos no se cargan a mano;
  // entran por Excel de compra o por escaneo)
  const pickResults = useMemo(() => {
    const q = pickSearch.trim().toLowerCase()
    if (q.length < 2) return []
    const bcs = (p) => (p.barcodes?.length ? p.barcodes : (p.barcode ? [p.barcode] : []))
    return products
      .filter(p =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.code || '').toLowerCase().includes(q) ||
        bcs(p).some(b => String(b).toLowerCase().includes(q))
      )
      .slice(0, 8)
  }, [pickSearch, products])

  const selectedLabel = (() => {
    if (!formData.itemKey) return ''
    const [k, id] = formData.itemKey.split(':')
    if (k === 'p') {
      const p = products.find(pp => pp.id === id)
      return p ? `${p.name} — Stock: ${p.quantity || 0}` : ''
    }
    const c = combos.find(cc => cc.id === id)
    return c ? `🎁 ${c.name} — se pueden armar: ${comboAvailable(c, products)}` : ''
  })()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setScanMessage('')

    if (!formData.itemKey) {
      setError('Elegí un producto del buscador (o escaneá su código)')
      return
    }

    const quantity = parseInt(formData.quantity)
    if (!quantity || quantity <= 0) {
      setError('La cantidad debe ser mayor a 0')
      return
    }

    const [kind, id] = formData.itemKey.split(':')

    setLoading(true)
    try {
      if (kind === 'c') {
        const combo = combos.find(c => c.id === id)
        if (!combo) {
          setError('Combo no encontrado')
          return
        }

        // El stock puede quedar negativo: no se bloquea la salida,
        // solo se verifica que los productos del combo existan
        const missing = combo.items.find(item => !products.some(p => p.id === item.productId))
        if (missing) {
          setError('Un producto del combo fue eliminado. Editá el combo primero.')
          return
        }

        await onAdd({
          comboId: combo.id,
          comboName: combo.name,
          productName: `🎁 ${combo.name}`,
          type: formData.type,
          quantity,
          reason: formData.reason,
          reference: formData.reference,
          breakdown: combo.items.map(item => {
            const p = products.find(pp => pp.id === item.productId)
            return {
              productId: item.productId,
              productName: p?.name || '(eliminado)',
              quantity: item.quantity * quantity,
            }
          }),
        })
      } else {
        const product = products.find(p => p.id === id)
        if (!product) {
          setError('Producto no encontrado')
          return
        }
        // El stock puede quedar negativo: no se bloquea la salida
        await onAdd({
          productId: product.id,
          productName: product.name,
          type: formData.type,
          quantity,
          reason: formData.reason,
          reference: formData.reference,
        })
      }

      setSuccess(`${formData.type === 'entrada' ? 'Entrada' : 'Salida'} registrada correctamente`)
      setFormData(EMPTY_FORM)
      setPickSearch('')
      setTimeout(() => {
        setShowForm(false)
        setSuccess('')
      }, 1500)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleScan = useCallback((code) => {
    setShowScanner(false)
    const matches = (value) => value && (value === code || code.includes(value))
    const productBarcodes = (p) => p.barcodes?.length ? p.barcodes : (p.barcode ? [p.barcode] : [])

    // Producto: por SKU o cualquiera de sus códigos de barras
    const product = products.find(p => matches(p.code) || productBarcodes(p).some(matches))

    // Combo: por su código de barras, su SKU, o el código de barras/SKU
    // de cualquier producto que lo compone
    const combo = !product
      ? combos.find(c =>
          matches(c.code) ||
          productBarcodes(c).some(matches) ||
          (c.itemBarcodes || []).some(matches) ||
          c.items?.some(item => {
            const p = products.find(pp => pp.id === item.productId)
            return p && (matches(p.code) || productBarcodes(p).some(matches))
          })
        )
      : null

    if (product || combo) {
      const itemKey = product ? `p:${product.id}` : `c:${combo.id}`
      const name = product ? product.name : combo.name
      setFormData(prev => ({
        ...prev,
        type: 'entrada',
        itemKey,
        quantity: prev.quantity || '1',
        reason: 'Ingreso por escaneo QR',
        reference: code.slice(0, 60),
      }))
      setPickSearch(name)
      setScanMessage(`✓ Código detectado: ${name}. Revisá la cantidad y confirmá.`)
      setShowForm(true)
      setError('')
    } else {
      setScanMessage('')
      setFormData(prev => ({ ...prev, reference: code.slice(0, 60) }))
      setShowForm(true)
      setError(`No hay ningún producto o combo con el código "${code.slice(0, 40)}". Seleccionalo manualmente o cargale ese código en Inventario/Combos.`)
    }
  }, [products, combos])

  const getMovementIcon = (type) => (type === 'entrada' ? '📥' : '📤')
  const getMovementLabel = (type) => (type === 'entrada' ? 'Entrada' : 'Salida')

  const formatDate = (timestamp) => {
    if (!timestamp) return '-'
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
    return date.toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const dayOf = (m) => {
    const mDate = m.date?.toDate ? m.date.toDate() : new Date(m.date)
    mDate.setHours(0, 0, 0, 0)
    return mDate.getTime()
  }
  const yesterday = today.getTime() - 86400000
  const weekAgo = today.getTime() - 6 * 86400000
  const isToday = (m) => dayOf(m) === today.getTime()
  const isYesterday = (m) => dayOf(m) === yesterday
  const isWeek = (m) => dayOf(m) >= weekAgo
  const todayMovements = movements.filter(isToday)
  const yesterdayMovements = movements.filter(isYesterday)
  const weekMovements = movements.filter(isWeek)

  // Filtro combinado: tipo/fecha (tab) + búsqueda por producto/SKU/referencia/usuario
  const q = searchMov.trim().toLowerCase()
  const filtered = movements.filter(m => {
    if (filterType === 'entrada' && m.type !== 'entrada') return false
    if (filterType === 'salida' && m.type !== 'salida') return false
    if (filterType === 'hoy' && !isToday(m)) return false
    if (filterType === 'ayer' && !isYesterday(m)) return false
    if (filterType === 'semana' && !isWeek(m)) return false
    if (q) {
      return (
        (m.productName || '').toLowerCase().includes(q) ||
        (m.reference || '').toLowerCase().includes(q) ||
        (m.reason || '').toLowerCase().includes(q) ||
        (m.userName || '').toLowerCase().includes(q)
      )
    }
    return true
  })

  // Resumen de unidades del filtro actual
  const totalEntradas = filtered.filter(m => m.type === 'entrada').reduce((s, m) => s + (m.quantity || 0), 0)
  const totalSalidas = filtered.filter(m => m.type === 'salida').reduce((s, m) => s + (m.quantity || 0), 0)

  return (
    <div className="movements-container">
      <div className="movements-header">
        <div>
          <h1>🔄 Movimientos de Stock</h1>
          <p>Registra entradas y salidas de mercancía</p>
        </div>
        <div className="header-actions">
          {canEdit && (
            <button onClick={() => setShowScanner(true)} className="btn-scan">
              📷 Escanear QR
            </button>
          )}
          {canEdit && (
            <button onClick={() => setShowForm(!showForm)} className="btn-add">
              {showForm ? '✕ Cancelar' : '+ Nuevo Movimiento'}
            </button>
          )}
        </div>
      </div>

      {showScanner && (
        <Scanner onScan={handleScan} onClose={() => setShowScanner(false)} />
      )}

      {scanMessage && !showScanner && (
        <div className="success-message">{scanMessage}</div>
      )}

      {showForm && (
        <div className="form-panel">
          <h2>Registrar Movimiento</h2>
          {error && <div className="error-message">{error}</div>}
          {success && <div className="success-message">{success}</div>}

          <form onSubmit={handleSubmit} className="movement-form">
            <div className="type-selector">
              <label>
                <input
                  type="radio"
                  value="entrada"
                  checked={formData.type === 'entrada'}
                  onChange={e => setFormData({ ...formData, type: e.target.value })}
                  disabled={loading}
                />
                <span>📥 Entrada de Mercancía</span>
              </label>
              <label>
                <input
                  type="radio"
                  value="salida"
                  checked={formData.type === 'salida'}
                  onChange={e => setFormData({ ...formData, type: e.target.value })}
                  disabled={loading}
                />
                <span>📤 Salida de Mercancía</span>
              </label>
            </div>

            <div className="form-grid">
              <div className="form-group picker-wrap">
                <label>Producto *</label>
                <input
                  type="text"
                  value={pickSearch}
                  onChange={e => {
                    setPickSearch(e.target.value)
                    if (formData.itemKey) setFormData({ ...formData, itemKey: '' })
                  }}
                  placeholder="Buscá por nombre, SKU o código de barras…"
                  disabled={loading}
                  autoComplete="off"
                />
                {!formData.itemKey && pickResults.length > 0 && (
                  <div className="picker-list">
                    {pickResults.map(p => (
                      <button
                        type="button"
                        key={p.id}
                        onClick={() => {
                          setFormData({ ...formData, itemKey: `p:${p.id}` })
                          setPickSearch(p.name)
                        }}
                      >
                        <span className="picker-name">{p.name}</span>
                        <span className="picker-meta">SKU {p.code || '—'} · Stock {p.quantity || 0}</span>
                      </button>
                    ))}
                  </div>
                )}
                {!formData.itemKey && pickSearch.trim().length >= 2 && pickResults.length === 0 && (
                  <div className="picker-empty">Sin resultados — probá con el SKU o escaneá el código.</div>
                )}
                {formData.itemKey && <div className="picker-selected">✓ {selectedLabel}</div>}
              </div>

              <div className="form-group">
                <label>Cantidad *</label>
                <input
                  type="number"
                  min="1"
                  value={formData.quantity}
                  onChange={e => setFormData({ ...formData, quantity: e.target.value })}
                  placeholder="0"
                  disabled={loading}
                  required
                />
              </div>
            </div>

            {formData.itemKey.startsWith('c:') && (
              <div className="combo-hint">
                🎁 Al registrar este movimiento se {formData.type === 'entrada' ? 'sumará' : 'descontará'} el
                stock de <strong>cada producto</strong> que compone el combo, multiplicado por la cantidad.
              </div>
            )}

            <div className="form-group">
              <label>Motivo o Referencia</label>
              <input
                type="text"
                value={formData.reason}
                onChange={e => setFormData({ ...formData, reason: e.target.value })}
                placeholder="Ej: Compra a proveedor, venta a cliente, reposición, etc."
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label>Número de Referencia (Factura, Orden, etc.)</label>
              <input
                type="text"
                value={formData.reference}
                onChange={e => setFormData({ ...formData, reference: e.target.value })}
                placeholder="Ej: FAC-2024-001"
                disabled={loading}
              />
            </div>

            <div className="form-actions">
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? '⏳ Registrando...' : '✓ Registrar Movimiento'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setShowForm(false)
                  setError('')
                  setSuccess('')
                }}
                disabled={loading}
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="movements-tabs">
        <button
          className={`tab-btn ${filterType === 'all' ? 'active' : ''}`}
          onClick={() => setFilterType('all')}
        >
          📋 Todos ({movements.length})
        </button>
        <button
          className={`tab-btn ${filterType === 'entrada' ? 'active' : ''}`}
          onClick={() => setFilterType('entrada')}
        >
          📥 Entradas ({movements.filter(m => m.type === 'entrada').length})
        </button>
        <button
          className={`tab-btn ${filterType === 'salida' ? 'active' : ''}`}
          onClick={() => setFilterType('salida')}
        >
          📤 Salidas ({movements.filter(m => m.type === 'salida').length})
        </button>
        <button
          className={`tab-btn ${filterType === 'hoy' ? 'active' : ''}`}
          onClick={() => setFilterType('hoy')}
        >
          📅 Hoy ({todayMovements.length})
        </button>
        <button
          className={`tab-btn ${filterType === 'ayer' ? 'active' : ''}`}
          onClick={() => setFilterType('ayer')}
        >
          🕐 Ayer ({yesterdayMovements.length})
        </button>
        <button
          className={`tab-btn ${filterType === 'semana' ? 'active' : ''}`}
          onClick={() => setFilterType('semana')}
        >
          🗓️ Semana ({weekMovements.length})
        </button>
      </div>

      <div className="mov-search">
        <input
          type="text"
          placeholder="🔍 Buscar por producto, SKU, referencia o usuario..."
          value={searchMov}
          onChange={e => setSearchMov(e.target.value)}
        />
        {(searchMov || filterType !== 'all') && (
          <button className="mov-clear" onClick={() => { setSearchMov(''); setFilterType('all') }}>
            ✕ Limpiar
          </button>
        )}
      </div>

      <div className="mov-summary">
        <span className="mov-sum-item">📥 Entró: <strong>{totalEntradas}</strong> u.</span>
        <span className="mov-sum-item">📤 Salió: <strong>{totalSalidas}</strong> u.</span>
        <span className="mov-sum-item">Neto: <strong>{totalEntradas - totalSalidas >= 0 ? '+' : ''}{totalEntradas - totalSalidas}</strong> u.</span>
        <span className="mov-sum-count">{filtered.length} movimientos</span>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <p>📭</p>
          <p>{movements.length === 0 ? 'No hay movimientos registrados. ¡Crea uno para empezar!' : 'No hay movimientos con ese filtro.'}</p>
        </div>
      ) : (
        <div className="movements-list">
          {filtered.slice(0, 200).map(m => {
            const prod = products.find(p => p.id === m.productId)
            const sku = prod?.code
            const isEntrada = m.type === 'entrada'
            return (
              <div key={m.id} className={`movement-card ${m.type}`}>
                <div className="movement-card-content">
                  <div className="movement-card-title">
                    {m.productName || 'Producto'}
                  </div>
                  <div className="movement-sub">
                    {m.comboId && <span className="chip-combo">🎁 Combo</span>}
                    {sku && <span className="movement-sku">SKU: {sku}</span>}
                    {m.reason && <span className="reason">{m.reason}</span>}
                  </div>
                  {m.breakdown?.length > 0 && (
                    <div className="breakdown">
                      Incluye: {m.breakdown.map(b => `${b.quantity}× ${b.productName}`).join(', ')}
                    </div>
                  )}
                  {m.reference && (
                    <div className="reference">Ref: {m.reference}</div>
                  )}
                  <div className="meta-info">
                    <span className="date">{formatDate(m.date)}</span>
                    {m.userName && <span className="user">• {m.userName}</span>}
                  </div>
                </div>
                <div className={`movement-qty ${m.type}`}>
                  <span className="mq-num">{isEntrada ? '+' : '−'}{m.quantity}</span>
                  <span className="mq-unit">{m.comboId ? 'combos' : 'u.'}</span>
                  <span className="mq-label">{isEntrada ? 'ENTRADA' : 'SALIDA'}</span>
                </div>
              </div>
            )
          })}
          {filtered.length > 200 && (
            <div className="show-more">
              Mostrando 200 de {filtered.length} movimientos. Usá el buscador para acotar.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
