import React, { useMemo } from 'react'
import './Dashboard.css'

export default function Dashboard({ products, movements }) {
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

    const recentMovements = movements.slice(0, 5)

    return {
      totalProducts,
      totalStock,
      lowStockProducts: lowStockProducts.length,
      todayMovements: todayMovements.length,
      recentMovements,
    }
  }, [products, movements])

  const formatDate = (timestamp) => {
    if (!timestamp) return '-'
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
    return date.toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="dashboard">
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">📦</div>
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
          <div className="stat-icon">🔄</div>
          <div className="stat-content">
            <div className="stat-label">Movimientos Hoy</div>
            <div className="stat-value">{stats.todayMovements}</div>
          </div>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="dashboard-panel">
          <h2>Movimientos Recientes</h2>
          {stats.recentMovements.length === 0 ? (
            <p className="empty-message">No hay movimientos registrados</p>
          ) : (
            <div className="movements-list">
              {stats.recentMovements.map(m => (
                <div key={m.id} className="movement-item">
                  <div className="movement-icon">
                    {m.type === 'entrada' ? '📥' : '📤'}
                  </div>
                  <div className="movement-info">
                    <div className="movement-product">{m.productName || 'Producto'}</div>
                    <div className="movement-details">
                      {m.type === 'entrada' ? 'Entrada' : 'Salida'} · {m.quantity} unidades
                    </div>
                    <div className="movement-time">{formatDate(m.date)}</div>
                  </div>
                  <div className="movement-user">{m.userName}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="dashboard-panel">
          <h2>Productos con Stock Bajo</h2>
          {stats.lowStockProducts.length === 0 ? (
            <p className="empty-message">Todos los productos tienen buen stock</p>
          ) : (
            <div className="low-stock-list">
              {products
                .filter(p => (p.quantity || 0) < (p.minStock || 5))
                .map(p => (
                  <div key={p.id} className="low-stock-item">
                    <div>
                      <div className="product-name">{p.name}</div>
                      <div className="product-code">Código: {p.code || '-'}</div>
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
