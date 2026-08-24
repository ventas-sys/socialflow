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
// pay = lo que bonifica ML por zona · motoPay = lo que le pagamos al motoquero
// (por ahora solo definido para cercana; las demás se cargan a mano)
const ZONES = {
  cercana:   { label: 'Cercana', pay: 4490, motoPay: 2750 },
  media:     { label: 'Media dist.', pay: 6490, motoPay: 4500 },
  lejana:    { label: 'Lejana', pay: 8690, motoPay: 6000 },
  muylejana: { label: 'Muy lejana', pay: 9990, motoPay: 8000 },
}
// Zona automática según las coordenadas que da ML. Todo Capital = cercana
// (polígono aproximado de CABA: Gral. Paz + Riachuelo + costa). Fuera de CABA,
// por anillos de distancia al Obelisco: 1er cordón ≈ media, 2do ≈ lejana,
// más allá ≈ muy lejana. Es sugerencia: elegir a mano en el reporte la pisa.
const CABA_POLY = [
  [-34.5265, -58.4680], [-34.5420, -58.4995], [-34.5960, -58.5310],
  [-34.6420, -58.5300], [-34.6870, -58.4710], [-34.7050, -58.4590],
  [-34.6590, -58.4100], [-34.6390, -58.3560], [-34.6380, -58.3310],
  [-34.6050, -58.3400], [-34.5760, -58.3560], [-34.5430, -58.4180],
]
const inCaba = (lat, lng) => {
  let inside = false
  for (let i = 0, j = CABA_POLY.length - 1; i < CABA_POLY.length; j = i++) {
    const [yi, xi] = CABA_POLY[i], [yj, xj] = CABA_POLY[j]
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
const kmFromObelisco = (lat, lng) => {
  const R = 6371, rad = Math.PI / 180
  const dLat = (lat - (-34.6037)) * rad, dLng = (lng - (-58.3816)) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * rad) * Math.cos(-34.6037 * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}
const zoneFromCoords = (lat, lng) => {
  if (!(Number(lat) && Number(lng))) return ''
  if (inCaba(lat, lng)) return 'cercana'
  const km = kmFromObelisco(lat, lng)
  if (km <= 20) return 'media'
  if (km <= 38) return 'lejana'
  return 'muylejana'
}
// La localidad que dice la etiqueta de ML manda: todo Capital = cercana.
// Si no alcanza, se estima por coordenadas.
const zoneOf = (s) => {
  const a = String(s.address || '').toLowerCase()
  if (a.includes('capital federal') || /\bcaba\b/.test(a)) return 'cercana'
  return zoneFromCoords(s.lat, s.lng)
}
// Localidad/barrio de la dirección de ML (lo que sigue a la calle)
const locOf = (s) => String(s.address || '').split(',').slice(1).join(',').trim()
const effZone = (s) => s.zone || zoneOf(s)

// ---- Ruta óptima por motoquero ----
// Punto de partida del reparto: el depósito — Bacacay 4726, Floresta, CABA.
// El ORDEN de las paradas se calcula desde acá; el link de Google Maps arranca
// desde la ubicación actual del motoquero (origen variable).
const DEPOT = { lat: -34.6309, lng: -58.5004 }
const distKm = (a, b) => {
  const R = 6371, rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
// Detecta restricciones horarias en la referencia de la etiqueta o la dirección
// ("horario comercial", "de 9 a 18", "hasta las 17", etc.)
const timeWindowOf = (s) => {
  const txt = `${s.notes || ''} ${s.address || ''}`.toLowerCase()
  if (/horario comercial|hs comercial|horario de oficina/.test(txt)) return { note: 'horario comercial', deadline: 18 }
  const m = txt.match(/(?:de |entre |desde )?(\d{1,2})(?::\d{2})?\s*(?:a|hasta|y|-)\s*(?:las )?(\d{1,2})(?::\d{2})?\s*(?:hs|hrs|h\b)?/)
  if (m) {
    const end = parseInt(m[2], 10)
    if (end >= 8 && end <= 22) return { note: m[0].trim(), deadline: end }
  }
  const h = txt.match(/hasta las? (\d{1,2})/)
  if (h) { const end = parseInt(h[1], 10); if (end >= 8 && end <= 22) return { note: h[0], deadline: end } }
  return null
}
const zonePay = (s) => { const z = effZone(s); return z && ZONES[z] ? ZONES[z].pay : 0 }
// Pago al motoquero: lo cargado a mano pisa el valor automático de la zona
const motoPay = (s) => {
  if (s.courierPay != null && s.courierPay !== '') return Number(s.courierPay) || 0
  const z = effZone(s)
  return (z && ZONES[z]?.motoPay) || 0
}
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
  isAdmin = false, // solo el master conecta ML, trae ventas y vacía el tablero
  allShipments, // incluye los de CORREO (solo para dedup del sync; el tablero recibe solo FLEX)
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
  const allShipmentsRef = useRef(allShipments); allShipmentsRef.current = allShipments || shipments
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
    if (!keys.length) {
      // Los ayudantes no tienen acceso a las credenciales de ML (a propósito):
      // las ventas las trae la sesión del master y el tablero se comparte.
      if (!silent) setSyncMsg(isAdmin
        ? '⚠️ Conectá MercadoLibre primero (solapa ML).'
        : 'ℹ️ Las ventas de ML las trae el usuario master; el tablero se actualiza solo.')
      return
    }
    syncingRef.current = true
    setSyncing(true) // avisar SIEMPRE, también en la actualización automática
    // Un envío por COMPRA (pack) o por envío físico; evita duplicar por producto.
    // Solo AGREGA ventas nuevas: nunca toca el estado de las ya gestionadas.
    const seen = new Set((allShipmentsRef.current || []).map(s => String(s.packId || s.code)))
    let created = 0
    const diag = { total: 0, flex: 0, correo: 0, cerrados: 0 }
    let nPend = 0, nCamino = 0, nDemorado = 0, nEntregado = 0, nCorreo = 0
    const H48 = 48 * 3600 * 1000
    // Estado actual en ML de cada envío (por shipmentId y packId), para
    // refrescar también los que ya están cargados en el tablero
    const mlStatus = new Map()
    const tokenByKey = {}
    try {
      for (const key of keys) {
        const token = await ensureToken(key)
        if (!token) continue
        tokenByKey[key] = token
        // Ventana de 7 días: 48hs para pendientes/en camino, 1 semana para demorados
        const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - 7)
        const r = await fetch(`${API}?action=orders`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, from: from.toISOString() }),
        }).then(x => x.json())
        if (!r.ok) continue
        diag.total += r.orders.length
        // Agrupar por compra (pack) juntando los artículos de todas sus órdenes
        const groups = new Map()
        for (const o of r.orders) {
          // SOLO FLEX / Turbo (self_service): lo que repartimos con moto
          // CORREO se trae SOLO para Empaquetado (entra archivado, con canal
          // 'correo': nunca aparece en tablero, mapa ni reporte)
          const isCorreo = ['cross_docking', 'drop_off', 'xd_drop_off'].includes(o.logisticType)
          if (o.logisticType !== 'self_service' && !isCorreo) continue
          if (isCorreo) {
            diag.correo++
          } else {
            diag.flex++
            // Si la ORDEN está cancelada (comprador canceló) cuenta como cancelado
            // aunque el envío haya quedado en otro estado
            const info = {
              st: o.status === 'cancelled' ? 'cancelled' : o.shipmentStatus,
              sub: o.shipmentSubstatus, tn: o.trackingNumber || null,
            }
            if (o.shipmentId) mlStatus.set(String(o.shipmentId), info)
            if (o.packId) mlStatus.set(String(o.packId), info)
          }
          // Cancelados no se traen; el resto de los últimos 7 días SÍ
          if (o.status === 'cancelled' || ['cancelled', 'to_be_agreed'].includes(o.shipmentStatus)) { diag.cerrados++; continue }
          const gkey = String(o.packId || o.shipmentId || '')
          if (!gkey || seen.has(gkey)) continue
          const g = groups.get(gkey)
          if (g) g.items = [...(g.items || []), ...(o.items || [])]
          else groups.set(gkey, { ...o, correo: isCorreo, items: [...(o.items || [])] })
        }
        for (const o of groups.values()) {
          if (o.correo) {
            seen.add(String(o.packId || o.shipmentId))
            const id = await onAddShipment({
              code: String(o.shipmentId || o.packId), packId: o.packId || null,
              recipient: o.recipient || '', address: o.address || '',
              lat: o.lat ?? null, lng: o.lng ?? null,
              status: 'archivado', archivedAt: new Date(), channel: 'correo',
              cost: 0, account: key, items: o.items || [], dims: o.dimensions || null,
              trackingNumber: o.trackingNumber || null, notes: o.notes || null,
            })
            if (id) nCorreo++
            continue
          }
          const ageMs = Date.now() - new Date(o.date).getTime()
          // Estado inicial según ML y antigüedad
          let status
          if (o.shipmentStatus === 'delivered') status = 'entregado'
          else if (o.shipmentStatus === 'shipped') status = ageMs <= H48 ? 'camino' : 'demorado'
          else if (o.shipmentStatus === 'not_delivered') status = 'demorado'
          else status = ageMs <= H48 ? 'pendiente' : 'demorado'
          seen.add(String(o.packId || o.shipmentId))
          const id = await onAddShipment({
            code: String(o.shipmentId || o.packId), packId: o.packId || null,
            recipient: o.recipient || '', address: o.address || '',
            lat: o.lat ?? null, lng: o.lng ?? null, status, cost: 0, account: key,
            items: o.items || [], dims: o.dimensions || null,
            trackingNumber: o.trackingNumber || null, // el código de barras de la etiqueta trae este número
            notes: o.notes || null, // referencia de la etiqueta (horarios, aclaraciones)
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
      // Refrescar los YA cargados según lo que dice ML: si ML los marca
      // entregados pasan a Entregado, si no se entregaron a Demorado, y un
      // "en camino" con más de 48hs también queda Demorado. Lo gestionado a
      // mano (armado, motoquero) no se toca.
      let updEnt = 0, updDem = 0, updArc = 0
      const updates = []
      for (const s of (shipmentsRef.current || [])) {
        const st = s.status || 'pendiente'
        if (['entregado', 'archivado'].includes(st)) continue
        const info = mlStatus.get(String(s.code)) || (s.packId && mlStatus.get(String(s.packId)))
        if (!info) continue
        const patch = {}
        // Completar el tracking a los envíos viejos que no lo tienen (lo
        // necesita la pistola: el código de barras de la etiqueta trae ese número)
        if (!s.trackingNumber && info.tn) patch.trackingNumber = info.tn
        if (info.st === 'delivered') {
          patch.status = 'entregado'; patch.deliveredAt = new Date(); updEnt++
        } else if (info.st === 'cancelled') {
          // Venta cancelada por el comprador → sale del panel (Archivado)
          patch.status = 'archivado'; patch.archivedAt = new Date(); updArc++
        } else if (info.st === 'not_delivered' && st !== 'demorado') {
          patch.status = 'demorado'; patch.demoradoAt = new Date(); updDem++
        } else if (info.st === 'shipped' && st === 'camino' &&
                   toMillis(s.assignedAt) && Date.now() - toMillis(s.assignedAt) > H48) {
          patch.status = 'demorado'; patch.demoradoAt = new Date(); updDem++
        }
        if (Object.keys(patch).length) updates.push([s.id, patch])
      }
      for (let i = 0; i < updates.length; i += 20) {
        await Promise.all(updates.slice(i, i + 20).map(([id, patch]) =>
          onUpdateShipment(id, patch).catch(() => {})))
      }

      // Los activos VIEJOS (fuera de la ventana de 7 días) no aparecen en las
      // órdenes y quedaban colgados en Pendiente: se consultan uno por uno
      // contra ML y se actualizan igual (entregado / demorado / cancelado)
      let oldEnt = 0, oldDem = 0, oldArc = 0
      const stale = shipmentsRef.current.filter(s => {
        const st = s.status || 'pendiente'
        if (['entregado', 'archivado'].includes(st)) return false
        return !mlStatus.has(String(s.code)) && !(s.packId && mlStatus.has(String(s.packId)))
      }).slice(0, 400)
      if (stale.length) {
        const pending = new Map(stale.map(s => [String(s.code), s]))
        for (const key of keys) {
          if (!pending.size || !tokenByKey[key]) continue
          // primero los de esta cuenta; los de cuenta desconocida se prueban en ambas
          const ids = [...pending.values()].filter(s => !s.account || s.account === key).map(s => String(s.code))
          if (!ids.length) continue
          const r = await fetch(`${API}?action=shipstatus`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: tokenByKey[key], ids }),
          }).then(x => x.json()).catch(() => null)
          if (!r?.ok) continue
          const ups = []
          Object.entries(r.statuses || {}).forEach(([id, info]) => {
            const s = pending.get(id)
            if (!s) return
            pending.delete(id)
            const st = s.status || 'pendiente'
            const patch = {}
            if (!s.trackingNumber && info.tracking) patch.trackingNumber = info.tracking
            if (info.status === 'delivered') { patch.status = 'entregado'; patch.deliveredAt = new Date(); oldEnt++ }
            else if (info.status === 'cancelled') { patch.status = 'archivado'; patch.archivedAt = new Date(); oldArc++ }
            else if (['not_delivered', 'shipped'].includes(info.status) && st !== 'demorado' && st !== 'camino') {
              patch.status = 'demorado'; patch.demoradoAt = new Date(); oldDem++
            }
            if (Object.keys(patch).length) ups.push([s.id, patch])
          })
          for (let i = 0; i < ups.length; i += 20) {
            await Promise.all(ups.slice(i, i + 20).map(([id, patch]) => onUpdateShipment(id, patch).catch(() => {})))
          }
        }
      }

      if (created || nCorreo || updEnt || updDem || updArc || oldEnt || oldDem || oldArc || !silent) setSyncMsg(
        `✅ ${created} envíos nuevos: ${nPend} pendientes, ${nCamino} en camino, ` +
        `${nEntregado} entregados, ${nDemorado} demorados. (${diag.flex} FLEX de ${diag.total} ventas)` +
        (nCorreo ? ` · 📮 ${nCorreo} de correo cargados solo para Empaque` : '') +
        (updEnt || updDem || updArc ? ` · 🔄 Según ML: ${updEnt} entregados, ${updDem} demorados, ${updArc} cancelados→archivados` : '') +
        (oldEnt || oldDem || oldArc ? ` · 🧹 Viejos revisados en ML: ${oldEnt} entregados, ${oldDem} demorados, ${oldArc} cancelados→archivados` : '')
      )
    } catch (e) {
      if (!silent) setSyncMsg('❌ ' + e.message)
    } finally {
      syncingRef.current = false
      setSyncing(false)
    }
  }

  // Frecuencia de actualización según la hora del día (hora argentina):
  // 0-8hs cada 4hs · 8-10 cada 1h · 10-12 cada 15min · 12-18 cada 30min · 18-24 cada 3hs
  const syncDelayMs = () => {
    const h = Number(new Intl.DateTimeFormat('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires', hour: 'numeric', hour12: false,
    }).format(new Date()))
    if (h < 8) return 4 * 3600 * 1000
    if (h < 10) return 3600 * 1000
    if (h < 12) return 15 * 60 * 1000
    if (h < 18) return 30 * 60 * 1000
    return 3 * 3600 * 1000
  }

  // Al abrir la sección y después según el horario, traer las ventas de ML
  useEffect(() => {
    syncFromML(true)
    let t
    const loop = () => {
      t = setTimeout(() => { syncFromML(true); loop() }, syncDelayMs())
    }
    loop()
    return () => clearTimeout(t)
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

  // Cantidades del día por motoquero (para el filtro): asignados hoy,
  // cuántos ya entregó y cuántos le quedan pendientes
  const courierDayStats = useMemo(() => {
    const m = new Map()
    shipments.forEach(s => {
      if (!s.courierId) return
      const asignadoHoy = toMillis(s.assignedAt) >= startOfToday
      const entregadoHoy = toMillis(s.deliveredAt) >= startOfToday
      if (!asignadoHoy && !entregadoHoy) return
      const st = m.get(s.courierId) || { asig: 0, entreg: 0, pend: 0 }
      st.asig++
      if (['entregado', 'archivado'].includes(s.status) || entregadoHoy) st.entreg++
      else st.pend++
      m.set(s.courierId, st)
    })
    return m
  }, [shipments, startOfToday])
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
    // Asignar motoquero pasa el envío a "En camino" — pero un DEMORADO sigue
    // demorado (solo se registra quién lo tiene), si no desaparece del filtro
    if (courierId && ['pendiente', 'armado'].includes(s.status || 'pendiente')) {
      patch.status = 'camino'
    }
    if (courierId && !s.assignedAt) patch.assignedAt = new Date()
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
      const t = String(s.trackingNumber || '') // el código de barras de la etiqueta trae el tracking
      return c === code || p === code || (t && t === code) ||
        (code && (c.includes(code) || code.includes(c))) ||
        (digits && (c === digits || p === digits || (t && t === digits) ||
          c.includes(digits) || digits.includes(c) || (t && (t.includes(digits) || digits.includes(t)))))
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

  // Pistola/lector QR conectado (USB/Bluetooth): teclea el código muy rápido
  // y termina con Enter → busca el envío igual que el escáner de cámara.
  useEffect(() => {
    let buf = ''
    let start = 0
    let last = 0
    const onKey = (e) => {
      // No interceptar cuando se está escribiendo en un campo (búsqueda, pagos)
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const now = Date.now()
      if (e.key === 'Enter') {
        if (buf.length >= 8 && (now - start) / buf.length < 50) {
          e.preventDefault()
          handleScan(buf)
        }
        buf = ''
        return
      }
      if (e.key.length !== 1) return
      if (!buf || now - last > 100) { buf = ''; start = now }
      buf += e.key
      last = now
      if (buf.length > 300) buf = ''
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipments])

  const counts = useMemo(() => {
    const c = {}; ORDER.forEach(k => c[k] = 0)
    shipments.forEach(s => { c[s.status || 'pendiente'] = (c[s.status || 'pendiente'] || 0) + 1 })
    return c
  }, [shipments])

  const actionShipment = shipments.find(s => s.id === actionId)

  // ---- Ruta por motoquero (link de Google Maps para pasar por WhatsApp) ----
  const [routeCourierId, setRouteCourierId] = useState('')
  const [routeInfo, setRouteInfo] = useState(null)

  const buildRoute = () => {
    const c = couriers.find(x => x.id === routeCourierId)
    if (!c) { setRouteInfo({ error: 'Elegí un motoquero primero.' }); return }
    const mine = shipments.filter(s => s.courierId === c.id && (s.status || '') === 'camino')
    const located = mine.filter(s => Number(s.lat) && Number(s.lng))
    const unlocated = mine.filter(s => !(Number(s.lat) && Number(s.lng)))
    if (!located.length) {
      setRouteInfo({ error: `${c.name} no tiene envíos EN CAMINO con ubicación en el mapa.`, unlocated })
      return
    }
    // Primero los que tienen horario (ordenados por vencimiento, por cercanía
    // dentro del mismo horario) y después el resto por vecino más próximo
    const stops = located.map(s => ({ s, tw: timeWindowOf(s) }))
    const order = []
    let cur = DEPOT
    const nn = (pool) => {
      const p = [...pool]
      while (p.length) {
        let bi = 0, bd = Infinity
        p.forEach((x, i) => {
          const d = distKm(cur, { lat: Number(x.s.lat), lng: Number(x.s.lng) })
          if (d < bd) { bd = d; bi = i }
        })
        const [x] = p.splice(bi, 1)
        order.push(x)
        cur = { lat: Number(x.s.lat), lng: Number(x.s.lng) }
      }
    }
    const deadlines = [...new Set(stops.filter(x => x.tw).map(x => x.tw.deadline))].sort((a, b) => a - b)
    deadlines.forEach(dl => nn(stops.filter(x => x.tw && x.tw.deadline === dl)))
    nn(stops.filter(x => !x.tw))
    // Google Maps acepta ~10 paradas por link: se parte en tramos encadenados
    const legs = []
    for (let i = 0; i < order.length; i += 10) legs.push(order.slice(i, i + 10))
    const links = legs.map((leg, i) => {
      // Tramo 1 SIN origen: Google Maps arranca desde donde esté el motoquero.
      // Los tramos siguientes arrancan donde terminó el anterior.
      const origin = i === 0 ? '' : `&origin=${legs[i - 1][legs[i - 1].length - 1].s.lat},${legs[i - 1][legs[i - 1].length - 1].s.lng}`
      const dest = leg[leg.length - 1].s
      const wps = leg.slice(0, -1).map(x => `${x.s.lat},${x.s.lng}`).join('|')
      return `https://www.google.com/maps/dir/?api=1${origin}&destination=${dest.lat},${dest.lng}` +
        (wps ? `&waypoints=${encodeURIComponent(wps)}` : '') + '&travelmode=driving'
    })
    const waText =
      `🏍️ Ruta de ${c.name} — ${order.length} entregas\n` +
      order.map((x, i) => `${i + 1}. ${x.s.address || x.s.recipient || x.s.code}${x.tw ? ` ⏰ ${x.tw.note}` : ''}`).join('\n') +
      '\n\n🗺️ Abrí la ruta en Google Maps:\n' +
      links.map((l, i) => (links.length > 1 ? `Tramo ${i + 1}: ` : '') + l).join('\n')
    setRouteInfo({ courier: c, order, links, unlocated, waText })
  }

  // ---- Reporte ----
  const [repCourier, setRepCourier] = useState('all')
  // Filas del período (sin filtro de motoquero, para el resumen por motoquero)
  const rangeRows = useMemo(() => {
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

  const reportRows = useMemo(() => (
    repCourier === 'all' ? rangeRows : rangeRows.filter(r => r.s.courierId === repCourier)
  ), [rangeRows, repCourier])

  // Resumen por motoquero del período: entregados, demorados, demora promedio,
  // cobro de ML y pago al motoquero
  const courierReport = useMemo(() => {
    const m = new Map()
    rangeRows.forEach(r => {
      const name = r.s.courierName || '— Sin motoquero —'
      const st = m.get(name) || { name, envios: 0, entregados: 0, demorados: 0, demoras: [], cobroML: 0, pagoMoto: 0 }
      st.envios++
      if (r.s.status === 'entregado' || (r.s.status === 'archivado' && r.s.deliveredAt)) {
        st.entregados++
        if (r.demoraMs > 0) st.demoras.push(r.demoraMs)
      }
      if (r.s.status === 'demorado') st.demorados++
      st.cobroML += zonePay(r.s)
      st.pagoMoto += motoPay(r.s)
      m.set(name, st)
    })
    return [...m.values()]
      .map(st => ({ ...st, demoraProm: st.demoras.length ? st.demoras.reduce((a, b) => a + b, 0) / st.demoras.length : 0 }))
      .sort((a, b) => b.envios - a.envios)
  }, [rangeRows])

  const reportTotals = useMemo(() => {
    const entregados = reportRows.filter(r =>
      r.s.status === 'entregado' || (r.s.status === 'archivado' && r.s.deliveredAt)
    )
    const cobroML = reportRows.reduce((sum, r) => sum + zonePay(r.s), 0)
    const pagoMoto = reportRows.reduce((sum, r) => sum + motoPay(r.s), 0)
    const pagoComprador = reportRows.reduce((sum, r) => sum + (Number(r.s.buyerPay) || 0), 0)
    const demoras = entregados.filter(r => r.demoraMs > 0).map(r => r.demoraMs)
    const demoraProm = demoras.length ? demoras.reduce((a, b) => a + b, 0) / demoras.length : 0
    return { total: reportRows.length, entregados: entregados.length, cobroML, pagoMoto, pagoComprador, demoraProm }
  }, [reportRows])

  const exportReport = () => {
    const rows = [['Código', 'Destinatario', 'Motoquero', 'Estado', 'Salió', 'Entregó', 'Demora (min)', 'Localidad', 'Zona', 'Cobro ML', 'Pago motoquero', 'Pagó comprador']]
    reportRows.forEach(({ s, salio, entrego, demoraMs }) => {
      rows.push([
        s.code || '', s.recipient || '', s.courierName || '', STATUS[s.status || 'pendiente']?.label || '',
        salio ? new Date(salio).toLocaleString('es-AR') : '',
        entrego ? new Date(entrego).toLocaleString('es-AR') : '',
        demoraMs ? Math.round(demoraMs / 60000) : '',
        locOf(s),
        effZone(s) && ZONES[effZone(s)] ? ZONES[effZone(s)].label : '',
        zonePay(s),
        motoPay(s),
        Number(s.buyerPay) || 0,
      ])
    })
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{ wch: 16 }, { wch: 26 }, { wch: 18 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 24 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 14 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Envíos')
    // Hoja 2: resumen por motoquero del período
    const cRows = [['Motoquero', 'Envíos', 'Entregados', 'Demorados', 'Demora promedio (min)', 'Cobro ML', 'Pago motoquero']]
    courierReport.forEach(c => cRows.push([
      c.name, c.envios, c.entregados, c.demorados,
      c.demoraProm ? Math.round(c.demoraProm / 60000) : '',
      c.cobroML, c.pagoMoto,
    ]))
    const ws2 = XLSX.utils.aoa_to_sheet(cRows)
    ws2['!cols'] = [{ wch: 22 }, { wch: 8 }, { wch: 11 }, { wch: 11 }, { wch: 20 }, { wch: 12 }, { wch: 14 }]
    XLSX.utils.book_append_sheet(wb, ws2, 'Por motoquero')
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
          {isAdmin && (
            <button className="btn-sync-ship" onClick={() => syncFromML(false)} disabled={syncing}>
              {syncing ? '⏳ Trayendo...' : '🔄 Traer ventas de ML'}
            </button>
          )}
          <button className="btn-scan-ship" onClick={() => setShowScanner(true)}>📷 Escanear QR</button>
          <button className="btn-couriers" onClick={() => setShowCouriers(v => !v)}>🏍️ Motoqueros ({couriers.length})</button>
          {isAdmin && onClearShipments && shipments.length > 0 && (
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
                {couriers.map(c => {
                  const st = courierDayStats.get(c.id)
                  return (
                    <option key={c.id} value={c.id}>
                      {c.name}{st ? ` — hoy ${st.asig} (✅ ${st.entreg} · 🛵 ${st.pend})` : ' — hoy 0'}
                    </option>
                  )
                })}
              </select>
            )}
          </div>

          {couriers.length > 0 && (
            <div className="route-panel pc-only">
              <div className="route-head">
                <strong>🗺️ Ruta del motoquero</strong>
                <select value={routeCourierId} onChange={e => { setRouteCourierId(e.target.value); setRouteInfo(null) }}>
                  <option value="">— elegir motoquero —</option>
                  {couriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button className="route-build" onClick={buildRoute}>Armar mejor ruta</button>
                <span className="route-hint">Ordena sus envíos EN CAMINO por cercanía desde el depósito (Bacacay 4726), priorizando los que tienen horario. El mapa arranca desde donde esté el motoquero.</span>
              </div>
              {routeInfo?.error && <div className="route-warn">⚠️ {routeInfo.error}</div>}
              {routeInfo?.order && (
                <div className="route-result">
                  <ol className="route-stops">
                    {routeInfo.order.map((x, i) => (
                      <li key={x.s.id}>
                        <span className="route-addr">{x.s.address || x.s.recipient || x.s.code}</span>
                        {x.tw && <span className="route-tw">⏰ {x.tw.note}</span>}
                      </li>
                    ))}
                  </ol>
                  {routeInfo.unlocated.length > 0 && (
                    <div className="route-warn">
                      ⚠️ {routeInfo.unlocated.length} envío(s) sin ubicación quedan fuera de la ruta:{' '}
                      {routeInfo.unlocated.map(s => s.recipient || s.code).slice(0, 5).join(', ')}
                    </div>
                  )}
                  <div className="route-actions">
                    {routeInfo.links.map((l, i) => (
                      <a key={i} href={l} target="_blank" rel="noreferrer" className="route-link">
                        🗺️ {routeInfo.links.length > 1 ? `Tramo ${i + 1}` : 'Abrir en Google Maps'}
                      </a>
                    ))}
                    <a
                      className="route-wa"
                      href={`https://wa.me/?text=${encodeURIComponent(routeInfo.waText)}`}
                      target="_blank" rel="noreferrer"
                    >
                      📲 Enviar por WhatsApp a {routeInfo.courier.name}
                    </a>
                    <button
                      className="route-copy"
                      onClick={() => navigator.clipboard?.writeText(routeInfo.waText).then(() => setSyncMsg('✅ Ruta copiada — pegala en el chat del motoquero.'))}
                    >
                      📋 Copiar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

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
              {couriers.length > 0 && (
                <select value={repCourier} onChange={e => setRepCourier(e.target.value)} className="courier-filter">
                  <option value="all">🏍️ Todos los motoqueros</option>
                  {couriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
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

          {repCourier === 'all' && courierReport.length > 0 && (
            <div className="rep-table-wrap">
              <table className="rep-table">
                <thead>
                  <tr>
                    <th>🏍️ Motoquero</th><th>Envíos</th><th>Entregados</th><th>Demorados</th>
                    <th>Demora prom.</th><th>Cobro ML</th><th>Pago motoquero</th>
                  </tr>
                </thead>
                <tbody>
                  {courierReport.map(c => (
                    <tr key={c.name}>
                      <td><strong>{c.name}</strong></td>
                      <td>{c.envios}</td>
                      <td>{c.entregados}</td>
                      <td>{c.demorados}</td>
                      <td>{fmtDur(c.demoraProm)}</td>
                      <td className="rep-money">{fmtMoney(c.cobroML)}</td>
                      <td className="rep-money">{fmtMoney(c.pagoMoto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

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
                          value={effZone(s) || ''}
                          onChange={e => onUpdateShipment(s.id, { zone: e.target.value })}
                        >
                          <option value="">— zona —</option>
                          {Object.entries(ZONES).map(([k, z]) => (
                            <option key={k} value={k}>{z.label} ({fmtMoney(z.pay)})</option>
                          ))}
                        </select>
                        {locOf(s) && <div className="rep-loc">📍 {locOf(s)}</div>}
                      </td>
                      <td className="rep-money">{fmtMoney(zonePay(s))}</td>
                      <td>
                        <input
                          type="number" min="0" className="rep-input"
                          defaultValue={s.courierPay != null && s.courierPay !== '' ? s.courierPay : (motoPay(s) || '')}
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
