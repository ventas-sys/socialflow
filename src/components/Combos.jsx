import React, { useState, useEffect, useRef } from 'react'
import { compressImage, MAX_PHOTOS, MAX_PHOTOS_BYTES, photosSize } from '../utils/images'
import LazyThumb from './LazyThumb'
import './Combos.css'

export const STOCK_TYPES = ['FULL', 'FERRE', 'BASE']

const EMPTY_FORM = {
  name: '',
  code: '',
  barcode: '',
  price: '',
  location: '',
  stockType: '',
  items: [{ productId: '', quantity: '1' }],
  photos: [],
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

export default function Combos({ combos, products, onAdd, onUpdate, onDelete, editRequest, loadPhotos }) {
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [formData, setFormData] = useState(EMPTY_FORM)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const photoInputRef = useRef(null)

  // Abre el formulario cuando se pide editar un combo desde Inventario
  useEffect(() => {
    if (editRequest?.combo) {
      handleEdit(editRequest.combo)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRequest?.ts])

  const resetForm = () => {
    setFormData(EMPTY_FORM)
    setEditingId(null)
    setError('')
  }

  const handleEdit = async (combo) => {
    setFormData({
      name: combo.name || '',
      code: combo.code || '',
      barcode: combo.barcode || '',
      price: combo.price || '',
      location: combo.location || '',
      stockType: combo.stockType || '',
      items: combo.items?.length
        ? combo.items.map(i => ({ productId: i.productId, quantity: String(i.quantity) }))
        : [{ productId: '', quantity: '1' }],
      photos: [],
    })
    setEditingId(combo.id)
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    if (combo.hasPhotos && loadPhotos) {
      const photos = await loadPhotos(combo.id)
      setFormData(f => ({ ...f, photos }))
    }
  }

  const handleAddPhotos = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setError('')
    try {
      const room = MAX_PHOTOS - formData.photos.length
      if (room <= 0) {
        setError(`Máximo ${MAX_PHOTOS} fotos por combo`)
        return
      }
      const newPhotos = []
      for (const file of files.slice(0, room)) {
        newPhotos.push(await compressImage(file))
      }
      const all = [...formData.photos, ...newPhotos]
      if (photosSize(all) > MAX_PHOTOS_BYTES) {
        setError('Las fotos superan el tamaño máximo. Probá con imágenes más chicas o menos fotos.')
        return
      }
      setFormData({ ...formData, photos: all })
      if (files.length > room) {
        setError(`Se agregaron solo ${room} fotos (máximo ${MAX_PHOTOS} por combo)`)
      }
    } catch (err) {
      setError('Error al procesar la imagen: ' + err.message)
    }
  }

  const removePhoto = (index) => {
    setFormData({
      ...formData,
      photos: formData.photos.filter((_, i) => i !== index),
    })
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
      // Guarda también los códigos de barras y SKU de los productos que
      // componen el combo, para que un operario pueda encontrar el combo
      // escaneando cualquiera de sus productos
      const itemBarcodes = items.flatMap(item => {
        const p = products.find(pp => pp.id === item.productId)
        return [p?.barcode, p?.code].filter(Boolean)
      })

      const data = {
        name: formData.name.trim(),
        code: formData.code.trim(),
        barcode: formData.barcode.trim(),
        price: formData.price ? parseFloat(formData.price) : 0,
        location: formData.location.trim(),
        stockType: formData.stockType,
        items,
        itemBarcodes,
        photos: formData.photos,
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
                <label>SKU</label>
                <input
                  type="text"
                  value={formData.code}
                  onChange={e => setFormData({ ...formData, code: e.target.value })}
                  placeholder="SKU del combo"
                  disabled={loading}
                />
              </div>
              <div className="form-group">
                <label>|||| Código de barras del combo</label>
                <input
                  type="text"
                  value={formData.barcode}
                  onChange={e => setFormData({ ...formData, barcode: e.target.value })}
                  placeholder="EAN / UPC del combo"
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
              <div className="form-group">
                <label>Tipo de stock</label>
                <select
                  value={formData.stockType}
                  onChange={e => setFormData({ ...formData, stockType: e.target.value })}
                  disabled={loading}
                >
                  <option value="">-- Sin asignar --</option>
                  {STOCK_TYPES.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
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

            <div className="form-group">
              <label>Fotos ({formData.photos.length}/{MAX_PHOTOS})</label>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={handleAddPhotos}
              />
              <div className="photos-row">
                {formData.photos.map((photo, i) => (
                  <div key={i} className="photo-thumb">
                    <img src={photo} alt={`Foto ${i + 1}`} />
                    <button
                      type="button"
                      className="photo-remove"
                      onClick={() => removePhoto(i)}
                      title="Quitar foto"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {formData.photos.length < MAX_PHOTOS && (
                  <button
                    type="button"
                    className="photo-add"
                    onClick={() => photoInputRef.current?.click()}
                    disabled={loading}
                  >
                    📷<br />Agregar
                  </button>
                )}
              </div>
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
                  <div className="combo-title-row">
                    <LazyThumb
                      id={combo.id}
                      hasPhotos={combo.hasPhotos}
                      kind="combo"
                      loadPhotos={loadPhotos}
                      className="combo-photo"
                    />
                    <div>
                      <div className="combo-name">🎁 {combo.name}</div>
                      <div className="combo-meta">
                        {combo.code && <span>SKU: {combo.code} · </span>}
                        {combo.barcode && <span>|||| {combo.barcode} · </span>}
                        {combo.price ? `$${Number(combo.price).toFixed(2)}` : 'Sin precio'}
                        {combo.location && <span> · 📍 {combo.location}</span>}
                        {combo.stockType && (
                          <span className={`badge-st ${combo.stockType.toLowerCase()}`}> {combo.stockType}</span>
                        )}
                      </div>
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
