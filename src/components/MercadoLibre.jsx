import React, { useState, useMemo } from 'react'
import * as XLSX from 'xlsx'
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
  const findByRef = (ref) => {
    const q = String(ref || '').trim().toLowerCase()
    if (!q) return null
    const p = products.find(pp =>
      (pp.code && pp.code.toLowerCase() === q) ||
      (pp.barcodes?.length ? pp.barcodes : (pp.barcode ? [pp.barcode] : [])).some(b => String(b).toLowerCase() === q)
    )
    if (p) return { type: 'product', p }
    const c = combos.find(cc =>
      (cc.code && cc.code.toLowerCase() === q) ||
      (cc.barcodes?.length ? cc.barcodes : (cc.barcode ? [cc.barcode] : [])).some(b => String(b).toLowerCase() === q)
    )
    if (c) return { type: 'combo', c }
    return null
  }

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

  // Dispara el proceso automático (el mismo del cron de las 18hs) una vez
  const [cronMsg, setCronMsg] = useState('')
  const [cronBusy, setCronBusy] = useState(false)
  const runCronNow = async () => {
    if (!window.confirm('Esto descuenta ahora las ventas de hoy de las 2 cuentas (menos bodega Full). ¿Seguir?')) return
    setCronBusy(true); setCronMsg('')
    try {
      const r = await fetch('/api/ml/cron', { method: 'POST' }).then(x => x.json())
      if (!r.ok) throw new Error(r.error || 'Error')
      const parts = Object.entries(r.summary || {}).map(([k, v]) =>
        typeof v === 'string' ? `${k.toUpperCase()}: ${v}` :
        `${k.toUpperCase()}: ${v.enVentana48hs} ventas en 48hs → ${v.ordenesNuevas} nuevas descontadas (${v.unidadesDescontadas} unidades de ${v.productos} productos)` +
        `${v.salteadasFull ? `, ${v.salteadasFull} de Full salteadas` : ''}${v.yaProcesadas ? `, ${v.yaProcesadas} ya procesadas` : ''}`
      )
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
