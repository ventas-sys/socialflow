import React, { useState } from 'react'
import './Metrics.css'

const API = '/api/ml/exchange'

// Rangos rápidos. Los días se cuentan en hora de Argentina (UTC-3): "hoy"
// arranca a las 00:00 de acá, no a las 00:00 UTC (que son las 21hs de ayer).
const AR = 3 * 3600 * 1000
const inicioDiaAR = (diasAtras = 0) => {
  const ahora = new Date(Date.now() - AR)
  ahora.setUTCHours(0, 0, 0, 0)
  return new Date(ahora.getTime() - diasAtras * 24 * 3600 * 1000 + AR)
}
const RANGOS = [
  { key: 'hoy', label: 'Hoy', dias: 0 },
  { key: '7', label: '7 días', dias: 6 },
  { key: '15', label: '15 días', dias: 14 },
  { key: '30', label: '30 días', dias: 29 },
]

const plata = (n) => '$' + Math.round(n || 0).toLocaleString('es-AR')
const num = (n) => (n || 0).toLocaleString('es-AR')
const pct = (n) => (n == null ? '—' : (n * 100).toFixed(2).replace('.', ',') + '%')

export default function Metrics({ mlAccounts, ensureToken }) {
  const [cuenta, setCuenta] = useState('ambas')
  const [rango, setRango] = useState('hoy')
  const [conEnvios, setConEnvios] = useState(true)
  const [serie, setSerie] = useState('ventas') // qué muestra el gráfico
  const [datos, setDatos] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const cuentas = ['full', 'ferre'].filter(k => mlAccounts?.[k]?.accessToken)
  // El tipo de envío hay que preguntárselo a ML envío por envío: en 15 o 30
  // días son miles de consultas y la función se corta antes de terminar
  const periodoLargo = rango === '15' || rango === '30'
  const pedirEnvios = conEnvios && !periodoLargo

  const cargar = async () => {
    setBusy(true); setError(''); setDatos(null)
    try {
      const r = RANGOS.find(x => x.key === rango)
      const from = inicioDiaAR(r.dias).toISOString()
      const to = new Date().toISOString()
      const cuales = cuenta === 'ambas' ? cuentas : [cuenta]
      if (!cuales.length) throw new Error('No hay cuentas de MercadoLibre conectadas.')

      const partes = []
      for (const key of cuales) {
        const token = await ensureToken(key)
        const res = await fetch(`${API}?action=metrics`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, from, to, conEnvios: pedirEnvios }),
        }).then(x => x.json())
        if (!res.ok) throw new Error(`${key.toUpperCase()}: ${res.error || 'Error'}`)
        if (!res.porDia) throw new Error(`${key.toUpperCase()}: MercadoLibre no devolvió los días`)
        partes.push({ key, ...res })
      }

      // Juntar las cuentas elegidas en un solo resultado
      const resumen = { ventas: 0, unidades: 0, dinero: 0, canceladas: 0, visitas: null }
      const dias = new Map()
      const envios = { flex: { envios: 0, dinero: 0 }, correo: { envios: 0, dinero: 0 }, full: { envios: 0, dinero: 0 }, otro: { envios: 0, dinero: 0 }, costoNuestro: 0 }
      let hayEnvios = false
      partes.forEach(p => {
        resumen.ventas += p.resumen.ventas
        resumen.unidades += p.resumen.unidades
        resumen.dinero += p.resumen.dinero
        resumen.canceladas += p.resumen.canceladas
        if (p.resumen.visitas != null) resumen.visitas = (resumen.visitas || 0) + p.resumen.visitas
        p.porDia.forEach(d => {
          const a = dias.get(d.dia) || { dia: d.dia, ventas: 0, unidades: 0, dinero: 0 }
          a.ventas += d.ventas; a.unidades += d.unidades; a.dinero += d.dinero
          dias.set(d.dia, a)
        })
        if (p.tipoEnvio) {
          hayEnvios = true
          ;['flex', 'correo', 'full', 'otro'].forEach(k => {
            envios[k].envios += p.tipoEnvio[k].envios
            envios[k].dinero += p.tipoEnvio[k].dinero
          })
          envios.costoNuestro += p.tipoEnvio.costoNuestro || 0
        }
      })
      resumen.ticket = resumen.ventas ? resumen.dinero / resumen.ventas : 0
      const porDia = [...dias.values()].sort((a, b) => a.dia.localeCompare(b.dia))
      resumen.promedioDia = porDia.length ? resumen.ventas / porDia.length : 0

      setDatos({ resumen, porDia, envios: hayEnvios ? envios : null, cuentas: partes })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const max = datos ? Math.max(1, ...datos.porDia.map(d => d[serie])) : 1
  const ALTO_BARRA = 170 // px
  const etiqueta = { ventas: 'Ventas', unidades: 'Unidades', dinero: 'Dinero' }

  return (
    <div className="metrics">
      <div className="mt-head">
        <div>
          <h1>📊 Métricas</h1>
          <p className="mt-sub">Ventas de MercadoLibre. Todo en hora de Argentina.</p>
        </div>
      </div>

      <div className="mt-filtros">
        <div className="mt-grupo">
          <span className="mt-lbl">Cuenta</span>
          <div className="mt-chips">
            <button className={cuenta === 'ambas' ? 'on' : ''} onClick={() => setCuenta('ambas')}>Ambas</button>
            {cuentas.map(k => (
              <button key={k} className={cuenta === k ? 'on' : ''} onClick={() => setCuenta(k)}>
                {k.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-grupo">
          <span className="mt-lbl">Período</span>
          <div className="mt-chips">
            {RANGOS.map(r => (
              <button key={r.key} className={rango === r.key ? 'on' : ''} onClick={() => setRango(r.key)}>
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <label className={`mt-check ${periodoLargo ? 'off' : ''}`}
          title={periodoLargo
            ? 'Solo hasta 7 días: en períodos largos hay que preguntar miles de envíos uno por uno y no llega a terminar'
            : 'Pregunta el tipo de envío de cada venta: es lo que más tarda'}>
          <input
            type="checkbox"
            checked={pedirEnvios}
            disabled={periodoLargo}
            onChange={e => setConEnvios(e.target.checked)}
          />
          Desglose por tipo de envío {periodoLargo && <em>(hasta 7 días)</em>}
        </label>

        <button className="mt-btn" onClick={cargar} disabled={busy}>
          {busy ? '⏳ Leyendo ventas...' : '📈 Ver métricas'}
        </button>
      </div>

      {error && <div className="mt-error">❌ {error}</div>}
      {busy && <p className="mt-hint">Puede tardar un rato si el período es largo. Dejá la pantalla abierta.</p>}

      {datos && (
        <>
          <div className="mt-cards">
            <div className="mt-card">
              <div className="mt-card-lbl">Ventas</div>
              <div className="mt-card-val">{num(datos.resumen.ventas)}</div>
            </div>
            <div className="mt-card">
              <div className="mt-card-lbl">Unidades</div>
              <div className="mt-card-val">{num(datos.resumen.unidades)}</div>
            </div>
            <div className="mt-card">
              <div className="mt-card-lbl">Dinero transaccionado</div>
              <div className="mt-card-val">{plata(datos.resumen.dinero)}</div>
            </div>
            <div className="mt-card">
              <div className="mt-card-lbl">Ticket promedio</div>
              <div className="mt-card-val">{plata(datos.resumen.ticket)}</div>
            </div>
            <div className="mt-card">
              <div className="mt-card-lbl">Promedio ventas / día</div>
              <div className="mt-card-val">{datos.resumen.promedioDia.toFixed(1).replace('.', ',')}</div>
            </div>
            <div className="mt-card">
              <div className="mt-card-lbl">Canceladas</div>
              <div className="mt-card-val warn">{num(datos.resumen.canceladas)}</div>
            </div>
            {datos.resumen.visitas != null && (
              <div className="mt-card">
                <div className="mt-card-lbl">Visitas</div>
                <div className="mt-card-val">{num(datos.resumen.visitas)}</div>
              </div>
            )}
          </div>

          <div className="mt-panel">
            <div className="mt-panel-head">
              <h2>Evolución</h2>
              <div className="mt-chips">
                {['ventas', 'unidades', 'dinero'].map(k => (
                  <button key={k} className={serie === k ? 'on' : ''} onClick={() => setSerie(k)}>
                    {etiqueta[k]}
                  </button>
                ))}
              </div>
            </div>
            {datos.porDia.length === 0 ? (
              <p className="mt-hint">No hubo ventas en el período.</p>
            ) : (
              <div className={`mt-chart ${datos.porDia.length < 4 ? 'pocos' : ''}`}>
                {datos.porDia.map(d => (
                  <div key={d.dia} className="mt-bar-wrap" title={`${d.dia}: ${serie === 'dinero' ? plata(d.dinero) : num(d[serie])}`}>
                    <div className="mt-bar-val">{serie === 'dinero' ? Math.round(d.dinero / 1000) + 'k' : d[serie]}</div>
                    <div className="mt-bar" style={{ height: `${Math.max(3, Math.round((d[serie] / max) * ALTO_BARRA))}px` }} />
                    <div className="mt-bar-day">{d.dia.slice(8)}/{d.dia.slice(5, 7)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {datos.envios && (
            <div className="mt-panel">
              <h2>Tipo de envío</h2>
              <table className="mt-table">
                <thead>
                  <tr><th>Tipo</th><th>Envíos</th><th>Dinero</th></tr>
                </thead>
                <tbody>
                  <tr><td>🛵 Flex (motos)</td><td>{num(datos.envios.flex.envios)}</td><td>{plata(datos.envios.flex.dinero)}</td></tr>
                  <tr><td>📮 Correo / Colecta</td><td>{num(datos.envios.correo.envios)}</td><td>{plata(datos.envios.correo.dinero)}</td></tr>
                  <tr><td>🏬 Full (bodega ML)</td><td>{num(datos.envios.full.envios)}</td><td>{plata(datos.envios.full.dinero)}</td></tr>
                  {datos.envios.otro.envios > 0 && (
                    <tr><td>Sin envío / otro</td><td>{num(datos.envios.otro.envios)}</td><td>{plata(datos.envios.otro.dinero)}</td></tr>
                  )}
                </tbody>
              </table>
              <p className="mt-hint">Costo de envíos a cargo nuestro: <strong>{plata(datos.envios.costoNuestro)}</strong></p>
            </div>
          )}

          <div className="mt-panel">
            <h2>Reputación por cuenta</h2>
            <table className="mt-table">
              <thead>
                <tr><th>Cuenta</th><th>Operaciones</th><th>Reclamos</th><th>Envíos demorados</th><th>Canceladas</th></tr>
              </thead>
              <tbody>
                {datos.cuentas.map(c => (
                  <tr key={c.key}>
                    <td>{c.key.toUpperCase()} <span className="mt-nick">{c.cuenta}</span></td>
                    <td>{num(c.reputacion.operaciones)}</td>
                    <td>{pct(c.reputacion.reclamos)}</td>
                    <td>{pct(c.reputacion.demorados)}</td>
                    <td>{pct(c.reputacion.cancelacionesRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-hint">Según MercadoLibre, sobre los últimos 60 días.</p>
          </div>
        </>
      )}
    </div>
  )
}
