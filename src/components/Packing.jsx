import React, { useState, useMemo, useEffect, useRef } from 'react'
import Scanner from './Scanner'
import LazyThumb from './LazyThumb'
import './Packing.css'

// Medidas reales de cada bolsa (ancho × largo en cm, dadas por el usuario):
// verde 20×30, blanca 30×40, gris 40×50. Si no entra en la gris → empaque especial.
const BAGS = [
  { key: 'verde',    label: 'BOLSA VERDE (20×30)',  bg: '#16a34a', fg: '#fff', w: 20, l: 30 },
  { key: 'blanca',   label: 'BOLSA BLANCA (30×40)', bg: '#f9fafb', fg: '#1f2937', w: 30, l: 40 },
  { key: 'gris',     label: 'BOLSA GRIS (40×50)',   bg: '#6b7280', fg: '#fff', w: 40, l: 50 },
  { key: 'especial', label: 'EMPAQUE ESPECIAL',     bg: '#7c3aed', fg: '#fff' },
]

// Margen para poder envolver y cerrar la bolsa
const BAG_SLACK = 2

const parseShipmentCode = (raw) => {
  const text = String(raw).trim()
  try { const o = JSON.parse(text); if (o && (o.id || o.shipment_id)) return String(o.id || o.shipment_id) } catch {}
  const m = text.match(/(\d{8,})/)
  return m ? m[1] : text.slice(0, 40)
}

// Dimensiones del paquete en cm desde lo que da ML (objeto o texto "13x37x53,1350"),
// ordenadas de mayor a menor
const dimsOf = (dims) => {
  if (!dims) return null
  let a, b, c
  if (typeof dims === 'string') {
    const m = dims.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i)
    if (!m) return null
    ;[a, b, c] = [+m[1], +m[2], +m[3]]
  } else {
    ;[a, b, c] = [Number(dims.height), Number(dims.width), Number(dims.length)]
  }
  if (!(a > 0 && b > 0 && c > 0)) return null
  return [a, b, c].sort((x, y) => y - x) // [largo, ancho, alto]
}

// Una bolsa plana de w×l sirve si el paquete envuelto entra con margen:
// (ancho + alto) ≤ ancho bolsa y (largo + alto) ≤ largo bolsa
const bagFor = (dims) => {
  const d = dimsOf(dims)
  if (!d) return null
  const [L, W, H] = d
  return BAGS.find(b => !b.w || (W + H + BAG_SLACK <= b.w && L + H + BAG_SLACK <= b.l))
}

export default function Packing({ products, combos, shipments, loadPhotos, onUpdateShipment }) {
  const [step, setStep] = useState(1)
  const [showScanner, setShowScanner] = useState(false)
  const [shipmentId, setShipmentId] = useState(null)
  const [checks, setChecks] = useState({})
  const [okQty, setOkQty] = useState(false)
  const [okSlips, setOkSlips] = useState(false)
  const [msg, setMsg] = useState('')
  const [countdown, setCountdown] = useState(null)

  const shipment = shipments.find(s => s.id === shipmentId) || null

  const barcodesOf = (x) => (x.barcodes?.length ? x.barcodes : (x.barcode ? [x.barcode] : []))
  const findByRef = (ref) => {
    const q = String(ref || '').trim().toLowerCase()
    if (!q) return null
    const p = products.find(pp => (pp.code && pp.code.toLowerCase() === q) || barcodesOf(pp).some(b => String(b).toLowerCase() === q))
    if (p) return { type: 'product', p }
    const c = combos.find(cc => (cc.code && cc.code.toLowerCase() === q) || barcodesOf(cc).some(b => String(b).toLowerCase() === q))
    if (c) return { type: 'combo', c }
    return null
  }

  // Expande los artículos de la venta a productos base con foto y cantidad total
  const lines = useMemo(() => {
    if (!shipment?.items?.length) return []
    const out = []
    shipment.items.forEach((it, idx) => {
      const m = findByRef(it.sku) || findByRef(it.mla)
      if (!m) {
        out.push({ key: 'x' + idx, name: it.title || it.mla || 'Artículo', qty: it.quantity || 1, missing: true })
        return
      }
      if (m.type === 'product') {
        out.push({ key: `${m.p.id}_${idx}`, id: m.p.id, name: m.p.name, qty: it.quantity || 1, hasPhotos: m.p.hasPhotos, fragile: !!m.p.fragile, location: m.p.location })
      } else {
        m.c.items?.forEach((ci, j) => {
          const bp = products.find(pp => pp.id === ci.productId)
          if (bp) out.push({
            key: `${bp.id}_${idx}_${j}`, id: bp.id, name: bp.name,
            qty: (ci.quantity || 1) * (it.quantity || 1),
            hasPhotos: bp.hasPhotos, fragile: !!bp.fragile, location: bp.location,
            comboName: m.c.name,
          })
        })
      }
    })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipment, products, combos])

  const totalUnits = lines.reduce((s, l) => s + l.qty, 0)
  const anyFragile = lines.some(l => l.fragile)
  const bag = bagFor(shipment?.dims)
  const allChecked = lines.length > 0 && lines.every(l => checks[l.key])

  const reset = (openScanner = true) => {
    setShipmentId(null); setChecks({}); setOkQty(false); setOkSlips(false)
    setMsg(''); setCountdown(null); setStep(1)
    if (openScanner) setShowScanner(true)
  }

  const handleScan = (raw) => {
    setShowScanner(false)
    const code = parseShipmentCode(raw)
    const digits = String(raw).replace(/\D/g, '')
    const found = shipments.find(s => {
      const c = String(s.code); const p = String(s.packId || '')
      return c === code || p === code ||
        (code && (c.includes(code) || code.includes(c))) ||
        (digits && (c === digits || p === digits || c.includes(digits) || digits.includes(c)))
    })
    if (!found) { setMsg(`⚠️ No se encontró la venta del QR (${code}). Sincronizá en Envíos y volvé a intentar.`); return }
    if (!found.items?.length) {
      setMsg('⚠️ Este envío no tiene el detalle de artículos (es de una sincronización anterior). Los envíos nuevos ya lo traen.')
      return
    }
    setMsg(''); setChecks({}); setShipmentId(found.id); setStep(1)
  }

  // Al llegar al paso 2, el paquete queda "Armado" automáticamente
  const goStep2 = () => {
    if (shipment && (shipment.status === 'pendiente' || !shipment.status)) {
      onUpdateShipment(shipment.id, { status: 'armado', armadoAt: new Date() }).catch(() => {})
    }
    setStep(2)
  }

  // Paso 3: cuenta regresiva y vuelve sola a escanear
  useEffect(() => {
    if (step !== 3) return
    setCountdown(6)
    const t = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { clearInterval(t); reset(true); return null }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  return (
    <div className="packing-container">
      <div className="pk-header">
        <h1>📦 Empaquetado</h1>
        <p>Escaneá el QR de la venta y seguí los pasos. Al terminar vuelve solo para escanear la siguiente.</p>
      </div>

      {showScanner && <Scanner onScan={handleScan} onClose={() => setShowScanner(false)} />}
      {msg && <div className="pk-msg">{msg}</div>}

      {/* ---------- PASO 1: escanear + checklist de artículos ---------- */}
      {step === 1 && !shipment && (
        <div className="pk-start">
          <button className="pk-scan-big" onClick={() => { setMsg(''); setShowScanner(true) }}>
            📷<br />ESCANEAR VENTA
          </button>
          <p className="pk-hint">Apuntá al QR de la etiqueta FLEX.</p>
        </div>
      )}

      {step === 1 && shipment && (
        <div className="pk-step">
          <div className="pk-topbar">
            {bag ? (
              <div className="pk-bag" style={{ background: bag.bg, color: bag.fg }}>
                🛍️ {bag.label}
              </div>
            ) : (
              <div className="pk-bag pk-bag-unknown">🛍️ Sin medidas de ML — elegí la bolsa a criterio</div>
            )}
            {anyFragile && <div className="pk-fragile">⚠️ FRÁGIL — embalar con cuidado</div>}
          </div>
          <div className="pk-shipinfo">
            <span className="pk-code">{shipment.code}</span>
            {shipment.recipient && <span className="pk-recipient">{shipment.recipient}</span>}
          </div>

          <div className="pk-lines">
            {lines.map(l => (
              <label key={l.key} className={`pk-line ${checks[l.key] ? 'done' : ''} ${l.missing ? 'missing' : ''}`}>
                <input
                  type="checkbox"
                  checked={!!checks[l.key]}
                  onChange={e => setChecks(prev => ({ ...prev, [l.key]: e.target.checked }))}
                />
                {l.id ? (
                  <LazyThumb id={l.id} hasPhotos={l.hasPhotos} kind="product" loadPhotos={loadPhotos} className="pk-photo" />
                ) : (
                  <div className="pk-photo pk-photo-none">📦</div>
                )}
                <div className="pk-line-info">
                  <div className="pk-line-name">{l.name}</div>
                  {l.location && <div className="pk-line-loc">📍 {l.location}</div>}
                  {l.comboName && <div className="pk-line-combo">🎁 {l.comboName}</div>}
                  {l.missing && <div className="pk-line-warn">No está en el sistema — verificá con la etiqueta</div>}
                </div>
                <div className="pk-line-qty">×{l.qty}</div>
              </label>
            ))}
          </div>

          <div className="pk-actions">
            <button className="pk-next" disabled={!allChecked} onClick={goStep2}>
              {allChecked ? '✓ Todo puesto — Continuar' : `Marcá todos los artículos (${Object.values(checks).filter(Boolean).length}/${lines.length})`}
            </button>
            <button className="pk-cancel" onClick={() => reset(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {/* ---------- PASO 2: verificación de cantidades + papelitos ---------- */}
      {step === 2 && shipment && (
        <div className="pk-step pk-center">
          <div className="pk-bigcount">{totalUnits}</div>
          <p className="pk-check-title">unidades en total tiene que llevar este paquete</p>
          <p className="pk-check-sub">
            Ojo: un SKU puede ser un combo de varias unidades (ej: "×10"). Contá lo que pusiste.
          </p>
          <label className="pk-bigcheck">
            <input type="checkbox" checked={okQty} onChange={e => setOkQty(e.target.checked)} />
            ✔ Verifiqué las cantidades: puse {totalUnits} unidades
          </label>
          <label className="pk-bigcheck">
            <input type="checkbox" checked={okSlips} onChange={e => setOkSlips(e.target.checked)} />
            📄 Puse el papelito de calificación y devolución
          </label>
          <div className="pk-actions">
            <button className="pk-next" disabled={!okQty || !okSlips} onClick={() => setStep(3)}>
              Continuar →
            </button>
            <button className="pk-cancel" onClick={() => setStep(1)}>← Volver</button>
          </div>
        </div>
      )}

      {/* ---------- PASO 3: etiqueta + volver a escanear ---------- */}
      {step === 3 && (
        <div className="pk-step pk-center">
          <div className="pk-done-icon">🏷️</div>
          <p className="pk-final-title">Pegá la etiqueta del lado LISO de la bolsa</p>
          <p className="pk-check-sub">para una mejor presentación del paquete.</p>
          <div className="pk-done-badge">✅ Paquete armado</div>
          <button className="pk-scan-big small" onClick={() => reset(true)}>
            📷 ESCANEAR SIGUIENTE {countdown != null ? `(${countdown})` : ''}
          </button>
        </div>
      )}
    </div>
  )
}
