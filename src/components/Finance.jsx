import React, { useState, useMemo } from 'react'
import './Finance.css'

// Panel de control financiero: calendario de movimientos, registros, cuenta
// corriente por proveedor y resumen. Antes era una página suelta que guardaba
// todo en el navegador; acá los registros viven en la base, así se ven desde
// cualquier dispositivo y no se pierden al limpiar el navegador.

const DIAS_VENCIMIENTO = 30
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

const fmtARS = (n) => new Intl.NumberFormat('es-AR', {
  style: 'currency', currency: 'ARS', minimumFractionDigits: 0,
}).format(n || 0)
const fmtUSD = (n) => 'US$ ' + new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(n || 0)
const fmt = (n, moneda) => (moneda === 'USD' ? fmtUSD(n) : fmtARS(n))

const ymd = (date) => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
const parseYMD = (s) => {
  const [y, m, d] = String(s || '').split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}
const diffDays = (a, b) => Math.floor((b - a) / (1000 * 60 * 60 * 24))
const tipoLabel = (t) => (t === 'entrada' ? 'Entrada' : t === 'salida' ? 'Salida' : 'Gasto')
const tipoClass = (t) => (t === 'entrada' ? 'amount-pos' : t === 'salida' ? 'amount-neg' : 'amount-amber')
const normProv = (p) => (p || '').trim().toLowerCase()

const FORM_VACIO = {
  tipo: 'entrada', fecha: ymd(new Date()), moneda: 'ARS', monto: '',
  proveedor: '', remito: '', factura: '', descripcion: '',
}

export default function Finance({ records = [], usdRate = 1000, onAdd, onDelete, onTogglePagado, onSaveRate, onImport }) {
  const [tab, setTab] = useState('calendario')
  const [mes, setMes] = useState(() => new Date())
  const [form, setForm] = useState(FORM_VACIO)
  const [rate, setRate] = useState(String(usdRate))
  const [modal, setModal] = useState(null) // { titulo, tipo:'dia'|'proveedor', ... }
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importMsg, setImportMsg] = useState('')

  const toARS = (monto, moneda) => (moneda === 'USD' ? monto * usdRate : monto)

  // ---- Totales del mes que se está mirando ----
  const metricas = useMemo(() => {
    const y = mes.getFullYear(), m = mes.getMonth()
    const acc = { entrada: { ars: 0, usd: 0 }, salida: { ars: 0, usd: 0 }, gasto: { ars: 0, usd: 0 } }
    records.forEach(r => {
      const d = parseYMD(r.fecha)
      if (d.getFullYear() !== y || d.getMonth() !== m) return
      const a = acc[r.tipo]
      if (!a) return
      if (r.moneda === 'USD') a.usd += r.monto || 0
      else a.ars += r.monto || 0
    })
    const total = (x) => x.ars + x.usd * usdRate
    return {
      ...acc,
      balance: total(acc.entrada) - total(acc.salida) - total(acc.gasto),
    }
  }, [records, mes, usdRate])

  // ---- Cuenta corriente por proveedor ----
  const proveedores = useMemo(() => {
    const grouped = {}
    records.forEach(r => {
      if (!r.proveedor) return
      const key = normProv(r.proveedor)
      if (!grouped[key]) {
        grouped[key] = {
          nombre: r.proveedor, comprasARS: 0, comprasUSD: 0,
          pagosARS: 0, pagosUSD: 0, facturas: [], pagos: [],
        }
      }
      const g = grouped[key]
      if (r.tipo === 'entrada') {
        if (r.moneda === 'USD') g.comprasUSD += r.monto || 0; else g.comprasARS += r.monto || 0
        g.facturas.push(r)
      } else if (r.tipo === 'salida') {
        if (r.moneda === 'USD') g.pagosUSD += r.monto || 0; else g.pagosARS += r.monto || 0
        g.pagos.push(r)
      }
    })

    const hoy = new Date(); hoy.setHours(0, 0, 0, 0)

    return Object.values(grouped).map(p => {
      p.saldoARSPesos = p.comprasARS - p.pagosARS
      p.saldoUSD = p.comprasUSD - p.pagosUSD
      p.saldoARS = p.saldoARSPesos + p.saldoUSD * usdRate

      // Los pagos se aplican contra las facturas de la más vieja a la más
      // nueva (por moneda), así no hay que marcar cada factura a mano para
      // saber cuál es la más vieja que sigue impaga.
      const pendientes = p.facturas.filter(f => !f.pagado)
        .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
      let restanteARS = p.pagosARS, restanteUSD = p.pagosUSD
      let vieja = null
      for (const f of pendientes) {
        if (f.moneda === 'USD') {
          if (restanteUSD >= f.monto - 0.005) { restanteUSD -= f.monto; continue }
        } else {
          if (restanteARS >= f.monto - 0.005) { restanteARS -= f.monto; continue }
        }
        vieja = f
        break
      }
      p.facturaVieja = (vieja && p.saldoARS > 0) ? vieja : null
      p.diasAtraso = p.facturaVieja ? diffDays(parseYMD(p.facturaVieja.fecha), hoy) : 0
      return p
    }).sort((a, b) => b.saldoARS - a.saldoARS)
  }, [records, usdRate])

  const deudaTotal = proveedores.reduce((s, p) => s + Math.max(0, p.saldoARS), 0)
  const deudaSub = (() => {
    const ars = proveedores.reduce((s, p) => s + Math.max(0, p.saldoARSPesos), 0)
    const usd = proveedores.reduce((s, p) => s + Math.max(0, p.saldoUSD), 0)
    return [ars > 0 ? fmtARS(ars) : null, usd > 0 ? fmtUSD(usd) : null].filter(Boolean).join(' + ')
  })()

  // ---- Movimientos por mes (últimos 12) para el resumen ----
  const porMes = useMemo(() => {
    const meses = {}
    records.forEach(r => {
      const d = parseYMD(r.fecha)
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!meses[k]) meses[k] = { k, entrada: 0, salida: 0, gasto: 0 }
      meses[k][r.tipo] += toARS(r.monto || 0, r.moneda)
    })
    const keys = Object.keys(meses).sort().slice(-12)
    let acumulado = 0
    return keys.map(k => {
      const m = meses[k]
      acumulado += m.entrada - m.salida - m.gasto
      const [y, mm] = k.split('-').map(Number)
      return { ...m, label: `${MESES[mm - 1].slice(0, 3)} ${String(y).slice(2)}`, acumulado }
    })
  }, [records, usdRate])

  const proveedoresConocidos = useMemo(() => (
    [...new Set(records.map(r => r.proveedor).filter(Boolean))].sort()
  ), [records])

  // ---- Acciones ----
  const agregar = async (e) => {
    e.preventDefault()
    setError('')
    const monto = parseFloat(form.monto) || 0
    if (!form.descripcion.trim()) return setError('Poné una descripción del movimiento.')
    if (monto <= 0) return setError('El monto tiene que ser mayor a cero.')
    if (!form.fecha) return setError('Falta la fecha.')
    setGuardando(true)
    try {
      await onAdd({
        tipo: form.tipo,
        fecha: form.fecha,
        moneda: form.moneda,
        monto,
        proveedor: form.proveedor.trim(),
        remito: form.remito.trim(),
        factura: form.factura.trim(),
        descripcion: form.descripcion.trim(),
        pagado: false,
      })
      setForm({ ...FORM_VACIO, fecha: form.fecha, tipo: form.tipo })
    } catch (err) {
      setError('No se pudo guardar: ' + err.message)
    } finally {
      setGuardando(false)
    }
  }

  const borrar = async (r) => {
    if (!window.confirm(`¿Eliminar "${r.descripcion}" de ${fmt(r.monto, r.moneda)}?`)) return
    try { await onDelete(r.id) } catch (err) { setError('No se pudo eliminar: ' + err.message) }
  }

  const guardarRate = async () => {
    const v = parseFloat(rate)
    if (!v || v <= 0 || v === usdRate) return
    try { await onSaveRate(v) } catch (err) { setError('No se pudo guardar la cotización: ' + err.message) }
  }

  // ---- Traer los datos del panel viejo ----
  // El panel anterior guardaba los registros en el navegador de esa PC. Se
  // importan pegando el JSON o subiendo el archivo que exporta esa página.
  const importar = async (texto) => {
    setImportMsg('')
    let datos
    try {
      datos = JSON.parse(String(texto).trim())
    } catch {
      setImportMsg('❌ Eso no es un JSON válido. Copiá todo el contenido del archivo exportado.')
      return
    }
    const lista = Array.isArray(datos) ? datos : (Array.isArray(datos?.records) ? datos.records : null)
    if (!lista) { setImportMsg('❌ El archivo no tiene una lista de registros.'); return }

    const yaImportados = new Set(records.map(r => r.origenId).filter(Boolean))
    const validos = []
    let repetidos = 0, descartados = 0
    for (const r of lista) {
      const tipo = ['entrada', 'salida', 'gasto'].includes(r.tipo) ? r.tipo : null
      const monto = Number(r.monto)
      const fecha = String(r.fecha || '')
      if (!tipo || !(monto > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { descartados++; continue }
      if (r.id && yaImportados.has(String(r.id))) { repetidos++; continue }
      validos.push({
        tipo, fecha, monto,
        moneda: r.moneda === 'USD' ? 'USD' : 'ARS',
        descripcion: String(r.descripcion || '').trim() || 'Sin descripción',
        proveedor: String(r.proveedor || '').trim(),
        remito: String(r.remito || '').trim(),
        factura: String(r.factura || '').trim(),
        pagado: !!r.pagado,
        origenId: r.id ? String(r.id) : '',
      })
    }
    if (!validos.length) {
      setImportMsg(`⚠️ No quedó nada para traer (${repetidos} ya estaban, ${descartados} sin datos válidos).`)
      return
    }
    setGuardando(true)
    try {
      await onImport(validos)
      setImportMsg(`✅ Se trajeron ${validos.length} registros.`
        + (repetidos ? ` ${repetidos} ya estaban cargados.` : '')
        + (descartados ? ` ${descartados} se descartaron por estar incompletos.` : ''))
      setImportText('')
    } catch (err) {
      setImportMsg('❌ No se pudo guardar: ' + err.message)
    } finally {
      setGuardando(false)
    }
  }

  const importarArchivo = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    importar(await file.text())
  }

  // ---- Calendario ----
  const celdas = useMemo(() => {
    const y = mes.getFullYear(), m = mes.getMonth()
    const primerDia = new Date(y, m, 1).getDay()
    const ultimo = new Date(y, m + 1, 0).getDate()
    const out = []
    for (let i = 0; i < primerDia; i++) out.push(null)
    for (let d = 1; d <= ultimo; d++) {
      const dia = ymd(new Date(y, m, d))
      out.push({ d, dia, eventos: records.filter(r => r.fecha === dia) })
    }
    return out
  }, [records, mes])

  const hoyStr = ymd(new Date())
  const maxMes = Math.max(1, ...porMes.map(m => Math.max(m.entrada, m.salida, m.gasto)))

  const ItemRegistro = ({ r, conAcciones }) => {
    const f = parseYMD(r.fecha)
    return (
      <div className="fin-item">
        <div className="fin-item-info">
          <div className="fin-item-desc">{r.descripcion}</div>
          <div className="fin-item-meta">
            {f.getDate()}/{f.getMonth() + 1}/{f.getFullYear()}
            {!conAcciones && ` · ${tipoLabel(r.tipo)}`}
          </div>
          <div className="fin-tags">
            <span className={`fin-tag ${r.moneda === 'USD' ? 'usd' : 'ars'}`}>{r.moneda}</span>
            {r.proveedor && <span className="fin-tag prov">📦 {r.proveedor}</span>}
            {r.factura && <span className="fin-tag fac">F: {r.factura}</span>}
            {r.remito && <span className="fin-tag rem">R: {r.remito}</span>}
            {r.tipo === 'entrada' && r.proveedor && (
              <span className={`fin-tag ${r.pagado ? 'pagado' : 'impago'}`}>
                {r.pagado ? '✓ Pagado' : '⏳ Impago'}
              </span>
            )}
          </div>
        </div>
        <div className="fin-item-monto">
          <div className={tipoClass(r.tipo)}>{fmt(r.monto, r.moneda)}</div>
          {r.moneda === 'USD' && <div className="fin-item-sub">≈ {fmtARS(r.monto * usdRate)}</div>}
        </div>
        {conAcciones && (
          <div className="fin-item-acc">
            {r.tipo === 'entrada' && r.proveedor && (
              <button
                className={r.pagado ? 'fin-btn-mini' : 'fin-btn-mini ok'}
                onClick={() => onTogglePagado(r.id, !r.pagado)}
                title={r.pagado ? 'Marcar impago' : 'Marcar pagado'}
              >{r.pagado ? '↺' : '✓'}</button>
            )}
            <button className="fin-btn-mini del" onClick={() => borrar(r)} title="Eliminar">×</button>
          </div>
        )}
      </div>
    )
  }

  const listaPorTipo = (tipo) => records
    .filter(r => r.tipo === tipo)
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))

  return (
    <div className="finance">
      <div className="fin-head">
        <div>
          <h1>💰 Finanzas</h1>
          <p className="fin-sub">Entradas de mercadería, pagos, gastos y cuenta corriente de proveedores.</p>
        </div>
        <div className="fin-head-acc">
        <button className="fin-btn-sec" onClick={() => setImportOpen(v => !v)}>
          📥 Traer datos del panel viejo
        </button>
        <label className="fin-rate" title="Cotización del dólar para convertir a pesos">
          <span>USD →</span>
          <input
            type="number" step="0.01" min="0" value={rate}
            onChange={e => setRate(e.target.value)}
            onBlur={guardarRate}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
          />
          <span>ARS</span>
        </label>
        </div>
      </div>

      {importOpen && (
        <div className="fin-card fin-import">
          <h2>Traer los registros del panel viejo</h2>
          <p className="fin-item-meta">
            El panel anterior guardaba todo en el navegador de esa PC. Abrí el archivo
            <strong> exportar-panel-viejo.html</strong> que te pasé (en la misma carpeta que el panel),
            tocá “Descargar mis datos” y subí acá el archivo que baja. También podés pegar el texto.
          </p>
          <div className="fin-import-acc">
            <input type="file" accept=".json,.txt,application/json" onChange={importarArchivo} />
            <button className="fin-btn" disabled={guardando || !importText.trim()} onClick={() => importar(importText)}>
              {guardando ? '⏳ Trayendo...' : 'Traer lo pegado'}
            </button>
          </div>
          <textarea
            rows={4}
            placeholder='O pegá acá el contenido, que empieza con [{"id":...'
            value={importText}
            onChange={e => setImportText(e.target.value)}
          />
          {importMsg && <p className="fin-import-msg">{importMsg}</p>}
        </div>
      )}

      {error && <div className="fin-error">❌ {error}</div>}

      <div className="fin-metrics">
        <div className="fin-metric">
          <div className="fin-metric-lbl">Entradas del mes</div>
          <div className="fin-metric-val amount-pos">{fmtARS(metricas.entrada.ars + metricas.entrada.usd * usdRate)}</div>
          <div className="fin-metric-sub">
            {[metricas.entrada.ars > 0 ? fmtARS(metricas.entrada.ars) : null,
              metricas.entrada.usd > 0 ? fmtUSD(metricas.entrada.usd) : null].filter(Boolean).join(' + ')}
          </div>
        </div>
        <div className="fin-metric">
          <div className="fin-metric-lbl">Salidas del mes</div>
          <div className="fin-metric-val amount-neg">{fmtARS(metricas.salida.ars + metricas.salida.usd * usdRate)}</div>
          <div className="fin-metric-sub">
            {[metricas.salida.ars > 0 ? fmtARS(metricas.salida.ars) : null,
              metricas.salida.usd > 0 ? fmtUSD(metricas.salida.usd) : null].filter(Boolean).join(' + ')}
          </div>
        </div>
        <div className="fin-metric">
          <div className="fin-metric-lbl">Gastos del mes</div>
          <div className="fin-metric-val amount-amber">{fmtARS(metricas.gasto.ars + metricas.gasto.usd * usdRate)}</div>
          <div className="fin-metric-sub">
            {[metricas.gasto.ars > 0 ? fmtARS(metricas.gasto.ars) : null,
              metricas.gasto.usd > 0 ? fmtUSD(metricas.gasto.usd) : null].filter(Boolean).join(' + ')}
          </div>
        </div>
        <div className="fin-metric">
          <div className="fin-metric-lbl">Balance neto (ARS)</div>
          <div className={`fin-metric-val ${metricas.balance >= 0 ? 'amount-pos' : 'amount-neg'}`}>
            {fmtARS(metricas.balance)}
          </div>
          <div className="fin-metric-sub">Del mes que estás mirando</div>
        </div>
        <div className="fin-metric">
          <div className="fin-metric-lbl">Deuda total (ARS)</div>
          <div className="fin-metric-val amount-neg">{fmtARS(deudaTotal)}</div>
          <div className="fin-metric-sub">{deudaSub}</div>
        </div>
      </div>

      <div className="fin-tabs">
        {[['calendario', 'Calendario'], ['registros', 'Registros'],
          ['proveedores', 'Proveedores'], ['resumen', 'Resumen']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'calendario' && (
        <div className="fin-grid2">
          <div className="fin-card">
            <div className="fin-card-head">
              <h2>Calendario</h2>
              <div className="fin-nav">
                <button onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))}>‹</button>
                <span>{MESES[mes.getMonth()]} {mes.getFullYear()}</span>
                <button onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))}>›</button>
              </div>
            </div>
            <div className="fin-cal">
              {DIAS.map(d => <div key={d} className="fin-cal-head">{d}</div>)}
              {celdas.map((c, i) => (
                <div
                  key={i}
                  className={`fin-cal-day ${!c ? 'empty' : ''} ${c && c.dia === hoyStr ? 'today' : ''}`}
                  onClick={() => c?.eventos.length && setModal({
                    titulo: `Movimientos del ${c.d} de ${MESES[mes.getMonth()]}`,
                    eventos: c.eventos,
                  })}
                  style={c?.eventos.length ? { cursor: 'pointer' } : undefined}
                >
                  {c && (
                    <>
                      <div className="fin-cal-num">{c.d}</div>
                      <div className="fin-cal-evs">
                        {c.eventos.slice(0, 3).map(r => (
                          <div key={r.id} className={`fin-cal-ev ${r.tipo}`} title={`${tipoLabel(r.tipo)}: ${r.descripcion}`}>
                            {fmt(r.monto, r.moneda)}
                          </div>
                        ))}
                        {c.eventos.length > 3 && (
                          <div className="fin-cal-ev mas">+{c.eventos.length - 3} más</div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
            <div className="fin-legend">
              <span><i className="dot entrada" /> Entradas de mercadería</span>
              <span><i className="dot salida" /> Salidas de dinero</span>
              <span><i className="dot gasto" /> Gastos operativos</span>
            </div>
          </div>

          <div className="fin-card">
            <h2>Nuevo registro</h2>
            <form onSubmit={agregar} className="fin-form">
              <label>Tipo
                <select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>
                  <option value="entrada">Entrada de mercadería</option>
                  <option value="salida">Salida de dinero (pago)</option>
                  <option value="gasto">Gasto operativo</option>
                </select>
              </label>
              <div className="fin-form-row">
                <label>Fecha
                  <input type="date" value={form.fecha} onChange={e => setForm({ ...form, fecha: e.target.value })} required />
                </label>
                <label>Moneda
                  <select value={form.moneda} onChange={e => setForm({ ...form, moneda: e.target.value })}>
                    <option value="ARS">Pesos (ARS)</option>
                    <option value="USD">Dólares (USD)</option>
                  </select>
                </label>
              </div>
              <label>Monto
                <input type="number" step="0.01" min="0" placeholder="0.00" value={form.monto}
                  onChange={e => setForm({ ...form, monto: e.target.value })} required />
              </label>
              <label>Proveedor
                <input list="fin-provs" placeholder="Nombre del proveedor" value={form.proveedor}
                  onChange={e => setForm({ ...form, proveedor: e.target.value })} />
                <datalist id="fin-provs">
                  {proveedoresConocidos.map(p => <option key={p} value={p} />)}
                </datalist>
              </label>
              <div className="fin-form-row">
                <label>Remito
                  <input placeholder="N° remito" value={form.remito} onChange={e => setForm({ ...form, remito: e.target.value })} />
                </label>
                <label>Factura
                  <input placeholder="N° factura" value={form.factura} onChange={e => setForm({ ...form, factura: e.target.value })} />
                </label>
              </div>
              <label>Descripción
                <input placeholder="Detalle del movimiento" value={form.descripcion}
                  onChange={e => setForm({ ...form, descripcion: e.target.value })} required />
              </label>
              <button type="submit" className="fin-btn" disabled={guardando}>
                {guardando ? '⏳ Guardando...' : 'Agregar registro'}
              </button>
            </form>
          </div>
        </div>
      )}

      {tab === 'registros' && (
        <div className="fin-grid3">
          {[['entrada', 'Entradas de mercadería'], ['salida', 'Salidas de dinero'], ['gasto', 'Gastos operativos']]
            .map(([tipo, titulo]) => {
              const items = listaPorTipo(tipo)
              return (
                <div className="fin-card" key={tipo}>
                  <h2>{titulo} <span className="fin-count">{items.length}</span></h2>
                  <div className="fin-list">
                    {items.length === 0
                      ? <div className="fin-empty">Sin registros</div>
                      : items.map(r => <ItemRegistro key={r.id} r={r} conAcciones />)}
                  </div>
                </div>
              )
            })}
        </div>
      )}

      {tab === 'proveedores' && (
        <>
          <div className="fin-card">
            <div className="fin-card-head">
              <h2>Resumen de proveedores</h2>
              <span className="fin-item-meta">Deuda total: {fmtARS(deudaTotal)}</span>
            </div>
            {proveedores.length === 0 ? (
              <div className="fin-empty">
                Sin proveedores todavía. Cargá una entrada de mercadería con el nombre del proveedor.
              </div>
            ) : (
              <div className="fin-provs">
                {proveedores.map(p => {
                  const cls = p.saldoARS <= 0 ? 'ok'
                    : p.diasAtraso > DIAS_VENCIMIENTO ? 'danger'
                      : p.diasAtraso > DIAS_VENCIMIENTO * 0.7 ? 'warn' : 'ok'
                  const sub = [p.saldoARSPesos !== 0 ? fmtARS(p.saldoARSPesos) : null,
                    p.saldoUSD !== 0 ? fmtUSD(p.saldoUSD) : null].filter(Boolean).join(' + ')
                  return (
                    <div key={p.nombre} className="fin-prov" onClick={() => setModal({ titulo: `Cuenta corriente: ${p.nombre}`, prov: p })}>
                      <div className="fin-prov-nom">{p.nombre}</div>
                      <div className="fin-item-meta">
                        {p.facturas.length} factura{p.facturas.length === 1 ? '' : 's'} · {p.pagos.length} pago{p.pagos.length === 1 ? '' : 's'}
                      </div>
                      <div className={`fin-prov-saldo ${p.saldoARS > 0 ? 'amount-neg' : p.saldoARS < 0 ? 'amount-pos' : ''}`}>
                        {fmtARS(p.saldoARS)}
                      </div>
                      {sub && <div className="fin-item-sub">{sub}</div>}
                      <span className={`fin-badge ${cls}`}>
                        {p.saldoARS > 0
                          ? (p.diasAtraso <= 0 ? 'Vence hoy' : `${p.diasAtraso} día${p.diasAtraso === 1 ? '' : 's'} de atraso`)
                          : 'Al día'}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {proveedores.length > 0 && (
            <div className="fin-card">
              <h2>Cuenta corriente detallada</h2>
              <div className="fin-table-wrap">
                <table className="fin-table">
                  <thead>
                    <tr>
                      <th>Proveedor</th><th className="r">Compras</th><th className="r">Pagos</th>
                      <th className="r">Saldo (ARS)</th><th>Factura más vieja impaga</th><th className="r">Atraso</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proveedores.map(p => (
                      <tr key={p.nombre} onClick={() => setModal({ titulo: `Cuenta corriente: ${p.nombre}`, prov: p })}>
                        <td><strong>{p.nombre}</strong></td>
                        <td className="r">
                          {[p.comprasARS > 0 ? fmtARS(p.comprasARS) : null, p.comprasUSD > 0 ? fmtUSD(p.comprasUSD) : null]
                            .filter(Boolean).map((x, i) => <div key={i}>{x}</div>)}
                          {!p.comprasARS && !p.comprasUSD && '—'}
                        </td>
                        <td className="r">
                          {[p.pagosARS > 0 ? fmtARS(p.pagosARS) : null, p.pagosUSD > 0 ? fmtUSD(p.pagosUSD) : null]
                            .filter(Boolean).map((x, i) => <div key={i}>{x}</div>)}
                          {!p.pagosARS && !p.pagosUSD && '—'}
                        </td>
                        <td className={`r ${p.saldoARS > 0 ? 'amount-neg' : 'amount-pos'}`}><strong>{fmtARS(p.saldoARS)}</strong></td>
                        <td>{p.facturaVieja
                          ? `${p.facturaVieja.factura || p.facturaVieja.descripcion} (${parseYMD(p.facturaVieja.fecha).toLocaleDateString('es-AR')})`
                          : '—'}</td>
                        <td className="r">{p.saldoARS > 0 ? `${p.diasAtraso} d` : 'Al día'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'resumen' && (
        <div className="fin-card">
          <h2>Movimientos por mes (en pesos)</h2>
          {porMes.length === 0 ? (
            <div className="fin-empty">Todavía no hay movimientos cargados.</div>
          ) : (
            <>
              <div className="fin-chart">
                {porMes.map(m => (
                  <div key={m.k} className="fin-chart-mes" title={`${m.label}\nEntradas ${fmtARS(m.entrada)}\nSalidas ${fmtARS(m.salida)}\nGastos ${fmtARS(m.gasto)}`}>
                    <div className="fin-chart-barras">
                      <i className="entrada" style={{ height: `${Math.round((m.entrada / maxMes) * 150)}px` }} />
                      <i className="salida" style={{ height: `${Math.round((m.salida / maxMes) * 150)}px` }} />
                      <i className="gasto" style={{ height: `${Math.round((m.gasto / maxMes) * 150)}px` }} />
                    </div>
                    <div className="fin-chart-lbl">{m.label}</div>
                  </div>
                ))}
              </div>
              <div className="fin-legend">
                <span><i className="dot entrada" /> Entradas</span>
                <span><i className="dot salida" /> Salidas</span>
                <span><i className="dot gasto" /> Gastos</span>
              </div>

              <h2 style={{ marginTop: '1.5rem' }}>Balance acumulado (en pesos)</h2>
              <div className="fin-table-wrap">
                <table className="fin-table">
                  <thead>
                    <tr><th>Mes</th><th className="r">Entradas</th><th className="r">Salidas</th><th className="r">Gastos</th><th className="r">Del mes</th><th className="r">Acumulado</th></tr>
                  </thead>
                  <tbody>
                    {porMes.map(m => {
                      const neto = m.entrada - m.salida - m.gasto
                      return (
                        <tr key={m.k}>
                          <td>{m.label}</td>
                          <td className="r amount-pos">{fmtARS(m.entrada)}</td>
                          <td className="r amount-neg">{fmtARS(m.salida)}</td>
                          <td className="r amount-amber">{fmtARS(m.gasto)}</td>
                          <td className={`r ${neto >= 0 ? 'amount-pos' : 'amount-neg'}`}>{fmtARS(neto)}</td>
                          <td className={`r ${m.acumulado >= 0 ? 'amount-pos' : 'amount-neg'}`}><strong>{fmtARS(m.acumulado)}</strong></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {modal && (
        <div className="fin-modal-bg" onClick={e => { if (e.target === e.currentTarget) setModal(null) }}>
          <div className="fin-modal">
            <div className="fin-card-head">
              <h2>{modal.titulo}</h2>
              <button className="fin-btn-mini" onClick={() => setModal(null)}>✕</button>
            </div>

            {modal.eventos && modal.eventos.map(r => <ItemRegistro key={r.id} r={r} />)}

            {modal.prov && (
              <>
                <div className="fin-modal-tot">
                  <div>
                    <div className="fin-metric-lbl">Compras</div>
                    <strong>{fmtARS(modal.prov.comprasARS + modal.prov.comprasUSD * usdRate)}</strong>
                  </div>
                  <div>
                    <div className="fin-metric-lbl">Pagos</div>
                    <strong>{fmtARS(modal.prov.pagosARS + modal.prov.pagosUSD * usdRate)}</strong>
                  </div>
                  <div>
                    <div className="fin-metric-lbl">Saldo</div>
                    <strong className={modal.prov.saldoARS > 0 ? 'amount-neg' : 'amount-pos'}>
                      {fmtARS(modal.prov.saldoARS)}
                    </strong>
                  </div>
                </div>
                <p className="fin-item-sub">Cotización usada: {fmtARS(usdRate)} por dólar.</p>

                <h3>Facturas ({modal.prov.facturas.length})</h3>
                {modal.prov.facturas.length === 0
                  ? <div className="fin-empty">Sin facturas</div>
                  : [...modal.prov.facturas].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
                    .map(f => <ItemRegistro key={f.id} r={f} />)}

                <h3>Pagos ({modal.prov.pagos.length})</h3>
                {modal.prov.pagos.length === 0
                  ? <div className="fin-empty">Sin pagos registrados</div>
                  : [...modal.prov.pagos].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
                    .map(p => <ItemRegistro key={p.id} r={p} />)}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
