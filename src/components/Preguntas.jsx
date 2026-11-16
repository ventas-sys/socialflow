import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import './Preguntas.css'

// Preguntas de compradores SIN RESPONDER, de las DOS cuentas en una sola
// pantalla. Está para que cuando Tatiana no pueda, cualquiera con el permiso
// conteste sin tener que entrar a ML ni saber en qué cuenta está la pregunta.
const CUENTAS = [
  { key: 'full', label: 'FULL' },
  { key: 'ferre', label: 'FERRE' },
]

// Cada cuánto se vuelve a mirar si entraron preguntas nuevas. ML pide que se
// conteste rápido, así que de día se mira seguido y de noche casi nada.
const refrescoMs = () => {
  const h = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires', hour: 'numeric', hour12: false,
  }).format(new Date())) % 24
  return (h >= 8 && h < 21) ? 3 * 60 * 1000 : 30 * 60 * 1000
}

const hace = (iso) => {
  const ms = Date.now() - new Date(iso || 0).getTime()
  if (!iso || Number.isNaN(ms)) return ''
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const hs = Math.floor(min / 60)
  if (hs < 24) return `hace ${hs} h`
  const d = Math.floor(hs / 24)
  return `hace ${d} día${d === 1 ? '' : 's'}`
}

// Una pregunta que lleva mucho sin contestar es plata que se va: se marca.
const urgencia = (iso) => {
  const hs = (Date.now() - new Date(iso || 0).getTime()) / 3600000
  if (!iso || Number.isNaN(hs)) return ''
  if (hs >= 24) return 'vieja'
  if (hs >= 4) return 'tibia'
  return ''
}

const pesos = (n) => (n == null ? '' : '$' + Number(n).toLocaleString('es-AR'))

export default function Preguntas({ mlAccounts, ensureToken }) {
  const [items, setItems] = useState([])          // preguntas de las dos cuentas
  const [cargando, setCargando] = useState(false)
  const [primeraVez, setPrimeraVez] = useState(true)
  const [msg, setMsg] = useState('')
  const [fallas, setFallas] = useState([])        // qué cuenta no se pudo leer y por qué
  const [borrador, setBorrador] = useState({})    // preguntaId -> texto que se está escribiendo
  const [enviando, setEnviando] = useState(null)  // preguntaId que se está contestando
  const [filtro, setFiltro] = useState('todas')   // todas | full | ferre
  const [buscar, setBuscar] = useState('')
  const [abiertos, setAbiertos] = useState({})    // preguntaId -> false si se cerró el hilo
  const [verTodo, setVerTodo] = useState({})      // preguntaId -> mostrar todo el historial
  const cargandoRef = useRef(false)

  const alternarHilo = (id) =>
    setAbiertos(p => ({ ...p, [id]: p[id] === false }))

  const conectadas = useMemo(
    () => CUENTAS.filter(c => mlAccounts?.[c.key]?.accessToken),
    [mlAccounts])

  // ensureToken llega como función nueva en cada render de App. Si `traer`
  // dependiera de ella, cambiaría siempre, el efecto se volvería a montar y
  // quedaría pidiendo preguntas sin parar. Por eso va por referencia.
  const tokenRef = useRef(ensureToken); tokenRef.current = ensureToken
  const conectadasRef = useRef(conectadas); conectadasRef.current = conectadas
  // Lo único que de verdad cambia algo: qué cuentas están conectadas.
  const claveCuentas = conectadas.map(c => c.key).join(',')

  const traer = useCallback(async (silencioso = false) => {
    const conectadas = conectadasRef.current
    const ensureToken = tokenRef.current
    if (cargandoRef.current) return
    if (!conectadas.length) {
      setMsg('⚠️ No hay ninguna cuenta de ML conectada. Conectalas desde la solapa ML.')
      setPrimeraVez(false)
      return
    }
    cargandoRef.current = true
    setCargando(true)
    if (!silencioso) setMsg('')
    const juntas = []
    const malas = []
    for (const { key, label } of conectadas) {
      try {
        const token = await ensureToken(key)
        const r = await fetch('/api/ml/exchange?action=preguntas', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        }).then(x => x.json())
        if (!r.ok) throw new Error(r.error || 'no contestó')
        // Si no se pudo leer el listado de la cuenta, los hilos van a venir
        // vacíos: mejor decirlo que dejar pensando que no hay nada anterior.
        if (r.diag && !r.diag.escaneadas) {
          malas.push(`${label}: no se pudo leer el historial de preguntas (las preguntas nuevas sí se ven)`)
        }
        juntas.push(...(r.preguntas || []).map(q => ({ ...q, cuenta: key, cuentaLabel: label })))
      } catch (e) {
        // Que una cuenta falle NO deja sin ver la otra: se avisa cuál falló.
        malas.push(`${label}: ${e.message}`)
      }
    }
    juntas.sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0))
    setItems(juntas)
    setFallas(malas)
    setPrimeraVez(false)
    cargandoRef.current = false
    setCargando(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveCuentas])

  // Al abrir y después cada tanto, según la hora
  useEffect(() => {
    traer(true)
    let t
    const loop = () => { t = setTimeout(() => { traer(true); loop() }, refrescoMs()) }
    loop()
    return () => clearTimeout(t)
  }, [traer])

  const responder = async (q) => {
    const texto = (borrador[q.id] || '').trim()
    if (!texto) { setMsg('⚠️ Escribí la respuesta antes de enviarla.'); return }
    // ML NO deja editar ni borrar una respuesta publicada. Por eso se confirma.
    const ok = window.confirm(
      `Se publica en ${q.cuentaLabel} y NO se puede editar ni borrar después.\n\n` +
      `Pregunta: ${q.texto}\n\nTu respuesta: ${texto}\n\n¿Enviar?`)
    if (!ok) return
    setEnviando(q.id)
    setMsg('')
    try {
      const token = await ensureToken(q.cuenta)
      const r = await fetch('/api/ml/exchange?action=responder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, preguntaId: q.id, texto }),
      }).then(x => x.json())
      if (!r.ok) throw new Error(r.error || 'no se pudo enviar')
      // Sale de la lista: ya está contestada.
      setItems(prev => prev.filter(x => x.id !== q.id))
      setBorrador(prev => { const n = { ...prev }; delete n[q.id]; return n })
      setMsg(`✅ Respondida en ${q.cuentaLabel}.`)
    } catch (e) {
      setMsg('❌ No se pudo responder: ' + e.message)
    } finally {
      setEnviando(null)
    }
  }

  const visibles = useMemo(() => {
    const t = buscar.trim().toLowerCase()
    return items.filter(q => {
      if (filtro !== 'todas' && q.cuenta !== filtro) return false
      if (!t) return true
      return [q.texto, q.pub?.titulo, q.mla, q.comprador].join(' ').toLowerCase().includes(t)
    })
  }, [items, filtro, buscar])

  const porCuenta = (key) => items.filter(q => q.cuenta === key).length

  return (
    <div className="preg-container">
      <div className="preg-header">
        <div>
          <h1>💬 Preguntas</h1>
          <p>
            Las preguntas sin responder de las dos cuentas, juntas y de la más nueva a la
            más vieja, con lo que ese comprador ya había preguntado antes. Lo que contestás
            acá se publica en Mercado Libre y <strong>no se puede editar ni borrar</strong>.
          </p>
        </div>
        <div className="preg-acciones">
          <button className="preg-btn-refresh" onClick={() => traer(false)} disabled={cargando}>
            {cargando ? '⏳ Buscando...' : '🔄 Buscar preguntas'}
          </button>
        </div>
      </div>

      {msg && <div className={`preg-msg ${msg.startsWith('✅') ? 'ok' : 'warn'}`}>{msg}</div>}
      {fallas.map(f => <div key={f} className="preg-msg warn">⚠️ {f}</div>)}
      {cargando && !primeraVez && <div className="preg-fondo">⏳ Mirando si entraron preguntas nuevas…</div>}

      <div className="preg-filtros">
        <div className="preg-tabs">
          <button className={filtro === 'todas' ? 'active' : ''} onClick={() => setFiltro('todas')}>
            Todas ({items.length})
          </button>
          {CUENTAS.map(c => (
            <button key={c.key}
              className={filtro === c.key ? 'active' : ''}
              onClick={() => setFiltro(c.key)}
              disabled={!conectadas.some(x => x.key === c.key)}>
              {c.label} ({porCuenta(c.key)})
            </button>
          ))}
        </div>
        <input className="preg-buscar" placeholder="🔍 Buscar por pregunta, producto o código..."
          value={buscar} onChange={e => setBuscar(e.target.value)} />
      </div>

      {primeraVez && cargando && <div className="preg-vacio">⏳ Trayendo las preguntas…</div>}

      {!primeraVez && !visibles.length && (
        <div className="preg-vacio">
          {items.length
            ? 'Ninguna pregunta coincide con el filtro.'
            : '🎉 No hay preguntas sin responder.'}
        </div>
      )}

      <div className="preg-lista">
        {visibles.map(q => (
          <div key={q.id} className={`preg-item ${urgencia(q.fecha)}`}>
            <div className="preg-item-top">
              <span className={`preg-cuenta ${q.cuenta}`}>{q.cuentaLabel}</span>
              {q.comprador && <span className="preg-comprador">👤 {q.comprador}</span>}
              <span className="preg-fecha">{hace(q.fecha)}</span>
              {urgencia(q.fecha) === 'vieja' && <span className="preg-alerta">⚠️ más de un día sin contestar</span>}
            </div>

            <div className="preg-pub">
              {q.pub?.foto && <img src={q.pub.foto} alt="" className="preg-foto" loading="lazy" />}
              <div className="preg-pub-datos">
                {q.pub
                  ? (
                    <>
                      <a href={q.pub.link} target="_blank" rel="noreferrer" className="preg-titulo">
                        {q.pub.titulo}
                      </a>
                      <div className="preg-meta">
                        {pesos(q.pub.precio)}
                        {q.pub.stock != null && (
                          <span className={q.pub.stock > 0 ? 'preg-stock' : 'preg-stock cero'}>
                            {q.pub.stock > 0 ? `${q.pub.stock} en stock` : 'SIN STOCK'}
                          </span>
                        )}
                        <span className="preg-mla">{q.mla}</span>
                      </div>
                    </>
                  )
                  : <span className="preg-meta">Publicación {q.mla || '—'} (no se pudieron traer los datos)</span>}
              </div>
            </div>

            <div className="preg-texto">{q.texto}</div>

            {/* El hilo anterior con ESTE comprador. Va abierto porque muchas
                preguntas no se entienden solas, y es justo cuando hace falta. */}
            {!!q.historial?.length && (
              <div className="preg-hilo">
                <button className="preg-hilo-tit" onClick={() => alternarHilo(q.id)}>
                  {abiertos[q.id] === false ? '▸' : '▾'} Preguntas anteriores
                  {q.comprador ? ` de ${q.comprador}` : ' de este comprador'} ({q.historial.length})
                </button>
                {abiertos[q.id] !== false && (
                  <>
                    {(verTodo[q.id] ? q.historial : q.historial.slice(0, 3)).map(h => (
                      <div key={h.id} className="preg-hilo-item">
                        <div className="preg-hilo-q">
                          <span className="preg-hilo-ico">💬</span>
                          <span>{h.texto}</span>
                          <span className="preg-hilo-fecha">{hace(h.fecha)}</span>
                        </div>
                        {h.respuesta
                          ? (
                            <div className="preg-hilo-r">
                              <span className="preg-hilo-ico">↳</span>
                              <span>{h.respuesta}</span>
                              <span className="preg-hilo-fecha">{hace(h.respuestaFecha)}</span>
                            </div>
                          )
                          : <div className="preg-hilo-r sin">↳ sin responder</div>}
                        {h.mla && h.mla !== q.mla && (
                          <div className="preg-hilo-otra">sobre otra publicación: {h.mla}</div>
                        )}
                      </div>
                    ))}
                    {q.historial.length > 3 && !verTodo[q.id] && (
                      <button className="preg-hilo-mas"
                        onClick={() => setVerTodo(p => ({ ...p, [q.id]: true }))}>
                        Ver las {q.historial.length} anteriores
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            <textarea
              className="preg-respuesta"
              placeholder="Escribí la respuesta..."
              rows={3}
              maxLength={2000}
              value={borrador[q.id] || ''}
              onChange={e => setBorrador(prev => ({ ...prev, [q.id]: e.target.value }))}
            />
            <div className="preg-item-pie">
              <span className="preg-largo">{(borrador[q.id] || '').length}/2000</span>
              <button
                className="preg-btn-enviar"
                onClick={() => responder(q)}
                disabled={enviando === q.id || !(borrador[q.id] || '').trim()}>
                {enviando === q.id ? '⏳ Enviando...' : '📨 Responder'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
