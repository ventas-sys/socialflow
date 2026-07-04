import React, { useState } from 'react'
import './Inventory.css'

export default function Inventory({ products, onAdd, onUpdate, onDelete }) {
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    category: '',
    price: '',
    minStock: '5',
    quantity: '0',
    description: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  const resetForm = () => {
    setFormData({
      name: '',
      code: '',
      category: '',
      price: '',
      minStock: '5',
      quantity: '0',
      description: '',
    })
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
      quantity: product.quantity || '0',
      description: product.description || '',
    })
    setEditingId(product.id)
    setShowForm(true)
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
      if (editingId) {
        await onUpdate(editingId, {
          ...formData,
          price: formData.price ? parseFloat(formData.price) : 0,
          minStock: parseInt(formData.minStock) || 5,
          quantity: parseInt(formData.quantity) || 0,
        })
      } else {
        await onAdd({
          ...formData,
          price: formData.price ? parseFloat(formData.price) : 0,
          minStock: parseInt(formData.minStock) || 5,
          quantity: parseInt(formData.quantity) || 0,
        })
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
    if (window.confirm('¿Estás seguro de que quieres eliminar este producto?')) {
      try {
        await onDelete(id)
      } catch (err) {
        setError(err.message)
      }
    }
  }

  const filteredProducts = products.filter(p =>
    p.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.code?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="inventory-container">
      <div className="inventory-header">
        <div>
          <h1>📦 Inventario</h1>
          <p>Gestiona tus productos y stock</p>
        </div>
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
                <label>Cantidad Actual</label>
                <input
                  type="number"
                  min="0"
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

            <div className="form-actions">
              <button
                type="submit"
                className="btn-primary"
                disabled={loading}
              >
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
          <p>{searchTerm ? 'No se encontraron productos' : 'No hay productos. ¡Crea uno para empezar!'}</p>
        </div>
      ) : (
        <div className="products-table-container">
          <table className="products-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Código</th>
                <th>Categoría</th>
                <th>Precio</th>
                <th>Stock</th>
                <th>Mín.</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map(product => (
                <tr key={product.id} className={product.quantity < product.minStock ? 'low-stock' : ''}>
                  <td className="bold">{product.name}</td>
                  <td>{product.code || '-'}</td>
                  <td>{product.category || '-'}</td>
                  <td>${product.price ? product.price.toFixed(2) : '0.00'}</td>
                  <td className="stock">{product.quantity || 0}</td>
                  <td>{product.minStock || 5}</td>
                  <td>
                    <span className={`badge ${product.quantity >= product.minStock ? 'ok' : 'warn'}`}>
                      {product.quantity >= product.minStock ? '✓ OK' : '⚠ Bajo'}
                    </span>
                  </td>
                  <td className="actions">
                    <button
                      onClick={() => handleEdit(product)}
                      className="btn-edit"
                      title="Editar"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => handleDelete(product.id)}
                      className="btn-del"
                      title="Eliminar"
                    >
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
