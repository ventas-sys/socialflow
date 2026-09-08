import React, { useState, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { cordonDe } from '../utils/cordon'
import { findProductOrCombo } from '../utils/refMatch'
import { db } from '../firebase'
import { doc, getDoc, writeBatch, Timestamp } from 'firebase/firestore'
import { ORG_ID } from '../config'
import './MercadoLibre.css'

// Cuentas configurables. Misma regla para las dos: descuentan todo lo que se
// despacha desde el depósito propio y NUNCA lo que sale de la bodega de ML (Full).
const ACCOUNTS = [
  { key: 'full', label: 'FULL' },
  { key: 'ferre', label: 'FERRE' },
]

// Tipos de envío de ML que SÍ descuentan (todo menos fulfillment = Full)
const isDescontable = (logisticType) => logisticType !== 'fulfillment'

const logisticLabel = (t) => ({
  self_service: 'FLEX (moto)',
  cross_docking: 'Correo',
  drop_off: 'Correo',
  xd_drop_off: 'Correo',
  fulfillment: 'Bodega ML (Full)',
  pickup: 'Retiro',
}[t] || (t || 'Sin envío'))

const AUTH_BASE = 'https://auth.mercadolibre.com.ar/authorization'
const API = '/api/ml/exchange'

export default function MercadoLibre({ products, combos, mlAccounts, onSaveAccount, onPurchase }) {
  const [forms, setForms] = useState({}) // edición de clientId/secret por cuenta
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState({})
  const [preview, setPreview] = useState(null) // { account, lines, orders, skipped }

  const redirectUri = `${window.location.origin}/`

  // Mapear un item de ML (por SKU o MLA) a producto/combo → lista de deltas de stock
  const findByRef = (ref) => findProductOrCombo(products, combos, ref)

  const setForm = (key, field, value) =>
    setForms(f => ({ ...f, [key]: { ...f[key], [field]: value } }))

  const saveConfig = async (key) => {
    const f = forms[key] || {}
    const clientId = (f.clientId ?? mlAccounts?.[key]?.clientId ?? '').trim()
    const clientSecret = (f.clientSecret ?? mlAccounts?.[key]?.clientSecret ?? '').trim()
    if (!clientId || !clientSecret) {
      setMsg(m => ({ ...m, [key]: '⚠️ Completá App ID y Secret.' }))
      return
    }
    await onSaveAccount(key, { clientId, clientSecret })
    setMsg(m => ({ ...m, [key]: '✅ Datos guardados. Ya podés conectar.' }))
  }

  const connect = (key) => {
    const acc = mlAccounts?.[key]
    if (!acc?.clientId) {
      setMsg(m => ({ ...m, [key]: '⚠️ Primero guardá el App ID y Secret.' }))
      return
    }
    // Guardar qué cuenta estamos conectando para el retorno del OAuth
    sessionStorage.setItem('ml_connecting', key)
    const url = `${AUTH_BASE}?response_type=code&client_id=${encodeURIComponent(acc.clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}&state=${key}`
    window.location.href = url
  }

  // Asegura un access token válido (refresca si está por vencer)
  const ensureToken = async (key) => {
    const acc = mlAccounts?.[key]
    if (!acc?.accessToken) throw new Error('La cuenta no está conectada.')
    const expMs = acc.expiresAt?.toMillis ? acc.expiresAt.toMillis() : new Date(acc.expiresAt || 0).getTime()
    if (expMs && expMs - Date.now() > 5 * 60 * 1000) return acc.accessToken
    // refrescar
    const r = await fetch(`${API}?action=refresh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: acc.clientId, clientSecret: acc.clientSecret, refreshToken: acc.refreshToken }),
    }).then(x => x.json())
    if (!r.ok) throw new Error('No se pudo renovar el token: ' + (r.error || ''))
    const expiresAt = Timestamp.fromMillis(Date.now() + (r.expiresIn || 21600) * 1000)
    await onSaveAccount(key, { accessToken: r.accessToken, refreshToken: r.refreshToken, expiresAt })
    return r.accessToken
  }

  // Trae ventas del día y arma la vista previa de lo que descontaría
  const sync = async (key) => {
    setBusy(key); setMsg(m => ({ ...m, [key]: '' })); setPreview(null)
    try {
      const token = await ensureToken(key)
      // Desde hoy 00:00 hora local
      const start = new Date(); start.setHours(0, 0, 0, 0)
      const r = await fetch(`${API}?action=orders`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, from: start.toISOString() }),
      }).then(x => x.json())
      if (!r.ok) throw new Error(r.error || 'Error al leer las ventas')

      // Filtrar: solo lo despachado desde el depósito (excluir Full) y no procesado antes
      const byProduct = new Map()
      const notFound = new Set()
      const usable = []
      const skippedFull = []
      for (const o of r.orders) {
        if (!isDescontable(o.logisticType)) { skippedFull.push(o); continue }
        // ¿ya procesada?
        const seen = await getDoc(doc(db, 'ml_orders', `${key}_${o.id}`))
        if (seen.exists()) continue
        usable.push(o)
        for (const it of o.items) {
          const match = findByRef(it.sku) || findByRef(it.mla)
          if (!match) { notFound.add(it.sku || it.mla || it.title); continue }
          const addDelta = (p, delta, origin) => {
            if (!byProduct.has(p.id)) byProduct.set(p.id, { productName: p.name, current: p.quantity || 0, delta: 0, origins: new Set() })
            const e = byProduct.get(p.id); e.delta += delta; e.origins.add(origin)
          }
          if (match.type === 'product') {
            addDelta(match.p, -it.quantity, it.sku || it.mla)
          } else {
            match.c.items?.forEach(ci => {
              const bp = products.find(pp => pp.id === ci.productId)
              if (bp) addDelta(bp, -(ci.quantity * it.quantity), `${match.c.code || it.mla} (combo)`)
            })
          }
        }
      }
      const lines = [...byProduct.values()].map(l => ({ ...l, origins: [...l.origins] }))
      if (!usable.length) {
        setMsg(m => ({ ...m, [key]: `✅ No hay ventas nuevas para descontar hoy (se saltearon ${skippedFull.length} de bodega Full).` }))
        return
      }
      setPreview({ account: key, lines, orders: usable, skippedFull: skippedFull.length, notFound: [...notFound] })
    } catch (err) {
      setMsg(m => ({ ...m, [key]: '❌ ' + err.message }))
    } finally {
      setBusy('')
    }
  }

  // Busca las publicaciones de ML que NO están cargadas como combo/producto
  // y exporta un Excel con esos MLA para completar el armado y reimportar.
  const findMissing = async (key) => {
    setBusy(key); setMsg(m => ({ ...m, [key]: '' }))
    try {
      const token = await ensureToken(key)
      const r = await fetch(`${API}?action=items`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }).then(x => x.json())
      if (!r.ok) throw new Error(r.error || 'Error al leer las publicaciones')

      // Conjunto de códigos ya cargados (SKU y códigos de barras de combos y productos)
      const known = new Set()
      const addKnown = (x) => {
        if (x.code) known.add(String(x.code).toLowerCase())
        ;(x.barcodes?.length ? x.barcodes : (x.barcode ? [x.barcode] : [])).forEach(b => known.add(String(b).toLowerCase()))
      }
      combos.forEach(addKnown); products.forEach(addKnown)

      const missing = r.items.filter(it =>
        (it.status ? it.status === 'active' : true) &&
        !known.has(String(it.mla).toLowerCase()) &&
        !(it.sku && known.has(String(it.sku).toLowerCase()))
      )
      if (!missing.length) {
        setMsg(m => ({ ...m, [key]: `✅ Todas las publicaciones (${r.count}) ya están cargadas.` }))
        return
      }
      // Excel para completar: SKU (MLA) + Nombre + columnas de armado vacías
      const rows = [['SKU', 'Nombre', 'Codigo (ARMADO P)', 'ARMADO S', 'Codigo de Barras', 'TIPO']]
      missing.forEach(it => rows.push([it.mla, it.title, '', '', '', key.toUpperCase()]))
      const ws = XLSX.utils.aoa_to_sheet(rows)
      ws['!cols'] = [{ wch: 18 }, { wch: 45 }, { wch: 16 }, { wch: 10 }, { wch: 16 }, { wch: 8 }]
      const info = XLSX.utils.aoa_to_sheet([
        ['PUBLICACIONES DE ML QUE FALTAN CARGAR COMO COMBO'],
        [''],
        ['Cada fila es una publicación de tu cuenta que todavía no está en el sistema.'],
        ['Completá por cada una:'],
        ['  • Codigo (ARMADO P): el SKU del producto base que arma ese combo'],
        ['  • ARMADO S: cuántas unidades de ese producto lleva'],
        ['Si un combo lleva 2 productos, agregá otra fila con el MISMO SKU y el otro producto.'],
        [''],
        ['Después importá este archivo desde la pestaña Combos → Importar Excel.'],
      ])
      info['!cols'] = [{ wch: 70 }]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, info, 'Instrucciones')
      XLSX.utils.book_append_sheet(wb, ws, 'Combos')
      XLSX.writeFile(wb, `faltantes-${key}.xlsx`)
      setMsg(m => ({ ...m, [key]: `✅ ${missing.length} publicaciones faltantes de ${r.count}. Descargué el Excel "faltantes-${key}.xlsx" para completar el armado.` }))
    } catch (err) {
      setMsg(m => ({ ...m, [key]: '❌ ' + err.message }))
    } finally {
      setBusy('')
    }
  }

  // Ranking de lo más vendido (las 2 cuentas, todos los tipos de envío) para
  // priorizar qué cargar primero: medidas, foto y ubicación
  const [topMsg, setTopMsg] = useState('')
  const [topBusy, setTopBusy] = useState(false)

  const exportTopSold = async () => {
    setTopBusy(true); setTopMsg('')
    try {
      const juntos = new Map()
      let ordenes = 0, truncado = false
      for (const key of ['full', 'ferre']) {
        if (!mlAccounts[key]?.accessToken) continue
        const token = await ensureToken(key)
        const r = await fetch(`${API}?action=topsold`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, days: 30, limit: 400 }),
        }).then(x => x.json())
        if (!r.ok) throw new Error(`${key.toUpperCase()}: ${r.error || 'Error'}`)
        ordenes += r.ordenes || 0
        if (r.truncado) truncado = true
        for (const t of r.top) {
          const k = t.mla || t.sku
          const x = juntos.get(k) || { ...t, unidades: 0, ventas: 0, cuentas: new Set() }
          x.unidades += t.unidades; x.ventas += t.ventas; x.cuentas.add(key.toUpperCase())
          if (!x.titulo && t.titulo) x.titulo = t.titulo
          juntos.set(k, x)
        }
      }
      if (!juntos.size) throw new Error('No hubo ventas en los últimos 30 días (¿las cuentas están conectadas?)')

      const top = [...juntos.values()].sort((a, b) => b.unidades - a.unidades).slice(0, 200)
      const si = v => (v ? 'SI' : 'FALTA')
      const filas = top.map((t, i) => {
        const m = findByRef(t.mla) || (t.sku ? findByRef(t.sku) : null)
        const combo = m?.type === 'combo' ? m.c : null
        const prod = m?.type === 'product' ? m.p : null
        const bases = combo
          ? (combo.items || []).map(ci => products.find(p => p.id === ci.productId)).filter(Boolean)
          : (prod ? [prod] : [])
        const sinMedida = bases.filter(p => !p.dims)
        const sinUbic = bases.filter(p => !p.location)
        const conFoto = combo ? combo.hasPhotos : prod?.hasPhotos
        return {
          '#': i + 1,
          'SKU (ML)': t.mla || t.sku,
          'Publicación': t.titulo,
          'Unidades vendidas (30 días)': t.unidades,
          'Ventas': t.ventas,
          'Cuenta': [...t.cuentas].join(' + '),
          'En el sistema': combo ? 'Combo' : (prod ? 'Producto' : 'NO ESTÁ'),
          'Nombre en el sistema': combo?.name || prod?.name || '',
          'Foto': m ? si(conFoto) : '',
          'Medidas': bases.length ? si(!sinMedida.length) : '',
          'Ubicación': bases.length ? si(!sinUbic.length) : '',
          'Productos que faltan completar': [...new Set([
            ...sinMedida.map(p => `${p.code || p.name} (medidas)`),
            ...sinUbic.map(p => `${p.code || p.name} (ubicación)`),
          ])].join(' · '),
        }
      })

      const ws = XLSX.utils.json_to_sheet(filas)
      ws['!cols'] = [{ wch: 5 }, { wch: 16 }, { wch: 55 }, { wch: 12 }, { wch: 8 }, { wch: 12 },
                     { wch: 13 }, { wch: 40 }, { wch: 8 }, { wch: 9 }, { wch: 10 }, { wch: 50 }]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Top 200')
      XLSX.writeFile(wb, `top200-vendidos-${new Date().toISOString().slice(0, 10)}.xlsx`)

      const faltan = filas.filter(f => f.Medidas === 'FALTA' || f.Ubicación === 'FALTA' || f.Foto === 'FALTA').length
      setTopMsg(`✅ ${ordenes} ventas de 30 días · top 200 exportado. ${faltan} de los 200 tienen algo sin cargar.`
        + (truncado ? ' ⚠️ Alguna semana superó el máximo de 10.000 ventas que deja leer ML y quedó incompleta.' : ''))
    } catch (err) {
      setTopMsg('❌ ' + err.message)
    } finally {
      setTopBusy(false)
    }
  }

  // Excel de TODAS las ventas FLEX de las dos cuentas, con el costo del envío,
  // quién lo pagó y en qué cordón cayó. Sirve para comparar lo que nos cobra ML
  // contra lo que le pagamos a los motoqueros.
  //
  // Son muchos meses y cada venta necesita su envío, así que se pide por tramos
  // cortos: si un tramo tarda demasiado y falla, se parte al medio y se
  // reintenta solo esa parte. Lo que ya vino no se pierde.
  const [flexMsg, setFlexMsg] = useState('')
  const [flexBusy, setFlexBusy] = useState(false)
  const [flexDesde, setFlexDesde] = useState('2025-08-01')

  const exportFlexSales = async () => {
    const desdeMs = new Date(flexDesde + 'T00:00:00-03:00').getTime()
    if (!Number.isFinite(desdeMs)) { setFlexMsg('❌ Poné una fecha válida en "desde"'); return }
    const hastaMs = Date.now()
    if (desdeMs >= hastaMs) { setFlexMsg('❌ La fecha "desde" tiene que ser anterior a hoy'); return }

    const meses = Math.round((hastaMs - desdeMs) / (30 * 24 * 3600 * 1000))
    if (!window.confirm(
      `Voy a leer venta por venta de las 2 cuentas desde el ${flexDesde} (unos ${meses} meses) y de cada una su envío.\n\n` +
      'Puede tardar bastante (decenas de minutos). No cierres esta pestaña mientras corre.\n\n¿Arranco?')) return

    setFlexBusy(true); setFlexMsg('⏳ Empezando...')
    const filas = []
    const avisos = []
    try {
      // Tramos de 12 días: es lo que entra cómodo en una corrida del servidor
      const TRAMO = 12 * 24 * 3600 * 1000
      const tramos = []
      for (let ini = desdeMs; ini < hastaMs; ini += TRAMO) {
        tramos.push([ini, Math.min(ini + TRAMO, hastaMs)])
      }

      for (const key of ['full', 'ferre']) {
        if (!mlAccounts[key]?.accessToken) { avisos.push(`${key.toUpperCase()} no está conectada`); continue }
        const token = await ensureToken(key)

        // Un tramo puede fallar por tiempo: se parte al medio y se reintenta
        const traer = async (ini, fin, profundidad = 0) => {
          const body = { token, desde: new Date(ini).toISOString(), hasta: new Date(fin).toISOString() }
          let r
          try {
            r = await fetch(`${API}?action=flexsales`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }).then(x => x.json())
          } catch (e) {
            r = { ok: false, error: e.message }
          }
          if (r?.ok) {
            r.filas.forEach(f => filas.push({ ...f, cuenta: key.toUpperCase() }))
            if (r.truncado) avisos.push(`${key.toUpperCase()} ${new Date(ini).toISOString().slice(0, 10)}: una semana superó las 10.000 ventas que deja leer ML`)
            return
          }
          if (profundidad >= 3 || fin - ini < 12 * 3600 * 1000) {
            avisos.push(`${key.toUpperCase()} ${new Date(ini).toISOString().slice(0, 10)} → ${new Date(fin).toISOString().slice(0, 10)}: ${r?.error || 'no se pudo leer'}`)
            return
          }
          const medio = ini + Math.floor((fin - ini) / 2)
          await traer(ini, medio, profundidad + 1)
          await traer(medio, fin, profundidad + 1)
        }

        for (let i = 0; i < tramos.length; i++) {
          const [ini, fin] = tramos[i]
          setFlexMsg(`⏳ ${key.toUpperCase()} · tramo ${i + 1} de ${tramos.length} (${new Date(ini).toISOString().slice(0, 10)}) · ${filas.length} envíos FLEX hasta ahora`)
          await traer(ini, fin)
        }
      }

      if (!filas.length) throw new Error('No se encontró ninguna venta FLEX en ese período. ' + avisos.join(' · '))

      const AR = 3 * 3600 * 1000
      const fechaAR = (iso) => new Date(new Date(iso).getTime() - AR).toISOString()
      const titulo = (s) => String(s || '').replace(/\b\w/g, c => c.toUpperCase())
      const quienPaga = (comprador, nosotros) => {
        if (comprador > 0 && nosotros > 0) return 'Compartido'
        if (comprador > 0) return 'Comprador'
        if (nosotros > 0) return 'Nosotros'
        return 'Sin costo (bonificado)'
      }

      const detalle = filas.map(f => {
        const comprador = Number(f.costoComprador || 0)
        const nosotros = Number(f.costoNosotros || 0)
        const z = cordonDe(f)
        const fa = fechaAR(f.fecha)
        return {
          'Cuenta': f.cuenta,
          'Fecha': fa.slice(0, 10),
          'Hora': fa.slice(11, 16),
          'N° de venta': String(f.orderId || ''),
          'N° de envío': String(f.shipmentId || ''),
          'Estado del envío': f.estadoEnvio || '',
          'Comprador': f.comprador || '',
          'SKU': f.sku || '',
          'Publicación': f.titulo || '',
          'Unidades': f.unidades || 0,
          'Total de la venta': Number(f.total || 0),
          'Provincia': f.provincia || '',
          'Localidad': f.localidad || '',
          'Partido': titulo(z.partido || f.municipio || ''),
          'CP': f.cp || '',
          'Zona (cordón)': z.zona,
          'Cómo se determinó la zona': z.criterio,
          'Quién pagó el envío': quienPaga(comprador, nosotros),
          'Costo envío — comprador': comprador,
          'Costo envío — nosotros': nosotros,
          'Bonificación de ML': Number(f.bonificacion || 0),
          'Costo del envío (total)': comprador + nosotros,
        }
      }).sort((a, b) => (a.Fecha + a.Hora).localeCompare(b.Fecha + b.Hora))

      // Resumen por zona y cuenta: es lo que se compara con lo que le pagamos
      // a la logística
      const res = new Map()
      for (const d of detalle) {
        const k = d['Zona (cordón)'] + '|' + d.Cuenta
        const x = res.get(k) || {
          'Zona (cordón)': d['Zona (cordón)'], 'Cuenta': d.Cuenta, 'Envíos': 0,
          'Pagó el comprador': 0, 'Pagamos nosotros': 0, 'Bonificó ML': 0, 'Costo total': 0,
        }
        x['Envíos'] += 1
        x['Pagó el comprador'] += d['Costo envío — comprador']
        x['Pagamos nosotros'] += d['Costo envío — nosotros']
        x['Bonificó ML'] += d['Bonificación de ML']
        x['Costo total'] += d['Costo del envío (total)']
        res.set(k, x)
      }
      const resumen = [...res.values()]
        .map(x => ({ ...x, 'Costo promedio por envío': Math.round(x['Costo total'] / x['Envíos']) }))
        .sort((a, b) => a['Zona (cordón)'].localeCompare(b['Zona (cordón)']) || a.Cuenta.localeCompare(b.Cuenta))

      const wb = XLSX.utils.book_new()
      const wsR = XLSX.utils.json_to_sheet(resumen)
      wsR['!cols'] = [{ wch: 24 }, { wch: 9 }, { wch: 9 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 20 }]
      XLSX.utils.book_append_sheet(wb, wsR, 'Resumen por zona')
      const wsD = XLSX.utils.json_to_sheet(detalle)
      wsD['!cols'] = [{ wch: 8 }, { wch: 11 }, { wch: 6 }, { wch: 15 }, { wch: 13 }, { wch: 15 }, { wch: 18 },
                      { wch: 20 }, { wch: 45 }, { wch: 9 }, { wch: 14 }, { wch: 16 }, { wch: 22 }, { wch: 20 },
                      { wch: 8 }, { wch: 16 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 16 }, { wch: 20 }]
      XLSX.utils.book_append_sheet(wb, wsD, 'Ventas FLEX')
      XLSX.writeFile(wb, `ventas-flex-${flexDesde}_a_${new Date().toISOString().slice(0, 10)}.xlsx`)

      setFlexMsg(`✅ ${detalle.length} ventas FLEX exportadas (${new Set(detalle.map(d => d['N° de envío'])).size} envíos).`
        + (avisos.length ? ` ⚠️ ${avisos.length} tramos con problemas: ${avisos.slice(0, 3).join(' · ')}${avisos.length > 3 ? '…' : ''}` : ''))
    } catch (err) {
      setFlexMsg('❌ ' + err.message)
    } finally {
      setFlexBusy(false)
    }
  }

  // Dispara el proceso automático (el mismo del cron de las 18hs) una vez
  const [cronMsg, setCronMsg] = useState('')
  const [cronBusy, setCronBusy] = useState(false)
  const runCronNow = async () => {
    if (!window.confirm('Descuenta las ventas Flex y de Correo/Colecta de las 2 cuentas (las ventas Full NO se descuentan). ¿Seguir?')) return
    setCronBusy(true); setCronMsg('')
    try {
      const r = await fetch('/api/ml/cron', { method: 'POST' }).then(x => x.json())
      if (!r.ok) throw new Error(r.error || 'Error')
      const parts = Object.entries(r.summary || {}).map(([k, v]) => {
        if (typeof v === 'string') return `${k.toUpperCase()}: ${v}`
        const d = v.descuentan || {}, n = v.noDescuentan || {}
        const noDesc = [
          n.full ? `${n.full} Full` : '',
          n.canceladas ? `${n.canceladas} canceladas` : '',
          n.sinCobrar ? `${n.sinCobrar} sin cobrar` : '',
          n.tipoDeEnvioDesconocido ? `${n.tipoDeEnvioDesconocido} sin tipo de envío` : '',
        ].filter(Boolean).join(', ')
        return `${k.toUpperCase()}: ${v.enVentana48hs} ventas en 48hs · descuentan ${d.flex || 0} flex + ${d.correoColecta || 0} correo` +
          `${d.sinEnvioML ? ` + ${d.sinEnvioML} sin envío ML` : ''}` +
          ` → ${v.ordenesNuevas} nuevas (${v.unidadesDescontadas} unidades de ${v.productos} productos)` +
          `${v.yaProcesadas ? `, ${v.yaProcesadas} ya procesadas` : ''}` +
          `${noDesc ? ` · NO descuentan: ${noDesc}` : ''}`
      })
      setCronMsg('✅ ' + parts.join(' · '))
    } catch (err) {
      setCronMsg('❌ ' + err.message)
    } finally {
      setCronBusy(false)
    }
  }

  // Confirma: descuenta stock y marca las órdenes como procesadas
  const applyPreview = async () => {
    if (!preview) return
    setBusy(preview.account)
    try {
      // Filas por producto (el delta ya viene negativo = descuento)
      const flat = preview.lines.map(l => {
        const prod = products.find(pp => pp.name === l.productName)
        return prod ? { productId: prod.id, productName: prod.name, quantity: l.delta, reason: `Venta ML ${preview.account.toUpperCase()}` } : null
      }).filter(Boolean)

      await onPurchase(flat, { reason: `Venta ML ${preview.account.toUpperCase()}`, reference: 'ML' })

      // marcar órdenes como procesadas
      const batch = writeBatch(db)
      preview.orders.forEach(o => {
        batch.set(doc(db, 'ml_orders', `${preview.account}_${o.id}`), {
          account: preview.account, orderId: o.id, userId: ORG_ID, processedAt: Timestamp.now(),
        })
      })
      await batch.commit()

      await onSaveAccount(preview.account, { lastSyncAt: Timestamp.now() })
      setMsg(m => ({ ...m, [preview.account]: `✅ Descontadas ${preview.orders.length} ventas.` }))
      setPreview(null)
    } catch (err) {
      setMsg(m => ({ ...m, [preview.account]: '❌ ' + err.message }))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="ml-container">
      <div className="ml-head">
        <h1>🛒 MercadoLibre</h1>
        <p>Conectá tus cuentas y descontá stock de las ventas (menos lo que sale de la bodega de ML).</p>
      </div>

      <div className="ml-info">
        ℹ️ <strong>Redirect URI</strong> para configurar en cada app de ML (copiala tal cual):
        <code>{redirectUri}</code>
      </div>

      <div className="ml-auto">
        🤖 <strong>Automático:</strong> todos los días a las <strong>13:00 y 18:00</strong> el sistema descuenta solo
        las ventas del día de las dos cuentas (menos lo de bodega Full). Igual podés sincronizar a mano cuando quieras.
        <div className="ml-auto-actions">
          <button className="ml-btn-cron" onClick={runCronNow} disabled={cronBusy}>
            {cronBusy ? '⏳ Procesando...' : '▶️ Probar automático ahora'}
          </button>
          {cronMsg && <span className={`ml-cron-msg ${cronMsg.startsWith('✅') ? 'ok' : 'warn'}`}>{cronMsg}</span>}
          <div className="ml-top-row">
            <button className="ml-btn-missing" onClick={exportTopSold} disabled={topBusy}>
              {topBusy ? '⏳ Leyendo las ventas del mes...' : '🏆 Top 200 más vendidos (30 días)'}
            </button>
            {topMsg && <span className={`ml-cron-msg ${topMsg.startsWith('✅') ? 'ok' : 'warn'}`}>{topMsg}</span>}
          </div>
          <div className="ml-top-row">
            <label className="ml-desde">
              Ventas FLEX desde
              <input type="date" value={flexDesde} onChange={e => setFlexDesde(e.target.value)} disabled={flexBusy} />
            </label>
            <button className="ml-btn-missing" onClick={exportFlexSales} disabled={flexBusy}>
              {flexBusy ? '⏳ Leyendo...' : '🚚 Excel de ventas FLEX (costo de envío y zona)'}
            </button>
            {flexMsg && <span className={`ml-cron-msg ${flexMsg.startsWith('✅') ? 'ok' : flexMsg.startsWith('⏳') ? '' : 'warn'}`}>{flexMsg}</span>}
          </div>
        </div>
      </div>

      <div className="ml-accounts">
        {ACCOUNTS.map(({ key, label }) => {
          const acc = mlAccounts?.[key] || {}
          const connected = !!acc.accessToken
          const f = forms[key] || {}
          return (
            <div key={key} className={`ml-card ${connected ? 'connected' : ''}`}>
              <div className="ml-card-head">
                <h2>{label}</h2>
                <span className={`ml-badge ${connected ? 'on' : 'off'}`}>
                  {connected ? `✓ Conectada${acc.nickname ? ' · ' + acc.nickname : ''}` : 'Sin conectar'}
                </span>
              </div>

              <label className="ml-label">App ID (Client ID)</label>
              <input
                type="text"
                value={f.clientId ?? acc.clientId ?? ''}
                onChange={e => setForm(key, 'clientId', e.target.value)}
                placeholder="Ej: 1234567890123456"
              />
              <label className="ml-label">Secret Key</label>
              <input
                type="password"
                value={f.clientSecret ?? acc.clientSecret ?? ''}
                onChange={e => setForm(key, 'clientSecret', e.target.value)}
                placeholder="Clave secreta de la app"
              />

              <div className="ml-actions">
                <button className="ml-btn-save" onClick={() => saveConfig(key)}>💾 Guardar</button>
                <button className="ml-btn-connect" onClick={() => connect(key)} disabled={!acc.clientId}>
                  {connected ? '🔄 Reconectar' : '🔗 Conectar'}
                </button>
                <button className="ml-btn-sync" onClick={() => sync(key)} disabled={!connected || busy === key}>
                  {busy === key ? '⏳...' : '⬇️ Sincronizar ventas de hoy'}
                </button>
                <button className="ml-btn-missing" onClick={() => findMissing(key)} disabled={!connected || busy === key}>
                  🔍 Publicaciones faltantes
                </button>
              </div>

              {acc.lastSyncAt && (
                <div className="ml-lastsync">
                  Última sincronización: {(acc.lastSyncAt.toDate ? acc.lastSyncAt.toDate() : new Date(acc.lastSyncAt)).toLocaleString('es-AR')}
                </div>
              )}
              {msg[key] && <div className={`ml-msg ${msg[key].startsWith('✅') ? 'ok' : 'warn'}`}>{msg[key]}</div>}
            </div>
          )
        })}
      </div>

      {preview && (
        <div className="ml-preview">
          <h3>Revisá antes de descontar — cuenta {preview.account.toUpperCase()}</h3>
          <p className="ml-preview-sub">
            {preview.orders.length} ventas para descontar · {preview.skippedFull} salteadas (bodega Full).
            {preview.notFound.length > 0 && ` ⚠️ Sin producto: ${preview.notFound.slice(0, 5).join(', ')}${preview.notFound.length > 5 ? '…' : ''}.`}
          </p>
          <div className="ml-preview-table-wrap">
            <table className="ml-preview-table">
              <thead>
                <tr><th>Origen (SKU/combo)</th><th>Producto</th><th>Stock</th><th>Cambio</th><th>Queda</th></tr>
              </thead>
              <tbody>
                {preview.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="ml-code">{l.origins.join(', ')}</td>
                    <td>{l.productName}</td>
                    <td>{l.current}</td>
                    <td className="ml-minus">{l.delta}</td>
                    <td className="ml-new">{l.current + l.delta}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ml-preview-actions">
            <button className="ml-btn-apply" onClick={applyPreview} disabled={busy}>
              {busy ? '⏳ Descontando...' : `✓ Confirmar y descontar (${preview.lines.length})`}
            </button>
            <button className="ml-btn-cancel" onClick={() => setPreview(null)} disabled={busy}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}
