import React, { useState, useEffect, useRef, useMemo } from 'react'
import * as XLSX from 'xlsx'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import Scanner from './Scanner'
import './Shipments.css'

// Flujo de estados del envío
const STATUS = {
  pendiente: { label: 'Pendiente de imprimir', short: 'Pendiente', color: '#ef4444', emoji: '🖨️' },
  armado:    { label: 'Armado', short: 'Armado', color: '#f59e0b', emoji: '📦' },
  camino:    { label: 'En camino', short: 'En camino', color: '#3b82f6', emoji: '🏍️' },
  entregado: { label: 'Entregado', short: 'Entregado', color: '#10b981', emoji: '✅' },
  demorado:  { label: 'Demorado', short: 'Demorado', color: '#8b5cf6', emoji: '⏰' },
  archivado: { label: 'Archivado', short: 'Archivado', color: '#6b7280', emoji: '🗄️' },
}
const ORDER = ['pendiente', 'armado', 'camino', 'entregado', 'demorado', 'archivado']

// Zonas FLEX de MercadoLibre: lo que ML bonifica por cada envío según la zona
const ZONES = {
  cercana:   { label: 'Cercana', pay: 4490 },
  media:     { label: 'Media dist.', pay: 6490 },
  lejana:    { label: 'Lejana', pay: 8690 },
  muylejana: { label: 'Muy lejana', pay: 9990 },
}
const zonePay = (s) => (s.zone && ZONES[s.zone] ? ZONES[s.zone].pay : 0)
const fmtMoney = (n) => '$' + (Number(n) || 0).toLocaleString('es-AR')

const parseShipmentCode = (raw) => {
  const text = String(raw).trim()
  try { const o = JSON.parse(text); if (o && (o.id || o.shipment_id)) return String(o.id || o.shipment_id) } catch {}
  const m = text.match(/(\d{8,})/)
  return m ? m[1] : text.slice(0, 40)
}

const toMillis = (t) => (t?.toMillis ? t.toMillis() : (t ? new Date(t).getTime() : 0))
const fmtDur = (ms) => {
  if (!ms || ms < 0) return '—'
  const min = Math.round(ms / 60000)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60), m = min % 60
  return `${h}h ${m}m`
}
const fmtDateTime = (t) => t ? new Date(toMillis(t)).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

const API = '/api/ml/exchange'

export default function Shipments({
  shipments, couriers, mlAccounts, onSaveAccount,
  onAddShipment, onUpdateShipment, onDeleteShipment, onClearShipments,
  onAddCourier, onRemoveCourier,
}) {
  const mapRef = useRef(null)
  const mapObj = useRef(null)
  const markers = useRef(new Map())
  const [view, setView] = useState('tablero') // 'tablero' | 'reporte'
  const [showScanner, setShowScanner] = useState(false)
  const [locatingId, setLocatingId] = useState(null)
  const locatingRef = useRef(null); locatingRef.current = locatingId
  const [statusFilter, setStatusFilter] = useState('all')
  const [courierFilter, setCourierFilter] = useState('all')
  const [searchShip, setSearchShip] = useState('')
  const [showCouriers, setShowCouriers] = useState(false)
  const [newCourier, setNewCourier] = useState('')
  const [actionId, setActionId] = useState(null) // envío enfocado tras escanear
  const [range, setRange] = useState('hoy') // reporte: hoy | semana | mes
  const [syncMsg, setSyncMsg] = useState('')
  const [syncing, setSyncing] = useState(false)
  const syncingRef = useRef(false)
  const shipmentsRef = useRef(shipments); shipmentsRef.current = shipments
  const mlRef = useRef(mlAccounts); mlRef.current = mlAccounts

  // Renueva el token de ML si está por vencer (usa el actual si no puede)
  const ensureToken = async (key) => {
    const acc = mlRef.current?.[key]
    if (!acc?.accessToken) return null
    const expMs = acc.expiresAt?.toMillis ? acc.expiresAt.toMillis() : new Date(acc.expiresAt || 0).getTime()
    if (expMs && expMs - Date.now() > 5 * 60 * 1000) return acc.accessToken
    try {
      const r = await fetch(`${API}?action=refresh`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: acc.clientId, clientSecret: acc.clientSecret, refreshToken: acc.refreshToken }),
      }).then(x => x.json())
      if (r.ok) {
        try { await onSaveAccount(key, { accessToken: r.accessToken, refreshToken: r.refreshToken, expiresAt: new Date(Date.now() + (r.expiresIn || 21600) * 1000) }) } catch {}
        return r.accessToken
      }
    } catch {}
    return acc.accessToken
  }

  // Trae las ventas de ML (ambas cuentas), excluye Full y crea los envíos
  // que falten en estado "Pendiente de imprimir".
  const syncFromML = async (silent = false) => {
    if (syncingRef.current) return // no solapar sincronizaciones
    const accs = mlRef.current || {}
    const keys = Object.keys(accs).filter(k => accs[k]?.accessToken)
    if (!keys.length) { if (!silent) setSyncMsg('⚠️ Conectá MercadoLibre primero (solapa ML).'); return }
    syncingRef.current = true
    setSyncing(true) // avisar SIEMPRE, también en la actualización automática
    // Un envío por COMPRA (pack) o por envío físico; evita duplicar por producto.
    // Solo AGREGA ventas nuevas: nunca toca el estado de las ya gestionadas.
    const seen = new Set(shipmentsRef.current.map(s => String(s.packId || s.code)))
    let created = 0
    const diag = { total: 0, flex: 0, cerrados: 0 }
    let nPend = 0, nCamino = 0, nDemorado = 0, nEntregado = 0
    const H48 = 48 * 3600 * 1000
    try {
      for (const key of keys) {
        const token = await ensureToken(key)
        if (!token) continue
        // Ventana de 7 días: 48hs para pendientes/en camino, 1 semana para demorados
        const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - 7)
        const r = await fetch(`${API}?action=orders`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, from: from.toISOString() }),
        }).then(x => x.json())
        if (!r.ok) continue
        diag.total += r.orders.length
        for (const o of r.orders) {
          // SOLO FLEX / Turbo (self_service): lo que repartimos con moto
          if (o.logisticType !== 'self_service') continue
          diag.flex++
          // Cancelados no se traen; el resto de los últimos 7 días SÍ
          // (incluidos entregados, para ver la evolución del reparto)
          if (['cancelled', 'to_be_agreed'].includes(o.shipmentStatus)) { diag.cerrados++; continue }
          const ageMs = Date.now() - new Date(o.date).getTime()
          // Estado inicial según ML y antigüedad:
          //  delivered → Entregado
          //  shipped ≤48hs → En camino; más viejo o not_delivered → Demorado
          //  abierto ≤48hs → Pendiente; abierto más viejo → Demorado
          let status
          if (o.shipmentStatus === 'delivered') status = 'entregado'
          else if (o.shipmentStatus === 'shipped') status = ageMs <= H48 ? 'camino' : 'demorado'
          else if (o.shipmentStatus === 'not_delivered') status = 'demorado'
          else status = ageMs <= H48 ? 'pendiente' : 'demorado'
          const gkey = String(o.packId || o.shipmentId || '')
          if (!gkey || seen.has(gkey)) continue // agrupa la compra del cliente
          seen.add(gkey)
          const id = await onAddShipment({
            code: String(o.shipmentId || o.packId), packId: o.packId || null,
            recipient: o.recipient || '', address: o.address || '',
            lat: o.lat ?? null, lng: o.lng ?? null, status, cost: 0, account: key,
            ...(status === 'camino' ? { assignedAt: new Date(o.date) } : {}),
            ...(status === 'demorado' ? { demoradoAt: new Date() } : {}),
            ...(status === 'entregado' ? { deliveredAt: new Date(o.date) } : {}),
          })
          if (id) {
            created++
            if (status === 'pendiente') nPend++
            else if (status === 'camino') nCamino++
            else if (status === 'entregado') nEntregado++
            else nDemorado++
          }
        }
      }
      if (created || !silent) setSyncMsg(
        `✅ ${created} envíos nuevos: ${nPend} pendientes, ${nCamino} en camino, ` +
        `${nEntregado} entregados, ${nDemorado} demorados. (${diag.flex} FLEX de ${diag.total} ventas)`
      )
    } catch (e) {
      if (!silent) setSyncMsg('❌ ' + e.message)
    } finally {
      syncingRef.current = false
      setSyncing(false)
    }
  }

  // Al abrir la sección y cada 30 minutos, traer las ventas de ML
  useEffect(() => {
    syncFromML(true)
    const t = setInterval(() => syncFromML(true), 30 * 60 * 1000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mapa
  useEffect(() => {
    if (mapObj.current || !mapRef.current || view !== 'tablero') return
    const map = L.map(mapRef.current).setView([-34.6037, -58.3816], 12)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map)
    map.on('click', (e) => {
      const id = locatingRef.current
      if (id) { onUpdateShipment(id, { lat: e.latlng.lat, lng: e.latlng.lng }); setLocatingId(null) }
    })
    mapObj.current = map
    setTimeout(() => map.invalidateSize(), 200)
  }, [onUpdateShipment, view])

  const visible = useMemo(() => {
    const q = searchShip.trim().toLowerCase()
    return shipments.filter(s => {
      const st = s.status || 'pendiente'
      // "Todos" no incluye los archivados (tienen su propio filtro)
      if (statusFilter === 'all' && st === 'archivado') return false
      if (statusFilter !== 'all' && st !== statusFilter) return false
      if (courierFilter !== 'all' && s.courierId !== courierFilter) return false
      if (q) {
        return (
          String(s.code || '').toLowerCase().includes(q) ||
          String(s.packId || '').toLowerCase().includes(q) ||
          (s.recipient || '').toLowerCase().includes(q) ||
          (s.address || '').toLowerCase().includes(q) ||
          (s.courierName || '').toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [shipments, statusFilter, courierFilter, searchShip])

  // El mapa sigue al filtro: con un estado elegido muestra SOLO ese estado;
  // en "Todos" muestra los activos del día (pendiente, armado, en camino).
  const startOfToday = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() })()
  const mapItems = useMemo(() => {
    const q = searchShip.trim().toLowerCase()
    return shipments.filter(s => {
      const st = s.status || 'pendiente'
      if (st === 'archivado') return false // archivado nunca va al mapa
      if (statusFilter !== 'all') {
        if (st !== statusFilter) return false
      } else {
        if (!['pendiente', 'armado', 'camino'].includes(st)) return false
        if (!(toMillis(s.createdAt) >= startOfToday || st === 'camino')) return false
      }
      if (courierFilter !== 'all' && s.courierId !== courierFilter) return false
      if (q) {
        return (
          String(s.code || '').toLowerCase().includes(q) ||
          (s.recipient || '').toLowerCase().includes(q) ||
          (s.address || '').toLowerCase().includes(q) ||
          (s.courierName || '').toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [shipments, statusFilter, courierFilter, searchShip, startOfToday])

  useEffect(() => {
    const map = mapObj.current
    if (!map || view !== 'tablero') return
    const seen = new Set()
    mapItems.forEach(s => {
      if (s.lat == null || s.lng == null) return
      seen.add(s.id)
      const st = STATUS[s.status || 'pendiente'] || STATUS.pendiente
      const icon = L.divIcon({ html: `<div class="pin" style="background:${st.color}"></div>`, className: 'pin-wrap', iconSize: [22, 22], iconAnchor: [11, 11] })
      let m = markers.current.get(s.id)
      if (!m) { m = L.marker([s.lat, s.lng], { icon }).addTo(map); markers.current.set(s.id, m) }
      else { m.setLatLng([s.lat, s.lng]); m.setIcon(icon) }
      m.bindPopup(`<b>${(s.code || '').replace(/</g, '&lt;')}</b><br>${(s.recipient || '').replace(/</g, '&lt;')}<br>${st.emoji} ${st.label}${s.courierName ? '<br>🏍️ ' + s.courierName.replace(/</g, '&lt;') : ''}`)
    })
    markers.current.forEach((m, id) => { if (!seen.has(id)) { map.removeLayer(m); markers.current.delete(id) } })
  }, [mapItems, view])

  // Cambiar de estado guardando el timestamp correspondiente
  const changeStatus = async (s, newStatus, extra = {}) => {
    const now = new Date()
    const patch = { status: newStatus, ...extra }
    if (newStatus === 'armado' && !s.armadoAt) patch.armadoAt = now
    if (newStatus === 'camino' && !s.assignedAt) patch.assignedAt = now
    if (newStatus === 'entregado') patch.deliveredAt = now
    if (newStatus === 'demorado') patch.demoradoAt = now
    if (newStatus === 'archivado') patch.archivedAt = now
    try {
      await onUpdateShipment(s.id, patch)
    } catch (e) {
      setSyncMsg('❌ No se pudo guardar el estado: ' + (e?.message || e))
    }
  }

  const assignCourier = async (s, courierId) => {
    const c = couriers.find(x => x.id === courierId)
    const patch = { courierId: courierId || '', courierName: c?.name || '' }
    // Asignar motoquero pasa el envío a "En camino"
    if (courierId && ['pendiente', 'armado', 'demorado'].includes(s.status || 'pendiente')) {
      patch.status = 'camino'
      if (!s.assignedAt) patch.assignedAt = new Date()
    }
    try {
      await onUpdateShipment(s.id, patch)
    } catch (e) {
      setSyncMsg('❌ No se pudo asignar: ' + (e?.message || e))
    }
  }

  const handleScan = async (raw) => {
    setShowScanner(false)
    const code = parseShipmentCode(raw)
    // Búsqueda flexible: por código exacto, por pack, o por coincidencia parcial
    const digits = String(raw).replace(/\D/g, '')
    const existing = shipments.find(s => {
      const c = String(s.code); const p = String(s.packId || '')
      return c === code || p === code ||
        (code && (c.includes(code) || code.includes(c))) ||
        (digits && (c === digits || p === digits || c.includes(digits) || digits.includes(c)))
    })
    if (existing) { setActionId(existing.id) }
    else setSyncMsg(
      `⚠️ No se encontró ese envío. El QR dice: «${String(raw).slice(0, 90)}» ` +
      `(código leído: ${code}). Puede ser de correo/Full o ya despachado; ` +
      `si debería estar, pasame ese texto y ajusto la lectura del QR.`
    )
  }

  const handleAddCourier = async (e) => {
    e.preventDefault()
    const name = newCourier.trim(); if (!name) return
    await onAddCourier(name); setNewCourier('')
  }

  const counts = useMemo(() => {
    const c = {}; ORDER.forEach(k => c[k] = 0)
    shipments.forEach(s => { c[s.status || 'pendiente'] = (c[s.status || 'pendiente'] || 0) + 1 })
    return c
  }, [shipments])

  const actionShipment = shipments.find(s => s.id === actionId)

  // ---- Reporte ----
  const reportRows = useMemo(() => {
    const now = new Date()
    let from = new Date(now); from.setHours(0, 0, 0, 0)
    if (range === 'semana') from.setDate(from.getDate() - 6)
    if (range === 'mes') from.setDate(from.getDate() - 29)
    const fromMs = from.getTime()
    return shipments
      .filter(s => {
        const ref = toMillis(s.deliveredAt || s.createdAt)
        return ref >= fromMs
      })
      .map(s => {
        const salio = toMillis(s.assignedAt)
        const entrego = toMillis(s.deliveredAt)
        const demoraMs = salio && entrego ? entrego - salio : 0
        return { s, salio, entrego, demoraMs }
      })
      .sort((a, b) => toMillis(b.s.createdAt) - toMillis(a.s.createdAt))
  }, [shipments, range])

  const reportTotals = useMemo(() => {
    const entregados = reportRows.filter(r =>
      r.s.status === 'entregado' || (r.s.status === 'archivado' && r.s.deliveredAt)
    )
    const cobroML = reportRows.reduce((sum, r) => sum + zonePay(r.s), 0)
    const pagoMoto = reportRows.reduce((sum, r) => sum + (Number(r.s.courierPay) || 0), 0)
    const pagoComprador = reportRows.reduce((sum, r) => sum + (Number(r.s.buyerPay) || 0), 0)
    const demoras = entregados.filter(r => r.demoraMs > 0).map(r => r.demoraMs)
    const demoraProm = demoras.length ? demoras.reduce((a, b) => a + b, 0) / demoras.length : 0
    return { total: reportRows.length, entregados: entregados.length, cobroML, pagoMoto, pagoComprador, demoraProm }
  }, [reportRows])

  const exportReport = () => {
    const rows = [['Código', 'Destinatario', 'Motoquero', 'Estado', 'Salió', 'Entregó', 'Demora (min)', 'Zona', 'Cobro ML', 'Pago motoquero', 'Pagó comprador']]
    reportRows.forEach(({ s, salio, entrego, demoraMs }) => {
      rows.push([
        s.code || '', s.recipient || '', s.courierName || '', STATUS[s.status || 'pendiente']?.label || '',
        salio ? new Date(salio).toLocaleString('es-AR') : '',
        entrego ? new Date(entrego).toLocaleString('es-AR') : '',
        demoraMs ? Math.round(demoraMs / 60000) : '',
        s.zone && ZONES[s.zone] ? ZONES[s.zone].label : '',
        zonePay(s),
        Number(s.courierPay) || 0,
        Number(s.buyerPay) || 0,
      ])
    })
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{ wch: 16 }, { wch: 26 }, { wch: 18 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 14 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Envíos')
    XLSX.writeFile(wb, `envios-${range}.xlsx`)
  }

  return (
    <div className="shipments-container">
      <div className="ship-header">
        <div>
          <h1>🚚 Envíos</h1>
          <p>Entran solos los envíos FLEX / Turbo (los que repartís con moto) como "Pendiente de imprimir" — no el correo ni Full. Escaneá el QR para asignar el motoquero.</p>
        </div>
        <div className="ship-header-actions">
          <button className="btn-sync-ship" onClick={() => syncFromML(false)} disabled={syncing}>
            {syncing ? '⏳ Trayendo...' : '🔄 Traer ventas de ML'}
          </button>
          <button className="btn-scan-ship" onClick={() => setShowScanner(true)}>📷 Escanear QR</button>
          <button className="btn-couriers" onClick={() => setShowCouriers(v => !v)}>🏍️ Motoqueros ({couriers.length})</button>
          {onClearShipments && shipments.length > 0 && (
            <button className="btn-clear-ship" onClick={() => {
              if (window.confirm(`¿Borrar los ${shipments.length} envíos y volver a traerlos de ML bien agrupados?`)) onClearShipments()
            }}>🗑️ Vaciar</button>
          )}
        </div>
      </div>
      {syncing && (
        <div className="ship-sync-msg loading">
          ⏳ Trayendo las ventas de MercadoLibre... esperá un momento, puede tardar hasta un minuto. No hace falta volver a tocar el botón.
        </div>
      )}
      {!syncing && syncMsg && <div className={`ship-sync-msg ${syncMsg.startsWith('✅') ? 'ok' : 'warn'}`}>{syncMsg}</div>}

      <div className="ship-viewtabs">
        <button className={view === 'tablero' ? 'active' : ''} onClick={() => setView('tablero')}>🗂️ Tablero</button>
        <button className={`tab-rep ${view === 'reporte' ? 'active' : ''}`} onClick={() => setView('reporte')}>📊 Reporte</button>
      </div>

      {showScanner && <Scanner onScan={handleScan} onClose={() => setShowScanner(false)} />}

      {showCouriers && (
        <div className="couriers-panel">
          <h3>🏍️ Motoqueros</h3>
          <form onSubmit={handleAddCourier} className="courier-form">
            <input type="text" value={newCourier} onChange={e => setNewCourier(e.target.value)} placeholder="Nombre del motoquero" />
            <button type="submit" className="btn-add-courier">+ Agregar</button>
          </form>
          {couriers.length === 0 ? <p className="empty-hint">Todavía no agregaste motoqueros.</p> : (
            <ul className="couriers-list">
              {couriers.map(c => (
                <li key={c.id}><span>🏍️ {c.name}</span><button onClick={() => onRemoveCourier(c.id)} title="Quitar">🗑️</button></li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Panel de acción tras escanear un envío */}
      {actionShipment && (
        <div className="ship-action">
          <div className="ship-action-head">
            <div>
              <div className="sa-code">{actionShipment.code}</div>
              <span className="sa-status" style={{ background: STATUS[actionShipment.status || 'pendiente'].color }}>
                {STATUS[actionShipment.status || 'pendiente'].emoji} {STATUS[actionShipment.status || 'pendiente'].label}
              </span>
            </div>
            <button className="sa-close" onClick={() => setActionId(null)}>✕</button>
          </div>
          <div className="sa-buttons">
            <button onClick={() => changeStatus(actionShipment, 'armado')}>📦 Armado</button>
            <select value={actionShipment.courierId || ''} onChange={e => assignCourier(actionShipment, e.target.value)}>
              <option value="">🏍️ Asignar motoquero…</option>
              {couriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="ok" onClick={() => changeStatus(actionShipment, 'entregado')}>✅ Entregado</button>
            <button className="warn" onClick={() => changeStatus(actionShipment, 'demorado')}>⏰ Demorado</button>
            {actionShipment.status === 'entregado' && (
              <button onClick={() => changeStatus(actionShipment, 'archivado')}>🗄️ Archivar</button>
            )}
          </div>
        </div>
      )}

      {locatingId && (
        <div className="locating-banner">📍 Tocá en el mapa el punto de entrega.<button onClick={() => setLocatingId(null)}>Cancelar</button></div>
      )}

      {view === 'tablero' ? (
        <>
          <div className="ship-stats">
            <button className={`ship-stat ${statusFilter === 'all' ? 'active' : ''}`} onClick={() => setStatusFilter('all')}>Todos ({shipments.length - (counts.archivado || 0)})</button>
            {ORDER.map(k => (
              <button key={k} className={`ship-stat ${statusFilter === k ? 'active' : ''}`}
                onClick={() => setStatusFilter(k)}
                style={statusFilter === k ? { background: STATUS[k].color, borderColor: STATUS[k].color, color: '#fff' } : {}}>
                {STATUS[k].emoji} {STATUS[k].short} ({counts[k]})
              </button>
            ))}
            {couriers.length > 0 && (
              <select value={courierFilter} onChange={e => setCourierFilter(e.target.value)} className="courier-filter">
                <option value="all">Todos los motoqueros</option>
                {couriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>

          <div className="ship-search">
            <input
              type="text"
              value={searchShip}
              onChange={e => setSearchShip(e.target.value)}
              placeholder="🔍 Buscar envío por número, destinatario, dirección o motoquero..."
            />
            {searchShip && (
              <button className="ship-search-clear" onClick={() => setSearchShip('')}>✕</button>
            )}
          </div>
          {searchShip && (
            <p className="ship-search-hint">
              {visible.length} resultado{visible.length !== 1 ? 's' : ''} — asigná el motoquero o cambiá el estado directo en la tarjeta.
            </p>
          )}

          <div className="map-legend">
            <strong>Mapa (solo activos del día):</strong>
            <span><i style={{ background: '#ef4444' }}></i> Pendiente de imprimir</span>
            <span><i style={{ background: '#f59e0b' }}></i> Armado</span>
            <span><i style={{ background: '#3b82f6' }}></i> En camino</span>
            <em>Al elegir un filtro de estado, el mapa muestra solo ese estado (incluye entregados/demorados).</em>
          </div>
          <div ref={mapRef} className="ship-map"></div>

          <div className="ship-list">
            {visible.length === 0 ? (
              <div className="empty-state"><p>🚚</p><p>No hay envíos. Escaneá un QR para empezar.</p></div>
            ) : visible.map(s => {
              const st = STATUS[s.status || 'pendiente'] || STATUS.pendiente
              return (
                <div key={s.id} className="ship-card" style={{ borderLeftColor: st.color }}>
                  <div className="ship-card-main">
                    <div className="ship-code">{s.code}</div>
                    {s.recipient && <div className="ship-recipient">{s.recipient}</div>}
                    <div className="ship-badges">
                      <span className="ship-status-badge" style={{ background: st.color }}>{st.emoji} {st.label}</span>
                      {s.courierName && <span className="ship-courier-tag">🏍️ {s.courierName}</span>}
                    </div>
                    <div className="ship-flow">
                      <button onClick={() => changeStatus(s, 'armado')} disabled={s.status === 'armado'}>📦 Armado</button>
                      <select value={s.courierId || ''} onChange={e => assignCourier(s, e.target.value)}>
                        <option value="">🏍️ Motoquero…</option>
                        {couriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <button className="ok" onClick={() => changeStatus(s, 'entregado')}>✅ Entregado</button>
                      <button className="warn" onClick={() => changeStatus(s, 'demorado')}>⏰ Demorado</button>
                      {s.status === 'entregado' && (
                        <button onClick={() => changeStatus(s, 'archivado')}>🗄️ Archivar</button>
                      )}
                    </div>
                  </div>
                  <div className="ship-card-side">
                    {s.lat == null
                      ? <button className="ship-locate" onClick={() => setLocatingId(s.id)}>📍 Ubicar</button>
                      : <button className="ship-locate ok" onClick={() => mapObj.current?.setView([s.lat, s.lng], 16)}>🗺️ Ver</button>}
                    <button className="ship-del" onClick={() => { if (window.confirm('¿Eliminar este envío?')) onDeleteShipment(s.id) }}>🗑️</button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <>
          <div className="rep-controls">
            <div className="rep-range">
              {['hoy', 'semana', 'mes'].map(r => (
                <button key={r} className={range === r ? 'active' : ''} onClick={() => setRange(r)}>
                  {r === 'hoy' ? 'Hoy' : r === 'semana' ? 'Últimos 7 días' : 'Últimos 30 días'}
                </button>
              ))}
            </div>
            <button className="rep-export" onClick={exportReport}>⬇️ Exportar Excel</button>
          </div>

          <div className="rep-totals">
            <div className="rep-total"><span>Envíos</span><strong>{reportTotals.total}</strong></div>
            <div className="rep-total"><span>Entregados</span><strong>{reportTotals.entregados}</strong></div>
            <div className="rep-total"><span>Cobro ML (zonas)</span><strong>{fmtMoney(reportTotals.cobroML)}</strong></div>
            <div className="rep-total"><span>Pago motoqueros</span><strong>{fmtMoney(reportTotals.pagoMoto)}</strong></div>
            <div className="rep-total"><span>Pagó comprador</span><strong>{fmtMoney(reportTotals.pagoComprador)}</strong></div>
            <div className="rep-total"><span>Demora promedio</span><strong>{fmtDur(reportTotals.demoraProm)}</strong></div>
          </div>

          <div className="rep-table-wrap">
            <table className="rep-table">
              <thead>
                <tr>
                  <th>Código</th><th>Destinatario</th><th>Motoquero</th><th>Estado</th>
                  <th>Salió</th><th>Entregó</th><th>Demora</th>
                  <th>Zona</th><th>Cobro ML</th><th>Pago moto</th><th>Pagó comprador</th>
                </tr>
              </thead>
              <tbody>
                {reportRows.length === 0 ? (
                  <tr><td colSpan="11" className="rep-empty">No hay envíos en este período.</td></tr>
                ) : reportRows.map(({ s, salio, entrego, demoraMs }) => {
                  const st = STATUS[s.status || 'pendiente']
                  return (
                    <tr key={s.id}>
                      <td className="rep-code">{s.code}</td>
                      <td>{s.recipient || '—'}</td>
                      <td>{s.courierName || '—'}</td>
                      <td><span className="rep-badge" style={{ background: st.color }}>{st.short}</span></td>
                      <td>{fmtDateTime(salio)}</td>
                      <td>{fmtDateTime(entrego)}</td>
                      <td>{fmtDur(demoraMs)}</td>
                      <td>
                        <select
                          className="rep-zone"
                          value={s.zone || ''}
                          onChange={e => onUpdateShipment(s.id, { zone: e.target.value })}
                        >
                          <option value="">— zona —</option>
                          {Object.entries(ZONES).map(([k, z]) => (
                            <option key={k} value={k}>{z.label} ({fmtMoney(z.pay)})</option>
                          ))}
                        </select>
                      </td>
                      <td className="rep-money">{fmtMoney(zonePay(s))}</td>
                      <td>
                        <input
                          type="number" min="0" className="rep-input"
                          defaultValue={s.courierPay || ''}
                          placeholder="$"
                          onBlur={e => onUpdateShipment(s.id, { courierPay: parseFloat(e.target.value) || 0 })}
                        />
                      </td>
                      <td>
                        <input
                          type="number" min="0" className="rep-input"
                          defaultValue={s.buyerPay || ''}
                          placeholder="$ o 0"
                          onBlur={e => onUpdateShipment(s.id, { buyerPay: parseFloat(e.target.value) || 0 })}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
