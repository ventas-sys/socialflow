import React, { useState, useMemo, useRef, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { findProductOrCombo } from '../utils/refMatch'
import Scanner from './Scanner'
import LazyThumb from './LazyThumb'
import './FullShipment.css'

// Armado del envío a bodega FULL. El depósito escanea artículo por artículo
// (código del combo o código de barras del producto): cada escaneo suma una
// unidad al envío y, al descontar, sale del stock. En paralelo se compara
// contra el listado que pidió ML para saber cuánto falta para que salga
// completo.

const normalize = (s) =>
  String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

// Encabezados posibles del Excel que baja ML del envío a Full
const COLS_REF = ['sku', 'codigo', 'codigo universal', 'codigo de barras', 'publicacion', 'nro de publicacion',
  'n de publicacion', 'numero de publicacion', 'codigo de publicacion', 'mla', 'sku del producto',
  'codigo sku', 'identificador']
const COLS_QTY = ['cantidad', 'unidades', 'stock', 'cantidad a enviar', 'unidades a enviar', 'qty',
  'stock a enviar', 'cantidad enviada', 'total']
const COLS_NAME = ['titulo', 'nombre', 'producto', 'descripcion', 'titulo de la publicacion']

const hoyAR = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)
const fmtFecha = (t) => {
  const ms = t?.toMillis ? t.toMillis() : (t ? new Date(t).getTime() : 0)
  return ms ? new Date(ms).toLocaleDateString('es-AR') : ''
}

export default function FullShipment({
  products, combos, envios = [], loadPhotos,
  onCreate, onUpdate, onDelete, onDescontar, canEdit = true,
}) {
  const [envioId, setEnvioId] = useState('')
  const [showScanner, setShowScanner] = useState(false)
  const [msg, setMsg] = useState('')
  const [pendiente, setPendiente] = useState(null) // lo escaneado, esperando confirmación a pantalla completa
  const [cantidad, setCantidad] = useState(1)
  const [volverACamara, setVolverACamara] = useState(false)
  const [soloFaltan, setSoloFaltan] = useState(false)
  const [busy, setBusy] = useState(false)
  const [manual, setManual] = useState('')
  const fileRef = useRef(null)
  const bufferRef = useRef({ txt: '', t: 0 })

  const abiertos = useMemo(() => envios.filter(e => e.estado !== 'cerrado'), [envios])
  const envio = useMemo(
    () => envios.find(e => e.id === envioId) || abiertos[0] || envios[0] || null,
    [envios, envioId, abiertos]
  )

  const buscar = (ref) => findProductOrCombo(products, combos, ref)

  // ---- Lo escaneado, resuelto a producto/combo con foto, ubicación y avisos ----
  const escaneos = envio?.escaneos || []
  const pedido = envio?.pedido || []

  const resolver = (ref) => {
    const m = buscar(ref)
    if (!m) return null
    if (m.type === 'product') {
      const p = m.p
      return {
        tipo: 'product', id: p.id, nombre: p.name, code: p.code || ref,
        ubicacion: p.location || '', primerEmpaque: !!p.primerEmpaque, fragile: !!p.fragile,
        fotoId: p.id, fotoKind: 'product', fotoHas: !!p.hasPhotos,
        bases: [{ productId: p.id, productName: p.name, quantity: 1 }],
      }
    }
    const c = m.c
    const bases = (c.items || []).map(it => {
      const bp = products.find(pp => pp.id === it.productId)
      return bp ? { productId: bp.id, productName: bp.name, quantity: it.quantity || 1, bp } : null
    }).filter(Boolean)
    const conFoto = bases.find(b => b.bp.hasPhotos)
    const lugares = [...new Set(bases.map(b => (b.bp.location || '').trim()).filter(Boolean))]
    return {
      tipo: 'combo', id: c.id, nombre: c.name, code: c.code || ref,
      ubicacion: lugares.join(' · ') || c.location || '',
      primerEmpaque: bases.some(b => b.bp.primerEmpaque),
      fragile: bases.some(b => b.bp.fragile),
      fotoId: c.hasPhotos ? c.id : (conFoto ? conFoto.bp.id : c.id),
      fotoKind: c.hasPhotos ? 'combo' : (conFoto ? 'product' : 'combo'),
      fotoHas: !!(c.hasPhotos || conFoto),
      bases: bases.map(({ bp, ...b }) => b),
    }
  }

  // ---- Cuadro de avance: lo pedido por ML contra lo escaneado ----
  const avance = useMemo(() => {
    const porRef = new Map()
    const clave = (ref) => {
      const m = buscar(ref)
      return m ? `${m.type}:${m.type === 'product' ? m.p.id : m.c.id}` : 'x:' + normalize(ref)
    }
    pedido.forEach(l => {
      const k = clave(l.ref)
      const x = porRef.get(k) || { k, ref: l.ref, nombre: l.nombre || '', pedido: 0, escaneado: 0, enSistema: !k.startsWith('x:') }
      x.pedido += Number(l.cantidad) || 0
      if (!x.nombre && l.nombre) x.nombre = l.nombre
      porRef.set(k, x)
    })
    escaneos.forEach(s => {
      const k = clave(s.ref)
      const x = porRef.get(k) || { k, ref: s.ref, nombre: s.nombre || '', pedido: 0, escaneado: 0, enSistema: !k.startsWith('x:') }
      x.escaneado += Number(s.cantidad) || 0
      if (!x.nombre && s.nombre) x.nombre = s.nombre
      porRef.set(k, x)
    })
    const filas = [...porRef.values()].map(x => ({ ...x, falta: Math.max(0, x.pedido - x.escaneado), demas: Math.max(0, x.escaneado - x.pedido) }))
    filas.sort((a, b) => (b.falta - a.falta) || String(a.nombre).localeCompare(String(b.nombre)))
    return filas
  }, [pedido, escaneos, products, combos])

  const totales = useMemo(() => {
    const pedidas = avance.reduce((s, f) => s + f.pedido, 0)
    const escaneadas = avance.reduce((s, f) => s + f.escaneado, 0)
    const faltan = avance.reduce((s, f) => s + f.falta, 0)
    const demas = avance.reduce((s, f) => s + f.demas, 0)
    return { pedidas, escaneadas, faltan, demas, completo: pedidas > 0 && faltan === 0 }
  }, [avance])

  // ---- Escanear ----
  // El escaneo NO guarda solo: abre la pantalla completa con la foto, el SKU,
  // la ubicación y el aviso de primer empaque, y ahí se confirma. Así el del
  // depósito ve qué agarrar antes de que salga del stock.
  const sumar = (ref, desdeCamara = false) => {
    if (!envio) { setMsg('❌ Primero creá un envío'); return }
    if (envio.estado === 'cerrado') { setMsg('❌ Este envío ya está cerrado'); return }
    const limpio = String(ref).trim()
    if (!limpio) return
    const info = resolver(limpio)
    setVolverACamara(desdeCamara)
    setShowScanner(false)
    setCantidad(1)
    setMsg('')
    if (!info) { setPendiente({ noEncontrado: true, code: limpio }); return }
    const ya = escaneos.find(s => normalize(s.ref) === normalize(info.code))
    setPendiente({ ...info, yaLleva: Number(ya?.cantidad) || 0 })
  }

  // Confirmar: anota en el envío Y descuenta el stock de una vez
  const confirmar = async () => {
    if (!pendiente || pendiente.noEncontrado || !envio) return
    const n = Math.max(1, Math.round(Number(cantidad) || 1))
    setBusy(true)
    try {
      const renglones = pendiente.bases.map(b => ({
        productId: b.productId,
        productName: b.productName,
        quantity: -Math.abs(b.quantity * n),
        reason: `Envío a Full N° ${envio.numero}`,
      }))
      await onDescontar(renglones, {
        reference: `Envío Full N° ${envio.numero}`,
        reason: `Envío a Full N° ${envio.numero}`,
      })
      const nuevos = [...escaneos]
      const i = nuevos.findIndex(s => normalize(s.ref) === normalize(pendiente.code))
      if (i >= 0) nuevos[i] = { ...nuevos[i], cantidad: (Number(nuevos[i].cantidad) || 0) + n, descontado: true }
      else nuevos.push({ ref: pendiente.code, nombre: pendiente.nombre, cantidad: n, tipo: pendiente.tipo, descontado: true })
      await onUpdate(envio.id, { escaneos: nuevos })
      setMsg(`✅ ${pendiente.nombre} — ${n} ${n === 1 ? 'unidad' : 'unidades'} anotadas en el envío N° ${envio.numero} y descontadas del stock.`)
      setPendiente(null)
      if (volverACamara) setShowScanner(true)
    } catch (err) {
      setMsg('❌ No se pudo descontar: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  const cancelarPendiente = () => {
    setPendiente(null)
    if (volverACamara) setShowScanner(true)
  }

  const quitar = async (ref) => {
    const linea = escaneos.find(s => normalize(s.ref) === normalize(ref))
    if (linea?.descontado && !window.confirm(
      `Ese renglón YA descontó stock. Si lo sacás del envío, el stock NO vuelve solo: ` +
      `hay que cargar la entrada desde Movimientos.\n\n¿Sacarlo igual?`
    )) return
    const nuevos = escaneos.filter(s => normalize(s.ref) !== normalize(ref))
    await onUpdate(envio.id, { escaneos: nuevos })
  }
  const cambiarCantidad = async (ref, cantidad) => {
    const n = Math.max(0, Math.round(Number(cantidad) || 0))
    const nuevos = n === 0
      ? escaneos.filter(s => normalize(s.ref) !== normalize(ref))
      : escaneos.map(s => (normalize(s.ref) === normalize(ref) ? { ...s, cantidad: n } : s))
    await onUpdate(envio.id, { escaneos: nuevos })
  }

  // Pistola lectora (teclado rápido que termina en Enter), como en Envíos
  useEffect(() => {
    if (!envio || envio.estado === 'cerrado') return
    const onKey = (e) => {
      const el = document.activeElement
      if (el && ['INPUT', 'TEXTAREA'].includes(el.tagName)) return
      // Con la pantalla de confirmación abierta, el siguiente disparo de la
      // pistola tiene que esperar: si no, pisaría lo que está sin confirmar
      if (pendiente) return
      const ahora = Date.now()
      const b = bufferRef.current
      if (ahora - b.t > 50) b.txt = ''
      b.t = ahora
      if (e.key === 'Enter') {
        if (b.txt.length >= 4) sumar(b.txt)
        b.txt = ''
        return
      }
      if (e.key.length === 1) b.txt += e.key
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envio, escaneos, products, combos, pendiente])

  // ---- Listado que pidió ML ----
  const importarPedido = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !envio) return
    setBusy(true); setMsg('')
    try {
      const wb = XLSX.read(await file.arrayBuffer())
      let filas = []
      for (const nombre of wb.SheetNames) {
        const raw = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { defval: '' })
        if (!raw.length) continue
        const cols = {}
        Object.keys(raw[0]).forEach(k => {
          const n = normalize(k)
          if (!cols.ref && COLS_REF.includes(n)) cols.ref = k
          if (!cols.qty && COLS_QTY.includes(n)) cols.qty = k
          if (!cols.name && COLS_NAME.includes(n)) cols.name = k
        })
        if (!cols.ref) continue
        filas = raw.map(r => ({
          ref: String(r[cols.ref] ?? '').trim(),
          cantidad: Math.max(0, Math.round(Number(String(r[cols.qty] ?? 1).replace(',', '.')) || 0)),
          nombre: cols.name ? String(r[cols.name] ?? '').trim() : '',
        })).filter(r => r.ref)
        if (filas.length) break
      }
      if (!filas.length) throw new Error('No encontré las columnas. El Excel tiene que tener una con el SKU / código de publicación y otra con la cantidad.')
      const sinSistema = filas.filter(r => !buscar(r.ref)).length
      await onUpdate(envio.id, { pedido: filas })
      setMsg(`✅ Pedido de ML cargado: ${filas.length} renglones, ${filas.reduce((s, r) => s + r.cantidad, 0)} unidades.`
        + (sinSistema ? ` ⚠️ ${sinSistema} no están cargados en la app.` : ''))
    } catch (err) {
      setMsg('❌ ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  // ---- Descontar stock ----
  const pendientesDeDescontar = escaneos.filter(s => !s.descontado)
  const descontar = async () => {
    if (!envio || !pendientesDeDescontar.length) return
    const renglones = []
    const noEncontrados = []
    pendientesDeDescontar.forEach(s => {
      const info = resolver(s.ref)
      if (!info) { noEncontrados.push(s.ref); return }
      info.bases.forEach(b => renglones.push({
        productId: b.productId,
        productName: b.productName,
        quantity: -Math.abs(b.quantity * (Number(s.cantidad) || 0)),
        reason: `Envío a Full N° ${envio.numero}`,
      }))
    })
    if (!renglones.length) { setMsg('❌ No hay nada para descontar'); return }
    const unidades = renglones.reduce((s, r) => s + Math.abs(r.quantity), 0)
    if (!window.confirm(
      `Se van a descontar ${unidades} unidades de ${new Set(renglones.map(r => r.productId)).size} productos ` +
      `por el Envío a Full N° ${envio.numero}.\n\nEsto NO se puede deshacer solo (habría que cargar la entrada a mano). ¿Seguir?`
    )) return
    setBusy(true); setMsg('')
    try {
      await onDescontar(renglones, { reference: `Envío Full N° ${envio.numero}`, reason: `Envío a Full N° ${envio.numero}` })
      await onUpdate(envio.id, {
        escaneos: escaneos.map(s => ({ ...s, descontado: true })),
        descontadoAt: new Date().toISOString(),
      })
      setMsg(`✅ Stock descontado: ${unidades} unidades.`
        + (noEncontrados.length ? ` ⚠️ Quedaron afuera ${noEncontrados.length} códigos que no están en el sistema.` : ''))
    } catch (err) {
      setMsg('❌ No se pudo descontar: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  // ---- Excel ----
  const exportar = () => {
    if (!envio) return
    const detalle = escaneos.map(s => {
      const info = resolver(s.ref)
      const f = avance.find(x => normalize(x.ref) === normalize(s.ref))
      return {
        'Código': s.ref,
        'Producto': info?.nombre || s.nombre || '',
        'Tipo': info?.tipo === 'combo' ? 'Publicación' : 'Producto',
        'Ubicación': info?.ubicacion || '',
        'Primer empaque': info?.primerEmpaque ? 'SÍ' : '',
        'Frágil': info?.fragile ? 'SÍ' : '',
        'Escaneado': Number(s.cantidad) || 0,
        'Pedido por ML': f?.pedido ?? '',
        'Falta': f?.falta ?? '',
        'De más': f?.demas ?? '',
      }
    })
    const faltantes = avance.filter(f => f.falta > 0).map(f => ({
      'Código': f.ref,
      'Producto': f.nombre,
      'Pedido por ML': f.pedido,
      'Armado': f.escaneado,
      'FALTA': f.falta,
      'En el sistema': f.enSistema ? 'SÍ' : 'NO ESTÁ',
    }))
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(detalle)
    ws['!cols'] = [{ wch: 16 }, { wch: 52 }, { wch: 13 }, { wch: 16 }, { wch: 14 }, { wch: 8 }, { wch: 11 }, { wch: 14 }, { wch: 9 }, { wch: 9 }]
    XLSX.utils.book_append_sheet(wb, ws, `Envío Full ${envio.numero}`)
    if (faltantes.length) {
      const ws2 = XLSX.utils.json_to_sheet(faltantes)
      ws2['!cols'] = [{ wch: 16 }, { wch: 52 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 14 }]
      XLSX.utils.book_append_sheet(wb, ws2, 'Falta para completar')
    }
    XLSX.writeFile(wb, `envio-full-${envio.numero}-${hoyAR()}.xlsx`)
  }

  // ---- Envíos ----
  const crear = async () => {
    const sugerido = (envios.reduce((max, e) => Math.max(max, Number(e.numero) || 0), 0) || 0) + 1
    const n = window.prompt('Número del envío a Full:', String(sugerido))
    if (n === null) return
    const numero = String(n).trim()
    if (!numero) return
    const id = await onCreate({ numero, estado: 'abierto', pedido: [], escaneos: [] })
    if (id) setEnvioId(id)
    setPendiente(null); setMsg('')
  }
  const cerrar = async () => {
    if (!envio) return
    if (!window.confirm(`¿Cerrar el Envío a Full N° ${envio.numero}? No se va a poder escanear más en él.`)) return
    await onUpdate(envio.id, { estado: 'cerrado', closedAt: new Date().toISOString() })
  }
  const reabrir = async () => envio && onUpdate(envio.id, { estado: 'abierto' })

  const filasTabla = soloFaltan ? avance.filter(f => f.falta > 0) : avance

  return (
    <div className="full-container">
      <div className="full-head">
        <div>
          <h1>🏬 Envío a Full</h1>
          <p>Escaneá lo que va a bodega: descuenta stock y te dice cuánto falta para que el pedido salga completo.</p>
        </div>
        <div className="full-head-acc">
          <select value={envio?.id || ''} onChange={e => setEnvioId(e.target.value)} className="full-select">
            {!envios.length && <option value="">Sin envíos</option>}
            {envios.map(e => (
              <option key={e.id} value={e.id}>
                N° {e.numero} · {e.estado === 'cerrado' ? 'cerrado' : 'abierto'} · {fmtFecha(e.createdAt)}
              </option>
            ))}
          </select>
          {canEdit && <button className="full-btn" onClick={crear}>+ Nuevo envío</button>}
        </div>
      </div>

      {!envio ? (
        <div className="full-empty">
          <p>📦</p>
          <p>No hay ningún envío a Full todavía.</p>
          {canEdit && <button className="full-btn" onClick={crear}>+ Crear el primero</button>}
        </div>
      ) : (
        <>
          <div className="full-kpis">
            <div className="full-kpi"><span>Pedido por ML</span><strong>{totales.pedidas || '—'}</strong></div>
            <div className="full-kpi ok"><span>Armado</span><strong>{totales.escaneadas}</strong></div>
            <div className={`full-kpi ${totales.faltan ? 'warn' : 'ok'}`}><span>Falta</span><strong>{totales.faltan}</strong></div>
            {totales.demas > 0 && <div className="full-kpi warn"><span>De más</span><strong>{totales.demas}</strong></div>}
            <div className="full-kpi"><span>Estado</span><strong>{envio.estado === 'cerrado' ? '🔒 Cerrado' : (totales.completo ? '✅ Completo' : '🟡 Armando')}</strong></div>
          </div>

          {escaneos.length > 0 && !pendientesDeDescontar.length && (
            <div className="full-aviso ok">
              ✅ Todo lo de este envío ya está descontado del stock.
            </div>
          )}

          <div className="full-acciones">
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={importarPedido} />
            {canEdit && envio.estado !== 'cerrado' && (
              <>
                <button className="full-btn" onClick={() => setShowScanner(true)}>📷 Escanear</button>
                <button className="full-btn sec" onClick={() => fileRef.current?.click()} disabled={busy}>
                  📥 Cargar pedido de ML
                </button>
                {pendientesDeDescontar.length > 0 && (
                  <button className="full-btn dark" onClick={descontar} disabled={busy}>
                    📉 Descontar los {pendientesDeDescontar.length} renglones pendientes
                  </button>
                )}
              </>
            )}
            <button className="full-btn sec" onClick={exportar} disabled={!escaneos.length}>⬇️ Excel del envío</button>
            {canEdit && (envio.estado === 'cerrado'
              ? <button className="full-btn sec" onClick={reabrir}>🔓 Reabrir</button>
              : <button className="full-btn sec" onClick={cerrar}>🔒 Cerrar envío</button>)}
          </div>

          {canEdit && envio.estado !== 'cerrado' && (
            <form
              className="full-manual"
              onSubmit={e => { e.preventDefault(); sumar(manual); setManual('') }}
            >
              <input
                value={manual}
                onChange={e => setManual(e.target.value)}
                placeholder="Código del combo o código de barras (o disparale con la pistola)"
              />
              <button className="full-btn" type="submit">+ Sumar 1</button>
            </form>
          )}

          {msg && <div className={`full-aviso ${msg.startsWith('✅') ? 'ok' : 'warn'}`}>{msg}</div>}

          {pendiente && (
            <div className="full-modal">
              {pendiente.noEncontrado ? (
                <div className="full-modal-box err">
                  <div className="full-modal-nf">❌</div>
                  <h2>No está en el sistema</h2>
                  <p className="full-modal-code">{pendiente.code}</p>
                  <p className="full-modal-sub">
                    Ese código no figura como publicación ni como producto. Cargalo en Combos o en
                    Inventario y volvé a escanearlo.
                  </p>
                  <button className="full-modal-btn sec" onClick={cancelarPendiente}>✕ Volver</button>
                </div>
              ) : (
                <div className="full-modal-box">
                  <button className="full-modal-x" onClick={cancelarPendiente} title="Cancelar">✕</button>

                  <div className="full-modal-grid">
                    <LazyThumb
                      id={pendiente.fotoId} hasPhotos={pendiente.fotoHas} kind={pendiente.fotoKind}
                      loadPhotos={loadPhotos} className="full-modal-foto"
                    />
                    <div className="full-modal-datos">
                      <h2>{pendiente.nombre}</h2>
                      <div className="full-modal-sku">
                        <span>SKU</span>
                        <strong>{pendiente.code}</strong>
                      </div>
                      <div className={`full-modal-ubic ${pendiente.ubicacion ? '' : 'empty'}`}>
                        <span>Ubicación</span>
                        <strong>{pendiente.ubicacion || 'SIN UBICACIÓN'}</strong>
                      </div>
                      {pendiente.yaLleva > 0 && (
                        <div className="full-modal-ya">Ya van {pendiente.yaLleva} en este envío</div>
                      )}
                    </div>
                  </div>

                  <div className={`full-modal-empaque ${pendiente.primerEmpaque ? 'si' : 'no'}`}>
                    {pendiente.primerEmpaque
                      ? '📦 LLEVA PRIMER EMPAQUE — envolvelo antes de meterlo'
                      : '✔️ NO LLEVA PRIMER EMPAQUE'}
                  </div>
                  {pendiente.fragile && <div className="full-modal-fragil">⚠️ FRÁGIL</div>}

                  <div className="full-modal-cant">
                    <button onClick={() => setCantidad(c => Math.max(1, c - 1))} disabled={busy}>−</button>
                    <input
                      type="number" min="1" value={cantidad}
                      onChange={e => setCantidad(Math.max(1, Math.round(Number(e.target.value) || 1)))}
                    />
                    <button onClick={() => setCantidad(c => c + 1)} disabled={busy}>+</button>
                    <span>unidades</span>
                  </div>

                  <button className="full-modal-btn" onClick={confirmar} disabled={busy}>
                    {busy ? '⏳ Descontando...' : `✅ Descontar stock y anotar en envío N° ${envio.numero}`}
                  </button>
                  <button className="full-modal-btn sec" onClick={cancelarPendiente} disabled={busy}>
                    ✕ Cancelar
                  </button>
                </div>
              )}
            </div>
          )}

          {showScanner && (
            <Scanner onScan={(code) => sumar(code, true)} onClose={() => setShowScanner(false)} />
          )}

          <div className="full-tabla-head">
            <h2>Avance del envío</h2>
            <label className="full-check">
              <input type="checkbox" checked={soloFaltan} onChange={e => setSoloFaltan(e.target.checked)} />
              Mostrar solo lo que falta
            </label>
          </div>

          {!filasTabla.length ? (
            <div className="full-empty chico">
              <p>Todavía no escaneaste nada{pedido.length ? '' : ' ni cargaste el pedido de ML'}.</p>
            </div>
          ) : (
            <div className="full-tabla-wrap">
              <table className="full-tabla">
                <thead>
                  <tr>
                    <th>Código</th><th>Producto</th><th>Pedido ML</th><th>Armado</th><th>Falta</th><th>De más</th><th />
                  </tr>
                </thead>
                <tbody>
                  {filasTabla.map(f => (
                    <tr key={f.k} className={f.falta ? 'falta' : (f.demas ? 'demas' : 'ok')}>
                      <td className="full-code">{f.ref}</td>
                      <td>
                        {f.nombre || '—'}
                        {!f.enSistema && <span className="full-tag-no"> no está en el sistema</span>}
                      </td>
                      <td className="num">{f.pedido || '—'}</td>
                      <td className="num">
                        {canEdit && envio.estado !== 'cerrado' && f.escaneado > 0 ? (
                          <input
                            type="number" min="0" className="full-qty" defaultValue={f.escaneado}
                            onBlur={e => cambiarCantidad(f.ref, e.target.value)}
                          />
                        ) : (f.escaneado || '—')}
                      </td>
                      <td className="num falta-n">{f.falta || ''}</td>
                      <td className="num demas-n">{f.demas || ''}</td>
                      <td>
                        {canEdit && envio.estado !== 'cerrado' && f.escaneado > 0 && (
                          <button className="full-del" onClick={() => quitar(f.ref)} title="Sacar del envío">🗑️</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {canEdit && envio.estado === 'cerrado' && (
            <button className="full-btn del" onClick={() => onDelete(envio.id)}>🗑️ Borrar este envío</button>
          )}
        </>
      )}
    </div>
  )
}
