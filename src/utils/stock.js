// Análisis de salud de stock basado en el consumo (salidas) de los últimos 2 meses.
export const HORIZON_DAYS = 60 // ventana de medición: 2 meses

const toMillis = (t) => (t?.toMillis ? t.toMillis() : new Date(t || 0).getTime())

// Map productId -> unidades que SALIERON en los últimos HORIZON_DAYS
export function computeConsumption(movements, nowMs = Date.now()) {
  const cutoff = nowMs - HORIZON_DAYS * 86400000
  const out = new Map()
  for (const m of movements) {
    if (m.type !== 'salida' || !m.productId) continue
    if (toMillis(m.date) < cutoff) continue
    out.set(m.productId, (out.get(m.productId) || 0) + (m.quantity || 0))
  }
  return out
}

// Estado de un producto según su stock y el ritmo de salida
export function stockStatus(product, soldInHorizon = 0) {
  const stock = product.quantity || 0
  const dailyRate = soldInHorizon / HORIZON_DAYS // unidades por día
  if (stock <= 0) {
    return { status: 'sin', label: 'Sin stock', daysLeft: 0, dailyRate }
  }
  if (dailyRate <= 0) {
    return { status: 'sinventas', label: 'Sin ventas (2m)', daysLeft: null, dailyRate }
  }
  const daysLeft = Math.floor(stock / dailyRate)
  if (daysLeft <= 20) return { status: 'bajo', label: 'Bajo stock', daysLeft, dailyRate }
  if (daysLeft <= 75) return { status: 'ok', label: 'Saludable', daysLeft, dailyRate }
  return { status: 'sobre', label: 'Sobre stock', daysLeft, dailyRate }
}

// Texto corto tipo "se termina en 12 días"
export function daysLeftText(info) {
  if (info.status === 'sin') return 'Sin stock'
  if (info.status === 'sinventas') return 'Sin salidas (2m)'
  if (info.daysLeft == null) return ''
  if (info.daysLeft > 365) return '+1 año'
  return `~${info.daysLeft} días`
}
