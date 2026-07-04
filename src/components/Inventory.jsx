import React, { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { compressImage, MAX_PHOTOS, MAX_PHOTOS_BYTES, photosSize } from '../utils/images'
import './Inventory.css'

const EMPTY_FORM = {
  name: '',
  code: '',
  category: '',
  price: '',
  minStock: '5',
  quantity: '0',
  location: '',
  description: '',
  photos: [],
}

// Mapea encabezados del Excel (sin acentos, minúsculas) a campos del producto
const COLUMN_MAP = {
  nombre: 'name', producto: 'name', name: 'name', articulo: 'name', descripcion_corta: 'name',
  codigo: 'code', sku: 'code', code: 'code', 'codigo de barras': 'code', ean: 'code',
  categoria: 'category', category: 'category', rubro: 'category',
  precio: 'price', price: 'price', 'precio venta': 'price',
  cantidad: 'quantity', stock: 'quantity', qty: 'quantity', unidades: 'quantity', existencia: 'quantity',
  'stock minimo': 'minStock', minimo: 'minStock', 'min stock': 'minStock',
  ubicacion: 'location', location: 'location', deposito: 'location', estante: 'location', posicion: 'location', pasillo: 'location',
  descripcion: 'description', description: 'description', detalle: 'description',
}

const normalize = (s) =>
  String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()

const parseNumber = (v) => {
  if (typeof v === 'number') return v
  const n = parseFloat(String(v).replace(',', '.'))
  return isNaN(n) ? 0 : n
}

export default function Inventory({ products, onAdd, onUpdate, onDelete, onImport }) {
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [formData, setFormData] = useState(EMPTY_FORM)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState('')
  const fileInputRef = useRef(null)
  const photoInputRef = useRef(null)

  const resetForm = () => {
    setFormData(EMPTY_FORM)
    setEditingId(null)
    setError('')
  }

  const handleEdit = (product) => {
    setFormData({
      name: product.name || '',
      code: product.code || '',
      category: product.category || '',
      price: product.price || '',
      minStock: product.minStock || '5',
      quantity: product.quantity ?? '0',
      location: product.location || '',
      description: product.description || '',
      photos: product.photos || [],
    })
    setEditingId(product.id)
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleAddPhotos = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setError('')
    try {
      const room = MAX_PHOTOS - formData.photos.length
      if (room <= 0) {
        setError(`Máximo ${MAX_PHOTOS} fotos por producto`)
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
        setError(`Se agregaron solo ${room} fotos (máximo ${MAX_PHOTOS} por producto)`)
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

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!formData.name.trim()) {
      setError('El nombre es requerido')
      return
    }
    setLoading(true)
    try {
      const data = {
        ...formData,
        price: formData.price ? parseFloat(formData.price) : 0,
        minStock: parseInt(formData.minStock) || 5,
        quantity: parseInt(formData.quantity) || 0,
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
    if (!window.confirm('¿Estás seguro de que quieres eliminar este producto?')) return
    try {
      await onDelete(id)
    } catch (err) {
      alert(err.message)
    }
  }

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true)
    setImportResult('')
    try {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer)
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' })

      if (!rawRows.length) {
        setImportResult('⚠️ El archivo está vacío o no tiene filas de datos.')
        return
      }

      const rows = rawRows
        .map(raw => {
          const p = {}
          Object.entries(raw).forEach(([key, value]) => {
            const field = COLUMN_MAP[normalize(key)]
            if (field) p[field] = value
          })
          if (!p.name || !String(p.name).trim()) return null
          return {
            name: String(p.name).trim(),
            code: p.code !== undefined ? String(p.code).trim() : '',
            category: p.category !== undefined ? String(p.category).trim() : '',
            price: parseNumber(p.price),
            quantity: Math.round(parseNumber(p.quantity)),
            minStock: p.minStock !== undefined ? Math.round(parseNumber(p.minStock)) : 5,
            location: p.location !== undefined ? String(p.location).trim() : '',
            description: p.description !== undefined ? String(p.description).trim() : '',
            photos: [],
          }
        })
        .filter(Boolean)

      if (!rows.length) {
        setImportResult(
          '⚠️ No se encontró la columna "Nombre". El Excel debe tener encabezados en la primera fila: ' +
          'Nombre (obligatorio), Código, Categoría, Precio, Cantidad, Stock Mínimo, Descripción.'
        )
        return
      }

      const count = await onImport(rows)
      const skipped = rawRows.length - rows.length
      setImportResult(
        `✅ Se importaron ${count} productos.` +
        (skipped > 0 ? ` Se saltearon ${skipped} filas sin nombre.` : '')
      )
    } catch (err) {
      setImportResult('❌ Error al importar: ' + err.message)
    } finally {
      setImporting(false)
    }
  }

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Nombre', 'Código', 'Categoría', 'Precio', 'Cantidad', 'Stock Mínimo', 'Ubicación', 'Descripción'],
      ['Producto de ejemplo', 'SKU-001', 'General', 1500, 10, 5, 'Estante A3', 'Descripción opcional'],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Productos')
    XLSX.writeFile(wb, 'plantilla-productos.xlsx')
  }

  const filteredProducts = products.filter(p =>
    p.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.location?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="inventory-container">
      <div className="inventory-header">
        <div>
          <h1>📦 Inventario</h1>
          <p>Gestiona tus productos y stock</p>
        </div>
        <div className="header-buttons">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="btn-import"
            disabled={importing}
          >
            {importing ? '⏳ Importando...' : '📥 Importar Excel'}
          </button>
          <button
            onClick={() => {
              resetForm()
              setShowForm(!showForm)
            }}
            className="btn-add"
          >
            {showForm ? '✕ Cancelar' : '+ Nuevo Producto'}
          </button>
        </div>
      </div>

      {importResult && (
        <div className={importResult.startsWith('✅') ? 'import-ok' : 'import-warn'}>
          {importResult}
          {!importResult.startsWith('✅') && (
            <button className="btn-template" onClick={downloadTemplate}>
              ⬇️ Descargar plantilla de ejemplo
            </button>
          )}
        </div>
      )}

      {showForm && (
        <div className="form-panel">
          <h2>{editingId ? 'Editar Producto' : 'Nuevo Producto'}</h2>
          {error && <div className="error-message">{error}</div>}

          <form onSubmit={handleSubmit} className="product-form">
            <div className="form-grid">
              <div className="form-group">
                <label>Nombre *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Nombre del producto"
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label>Código</label>
                <input
                  type="text"
                  value={formData.code}
                  onChange={e => setFormData({ ...formData, code: e.target.value })}
                  placeholder="Código o SKU"
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label>Categoría</label>
                <input
                  type="text"
                  value={formData.category}
                  onChange={e => setFormData({ ...formData, category: e.target.value })}
                  placeholder="Categoría"
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label>Precio ($)</label>
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
                <label>Cantidad Actual (puede ser negativa)</label>
                <input
                  type="number"
                  value={formData.quantity}
                  onChange={e => setFormData({ ...formData, quantity: e.target.value })}
                  placeholder="0"
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label>Stock Mínimo</label>
                <input
                  type="number"
                  min="0"
                  value={formData.minStock}
                  onChange={e => setFormData({ ...formData, minStock: e.target.value })}
                  placeholder="5"
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label>📍 Ubicación en el depósito</label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={e => setFormData({ ...formData, location: e.target.value })}
                  placeholder="Ej: Estante A3, Pasillo 2"
                  disabled={loading}
                />
              </div>
            </div>

            <div className="form-group">
              <label>Descripción</label>
              <textarea
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                placeholder="Descripción del producto"
                rows="3"
                disabled={loading}
              />
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
                {loading ? '⏳ Guardando...' : (editingId ? '✓ Actualizar' : '✓ Crear Producto')}
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

      <div className="search-box">
        <input
          type="text"
          placeholder="🔍 Buscar por nombre o código..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
      </div>

      {filteredProducts.length === 0 ? (
        <div className="empty-state">
          <p>📦</p>
          <p>{searchTerm ? 'No se encontraron productos' : 'No hay productos. Creá uno o importá tu Excel para empezar.'}</p>
          {!searchTerm && (
            <button className="btn-template" onClick={downloadTemplate}>
              ⬇️ Descargar plantilla Excel
            </button>
          )}
        </div>
      ) : (
        <div className="products-table-container">
          <table className="products-table">
            <thead>
              <tr>
                <th>Foto</th>
                <th>Nombre</th>
                <th>Código</th>
                <th>Categoría</th>
                <th>Precio</th>
                <th>Stock</th>
                <th>Mín.</th>
                <th>📍 Ubicación</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map(product => (
                <tr key={product.id} className={product.quantity < product.minStock ? 'low-stock' : ''}>
                  <td>
                    {product.photos?.length ? (
                      <img className="row-thumb" src={product.photos[0]} alt={product.name} />
                    ) : (
                      <div className="row-thumb placeholder">📦</div>
                    )}
                  </td>
                  <td className="bold">{product.name}</td>
                  <td>{product.code || '-'}</td>
                  <td>{product.category || '-'}</td>
                  <td>${product.price ? Number(product.price).toFixed(2) : '0.00'}</td>
                  <td className="stock">{product.quantity || 0}</td>
                  <td>{product.minStock || 5}</td>
                  <td>{product.location || '-'}</td>
                  <td>
                    <span className={`badge ${product.quantity >= product.minStock ? 'ok' : 'warn'}`}>
                      {product.quantity >= product.minStock ? '✓ OK' : '⚠ Bajo'}
                    </span>
                  </td>
                  <td className="actions">
                    <button onClick={() => handleEdit(product)} className="btn-edit" title="Editar">
                      ✏️
                    </button>
                    <button onClick={() => handleDelete(product.id)} className="btn-del" title="Eliminar">
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
