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

// Colores para los botones de respuesta rápida
const COLORES = [
  { key: 'azul', hex: '#6cb3ec' },
  { key: 'rosa', hex: '#f78fb3' },
  { key: 'verde', hex: '#a8d98b' },
  { key: 'lila', hex: '#a78bfa' },
  { key: 'amarillo', hex: '#f5c518' },
  { key: 'violeta', hex: '#b39ddb' },
  { key: 'fucsia', hex: '#f48fb1' },
  { key: 'verdeagua', hex: '#80b9b4' },
]
const hexDe = (c) => (COLORES.find(x => x.key === c) || COLORES[0]).hex

// Lo que se usa mientras no haya nada guardado. Los textos los carga el
// usuario desde "Administrar"; acá sólo quedan los botones armados para que
// la pantalla no arranque vacía.
// Lo que se usa mientras no haya nada guardado: el saludo, el cierre y las
// respuestas rápidas tal como se venían usando. Se editan desde "Administrar"
// y quedan guardadas para todos los que contesten, en cualquier aparato.
const RETIRO = 'Retiro en Floresta: Estamos ubicados cerca de la estación de Floresta, ' +
  'lo cual facilita tu visita. Horario para Retiro: Lunes a Viernes: 14 a 17.30 hs. Sábados: 10 a 13 hs.'
const CONFIG_VACIA = {
  saludo: '¡Hola! ¿Cómo andás? 👋',
  cierre: 'Cualquier cosa que necesites, escribinos sin problema. ¡Gracias por elegirnos!',
  rapidas: [
    { id: 'r1', titulo: 'HAY STOCK', color: 'azul',
      texto: 'Tenemos suficiente stock disponible, así que puedes ofertar sin preocupaciones. ' + RETIRO },
    { id: 'r2', titulo: 'MEDIDAS Y +', color: 'rosa',
      texto: 'En la tercera foto muestra las medidas y detalles adicionales que pueden ser útiles ' +
        'para comparar o evaluar el producto, confirmando si es lo que estás buscando' },
    { id: 'r3', titulo: 'PASATE!', color: 'verde',
      texto: 'Sera un error de MercadoLibre. Tenemos suficiente stock disponible, así que puedes ' +
        'ofertar sin preocupaciones. ' + RETIRO },
    { id: 'r4', titulo: 'A CARRITO', color: 'lila',
      texto: 'Te recomendaría agregar todos los artículos al carrito de compras antes de finalizar ' +
        'tu pedido. De esta manera, aseguras que todos los productos, se enviarán juntos. Por esta ' +
        'semana Recorda que podes poner CUALQUIER articulo FULL y llegar al envio GRATIS aunque no ' +
        'sea de nosotros...Aprovechalo!!' },
    { id: 'r5', titulo: 'ENVIOS', color: 'amarillo',
      texto: 'Revisa las opciones de envío ya que ofrecemos diferentes opciones de envío, como correo ' +
        'estándar o entrega urgente en el día mediante servicio de moto. Selecciona la opción que ' +
        'mejor se adapta a tus necesidades y plazos.' },
    { id: 'r6', titulo: 'X MAYOR', color: 'violeta',
      texto: 'Tenemos cantidad y te podemos hacer un buen descuento q se pasa x mail. Mira nuestro ' +
        'perfil de vendedor, desde "Ver más datos de este vendedor"' },
    { id: 'r7', titulo: 'CUBRE PILETA', color: 'fucsia',
      texto: 'Es tela plastica Nacional Reforzada c Todo Elastico en 100mc' },
    { id: 'r8', titulo: 'FACTURA', color: 'verdeagua',
      texto: 'Generamos facturas tipo A o B según sea necesario, si es para otro CUIT despues de ' +
        'recibir la compra podes pedir el cambio.' },
  ],
}

// Arma la respuesta final: saludo + lo escrito + cierre, sólo lo tildado.
const armar = ({ saludo, cuerpo, cierre, conSaludo, conCierre }) =>
  [conSaludo && saludo?.trim(), cuerpo?.trim(), conCierre && cierre?.trim()]
    .filter(Boolean).join('\n\n')

export default function Preguntas({ mlAccounts, ensureToken, config, onSaveConfig, canEdit = true }) {
  const cfg = useMemo(() => ({ ...CONFIG_VACIA, ...(config || {}) }), [config])
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
  const [sinSaludo, setSinSaludo] = useState({})  // preguntaId -> true si se destildó el saludo
  const [sinCierre, setSinCierre] = useState({})  // preguntaId -> true si se destildó el cierre
  const [foco, setFoco] = useState(null)          // pregunta en la que se está escribiendo
  const [admin, setAdmin] = useState(false)       // modal de respuestas rápidas
  const cargandoRef = useRef(false)

  // Pega el texto de una respuesta rápida donde se está escribiendo. Suma,
  // no pisa: muchas veces se arma la respuesta con dos o tres.
  const pegar = (texto) => {
    const id = foco
    if (!id) { setMsg('⚠️ Tocá primero el cuadro de respuesta de la pregunta que querés contestar.'); return }
    setBorrador(p => {
      const hay = (p[id] || '').trim()
      return { ...p, [id]: hay ? `${hay}\n\n${texto}` : texto }
    })
  }

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

  // Lo que realmente se va a publicar: saludo + lo escrito + cierre, con lo
  // que esté tildado en esa pregunta.
  const textoFinal = (q) => armar({
    saludo: cfg.saludo, cierre: cfg.cierre, cuerpo: borrador[q.id] || '',
    conSaludo: sinSaludo[q.id] !== true,
    conCierre: sinCierre[q.id] !== true,
  })

  const responder = async (q) => {
    const texto = textoFinal(q)
    if (!(borrador[q.id] || '').trim()) { setMsg('⚠️ Escribí la respuesta antes de enviarla.'); return }
    // ML NO deja editar ni borrar una respuesta publicada. Por eso se confirma
    // mostrando EXACTAMENTE lo que se va a publicar, saludo y cierre incluidos.
    const ok = window.confirm(
      `Se publica en ${q.cuentaLabel} y NO se puede editar ni borrar después.\n\n` +
      `Pregunta: ${q.texto}\n\n--- Se publica esto ---\n${texto}\n\n¿Enviar?`)
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

      <div className="preg-cuerpo">
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
                        Ver {q.historial.length - 3} más
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Saludo de arriba: va tildado, se destilda por pregunta */}
            <label className="preg-fijo">
              <input type="checkbox"
                checked={sinSaludo[q.id] !== true}
                onChange={e => setSinSaludo(p => ({ ...p, [q.id]: !e.target.checked }))} />
              <span>{cfg.saludo}</span>
            </label>

            <textarea
              className="preg-respuesta"
              placeholder="Escribí la respuesta..."
              rows={3}
              maxLength={2000}
              value={borrador[q.id] || ''}
              onFocus={() => setFoco(q.id)}
              onChange={e => { setFoco(q.id); setBorrador(prev => ({ ...prev, [q.id]: e.target.value })) }}
            />

            {/* Cierre de abajo */}
            <label className="preg-fijo">
              <input type="checkbox"
                checked={sinCierre[q.id] !== true}
                onChange={e => setSinCierre(p => ({ ...p, [q.id]: !e.target.checked }))} />
              <span>{cfg.cierre}</span>
            </label>

            <div className="preg-item-pie">
              {/* ML corta en 2000: se cuenta TODO lo que se va a publicar */}
              <span className={`preg-largo ${textoFinal(q).length > 2000 ? 'pasado' : ''}`}>
                {textoFinal(q).length}/2000 con saludo y cierre
              </span>
              <button
                className="preg-btn-enviar"
                onClick={() => responder(q)}
                disabled={enviando === q.id || !(borrador[q.id] || '').trim() || textoFinal(q).length > 2000}>
                {enviando === q.id ? '⏳ Enviando...' : '📨 Responder'}
              </button>
            </div>
          </div>
        ))}
      </div>

        {/* Panel de respuestas rápidas. Se toca el cuadro de una pregunta y
            después el botón: el texto se suma a lo que ya haya escrito. */}
        <aside className="preg-panel">
          <h3>Respuestas rápidas</h3>
          {canEdit && (
            <button className="preg-admin" onClick={() => setAdmin(true)}>✏️ Administrar</button>
          )}
          <div className="preg-rapidas">
            {cfg.rapidas.map(r => (
              <button key={r.id} className="preg-rapida"
                style={{ background: hexDe(r.color) }}
                title={r.texto || '(sin texto — cargalo en Administrar)'}
                onClick={() => pegar(r.texto)}
                disabled={!r.texto}>
                {r.titulo}
              </button>
            ))}
          </div>
          {!foco && <p className="preg-panel-tip">Tocá el cuadro de respuesta de una pregunta y después el botón.</p>}
        </aside>
      </div>

      {admin && (
        <AdminRapidas
          cfg={cfg}
          onCerrar={() => setAdmin(false)}
          onGuardar={async (nuevo) => { await onSaveConfig?.(nuevo); setAdmin(false); setMsg('✅ Respuestas rápidas guardadas.') }}
        />
      )}
    </div>
  )
}

// --- Administrar: saludo, cierre y las respuestas rápidas ---
// Se guarda en el sistema, así que vale para todos los que contesten y en
// cualquier aparato. Sólo entra quien tenga permiso para editar.
function AdminRapidas({ cfg, onCerrar, onGuardar }) {
  const [saludo, setSaludo] = useState(cfg.saludo || '')
  const [cierre, setCierre] = useState(cfg.cierre || '')
  const [lista, setLista] = useState(cfg.rapidas || [])
  const [nTitulo, setNTitulo] = useState('')
  const [nColor, setNColor] = useState('azul')
  const [nTexto, setNTexto] = useState('')
  const [guardando, setGuardando] = useState(false)

  const cambiar = (id, campo, valor) =>
    setLista(p => p.map(r => (r.id === id ? { ...r, [campo]: valor } : r)))
  const borrar = (id) => {
    const r = lista.find(x => x.id === id)
    if (window.confirm(`¿Borrar la respuesta rápida "${r?.titulo}"?`)) {
      setLista(p => p.filter(x => x.id !== id))
    }
  }
  const mover = (i, delta) => setLista(p => {
    const n = [...p]
    const j = i + delta
    if (j < 0 || j >= n.length) return p
    ;[n[i], n[j]] = [n[j], n[i]]
    return n
  })
  const agregar = () => {
    if (!nTitulo.trim() || !nTexto.trim()) return
    setLista(p => [...p, {
      id: 'r' + Date.now(), titulo: nTitulo.trim().toUpperCase(), color: nColor, texto: nTexto.trim(),
    }])
    setNTitulo(''); setNTexto(''); setNColor('azul')
  }

  const guardar = async () => {
    setGuardando(true)
    try { await onGuardar({ saludo: saludo.trim(), cierre: cierre.trim(), rapidas: lista }) }
    finally { setGuardando(false) }
  }

  return (
    <div className="preg-modal-fondo" onClick={onCerrar}>
      <div className="preg-modal" onClick={e => e.stopPropagation()}>
        <div className="preg-modal-top">
          <h2>Respuestas rápidas</h2>
          <button className="preg-cerrar" onClick={onCerrar}>✕</button>
        </div>

        <label className="preg-campo">Saludo (va arriba de cada respuesta)
          <input value={saludo} onChange={e => setSaludo(e.target.value)} />
        </label>
        <label className="preg-campo">Cierre (va abajo de cada respuesta)
          <textarea rows={2} value={cierre} onChange={e => setCierre(e.target.value)} />
        </label>

        <div className="preg-nueva">
          <div className="preg-nueva-izq">
            <input className="preg-nombre" placeholder="NOMBRE" value={nTitulo}
              onChange={e => setNTitulo(e.target.value)}
              style={{ background: hexDe(nColor) }} />
            <div className="preg-colores">
              {COLORES.map(c => (
                <button key={c.key}
                  className={`preg-color ${nColor === c.key ? 'elegido' : ''}`}
                  style={{ background: c.hex }}
                  title={c.key}
                  onClick={() => setNColor(c.key)} />
              ))}
            </div>
          </div>
          <textarea className="preg-nueva-texto" rows={3}
            placeholder="Ingresá una nueva respuesta rápida"
            value={nTexto} onChange={e => setNTexto(e.target.value)} />
          <button className="preg-agregar" onClick={agregar}
            disabled={!nTitulo.trim() || !nTexto.trim()}>Agregar</button>
        </div>

        <div className="preg-admin-lista">
          {lista.map((r, i) => (
            <div key={r.id} className="preg-admin-fila">
              <div className="preg-admin-izq">
                <input className="preg-nombre" value={r.titulo}
                  onChange={e => cambiar(r.id, 'titulo', e.target.value)}
                  style={{ background: hexDe(r.color) }} />
                <div className="preg-colores">
                  {COLORES.map(c => (
                    <button key={c.key}
                      className={`preg-color ${r.color === c.key ? 'elegido' : ''}`}
                      style={{ background: c.hex }}
                      onClick={() => cambiar(r.id, 'color', c.key)} />
                  ))}
                </div>
              </div>
              <textarea className="preg-admin-texto" rows={3} value={r.texto}
                onChange={e => cambiar(r.id, 'texto', e.target.value)} />
              <div className="preg-admin-acciones">
                <button onClick={() => mover(i, -1)} disabled={i === 0} title="Subir">↑</button>
                <button onClick={() => mover(i, 1)} disabled={i === lista.length - 1} title="Bajar">↓</button>
                <button onClick={() => borrar(r.id)} title="Borrar">🗑️</button>
              </div>
            </div>
          ))}
        </div>

        <div className="preg-modal-pie">
          <button className="preg-cancelar" onClick={onCerrar}>Cancelar</button>
          <button className="preg-guardar" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
