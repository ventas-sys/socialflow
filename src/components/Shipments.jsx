import React, { useState, useEffect, useRef, useMemo } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import Scanner from './Scanner'
import './Shipments.css'

const STATUS = {
  pendiente: { label: 'Pendiente', color: '#ef4444', emoji: '🔴' },
  camino: { label: 'En camino', color: '#f59e0b', emoji: '🟡' },
  entregado: { label: 'Entregado', color: '#10b981', emoji: '🟢' },
}

// Intenta sacar un número/código de envío del contenido del QR de ML
function parseShipmentCode(raw) {
  const text = String(raw).trim()
  try {
    const obj = JSON.parse(text)
    if (obj && (obj.id || obj.shipment_id)) return String(obj.id || obj.shipment_id)
  } catch { /* no es JSON */ }
  const m = text.match(/(\d{8,})/) // primer número largo (id de envío)
  return m ? m[1] : text.slice(0, 40)
}

export default function Shipments({
  shipments,
  couriers,
  onAddShipment,
  onUpdateShipment,
  onDeleteShipment,
  onAddCourier,
  onRemoveCourier,
}) {
  const mapRef = useRef(null)
  const mapObj = useRef(null)
  const markers = useRef(new Map())
  const [showScanner, setShowScanner] = useState(false)
  const [locatingId, setLocatingId] = useState(null) // envío al que le estamos poniendo ubicación
  const [courierFilter, setCourierFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [newCourier, setNewCourier] = useState('')
  const [showCouriers, setShowCouriers] = useState(false)
  const locatingRef = useRef(null)
  locatingRef.current = locatingId

  // Inicializar mapa una sola vez
  useEffect(() => {
    if (mapObj.current || !mapRef.current) return
    const map = L.map(mapRef.current).setView([-34.6037, -58.3816], 12) // Buenos Aires por defecto
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map)
    map.on('click', (e) => {
      const id = locatingRef.current
      if (id) {
        onUpdateShipment(id, { lat: e.latlng.lat, lng: e.latlng.lng })
        setLocatingId(null)
      }
    })
    mapObj.current = map
    // Ajuste de tamaño tras el primer render
    setTimeout(() => map.invalidateSize(), 200)
  }, [onUpdateShipment])

  const visible = useMemo(() => shipments.filter(s => {
    if (courierFilter !== 'all' && s.courierId !== courierFilter) return false
    if (statusFilter !== 'all' && (s.status || 'pendiente') !== statusFilter) return false
    return true
  }), [shipments, courierFilter, statusFilter])

  // Dibujar / actualizar marcadores
  useEffect(() => {
    const map = mapObj.current
    if (!map) return
    const seen = new Set()
    visible.forEach(s => {
      if (s.lat == null || s.lng == null) return
      seen.add(s.id)
      const st = STATUS[s.status || 'pendiente'] || STATUS.pendiente
      const html = `<div class="pin" style="background:${st.color}"></div>`
      const icon = L.divIcon({ html, className: 'pin-wrap', iconSize: [22, 22], iconAnchor: [11, 11] })
      let m = markers.current.get(s.id)
      if (!m) {
        m = L.marker([s.lat, s.lng], { icon }).addTo(map)
        markers.current.set(s.id, m)
      } else {
        m.setLatLng([s.lat, s.lng])
        m.setIcon(icon)
      }
      m.bindPopup(
        `<b>${(s.code || '').replace(/</g, '&lt;')}</b><br>${(s.recipient || '').replace(/</g, '&lt;')}<br>` +
        `${st.emoji} ${st.label}${s.courierName ? '<br>🏍️ ' + s.courierName.replace(/</g, '&lt;') : ''}`
      )
    })
    // quitar los que ya no están visibles
    markers.current.forEach((m, id) => {
      if (!seen.has(id)) { map.removeLayer(m); markers.current.delete(id) }
    })
  }, [visible])

  const handleScan = async (raw) => {
    setShowScanner(false)
    const code = parseShipmentCode(raw)
    const exists = shipments.find(s => s.code === code)
    if (exists) {
      alert('Ese envío ya está cargado: ' + code)
      setLocatingId(exists.id)
      return
    }
    const id = await onAddShipment({ code, recipient: '', status: 'pendiente' })
    if (id) setLocatingId(id) // pedir que se marque en el mapa
  }

  const cycleStatus = (s) => {
    const order = ['pendiente', 'camino', 'entregado']
    const next = order[(order.indexOf(s.status || 'pendiente') + 1) % order.length]
    onUpdateShipment(s.id, { status: next, ...(next === 'entregado' ? { deliveredAt: new Date() } : {}) })
  }

  const assignCourier = (s, courierId) => {
    const c = couriers.find(x => x.id === courierId)
    onUpdateShipment(s.id, { courierId: courierId || '', courierName: c?.name || '' })
  }

  const handleAddCourier = async (e) => {
    e.preventDefault()
    const name = newCourier.trim()
    if (!name) return
    await onAddCourier(name)
    setNewCourier('')
  }

  const counts = useMemo(() => {
    const c = { pendiente: 0, camino: 0, entregado: 0 }
    shipments.forEach(s => { c[s.status || 'pendiente'] = (c[s.status || 'pendiente'] || 0) + 1 })
    return c
  }, [shipments])

  return (
    <div className="shipments-container">
      <div className="ship-header">
        <div>
          <h1>🚚 Envíos</h1>
          <p>Escaneá etiquetas de MercadoLibre, ubicalas en el mapa y asigná motoqueros.</p>
        </div>
        <div className="ship-header-actions">
          <button className="btn-scan-ship" onClick={() => setShowScanner(true)}>
            📷 Escanear etiqueta
          </button>
          <button className="btn-couriers" onClick={() => setShowCouriers(v => !v)}>
            🏍️ Motoqueros ({couriers.length})
          </button>
        </div>
      </div>

      {showScanner && (
        <Scanner onScan={handleScan} onClose={() => setShowScanner(false)} />
      )}

      {locatingId && (
        <div className="locating-banner">
          📍 Tocá en el mapa el punto de entrega de este envío.
          <button onClick={() => setLocatingId(null)}>Cancelar</button>
        </div>
      )}

      {showCouriers && (
        <div className="couriers-panel">
          <h3>🏍️ Motoqueros</h3>
          <form onSubmit={handleAddCourier} className="courier-form">
            <input
              type="text"
              value={newCourier}
              onChange={e => setNewCourier(e.target.value)}
              placeholder="Nombre del motoquero"
            />
            <button type="submit" className="btn-add-courier">+ Agregar</button>
          </form>
          {couriers.length === 0 ? (
            <p className="empty-hint">Todavía no agregaste motoqueros.</p>
          ) : (
            <ul className="couriers-list">
              {couriers.map(c => (
                <li key={c.id}>
                  <span>🏍️ {c.name}</span>
                  <button onClick={() => onRemoveCourier(c.id)} title="Quitar">🗑️</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="ship-stats">
        <button className={`ship-stat ${statusFilter === 'all' ? 'active' : ''}`} onClick={() => setStatusFilter('all')}>
          Todos ({shipments.length})
        </button>
        <button className={`ship-stat pend ${statusFilter === 'pendiente' ? 'active' : ''}`} onClick={() => setStatusFilter('pendiente')}>
          🔴 Pendientes ({counts.pendiente})
        </button>
        <button className={`ship-stat cam ${statusFilter === 'camino' ? 'active' : ''}`} onClick={() => setStatusFilter('camino')}>
          🟡 En camino ({counts.camino})
        </button>
        <button className={`ship-stat ent ${statusFilter === 'entregado' ? 'active' : ''}`} onClick={() => setStatusFilter('entregado')}>
          🟢 Entregados ({counts.entregado})
        </button>
        {couriers.length > 0 && (
          <select value={courierFilter} onChange={e => setCourierFilter(e.target.value)} className="courier-filter">
            <option value="all">Todos los motoqueros</option>
            {couriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      <div ref={mapRef} className="ship-map"></div>

      <div className="ship-list">
        {visible.length === 0 ? (
          <div className="empty-state">
            <p>🚚</p>
            <p>No hay envíos. Escaneá una etiqueta para empezar.</p>
          </div>
        ) : (
          visible.map(s => {
            const st = STATUS[s.status || 'pendiente'] || STATUS.pendiente
            return (
              <div key={s.id} className="ship-card" style={{ borderLeftColor: st.color }}>
                <div className="ship-card-main">
                  <div className="ship-code">{s.code}</div>
                  {s.recipient && <div className="ship-recipient">{s.recipient}</div>}
                  <div className="ship-badges">
                    <button className="ship-status-badge" style={{ background: st.color }} onClick={() => cycleStatus(s)}>
                      {st.emoji} {st.label}
                    </button>
                    {s.lat == null && (
                      <button className="ship-locate" onClick={() => setLocatingId(s.id)}>📍 Ubicar</button>
                    )}
                    {s.lat != null && (
                      <button className="ship-locate ok" onClick={() => {
                        setLocatingId(null)
                        mapObj.current?.setView([s.lat, s.lng], 16)
                      }}>🗺️ Ver</button>
                    )}
                  </div>
                </div>
                <div className="ship-card-side">
                  <select
                    value={s.courierId || ''}
                    onChange={e => assignCourier(s, e.target.value)}
                    className="ship-courier-select"
                  >
                    <option value="">Sin motoquero</option>
                    {couriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button className="ship-del" onClick={() => {
                    if (window.confirm('¿Eliminar este envío?')) onDeleteShipment(s.id)
                  }}>🗑️</button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
