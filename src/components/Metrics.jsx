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
  // La plata de las ventas se pide aparte: hay que leer pago por pago y tarda
  const [plata2, setPlata2] = useState(null)
  const [plataBusy, setPlataBusy] = useState(false)
  const [plataMsg, setPlataMsg] = useState('')
  // Próximos cobros: el calendario de lo que ML va a depositar
  const [cobros, setCobros] = useState(null)
  const [cobrosBusy, setCobrosBusy] = useState(false)
  const [cobrosMsg, setCobrosMsg] = useState('')
  const [mesVisto, setMesVisto] = useState(() => new Date().toISOString().slice(0, 7))
  // Saldo real de Mercado Pago (necesita el Access Token propio de MP)
  const [saldos, setSaldos] = useState(null)
  const [saldosBusy, setSaldosBusy] = useState(false)

  const cuentas = ['full', 'ferre'].filter(k => mlAccounts?.[k]?.accessToken)
  // El tipo de envío hay que preguntárselo a ML envío por envío: en 15 o 30
  // días son miles de consultas y la función se corta antes de terminar
  const periodoLargo = rango === '15' || rango === '30'
  const pedirEnvios = conEnvios && !periodoLargo

  // Saldo real de cada cuenta de Mercado Pago. Con el token de ML da 403, así
  // que usa el Access Token de MP que se carga en la ficha de la cuenta (ML).
  const cargarSaldos = async () => {
    setSaldosBusy(true); setSaldos(null)
    try {
      const salida = []
      for (const key of cuentas) {
        const acc = mlAccounts[key] || {}
        const res = await fetch(`${API}?action=mpsaldo`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mpToken: acc.mpToken || '' }),
        }).then(x => x.json())
        salida.push({ key, ...res })
      }
      setSaldos(salida)
    } catch (err) {
      setSaldos([{ key: 'error', error: err.message }])
    } finally {
      setSaldosBusy(false)
    }
  }

  // El calendario de lo que ML va a depositar, día por día y por cuenta.
  // Se piden los próximos 90 días de una y después se navega por mes sin
  // volver a consultar.
  const cargarCobros = async () => {
    setCobrosBusy(true); setCobrosMsg(''); setCobros(null)
    try {
      if (!cuentas.length) throw new Error('No hay cuentas de MercadoLibre conectadas.')
      const partes = []
      for (const key of cuentas) {
        const token = await ensureToken(key)
        const res = await fetch(`${API}?action=mpcobros`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, dias: 90 }),
        }).then(x => x.json())
        if (!res.ok) throw new Error(`${key.toUpperCase()}: ${res.error || 'Error'}`)
        partes.push({ key, ...res })
      }
      // Un renglón por día con lo de cada cuenta y el total
      const dias = new Map()
      partes.forEach(p => {
        (p.dias || []).forEach(d => {
          const x = dias.get(d.dia) || { dia: d.dia, total: 0, pagos: 0 }
          x[p.key] = (x[p.key] || 0) + d.monto
          x.total += d.monto
          x.pagos += d.pagos
          dias.set(d.dia, x)
        })
      })
      const lista = [...dias.values()].sort((a, b) => a.dia.localeCompare(b.dia))
      setCobros({ dias: lista, cuentas: partes })
      setMesVisto(lista[0]?.dia.slice(0, 7) || new Date().toISOString().slice(0, 7))
      if (!lista.length) setCobrosMsg('ML no informó cobros por venir.')
    } catch (err) {
      setCobrosMsg('❌ ' + err.message)
    } finally {
      setCobrosBusy(false)
    }
  }

  // Cuánto entró, cuánto se lleva ML y cuándo se libera el resto.
  // El saldo de Mercado Pago da 403 con el token de ML, así que esto se calcula
  // sumando los pagos: cada uno trae su comisión, su neto y su fecha de
  // liberación. Es la plata DE LAS VENTAS del período, no el saldo de la cuenta
  // (no incluye retiros ni movimientos que no vengan de ventas).
  const cargarPlata = async () => {
    setPlataBusy(true); setPlataMsg(''); setPlata2(null)
    try {
      const r = RANGOS.find(x => x.key === rango)
      const from = inicioDiaAR(r.dias).toISOString()
      const to = new Date().toISOString()
      const cuales = cuenta === 'ambas' ? cuentas : [cuenta]
      if (!cuales.length) throw new Error('No hay cuentas de MercadoLibre conectadas.')

      const partes = []
      for (const key of cuales) {
        const token = await ensureToken(key)
        const res = await fetch(`${API}?action=mpdinero`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, desde: from, hasta: to }),
        }).then(x => x.json())
        if (!res.ok) throw new Error(`${key.toUpperCase()}: ${res.error || 'Error'}`)
        partes.push({ key, ...res })
      }

      const total = { pagos: 0, bruto: 0, comisionML: 0, costoEnvio: 0, otrosCargos: 0, neto: 0, liberado: 0, aLiquidar: 0 }
      const dias = new Map()
      partes.forEach(p => {
        ;['pagos', 'bruto', 'comisionML', 'costoEnvio', 'otrosCargos', 'neto', 'liberado', 'aLiquidar']
          .forEach(k => { total[k] += Number(p[k]) || 0 })
        ;(p.calendario || []).forEach(d => {
          const x = dias.get(d.dia) || { dia: d.dia, monto: 0, pagos: 0 }
          x.monto += d.monto; x.pagos += d.pagos
          dias.set(d.dia, x)
        })
      })
      const calendario = [...dias.values()].sort((a, b) => a.dia.localeCompare(b.dia))
      setPlata2({ total, calendario, cuentas: partes })
      if (!total.pagos) setPlataMsg('No hubo pagos aprobados en el período elegido.')
    } catch (err) {
      setPlataMsg('❌ ' + err.message)
    } finally {
      setPlataBusy(false)
    }
  }

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
              <div className="mt-table-wrap">
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
              </div>
              <p className="mt-hint">Costo de envíos a cargo nuestro: <strong>{plata(datos.envios.costoNuestro)}</strong></p>
            </div>
          )}

          <div className="mt-panel">
            <h2>💳 Saldo en Mercado Pago</h2>
            <p className="mt-hint">
              El saldo real de cada cuenta. ML no lo deja leer con su permiso, así que hace falta cargar el
              <strong> Access Token de Mercado Pago</strong> de cada cuenta en la solapa 🛒 ML.
            </p>
            <button className="mt-btn" onClick={cargarSaldos} disabled={saldosBusy}>
              {saldosBusy ? '⏳ Consultando...' : '💳 Ver saldos'}
            </button>

            {saldos && (
              <div className="mt-saldos">
                {saldos.map(s => (
                  <div className={`mt-saldo ${s.saldo ? 'ok' : 'no'}`} key={s.key}>
                    <span className="mt-saldo-cuenta">{s.key.toUpperCase()}</span>
                    {s.saldo ? (
                      <>
                        <div className="mt-saldo-fila"><span>En la cuenta</span><strong>{plata(s.saldo.total)}</strong></div>
                        <div className="mt-saldo-fila"><span>Disponible</span><strong className="verde">{plata(s.saldo.disponible)}</strong></div>
                        <div className="mt-saldo-fila"><span>A liquidar</span><strong className="naranja">{plata(s.saldo.aLiquidar)}</strong></div>
                        {s.tokenDe?.nickname && <p className="mt-hint">Token de {s.tokenDe.nickname}</p>}
                      </>
                    ) : s.falta === 'mpToken' ? (
                      <p className="mt-saldo-falta">
                        Falta el Access Token de Mercado Pago. Cargalo en 🛒 ML, en la ficha de esta cuenta.
                      </p>
                    ) : (
                      <>
                        <p className="mt-saldo-falta">Mercado Pago no devolvió el saldo.</p>
                        {(s.intentos || []).map(i => (
                          <p className="mt-hint" key={i.nombre}>{i.nombre}: {i.estado} — {String(i.cuerpo).slice(0, 120)}</p>
                        ))}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-panel">
            <h2>📆 Próximos cobros</h2>
            <p className="mt-hint">
              Lo que ML te va a depositar, día por día. Mira para adelante: entra todo lo que está por
              liberarse, sin importar cuándo se vendió. No depende del período elegido arriba.
            </p>
            <button className="mt-btn" onClick={cargarCobros} disabled={cobrosBusy}>
              {cobrosBusy ? '⏳ Leyendo los pagos...' : '📆 Ver el calendario'}
            </button>
            {cobrosMsg && <p className={`mt-hint ${cobrosMsg.startsWith('❌') ? 'warn' : ''}`}>{cobrosMsg}</p>}

            {cobros && cobros.dias.length > 0 && (() => {
              const delMes = cobros.dias.filter(d => d.dia.startsWith(mesVisto))
              const meses = [...new Set(cobros.dias.map(d => d.dia.slice(0, 7)))]
              const i = meses.indexOf(mesVisto)
              const nombreMes = new Date(mesVisto + '-02').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
              const totalMes = delMes.reduce((s, d) => s + d.total, 0)
              const porCuenta = cobros.cuentas.map(c => ({
                key: c.key,
                monto: delMes.reduce((s, d) => s + (d[c.key] || 0), 0),
              }))
              return (
                <>
                  <div className="mt-mes">
                    <button onClick={() => setMesVisto(meses[i - 1])} disabled={i <= 0}>‹</button>
                    <span>{nombreMes}</span>
                    <button onClick={() => setMesVisto(meses[i + 1])} disabled={i >= meses.length - 1}>›</button>
                  </div>

                  <div className="mt-cobrar">
                    <span>A cobrar en {nombreMes}</span>
                    <strong>{plata(totalMes)}</strong>
                    <div className="mt-cobrar-cuentas">
                      {porCuenta.map(c => (
                        <span key={c.key}>{c.key.toUpperCase()}: <b>{plata(c.monto)}</b></span>
                      ))}
                    </div>
                  </div>

                  <div className="mt-table-wrap">
                    <table className="mt-table mt-cal">
                      <thead>
                        <tr>
                          <th>Día</th>
                          {cobros.cuentas.map(c => <th key={c.key}>{c.key.toUpperCase()}</th>)}
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {delMes.map(d => {
                          const f = new Date(d.dia + 'T12:00:00')
                          const hoy = new Date().toISOString().slice(0, 10)
                          return (
                            <tr key={d.dia} className={d.dia === hoy ? 'hoy' : ''}>
                              <td>
                                <strong>{f.toLocaleDateString('es-AR', { weekday: 'long' })} {f.getDate()}</strong>
                              </td>
                              {cobros.cuentas.map(c => (
                                <td key={c.key} className="mt-num">{d[c.key] ? plata(d[c.key]) : '—'}</td>
                              ))}
                              <td className="mt-num mt-verde">{plata(d.total)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td><strong>Total del mes</strong></td>
                          {porCuenta.map(c => <td key={c.key} className="mt-num"><strong>{plata(c.monto)}</strong></td>)}
                          <td className="mt-num mt-verde"><strong>{plata(totalMes)}</strong></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <p className="mt-hint">
                    Son los próximos 90 días. Es lo que ML libera por ventas ya cobradas: no incluye
                    adelantos ni descuentos que ML te aplique después.
                  </p>
                </>
              )
            })()}
          </div>

          <div className="mt-panel">
            <h2>💵 La plata de estas ventas</h2>
            <p className="mt-hint">
              Cuánto entró, cuánto se lleva ML y cuándo te liberan el resto. Se lee pago por pago,
              así que en períodos largos tarda un rato.
            </p>
            <button className="mt-btn" onClick={cargarPlata} disabled={plataBusy}>
              {plataBusy ? '⏳ Leyendo los pagos...' : '💵 Calcular'}
            </button>
            {plataMsg && <p className={`mt-hint ${plataMsg.startsWith('❌') ? 'warn' : ''}`}>{plataMsg}</p>}

            {plata2 && plata2.total.pagos > 0 && (
              <>
                <div className="mt-plata">
                  <div className="mt-plata-item"><span>Venta bruta</span><strong>{plata(plata2.total.bruto)}</strong></div>
                  <div className="mt-plata-item neg"><span>Comisión de ML</span><strong>− {plata(plata2.total.comisionML)}</strong></div>
                  <div className="mt-plata-item neg"><span>Costo de envíos</span><strong>− {plata(plata2.total.costoEnvio)}</strong></div>
                  {plata2.total.otrosCargos > 0 && (
                    <div className="mt-plata-item neg"><span>Otros cargos</span><strong>− {plata(plata2.total.otrosCargos)}</strong></div>
                  )}
                  <div className="mt-plata-item fuerte"><span>Neto para vos</span><strong>{plata(plata2.total.neto)}</strong></div>
                  <div className="mt-plata-item ok"><span>Ya liberado</span><strong>{plata(plata2.total.liberado)}</strong></div>
                  <div className="mt-plata-item pend"><span>Falta liberar</span><strong>{plata(plata2.total.aLiquidar)}</strong></div>
                </div>

                {plata2.cuentas.length > 1 && (
                  <div className="mt-table-wrap">
                    <table className="mt-table">
                      <thead>
                        <tr><th>Cuenta</th><th>Bruto</th><th>Comisión</th><th>Envíos</th><th>Neto</th><th>Falta liberar</th></tr>
                      </thead>
                      <tbody>
                        {plata2.cuentas.map(c => (
                          <tr key={c.key}>
                            <td><strong>{c.key.toUpperCase()}</strong></td>
                            <td>{plata(c.bruto)}</td>
                            <td>− {plata(c.comisionML)}</td>
                            <td>− {plata(c.costoEnvio)}</td>
                            <td><strong>{plata(c.neto)}</strong></td>
                            <td>{plata(c.aLiquidar)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {plata2.calendario.length > 0 && (
                  <>
                    <h3 className="mt-sub">📆 Cuándo entra lo que falta liberar</h3>
                    <div className="mt-table-wrap">
                      <table className="mt-table">
                        <thead><tr><th>Día</th><th>Pagos</th><th>Te entran</th></tr></thead>
                        <tbody>
                          {plata2.calendario.slice(0, 20).map(d => (
                            <tr key={d.dia}>
                              <td>{d.dia.split('-').reverse().join('/')}</td>
                              <td>{num(d.pagos)}</td>
                              <td><strong>{plata(d.monto)}</strong></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {plata2.calendario.length > 20 && (
                      <p className="mt-hint">Hay {plata2.calendario.length - 20} fechas más.</p>
                    )}
                  </>
                )}

                <p className="mt-hint">
                  ⚠️ Esto es la plata <strong>de las ventas del período</strong>, no el saldo de la cuenta:
                  no incluye retiros ni movimientos que no vengan de ventas. El saldo en sí ML no lo deja leer
                  con este permiso.
                </p>
              </>
            )}
          </div>

          <div className="mt-panel">
            <h2>Reputación por cuenta</h2>
            <div className="mt-table-wrap">
              <table className="mt-table">
                <thead>
                  <tr><th>Cuenta</th><th>Oper.</th><th>Reclamos</th><th>Demorados</th><th>Cancel.</th></tr>
                </thead>
                <tbody>
                  {datos.cuentas.map(c => (
                    <tr key={c.key}>
                      <td>
                        <strong>{c.key.toUpperCase()}</strong>
                        <div className="mt-nick">{c.cuenta}</div>
                      </td>
                      <td>{num(c.reputacion.operaciones)}</td>
                      <td>{pct(c.reputacion.reclamos)}</td>
                      <td>{pct(c.reputacion.demorados)}</td>
                      <td>{pct(c.reputacion.cancelacionesRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-hint">Según MercadoLibre, sobre los últimos 60 días.</p>
          </div>
        </>
      )}
    </div>
  )
}
