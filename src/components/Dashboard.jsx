import React, { useMemo, useState, useRef } from 'react'
import { compressImage } from '../utils/images'
import './Dashboard.css'

export default function Dashboard({
  products,
  movements,
  depositMap,
  onSaveMap,
  isAdmin,
  members = [],
  onAddMember,
  onRemoveMember,
}) {
  const [savingMap, setSavingMap] = useState(false)
  const [mapError, setMapError] = useState('')
  const [mapExpanded, setMapExpanded] = useState(false)
  const mapInputRef = useRef(null)
  const [newMemberEmail, setNewMemberEmail] = useState('')
  const [memberError, setMemberError] = useState('')
  const [addingMember, setAddingMember] = useState(false)

  const handleAddMember = async (e) => {
    e.preventDefault()
    setMemberError('')
    setAddingMember(true)
    try {
      await onAddMember(newMemberEmail)
      setNewMemberEmail('')
    } catch (err) {
      setMemberError(err.message)
    } finally {
      setAddingMember(false)
    }
  }

  const handleRemoveMember = async (email) => {
    if (!window.confirm(`¿Quitar el acceso de ${email}?`)) return
    try {
      await onRemoveMember(email)
    } catch (err) {
      alert(err.message)
    }
  }

  const handleMapUpload = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setMapError('')
    setSavingMap(true)
    try {
      // Más resolución que las fotos de producto para que el plano se lea bien
      const photo = await compressImage(file, 1400, 0.72)
      if (photo.length > 900_000) {
        setMapError('La imagen es muy pesada. Probá con una foto más chica.')
        return
      }
      await onSaveMap(photo)
    } catch (err) {
      setMapError('Error al subir la imagen: ' + err.message)
    } finally {
      setSavingMap(false)
    }
  }

  const handleMapRemove = async () => {
    if (!window.confirm('¿Quitar la imagen del depósito?')) return
    setSavingMap(true)
    try {
      await onSaveMap(null)
    } catch (err) {
      setMapError('Error: ' + err.message)
    } finally {
      setSavingMap(false)
    }
  }
  const stats = useMemo(() => {
    const totalProducts = products.length
    const totalStock = products.reduce((sum, p) => sum + (p.quantity || 0), 0)
    const lowStockProducts = products.filter(p => (p.quantity || 0) < (p.minStock || 5))

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayMovements = movements.filter(m => {
      const mDate = m.date?.toDate ? m.date.toDate() : new Date(m.date)
      mDate.setHours(0, 0, 0, 0)
      return mDate.getTime() === today.getTime()
    })

    // Unidades vendidas hoy: las salidas suman unidades, no movimientos
    const unidadesVendidas = todayMovements
      .filter(m => m.type === 'salida')
      .reduce((sum, m) => sum + (m.quantity || 0), 0)

    // Los 5 ingresos más grandes del día, juntando por producto
    const porProducto = new Map()
    todayMovements.filter(m => m.type === 'entrada').forEach(m => {
      const key = m.productId || m.productName || m.id
      const acc = porProducto.get(key) || { nombre: m.productName || 'Producto', unidades: 0 }
      acc.unidades += m.quantity || 0
      porProducto.set(key, acc)
    })
    const topIngresos = [...porProducto.values()]
      .sort((a, b) => b.unidades - a.unidades)
      .slice(0, 5)

    // Los 5 más bajos: primero el que está más lejos de su mínimo
    const topBajos = [...lowStockProducts]
      .sort((a, b) => {
        const ra = (a.quantity || 0) / (a.minStock || 5)
        const rb = (b.quantity || 0) / (b.minStock || 5)
        return ra - rb || (a.quantity || 0) - (b.quantity || 0)
      })
      .slice(0, 5)

    return {
      totalProducts,
      totalStock,
      lowStockProducts: lowStockProducts.length,
      unidadesVendidas,
      topIngresos,
      topBajos,
    }
  }, [products, movements])

  return (
    <div className="dashboard">
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">🏷️</div>
          <div className="stat-content">
            <div className="stat-label">Productos</div>
            <div className="stat-value">{stats.totalProducts}</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <div className="stat-label">Stock Total</div>
            <div className="stat-value">{stats.totalStock}</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">⚠️</div>
          <div className="stat-content">
            <div className="stat-label">Stock Bajo</div>
            <div className="stat-value" style={{ color: stats.lowStockProducts > 0 ? '#ef4444' : '#10b981' }}>
              {stats.lowStockProducts}
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">🛒</div>
          <div className="stat-content">
            <div className="stat-label">Unidades vendidas hoy</div>
            <div className="stat-value">{stats.unidadesVendidas}</div>
          </div>
        </div>
      </div>

      {isAdmin && (
        <div className="dashboard-panel team-panel">
          <h2>👥 Equipo — acceso compartido</h2>
          <p className="team-hint">
            Las cuentas de Google que agregues acá van a ver y modificar
            <strong> el mismo inventario</strong>. Cada movimiento queda
            registrado con el nombre de quien lo hizo.
          </p>
          <form onSubmit={handleAddMember} className="team-form">
            <input
              type="email"
              placeholder="email@gmail.com del empleado"
              value={newMemberEmail}
              onChange={e => setNewMemberEmail(e.target.value)}
              disabled={addingMember}
            />
            <button type="submit" className="btn-map" disabled={addingMember || !newMemberEmail.trim()}>
              {addingMember ? '⏳' : '+ Agregar'}
            </button>
          </form>
          {memberError && <div className="map-error">{memberError}</div>}
          {members.length === 0 ? (
            <p className="team-empty">Todavía no agregaste a nadie. Solo tu cuenta tiene acceso.</p>
          ) : (
            <ul className="team-list">
              {members.map(m => (
                <li key={m.email}>
                  <span>👤 {m.email}</span>
                  <button onClick={() => handleRemoveMember(m.email)} title="Quitar acceso">
                    🗑️
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="dashboard-panel map-panel">
        <div className="map-header">
          <h2>🗺️ Mapa del Depósito</h2>
          {isAdmin && (
            <div className="map-actions">
              <input
                ref={mapInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleMapUpload}
              />
              <button
                className="btn-map"
                onClick={() => mapInputRef.current?.click()}
                disabled={savingMap}
              >
                {savingMap ? '⏳ Guardando...' : (depositMap ? '🔄 Cambiar imagen' : '📤 Subir imagen')}
              </button>
              {depositMap && (
                <button className="btn-map-remove" onClick={handleMapRemove} disabled={savingMap}>
                  🗑️ Quitar
                </button>
              )}
            </div>
          )}
        </div>
        {mapError && <div className="map-error">{mapError}</div>}
        {depositMap ? (
          <img
            src={depositMap}
            alt="Mapa del depósito"
            className={`deposit-map ${mapExpanded ? 'expanded' : ''}`}
            onClick={() => setMapExpanded(!mapExpanded)}
            title={mapExpanded ? 'Clic para achicar' : 'Clic para agrandar'}
          />
        ) : (
          <p className="map-empty">
            {isAdmin
              ? 'Subí una foto o plano de tu depósito para ubicar rápido los productos. Cada producto y combo tiene su campo 📍 Ubicación (ej: "Estante A3").'
              : 'El administrador todavía no subió el mapa del depósito.'}
          </p>
        )}
      </div>

      <div className="dashboard-grid">
        <div className="dashboard-panel">
          <h2>📥 Ingresos de hoy</h2>
          <p className="panel-sub">Los 5 productos que más stock sumaron hoy.</p>
          {stats.topIngresos.length === 0 ? (
            <p className="empty-message">Hoy todavía no entró mercadería.</p>
          ) : (
            <div className="low-stock-list">
              {stats.topIngresos.map((x, i) => (
                <div key={i} className="low-stock-item">
                  <div className="product-name">{x.nombre}</div>
                  <div className="stock-badge entrada">+{x.unidades}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="dashboard-panel">
          <h2>⚠️ Los 5 más bajos de stock</h2>
          <p className="panel-sub">Cantidad que queda sobre el mínimo de cada producto.</p>
          {stats.topBajos.length === 0 ? (
            <p className="empty-message">Todos los productos tienen buen stock</p>
          ) : (
            <div className="low-stock-list">
              {stats.topBajos.map(p => (
                <div key={p.id} className="low-stock-item">
                  <div>
                    <div className="product-name">{p.name}</div>
                    <div className="product-code">
                      {p.code ? `SKU: ${p.code}` : 'Sin SKU'}
                      {p.location ? ` · 📍 ${p.location}` : ''}
                    </div>
                  </div>
                  <div className="stock-badge">
                    {p.quantity || 0} / {p.minStock || 5}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
