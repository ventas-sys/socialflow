import React, { useState, useCallback } from 'react'
import Scanner from './Scanner'
import './Movements.css'

export default function Movements({ products, movements, onAdd }) {
  const [showForm, setShowForm] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [scanMessage, setScanMessage] = useState('')
  const [formData, setFormData] = useState({
    type: 'entrada',
    productId: '',
    quantity: '',
    reason: '',
    reference: '',
  })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setScanMessage('')

    if (!formData.productId) {
      setError('Debes seleccionar un producto')
      return
    }

    if (!formData.quantity || parseInt(formData.quantity) <= 0) {
      setError('La cantidad debe ser mayor a 0')
      return
    }

    const product = products.find(p => p.id === formData.productId)
    if (!product) {
      setError('Producto no encontrado')
      return
    }

    if (formData.type === 'salida' && (product.quantity || 0) < parseInt(formData.quantity)) {
      setError(`Stock insuficiente. Disponible: ${product.quantity || 0}`)
      return
    }

    setLoading(true)
    try {
      await onAdd({
        productId: formData.productId,
        productName: product.name,
        type: formData.type,
        quantity: parseInt(formData.quantity),
        reason: formData.reason,
        reference: formData.reference,
      })

      setSuccess(`${formData.type === 'entrada' ? 'Entrada' : 'Salida'} registrada correctamente`)
      setFormData({
        type: 'entrada',
        productId: '',
        quantity: '',
        reason: '',
        reference: '',
      })

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
    const product = products.find(
      p => p.code && (p.code === code || code.includes(p.code))
    )
    if (product) {
      setFormData(prev => ({
        ...prev,
        type: 'entrada',
        productId: product.id,
        quantity: prev.quantity || '1',
        reason: 'Ingreso por escaneo QR',
        reference: code.slice(0, 60),
      }))
      setScanMessage(`✓ Código detectado: ${product.name}. Revisá la cantidad y confirmá.`)
      setShowForm(true)
      setError('')
    } else {
      setScanMessage('')
      setFormData(prev => ({ ...prev, reference: code.slice(0, 60) }))
      setShowForm(true)
      setError(`No hay ningún producto con el código "${code.slice(0, 40)}". Seleccioná el producto manualmente o cargalo primero en Inventario con ese código.`)
    }
  }, [products])

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
          <button
            onClick={() => setShowScanner(true)}
            className="btn-scan"
          >
            📷 Escanear QR
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="btn-add"
          >
            {showForm ? '✕ Cancelar' : '+ Nuevo Movimiento'}
          </button>
        </div>
      </div>

      {showScanner && (
        <Scanner
          onScan={handleScan}
          onClose={() => setShowScanner(false)}
        />
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
                <label>Producto *</label>
                <select
                  value={formData.productId}
                  onChange={e => setFormData({ ...formData, productId: e.target.value })}
                  disabled={loading}
                  required
                >
                  <option value="">-- Selecciona un producto --</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} (Stock: {p.quantity || 0})
                    </option>
                  ))}
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
              <button
                type="submit"
                className="btn-primary"
                disabled={loading}
              >
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
                  <span className="quantity">{m.quantity} unidades</span>
                  {m.reason && <span className="reason">• {m.reason}</span>}
                </div>
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
