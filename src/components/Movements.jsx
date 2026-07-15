import React, { useState, useCallback } from 'react'
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

export default function Movements({ products, combos, movements, onAdd }) {
  const [showForm, setShowForm] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [scanMessage, setScanMessage] = useState('')
  const [formData, setFormData] = useState(EMPTY_FORM)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setScanMessage('')

    if (!formData.itemKey) {
      setError('Debes seleccionar un producto o combo')
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

  const todayMovements = movements.filter(m => {
    const mDate = m.date?.toDate ? m.date.toDate() : new Date(m.date)
    mDate.setHours(0, 0, 0, 0)
    return mDate.getTime() === today.getTime()
  })

  return (
    <div className="movements-container">
      <div className="movements-header">
        <div>
          <h1>🔄 Movimientos de Stock</h1>
          <p>Registra entradas y salidas de mercancía</p>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowScanner(true)} className="btn-scan">
            📷 Escanear QR
          </button>
          <button onClick={() => setShowForm(!showForm)} className="btn-add">
            {showForm ? '✕ Cancelar' : '+ Nuevo Movimiento'}
          </button>
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
              <div className="form-group">
                <label>Producto o Combo *</label>
                <select
                  value={formData.itemKey}
                  onChange={e => setFormData({ ...formData, itemKey: e.target.value })}
                  disabled={loading}
                  required
                >
                  <option value="">-- Selecciona --</option>
                  <optgroup label="📦 Productos">
                    {products.map(p => (
                      <option key={p.id} value={`p:${p.id}`}>
                        {p.name} (Stock: {p.quantity || 0})
                      </option>
                    ))}
                  </optgroup>
                  {combos.length > 0 && (
                    <optgroup label="🎁 Combos">
                      {combos.map(c => (
                        <option key={c.id} value={`c:${c.id}`}>
                          {c.name} (Se pueden armar: {comboAvailable(c, products)})
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
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
        <div className="tab-btn active">
          📋 Todos ({movements.length})
        </div>
        <div className="tab-btn">
          📥 Entradas ({movements.filter(m => m.type === 'entrada').length})
        </div>
        <div className="tab-btn">
          📤 Salidas ({movements.filter(m => m.type === 'salida').length})
        </div>
        <div className="tab-btn">
          📅 Hoy ({todayMovements.length})
        </div>
      </div>

      {movements.length === 0 ? (
        <div className="empty-state">
          <p>📭</p>
          <p>No hay movimientos registrados. ¡Crea uno para empezar!</p>
        </div>
      ) : (
        <div className="movements-list">
          {movements.slice(0, 50).map(m => (
            <div key={m.id} className={`movement-card ${m.type}`}>
              <div className="movement-card-icon">
                {getMovementIcon(m.type)}
              </div>
              <div className="movement-card-content">
                <div className="movement-card-title">
                  {m.productName || 'Producto'}
                </div>
                <div className="movement-card-details">
                  <span className="detail-badge">{getMovementLabel(m.type)}</span>
                  <span className="quantity">{m.quantity} {m.comboId ? 'combos' : 'unidades'}</span>
                  {m.reason && <span className="reason">• {m.reason}</span>}
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
            </div>
          ))}
          {movements.length > 50 && (
            <div className="show-more">
              Mostrando 50 de {movements.length} movimientos
            </div>
          )}
        </div>
      )}
    </div>
  )
}
