import React, { useState } from 'react'
import './Combos.css'

const EMPTY_FORM = {
  name: '',
  code: '',
  price: '',
  location: '',
  items: [{ productId: '', quantity: '1' }],
}

// Cuántos combos completos se pueden armar con el stock actual (solo informativo,
// no bloquea nada: el stock puede quedar negativo)
export function comboAvailable(combo, products) {
  if (!combo.items?.length) return 0
  let available = Infinity
  for (const item of combo.items) {
    const p = products.find(pp => pp.id === item.productId)
    if (!p) return 0
    available = Math.min(available, Math.floor((p.quantity || 0) / item.quantity))
  }
  return available === Infinity ? 0 : Math.max(0, available)
}

export default function Combos({ combos, products, onAdd, onUpdate, onDelete }) {
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [formData, setFormData] = useState(EMPTY_FORM)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const resetForm = () => {
    setFormData(EMPTY_FORM)
    setEditingId(null)
    setError('')
  }

  const handleEdit = (combo) => {
    setFormData({
      name: combo.name || '',
      code: combo.code || '',
      price: combo.price || '',
      location: combo.location || '',
      items: combo.items?.length
        ? combo.items.map(i => ({ productId: i.productId, quantity: String(i.quantity) }))
        : [{ productId: '', quantity: '1' }],
    })
    setEditingId(combo.id)
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const setItem = (index, field, value) => {
    const items = formData.items.map((item, i) =>
      i === index ? { ...item, [field]: value } : item
    )
    setFormData({ ...formData, items })
  }

  const addItemRow = () => {
    setFormData({
      ...formData,
      items: [...formData.items, { productId: '', quantity: '1' }],
    })
  }

  const removeItemRow = (index) => {
    if (formData.items.length <= 1) return
    setFormData({
      ...formData,
      items: formData.items.filter((_, i) => i !== index),
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!formData.name.trim()) {
      setError('El nombre del combo es requerido')
      return
    }

    const items = formData.items
      .filter(i => i.productId)
      .map(i => ({ productId: i.productId, quantity: Math.max(1, parseInt(i.quantity) || 1) }))

    if (!items.length) {
      setError('El combo debe tener al menos un producto')
      return
    }

    const ids = items.map(i => i.productId)
    if (new Set(ids).size !== ids.length) {
      setError('Hay productos repetidos en el combo. Uní las cantidades en una sola fila.')
      return
    }

    setLoading(true)
    try {
      const data = {
        name: formData.name.trim(),
        code: formData.code.trim(),
        price: formData.price ? parseFloat(formData.price) : 0,
        location: formData.location.trim(),
        items,
      }
      if (editingId) {
        await onUpdate(editingId, data)
      } else {
        await onAdd(data)
      }
      setShowForm(false)
      resetForm()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('¿Eliminar este combo? (No afecta el stock de los productos)')) return
    try {
      await onDelete(id)
    } catch (err) {
      alert(err.message)
    }
  }

  const productName = (id) => products.find(p => p.id === id)?.name || '(producto eliminado)'

  return (
    <div className="combos-container">
      <div className="combos-header">
        <div>
          <h1>🎁 Combos</h1>
          <p>Armá paquetes de varios productos. Al vender un combo se descuenta el stock de cada producto que lo compone.</p>
        </div>
        <button
          onClick={() => {
            resetForm()
            setShowForm(!showForm)
          }}
          className="btn-add"
        >
          {showForm ? '✕ Cancelar' : '+ Nuevo Combo'}
        </button>
      </div>

      {showForm && (
        <div className="form-panel">
          <h2>{editingId ? 'Editar Combo' : 'Nuevo Combo'}</h2>
          {error && <div className="error-message">{error}</div>}

          <form onSubmit={handleSubmit} className="combo-form">
            <div className="form-grid">
              <div className="form-group">
                <label>Nombre del combo *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ej: Combo limpieza x3"
                  disabled={loading}
                />
              </div>
              <div className="form-group">
                <label>Código</label>
                <input
                  type="text"
                  value={formData.code}
                  onChange={e => setFormData({ ...formData, code: e.target.value })}
                  placeholder="Código o SKU del combo"
                  disabled={loading}
                />
              </div>
              <div className="form-group">
                <label>Precio del combo ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.price}
                  onChange={e => setFormData({ ...formData, price: e.target.value })}
                  placeholder="0.00"
                  disabled={loading}
                />
              </div>
              <div className="form-group">
                <label>📍 Ubicación en el depósito</label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={e => setFormData({ ...formData, location: e.target.value })}
                  placeholder="Ej: Estante B1, Zona armado"
                  disabled={loading}
                />
              </div>
            </div>

            <div className="form-group">
              <label>Productos que lo componen *</label>
              {products.length === 0 ? (
                <p className="no-products-hint">
                  Primero cargá productos en la pestaña Inventario.
                </p>
              ) : (
                <div className="items-editor">
                  {formData.items.map((item, i) => (
                    <div key={i} className="item-row">
                      <select
                        value={item.productId}
                        onChange={e => setItem(i, 'productId', e.target.value)}
                        disabled={loading}
                      >
                        <option value="">-- Elegí un producto --</option>
                        {products.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name} (Stock: {p.quantity || 0})
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={e => setItem(i, 'quantity', e.target.value)}
                        title="Cantidad de unidades en el combo"
                        disabled={loading}
                      />
                      <button
                        type="button"
                        className="btn-row-del"
                        onClick={() => removeItemRow(i)}
                        disabled={loading || formData.items.length <= 1}
                        title="Quitar fila"
                      >
                        🗑️
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn-row-add"
                    onClick={addItemRow}
                    disabled={loading}
                  >
                    + Agregar otro producto
                  </button>
                </div>
              )}
            </div>

            <div className="form-actions">
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? '⏳ Guardando...' : (editingId ? '✓ Actualizar' : '✓ Crear Combo')}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setShowForm(false)
                  resetForm()
                }}
                disabled={loading}
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {combos.length === 0 ? (
        <div className="empty-state">
          <p>🎁</p>
          <p>No hay combos todavía. Creá uno combinando productos del inventario.</p>
        </div>
      ) : (
        <div className="combos-grid">
          {combos.map(combo => {
            const available = comboAvailable(combo, products)
            return (
              <div key={combo.id} className="combo-card">
                <div className="combo-card-header">
                  <div>
                    <div className="combo-name">🎁 {combo.name}</div>
                    <div className="combo-meta">
                      {combo.code && <span>Código: {combo.code} · </span>}
                      {combo.price ? `$${Number(combo.price).toFixed(2)}` : 'Sin precio'}
                      {combo.location && <span> · 📍 {combo.location}</span>}
                    </div>
                  </div>
                  <span className={`badge ${available > 0 ? 'ok' : 'warn'}`}>
                    {available > 0 ? `✓ ${available} disponibles` : '⚠ Sin stock'}
                  </span>
                </div>
                <ul className="combo-items">
                  {combo.items?.map((item, i) => (
                    <li key={i}>
                      <strong>{item.quantity}×</strong> {productName(item.productId)}
                    </li>
                  ))}
                </ul>
                <div className="combo-actions">
                  <button onClick={() => handleEdit(combo)} className="btn-edit" title="Editar">
                    ✏️ Editar
                  </button>
                  <button onClick={() => handleDelete(combo.id)} className="btn-del" title="Eliminar">
                    🗑️ Eliminar
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
