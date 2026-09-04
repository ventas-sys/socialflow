import React, { useMemo } from 'react'
import './Reports.css'

export default function Reports({ products, movements }) {
  const reportData = useMemo(() => {
    const totalProducts = products.length
    const totalValue = products.reduce((sum, p) => sum + ((p.price || 0) * (p.quantity || 0)), 0)
    const totalMovements = movements.length
    const lowStockCount = products.filter(p => (p.quantity || 0) < (p.minStock || 5)).length

    // Group by category
    const byCategory = {}
    products.forEach(p => {
      const cat = p.category || 'Sin categoría'
      if (!byCategory[cat]) {
        byCategory[cat] = { count: 0, quantity: 0, value: 0 }
      }
      byCategory[cat].count += 1
      byCategory[cat].quantity += p.quantity || 0
      byCategory[cat].value += (p.price || 0) * (p.quantity || 0)
    })

    // Group movements by type
    const entradas = movements.filter(m => m.type === 'entrada')
    const salidas = movements.filter(m => m.type === 'salida')

    // Top products by value
    const topByValue = [...products]
      .sort((a, b) => ((b.price || 0) * (b.quantity || 0)) - ((a.price || 0) * (a.quantity || 0)))
      .slice(0, 5)

    // Top products by quantity
    const topByQuantity = [...products]
      .sort((a, b) => (b.quantity || 0) - (a.quantity || 0))
      .slice(0, 5)

    // Activity by user
    const byUser = {}
    movements.forEach(m => {
      const user = m.userName || 'Desconocido'
      if (!byUser[user]) {
        byUser[user] = { entries: 0, exits: 0 }
      }
      if (m.type === 'entrada') {
        byUser[user].entries += 1
      } else {
        byUser[user].exits += 1
      }
    })

    return {
      totalProducts,
      totalValue,
      totalMovements,
      lowStockCount,
      byCategory,
      entradas: entradas.length,
      salidas: salidas.length,
      topByValue,
      topByQuantity,
      byUser,
    }
  }, [products, movements])

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value)
  }

  return (
    <div className="reports-container">
      <h1>📈 Reportes e Informes</h1>

      {/* KPI Grid */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon">🏷️</div>
          <div className="kpi-info">
            <div className="kpi-label">Productos Totales</div>
            <div className="kpi-value">{reportData.totalProducts}</div>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon">💰</div>
          <div className="kpi-info">
            <div className="kpi-label">Valor del Inventario</div>
            <div className="kpi-value">{formatCurrency(reportData.totalValue)}</div>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon">🔄</div>
          <div className="kpi-info">
            <div className="kpi-label">Movimientos (60 días)</div>
            <div className="kpi-value">{reportData.totalMovements}</div>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon">⚠️</div>
          <div className="kpi-info">
            <div className="kpi-label">Stock Bajo</div>
            <div className="kpi-value" style={{ color: reportData.lowStockCount > 0 ? '#ef4444' : '#10b981' }}>
              {reportData.lowStockCount}
            </div>
          </div>
        </div>
      </div>

      {/* Two column grid */}
      <div className="reports-grid">
        {/* Movimientos */}
        <div className="report-panel">
          <h2>📊 Resumen de Movimientos</h2>
          <div className="movement-summary">
            <div className="summary-item">
              <span className="icon">📥</span>
              <span className="label">Entradas</span>
              <span className="value">{reportData.entradas}</span>
            </div>
            <div className="summary-item">
              <span className="icon">📤</span>
              <span className="label">Salidas</span>
              <span className="value">{reportData.salidas}</span>
            </div>
            <div className="summary-item">
              <span className="icon">🔄</span>
              <span className="label">Total</span>
              <span className="value">{reportData.totalMovements}</span>
            </div>
          </div>
        </div>

        {/* Por Categoría */}
        <div className="report-panel">
          <h2>🏷️ Productos por Categoría</h2>
          {Object.keys(reportData.byCategory).length === 0 ? (
            <p className="empty">No hay productos</p>
          ) : (
            <div className="category-list">
              {Object.entries(reportData.byCategory)
                .sort((a, b) => b[1].count - a[1].count)
                .map(([category, data]) => (
                  <div key={category} className="category-item">
                    <div>
                      <div className="cat-name">{category}</div>
                      <div className="cat-meta">
                        {data.count} productos • {data.quantity} unidades
                      </div>
                    </div>
                    <div className="cat-value">{formatCurrency(data.value)}</div>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Top por Valor */}
        <div className="report-panel">
          <h2>💰 Top 5 Productos por Valor</h2>
          {reportData.topByValue.length === 0 ? (
            <p className="empty">No hay productos</p>
          ) : (
            <div className="top-list">
              {reportData.topByValue.map((p, idx) => (
                <div key={p.id} className="top-item">
                  <span className="rank">#{idx + 1}</span>
                  <div>
                    <div className="product-name">{p.name}</div>
                    <div className="product-meta">{p.quantity} unidades × {formatCurrency(p.price || 0)}</div>
                  </div>
                  <div className="value">{formatCurrency((p.price || 0) * (p.quantity || 0))}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top por Cantidad */}
        <div className="report-panel">
          <h2>🏷️ Top 5 Productos por Cantidad</h2>
          {reportData.topByQuantity.length === 0 ? (
            <p className="empty">No hay productos</p>
          ) : (
            <div className="top-list">
              {reportData.topByQuantity.map((p, idx) => (
                <div key={p.id} className="top-item">
                  <span className="rank">#{idx + 1}</span>
                  <div>
                    <div className="product-name">{p.name}</div>
                    <div className="product-meta">{formatCurrency(p.price || 0)} c/u</div>
                  </div>
                  <div className="quantity-badge">{p.quantity || 0}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actividad por Usuario */}
        <div className="report-panel full-width">
          <h2>👥 Actividad por Usuario</h2>
          {Object.keys(reportData.byUser).length === 0 ? (
            <p className="empty">No hay movimientos registrados</p>
          ) : (
            <div className="user-activity">
              {Object.entries(reportData.byUser)
                .sort((a, b) => (b[1].entries + b[1].exits) - (a[1].entries + a[1].exits))
                .map(([user, data]) => (
                  <div key={user} className="user-row">
                    <span className="user-name">👤 {user}</span>
                    <div className="user-stats">
                      <span className="stat entrada">📥 {data.entries} entradas</span>
                      <span className="stat salida">📤 {data.exits} salidas</span>
                      <span className="stat total">🔄 {data.entries + data.exits} total</span>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="report-footer">
        <p>📅 Datos actualizados en tiempo real</p>
        <p>🔐 Todos los movimientos se auditan por usuario y fecha</p>
      </div>
    </div>
  )
}
