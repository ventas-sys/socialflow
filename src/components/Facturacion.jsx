import React, { useState, useMemo, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { collection, getDocs, doc, setDoc, deleteDoc, writeBatch, query, orderBy, limit } from 'firebase/firestore'
import { auth, db } from '../firebase'
import LazyThumb from './LazyThumb'
import { fotoDeCombo } from '../utils/fotoCombo'

// 🧾 Facturación directa a ARCA (BP IMPORT S.R.L., punto de venta 12). Solo admin, solo PC.
// Subsolapas: Vender (punto de venta) · Comprobantes · Clientes · Conexión ARCA.

const COND_IVA = [
  { id: 5, txt: 'Consumidor Final' },
  { id: 1, txt: 'IVA Responsable Inscripto' },
  { id: 6, txt: 'Responsable Monotributo' },
  { id: 13, txt: 'Monotributista Social' },
  { id: 4, txt: 'IVA Sujeto Exento' },
  { id: 7, txt: 'Sujeto No Categorizado' },
]
const condTxt = (id) => COND_IVA.find(c => c.id === Number(id))?.txt || ''
const letra = (cond) => ([1, 6, 13].includes(Number(cond)) ? 'A' : 'B')
const TIPO_TXT = { 0: 'Presupuesto', 1: 'Factura A', 6: 'Factura B', 3: 'NC A', 8: 'NC B', 91: 'Remito' }
const CONDICIONES_VENTA = ['Contado', 'Transferencia', 'Mercado Pago', 'Tarjeta', 'Cuenta corriente']
const $ = (n) => '$ ' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
const fechaTxt = (f) => (f ? `${String(f).slice(6, 8)}/${String(f).slice(4, 6)}/${String(f).slice(0, 4)}` : '')
const nuevoOrigen = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2))

export function condicionDesdeTexto(t = '') {
  const d = String(t).toLowerCase()
  if (d.includes('inscripto') || d === 'ri') return 1
  if (d.includes('monotrib')) return d.includes('social') ? 13 : 6
  if (d.includes('exento')) return 4
  if (d.includes('no categ')) return 7
  return 5
}

async function llamarArca(action, body) {
  const token = await auth.currentUser?.getIdToken()
  const r = await fetch('/api/arca?action=' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Firebase-Token': token || '' },
    body: JSON.stringify(body || {}),
  })
  const txt = await r.text()
  try { return JSON.parse(txt) } catch { return { ok: false, error: 'Respuesta inesperada (HTTP ' + r.status + '): ' + txt.slice(0, 200) } }
}

// Baja el PDF directo a la carpeta Descargas (con nombre de archivo), sin abrir pestañas.
function bajarArchivo(base64, nombre) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url; a.download = nombre
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

async function descargarPdf(comprobanteId) {
  const r = await llamarArca('pdf', { comprobanteId })
  if (!r.ok) { alert('No se pudo generar el PDF: ' + r.error); return }
  bajarArchivo(r.base64, r.nombre || comprobanteId + '.pdf')
}

// Mismo cálculo que el servidor: precio final con IVA → neto + IVA por línea.
function totales(lineas) {
  let neto = 0, iva = 0, total = 0
  for (const l of lineas) {
    const pf = r2(Number(l.precioFinal || 0) * (1 - (Number(l.descuento) || 0) / 100))
    const bruto = r2(pf * Number(l.cantidad || 0))
    const n = r2(bruto / (1 + Number(l.iva ?? 21) / 100))
    neto += n; iva += r2(bruto - n); total += bruto
  }
  return { neto: r2(neto), iva: r2(iva), total: r2(total) }
}

const S = {
  card: { background: '#fff', border: '1px solid #e3e3e3', borderRadius: 10, padding: 12 },
  btn: { padding: '8px 14px', borderRadius: 8, border: '1px solid #ccc', background: '#f7f7f7', cursor: 'pointer' },
  btnP: { padding: '10px 16px', borderRadius: 8, border: 'none', background: '#1f6feb', color: '#fff', cursor: 'pointer', fontWeight: 600 },
  input: { padding: '7px 9px', borderRadius: 6, border: '1px solid #ccc', width: '100%', boxSizing: 'border-box' },
  th: { textAlign: 'left', padding: 6, borderBottom: '1px solid #ddd', fontSize: 13 },
  td: { padding: 6, borderBottom: '1px solid #f0f0f0', fontSize: 13, verticalAlign: 'middle' },
}

// ───────────────────────── Vender ─────────────────────────
function Vender({ products, combos, loadPhotos, clientes, recargarClientes, onEmitido }) {
  const [busca, setBusca] = useState('')
  const [tipoItem, setTipoItem] = useState('todos')
  const [orden, setOrden] = useState('sku')
  const [soloConPrecio, setSoloConPrecio] = useState(false)
  const [mostrar, setMostrar] = useState(60)
  const [carrito, setCarrito] = useState([])
  const [cliente, setCliente] = useState({ nombre: 'Consumidor Final', docTipo: 'DNI', docNro: '', condicionIva: 5, domicilio: '', email: '' })
  const [buscaCli, setBuscaCli] = useState('')
  const [tipoComp, setTipoComp] = useState('factura')
  const [condVenta, setCondVenta] = useState('Contado')
  const [obs, setObs] = useState('')
  const [origenId, setOrigenId] = useState(nuevoOrigen)
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState(null)

  const byId = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const catalogo = useMemo(() => {
    const a = products.map(p => ({ id: p.id, kind: 'producto', code: p.code || '', name: p.name || '', price: Number(p.price) || 0, iva: p.iva ?? 21, foto: { fotoId: p.id, fotoKind: 'producto', hasPhotos: !!p.hasPhotos }, barcodes: p.barcodes || [] }))
    const b = combos.map(c => ({ id: c.id, kind: 'combo', code: c.code || '', name: c.name || '', price: Number(c.price) || 0, iva: c.iva ?? 21, foto: fotoDeCombo(c, byId), barcodes: [] }))
    return [...a, ...b]
  }, [products, combos, byId])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    let l = catalogo.filter(x => (tipoItem === 'todos' || x.kind === tipoItem) && (!soloConPrecio || x.price > 0))
    if (q) l = l.filter(x => x.code.toLowerCase().includes(q) || x.name.toLowerCase().includes(q) || x.barcodes.some(b => String(b).includes(q)))
    const cmp = {
      sku: (a, b) => a.code.localeCompare(b.code, 'es', { numeric: true }),
      skuDesc: (a, b) => b.code.localeCompare(a.code, 'es', { numeric: true }),
      nombre: (a, b) => a.name.localeCompare(b.name, 'es'),
      precioAsc: (a, b) => a.price - b.price,
      precioDesc: (a, b) => b.price - a.price,
    }[orden]
    return [...l].sort(cmp)
  }, [catalogo, busca, tipoItem, orden, soloConPrecio])

  const agregar = (x) => setCarrito(c => {
    const i = c.findIndex(l => l.id === x.id)
    if (i >= 0) return c.map((l, j) => j === i ? { ...l, cantidad: l.cantidad + 1 } : l)
    return [...c, { id: x.id, sku: x.code, descripcion: x.name, cantidad: 1, precioFinal: x.price, iva: x.iva, descuento: 0 }]
  })
  const cambiar = (i, k, v) => setCarrito(c => c.map((l, j) => j === i ? { ...l, [k]: v } : l))
  const quitar = (i) => setCarrito(c => c.filter((_, j) => j !== i))
  const t = totales(carrito)

  const cliFiltrados = useMemo(() => {
    const q = buscaCli.trim().toLowerCase()
    if (q.length < 2) return []
    return clientes.filter(c => (c.nombre || '').toLowerCase().includes(q) || String(c.docNro || '').includes(q.replace(/\D/g, '') || '@@')).slice(0, 8)
  }, [clientes, buscaCli])

  const esA = tipoComp === 'factura' && letra(cliente.condicionIva) === 'A'
  const docOk = !esA || String(cliente.docNro).replace(/\D/g, '').length === 11

  const emitir = async () => {
    if (!carrito.length) return
    if (carrito.some(l => !(Number(l.cantidad) > 0) || !(Number(l.precioFinal) > 0))) { alert('Hay líneas con cantidad o precio en cero.'); return }
    if (!docOk) { alert('Para Factura A hace falta el CUIT del cliente (11 dígitos).'); return }
    const que = tipoComp === 'presupuesto' ? 'el PRESUPUESTO' : `la FACTURA ${letra(cliente.condicionIva)} con CAE (no se puede borrar, solo anular con nota de crédito)`
    if (!window.confirm(`Vas a emitir ${que}\n\nCliente: ${cliente.nombre} ${cliente.docNro ? '(' + cliente.docNro + ')' : ''}\nTotal: ${$(t.total)}\n\n¿Confirmás?`)) return
    setEnviando(true); setResultado(null)
    const body = {
      origenId, receptor: cliente, condicionVenta: condVenta, observaciones: obs,
      items: carrito.map(({ sku, descripcion, cantidad, precioFinal, iva, descuento }) => ({ sku, descripcion, cantidad: Number(cantidad), precioFinal: Number(precioFinal), iva: Number(iva), descuento: Number(descuento) || 0 })),
    }
    const r = await llamarArca(tipoComp === 'presupuesto' ? 'presupuesto' : 'emitir', body).catch(e => ({ ok: false, error: e.message }))
    setEnviando(false)
    setResultado(r)
    if (r.ok) {
      descargarPdf(r.comprobante.id) // queda en Descargas automáticamente
      setCarrito([]); setObs(''); setOrigenId(nuevoOrigen())
      recargarClientes(); onEmitido()
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(360px,1fr)', gap: 14, alignItems: 'start' }}>
      {/* Catálogo */}
      <div style={S.card}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <input style={{ ...S.input, flex: '2 1 220px', width: 'auto' }} placeholder="Buscar SKU, nombre o código de barras…" value={busca} onChange={e => { setBusca(e.target.value); setMostrar(60) }} autoFocus />
          <select style={{ ...S.input, width: 'auto' }} value={tipoItem} onChange={e => setTipoItem(e.target.value)}>
            <option value="todos">Productos y combos</option>
            <option value="producto">Solo productos</option>
            <option value="combo">Solo combos</option>
          </select>
          <select style={{ ...S.input, width: 'auto' }} value={orden} onChange={e => setOrden(e.target.value)}>
            <option value="sku">SKU A→Z</option>
            <option value="skuDesc">SKU Z→A</option>
            <option value="nombre">Nombre</option>
            <option value="precioAsc">Precio menor a mayor</option>
            <option value="precioDesc">Precio mayor a menor</option>
          </select>
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={soloConPrecio} onChange={e => setSoloConPrecio(e.target.checked)} /> Solo con precio
          </label>
        </div>
        <div style={{ fontSize: 12, color: '#777', marginBottom: 6 }}>{filtrados.length} artículos</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10 }}>
          {filtrados.slice(0, mostrar).map(x => (
            <div key={x.kind + x.id} onClick={() => agregar(x)} title="Agregar a la venta"
              style={{ border: '1px solid #e5e5e5', borderRadius: 8, padding: 8, cursor: 'pointer', background: '#fafafa', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <LazyThumb id={x.foto.fotoId} hasPhotos={x.foto.hasPhotos} kind={x.foto.fotoKind} loadPhotos={loadPhotos} className="row-thumb" />
              <div style={{ fontSize: 11, color: '#666' }}>{x.kind === 'combo' ? '🧩 ' : ''}{x.code}</div>
              <div style={{ fontSize: 13, lineHeight: 1.2, maxHeight: 48, overflow: 'hidden' }}>{x.name}</div>
              <div style={{ fontWeight: 700, color: x.price ? '#111' : '#c00' }}>{x.price ? $(x.price) : 'sin precio'}</div>
            </div>
          ))}
        </div>
        {filtrados.length > mostrar && <button style={{ ...S.btn, marginTop: 10 }} onClick={() => setMostrar(m => m + 60)}>Ver más</button>}
      </div>

      {/* Venta */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, position: 'sticky', top: 8 }}>
        <div style={S.card}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            {[['factura', `🧾 Factura ${letra(cliente.condicionIva)}`], ['presupuesto', '📝 Presupuesto']].map(([k, txt]) => (
              <button key={k} onClick={() => setTipoComp(k)} style={{ ...S.btn, flex: 1, background: tipoComp === k ? '#1f6feb' : '#f7f7f7', color: tipoComp === k ? '#fff' : '#222' }}>{txt}</button>
            ))}
          </div>
          <b>Cliente</b>
          <input style={{ ...S.input, marginTop: 4 }} placeholder="Buscar cliente guardado por nombre o CUIT…" value={buscaCli} onChange={e => setBuscaCli(e.target.value)} />
          {cliFiltrados.length > 0 && (
            <div style={{ border: '1px solid #ddd', borderRadius: 6, marginTop: 2, maxHeight: 180, overflow: 'auto' }}>
              {cliFiltrados.map(c => (
                <div key={c.id} onClick={() => { setCliente({ nombre: c.nombre, docTipo: c.docTipo, docNro: c.docNro, condicionIva: c.condicionIva, domicilio: c.domicilio || '', email: c.email || '' }); setBuscaCli('') }}
                  style={{ padding: 6, cursor: 'pointer', borderBottom: '1px solid #f0f0f0', fontSize: 13 }}>
                  <b>{c.nombre}</b> · {c.docNro} · {condTxt(c.condicionIva)}
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
            <input style={S.input} placeholder="Razón social / nombre" value={cliente.nombre} onChange={e => setCliente({ ...cliente, nombre: e.target.value })} />
            <input style={S.input} placeholder="CUIT o DNI (vacío = sin identificar)" value={cliente.docNro} onChange={e => setCliente({ ...cliente, docNro: e.target.value.replace(/[^\d]/g, ''), docTipo: e.target.value.replace(/\D/g, '').length === 11 ? 'CUIT' : 'DNI' })} />
            <select style={S.input} value={cliente.condicionIva} onChange={e => setCliente({ ...cliente, condicionIva: Number(e.target.value) })}>
              {COND_IVA.map(c => <option key={c.id} value={c.id}>{c.txt}</option>)}
            </select>
            <input style={S.input} placeholder="Domicilio" value={cliente.domicilio} onChange={e => setCliente({ ...cliente, domicilio: e.target.value })} />
          </div>
          <button style={{ ...S.btn, marginTop: 6, fontSize: 12 }} onClick={() => setCliente({ nombre: 'Consumidor Final', docTipo: 'DNI', docNro: '', condicionIva: 5, domicilio: '', email: '' })}>Consumidor final</button>
          {!docOk && <div style={{ color: '#c00', fontSize: 12, marginTop: 4 }}>Factura A: falta el CUIT (11 dígitos).</div>}
        </div>

        <div style={S.card}>
          <b>Artículos</b>
          {!carrito.length && <div style={{ color: '#888', fontSize: 13, padding: '8px 0' }}>Tocá un artículo del catálogo para agregarlo.</div>}
          {carrito.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
              <thead><tr><th style={S.th}>Artículo</th><th style={S.th}>Cant.</th><th style={S.th}>P. unit c/IVA</th><th style={S.th}>Desc %</th><th style={S.th}>IVA</th><th style={S.th}></th></tr></thead>
              <tbody>
                {carrito.map((l, i) => (
                  <tr key={l.id}>
                    <td style={S.td}><div style={{ fontSize: 11, color: '#666' }}>{l.sku}</div>{l.descripcion}</td>
                    <td style={S.td}><input type="number" min="1" style={{ ...S.input, width: 56 }} value={l.cantidad} onChange={e => cambiar(i, 'cantidad', e.target.value)} /></td>
                    <td style={S.td}><input type="number" step="0.01" style={{ ...S.input, width: 100 }} value={l.precioFinal} onChange={e => cambiar(i, 'precioFinal', e.target.value)} /></td>
                    <td style={S.td}><input type="number" min="0" max="100" style={{ ...S.input, width: 52 }} value={l.descuento} onChange={e => cambiar(i, 'descuento', e.target.value)} /></td>
                    <td style={S.td}><select style={{ ...S.input, width: 64 }} value={l.iva} onChange={e => cambiar(i, 'iva', Number(e.target.value))}>{[21, 10.5, 27, 0].map(v => <option key={v} value={v}>{v}%</option>)}</select></td>
                    <td style={S.td}><button style={{ ...S.btn, padding: '4px 8px' }} onClick={() => quitar(i)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ marginTop: 10, fontSize: 14, textAlign: 'right' }}>
            <div>Neto gravado: {$(t.neto)}</div>
            <div>IVA: {$(t.iva)}</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>Total: {$(t.total)}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
            <select style={S.input} value={condVenta} onChange={e => setCondVenta(e.target.value)}>{CONDICIONES_VENTA.map(c => <option key={c}>{c}</option>)}</select>
            <input style={S.input} placeholder="Observaciones (opcional)" value={obs} onChange={e => setObs(e.target.value)} />
          </div>
          <button style={{ ...S.btnP, width: '100%', marginTop: 10, opacity: (!carrito.length || enviando) ? 0.5 : 1 }} disabled={!carrito.length || enviando} onClick={emitir}>
            {enviando ? 'Emitiendo…' : tipoComp === 'presupuesto' ? 'Guardar presupuesto' : `Emitir Factura ${letra(cliente.condicionIva)} con CAE`}
          </button>
        </div>

        {resultado && (
          <div style={{ ...S.card, background: resultado.ok ? '#e6f4ea' : '#fde8e8' }}>
            {resultado.ok ? (
              <>
                ✅ <b>{TIPO_TXT[resultado.comprobante.cbteTipo]} {resultado.comprobante.cbteTipo ? `${String(resultado.comprobante.ptoVta).padStart(5, '0')}-` : ''}{String(resultado.comprobante.nro).padStart(8, '0')}</b> por {$(resultado.comprobante.total)}
                {resultado.comprobante.cae && <div style={{ fontSize: 13 }}>CAE {resultado.comprobante.cae} · vence {fechaTxt(resultado.comprobante.caeVto)}</div>}
                {resultado.comprobante.yaExistia && <div style={{ fontSize: 12 }}>(Ya estaba emitida: no se duplicó.)</div>}
                <button style={{ ...S.btn, marginTop: 8 }} onClick={() => descargarPdf(resultado.comprobante.id)}>📄 Descargar PDF de nuevo</button>
              </>
            ) : <>❌ <b>No se emitió:</b> {resultado.error}</>}
          </div>
        )}
      </div>
    </div>
  )
}

// ───────────────────────── Comprobantes ─────────────────────────
function Comprobantes({ version }) {
  const [lista, setLista] = useState(null)
  const [busca, setBusca] = useState('')
  const [tipo, setTipo] = useState('todos')
  const cargar = useCallback(async () => {
    try {
      const s = await getDocs(query(collection(db, 'comprobantes'), orderBy('creado', 'desc'), limit(300)))
      setLista(s.docs.map(d => d.data()))
    } catch (e) { setLista({ error: e.message }) }
  }, [])
  useEffect(() => { cargar() }, [cargar, version])

  const anular = async (c) => {
    const motivo = window.prompt(`Nota de crédito TOTAL sobre ${TIPO_TXT[c.cbteTipo]} ${c.nro} por ${$(c.total)}.\nMotivo (opcional):`, '')
    if (motivo === null) return
    const r = await llamarArca('nc', { comprobanteId: c.id, motivo })
    alert(r.ok ? `Nota de crédito emitida: CAE ${r.comprobante.cae}` : 'No se emitió: ' + r.error)
    cargar()
  }

  if (!lista) return <div>Cargando…</div>
  if (lista.error) return <div style={{ color: '#c00' }}>No se pudieron leer los comprobantes: {lista.error}<br />Si dice "permission", falta publicar las reglas nuevas de Firestore.</div>
  const q = busca.toLowerCase()
  const vis = lista.filter(c => (tipo === 'todos' || String(c.cbteTipo) === tipo) && (!q || (c.receptor?.nombre || '').toLowerCase().includes(q) || String(c.receptor?.DocNro || '').includes(q) || String(c.nro).includes(q)))
  return (
    <div style={S.card}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input style={{ ...S.input, width: 280 }} placeholder="Buscar cliente, CUIT o número…" value={busca} onChange={e => setBusca(e.target.value)} />
        <select style={{ ...S.input, width: 'auto' }} value={tipo} onChange={e => setTipo(e.target.value)}>
          <option value="todos">Todos</option>
          {Object.entries(TIPO_TXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button style={S.btn} onClick={cargar}>↻</button>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{['Fecha', 'Comprobante', 'Cliente', 'Total', 'CAE', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
        <tbody>
          {vis.map(c => (
            <tr key={c.id}>
              <td style={S.td}>{fechaTxt(c.fecha)}</td>
              <td style={S.td}>{TIPO_TXT[c.cbteTipo]} {c.cbteTipo && c.cbteTipo !== 91 ? String(c.ptoVta).padStart(5, '0') + '-' : ''}{String(c.nro).padStart(8, '0')}{c.anuladoPor ? <span style={{ color: '#c00' }}> · anulada</span> : ''}</td>
              <td style={S.td}>{c.receptor?.nombre}<div style={{ fontSize: 11, color: '#777' }}>{c.receptor?.DocNro || ''}</div></td>
              <td style={S.td}>{$(c.total)}</td>
              <td style={S.td}>{c.cae || '—'}</td>
              <td style={S.td}>
                <button style={{ ...S.btn, padding: '4px 8px' }} onClick={() => c.cbteTipo === 91 ? llamarArca('remitoPdf', { remitoId: c.id }).then(r => r.ok ? abrirPdfs(r) : alert(r.error)) : descargarPdf(c.id)}>📄 PDF</button>{' '}
                {[1, 6].includes(c.cbteTipo) && !c.anuladoPor && <button style={{ ...S.btn, padding: '4px 8px' }} onClick={() => anular(c)}>Nota de crédito</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!vis.length && <div style={{ color: '#888', padding: 8 }}>Todavía no hay comprobantes.</div>}
    </div>
  )
}

// ───────────────────────── Clientes ─────────────────────────
function Clientes({ clientes, recargar, error }) {
  const [busca, setBusca] = useState('')
  const [form, setForm] = useState(null)
  const [importando, setImportando] = useState(null)

  const guardar = async () => {
    const n = String(form.docNro || '').replace(/\D/g, '')
    if (!n) { alert('Falta el CUIT o DNI.'); return }
    await setDoc(doc(db, 'clientes', n), { ...form, docNro: n, docTipo: n.length === 11 ? 'CUIT' : 'DNI', condicionIva: Number(form.condicionIva) }, { merge: true })
    setForm(null); recargar()
  }
  const borrar = async (c) => {
    if (!window.confirm(`¿Borrar el cliente ${c.nombre}?`)) return
    await deleteDoc(doc(db, 'clientes', c.id)); recargar()
  }

  // Excel exportado de Contabilium (Ventas → Clientes → Exportar). Encabezados flexibles.
  const importar = async (file) => {
    const wb = XLSX.read(await file.arrayBuffer())
    const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
    const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '')
    const pick = (row, ...claves) => {
      for (const k of Object.keys(row)) if (claves.some(c => norm(k).includes(c))) return String(row[k]).trim()
      return ''
    }
    const out = []
    for (const r of filas) {
      const n = pick(r, 'nrodoc', 'nrodocumento', 'cuit', 'documento', 'nrodedoc').replace(/\D/g, '')
      if (!n || n === '0') continue
      out.push({
        nombre: pick(r, 'razonsocial', 'nombre', 'cliente') || 'Sin nombre',
        docNro: n, docTipo: n.length === 11 ? 'CUIT' : 'DNI',
        condicionIva: condicionDesdeTexto(pick(r, 'condicioniva', 'condiva', 'categoriaimpositiva', 'iva')),
        domicilio: [pick(r, 'domicilio', 'direccion'), pick(r, 'ciudad', 'localidad'), pick(r, 'provincia')].filter(Boolean).join(', '),
        email: pick(r, 'email', 'mail'),
        telefono: pick(r, 'telefono', 'celular'),
        origen: 'contabilium',
      })
    }
    setImportando({ filas: out, archivo: file.name })
  }
  const confirmarImport = async () => {
    const filas = importando.filas
    for (let i = 0; i < filas.length; i += 400) {
      const b = writeBatch(db)
      for (const c of filas.slice(i, i + 400)) b.set(doc(db, 'clientes', c.docNro), c, { merge: true })
      await b.commit()
    }
    alert(`Importados ${filas.length} clientes.`)
    setImportando(null); recargar()
  }

  const q = busca.toLowerCase()
  const vis = clientes.filter(c => !q || (c.nombre || '').toLowerCase().includes(q) || String(c.docNro).includes(q))
  return (
    <div style={S.card}>
      {error && <div style={{ color: '#c00', marginBottom: 8 }}>No se pudieron leer los clientes: {error}. Si dice "permission", falta publicar las reglas nuevas de Firestore.</div>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <input style={{ ...S.input, width: 280 }} placeholder="Buscar nombre o CUIT…" value={busca} onChange={e => setBusca(e.target.value)} />
        <button style={S.btnP} onClick={() => setForm({ nombre: '', docNro: '', condicionIva: 1, domicilio: '', email: '', telefono: '' })}>+ Cliente</button>
        <label style={{ ...S.btn, display: 'inline-block' }}>
          ⬆ Importar Excel de Contabilium
          <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => e.target.files[0] && importar(e.target.files[0])} />
        </label>
        <span style={{ fontSize: 12, color: '#777', alignSelf: 'center' }}>{clientes.length} clientes</span>
      </div>

      {importando && (
        <div style={{ ...S.card, background: '#fffbe6', marginBottom: 10 }}>
          <b>{importando.archivo}</b>: {importando.filas.length} clientes con CUIT/DNI. Primeros 5:
          <ul style={{ fontSize: 13 }}>{importando.filas.slice(0, 5).map(c => <li key={c.docNro}>{c.nombre} · {c.docNro} · {condTxt(c.condicionIva)}</li>)}</ul>
          <button style={S.btnP} onClick={confirmarImport}>Importar {importando.filas.length}</button>{' '}
          <button style={S.btn} onClick={() => setImportando(null)}>Cancelar</button>
        </div>
      )}

      {form && (
        <div style={{ ...S.card, background: '#f5f9ff', marginBottom: 10, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
          <input style={S.input} placeholder="Razón social" value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} />
          <input style={S.input} placeholder="CUIT o DNI" value={form.docNro} onChange={e => setForm({ ...form, docNro: e.target.value })} />
          <select style={S.input} value={form.condicionIva} onChange={e => setForm({ ...form, condicionIva: e.target.value })}>{COND_IVA.map(c => <option key={c.id} value={c.id}>{c.txt}</option>)}</select>
          <input style={S.input} placeholder="Domicilio" value={form.domicilio} onChange={e => setForm({ ...form, domicilio: e.target.value })} />
          <input style={S.input} placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          <input style={S.input} placeholder="Teléfono" value={form.telefono} onChange={e => setForm({ ...form, telefono: e.target.value })} />
          <div><button style={S.btnP} onClick={guardar}>Guardar</button> <button style={S.btn} onClick={() => setForm(null)}>Cancelar</button></div>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{['Razón social', 'CUIT / DNI', 'Condición IVA', 'Domicilio', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
        <tbody>
          {vis.slice(0, 300).map(c => (
            <tr key={c.id}>
              <td style={S.td}>{c.nombre}</td><td style={S.td}>{c.docNro}</td><td style={S.td}>{condTxt(c.condicionIva)}</td><td style={S.td}>{c.domicilio}</td>
              <td style={S.td}><button style={{ ...S.btn, padding: '4px 8px' }} onClick={() => setForm({ ...c })}>Editar</button> <button style={{ ...S.btn, padding: '4px 8px' }} onClick={() => borrar(c)}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ───────────────────────── Remitos ─────────────────────────
async function abrirPdfs(r) {
  const id = r.remito?.id || 'remito'
  if (r.pdf) bajarArchivo(r.pdf, `${id}${r.remito?.tipo === 'micro' ? '-micro' : ''}.pdf`)
  if (r.etiquetas) setTimeout(() => bajarArchivo(r.etiquetas, `${id}-etiquetas.pdf`), 600)
}

function Remitos({ products, combos, clientes, recargarClientes }) {
  const vacioDest = { nombre: '', docNro: '', domicilio: '', localidad: '', provincia: '', cp: '', telefono: '', contacto: '' }
  const [tipo, setTipo] = useState('expreso')
  const [dest, setDest] = useState(vacioDest)
  const [buscaCli, setBuscaCli] = useState('')
  const [transportes, setTransportes] = useState([])
  const [transp, setTransp] = useState({ nombre: '', cuit: '', domicilio: '', destino: '' })
  const [items, setItems] = useState([])
  const [buscaArt, setBuscaArt] = useState('')
  const [bultos, setBultos] = useState(1)
  const [peso, setPeso] = useState('')
  const [valor, setValor] = useState('')
  const [fragil, setFragil] = useState(false)
  const [obs, setObs] = useState('')
  const [comprobante, setComprobante] = useState('')
  const [facturas, setFacturas] = useState([])
  const [remitos, setRemitos] = useState([])
  const [enviando, setEnviando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const t = await getDocs(collection(db, 'arca_control'))
      const tr = t.docs.find(d => d.id === 'transportes')
      setTransportes(tr ? tr.data().lista || [] : [])
      const s = await getDocs(query(collection(db, 'comprobantes'), orderBy('creado', 'desc'), limit(200)))
      const todos = s.docs.map(d => d.data())
      setFacturas(todos.filter(c => [1, 6, 0].includes(c.cbteTipo)))
      setRemitos(todos.filter(c => c.cbteTipo === 91))
    } catch (e) { console.warn('remitos', e) }
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const cliFiltrados = useMemo(() => {
    const q = buscaCli.trim().toLowerCase()
    if (q.length < 2) return []
    return clientes.filter(c => (c.nombre || '').toLowerCase().includes(q) || String(c.docNro || '').includes(q.replace(/\D/g, '') || '@@')).slice(0, 8)
  }, [clientes, buscaCli])

  const catalogo = useMemo(() => [
    ...products.map(p => ({ id: p.id, sku: p.code || '', descripcion: p.name || '' })),
    ...combos.map(c => ({ id: c.id, sku: c.code || '', descripcion: c.name || '' })),
  ], [products, combos])
  const artFiltrados = useMemo(() => {
    const q = buscaArt.trim().toLowerCase()
    if (q.length < 2) return []
    return catalogo.filter(x => x.sku.toLowerCase().includes(q) || x.descripcion.toLowerCase().includes(q)).slice(0, 10)
  }, [catalogo, buscaArt])

  const desdeComprobante = (id) => {
    setComprobante(id)
    const c = facturas.find(f => f.id === id)
    if (!c) return
    setItems(c.items.map(it => ({ sku: it.sku || '', descripcion: it.descripcion, cantidad: it.cantidad })))
    const cli = clientes.find(x => String(x.docNro) === String(c.receptor?.DocNro))
    setDest({ ...vacioDest, ...(cli || {}), nombre: c.receptor?.nombre || '', docNro: String(c.receptor?.DocNro || '') || '', domicilio: cli?.domicilio || c.receptor?.domicilio || '' })
  }

  const generar = async () => {
    if (!dest.nombre) { alert('Falta el destinatario.'); return }
    if (!items.length) { alert('Agregá al menos un artículo.'); return }
    setEnviando(true)
    const cf = facturas.find(f => f.id === comprobante)
    const r = await llamarArca('remito', {
      tipo, destinatario: dest, transporte: transp, items, bultos, peso, valorDeclarado: valor, fragil, observaciones: obs,
      comprobante: cf ? `${TIPO_TXT[cf.cbteTipo]} ${cf.cbteTipo ? String(cf.ptoVta).padStart(5, '0') + '-' : ''}${String(cf.nro).padStart(8, '0')}` : '',
    }).catch(e => ({ ok: false, error: e.message }))
    setEnviando(false)
    if (!r.ok) { alert('No se generó: ' + r.error); return }
    // Guardar transporte y datos de entrega del cliente para la próxima
    if (transp.nombre && !transportes.some(t => t.nombre.toLowerCase() === transp.nombre.toLowerCase())) {
      const lista = [...transportes, transp]
      await setDoc(doc(db, 'arca_control', 'transportes'), { lista }).catch(() => {})
      setTransportes(lista)
    }
    const n = String(dest.docNro || '').replace(/\D/g, '')
    if (n) await setDoc(doc(db, 'clientes', n), { nombre: dest.nombre, docNro: n, domicilio: dest.domicilio, localidad: dest.localidad, provincia: dest.provincia, cp: dest.cp, telefono: dest.telefono, contacto: dest.contacto }, { merge: true }).then(recargarClientes).catch(() => {})
    abrirPdfs(r)
    cargar()
  }

  const reimprimir = async (id) => {
    const r = await llamarArca('remitoPdf', { remitoId: id })
    if (!r.ok) { alert(r.error); return }
    abrirPdfs(r)
  }

  const campo = (k, ph, w) => <input style={{ ...S.input, ...(w ? { gridColumn: w } : {}) }} placeholder={ph} value={dest[k] || ''} onChange={e => setDest({ ...dest, [k]: e.target.value })} />

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) minmax(320px,1fr)', gap: 14, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={S.card}>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['expreso', '🚚 Remito para expreso (A4 + etiquetas por bulto)'], ['micro', '🚌 Remito chico 15×10 (micro)']].map(([k, txt]) => (
              <button key={k} onClick={() => setTipo(k)} style={{ ...S.btn, flex: 1, background: tipo === k ? '#1f6feb' : '#f7f7f7', color: tipo === k ? '#fff' : '#222' }}>{txt}</button>
            ))}
          </div>
          <div style={{ marginTop: 10 }}>
            <b>Cargar desde una factura o presupuesto</b> <span style={{ fontSize: 12, color: '#777' }}>(opcional: trae cliente y artículos)</span>
            <select style={{ ...S.input, marginTop: 4 }} value={comprobante} onChange={e => desdeComprobante(e.target.value)}>
              <option value="">— Ninguno —</option>
              {facturas.map(f => <option key={f.id} value={f.id}>{fechaTxt(f.fecha)} · {TIPO_TXT[f.cbteTipo]} {String(f.nro).padStart(8, '0')} · {f.receptor?.nombre} · {$(f.total)}</option>)}
            </select>
          </div>
        </div>

        <div style={S.card}>
          <b>Destinatario</b>
          <input style={{ ...S.input, marginTop: 4 }} placeholder="Buscar cliente guardado por nombre o CUIT…" value={buscaCli} onChange={e => setBuscaCli(e.target.value)} />
          {cliFiltrados.length > 0 && (
            <div style={{ border: '1px solid #ddd', borderRadius: 6, marginTop: 2 }}>
              {cliFiltrados.map(c => <div key={c.id} onClick={() => { setDest({ ...vacioDest, ...c }); setBuscaCli('') }} style={{ padding: 6, cursor: 'pointer', borderBottom: '1px solid #f0f0f0', fontSize: 13 }}><b>{c.nombre}</b> · {c.docNro}</div>)}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, marginTop: 6 }}>
            {campo('nombre', 'Razón social / nombre', 'span 2')}{campo('docNro', 'CUIT / DNI')}
            {campo('domicilio', 'Domicilio de entrega', 'span 2')}{campo('cp', 'Código postal')}
            {campo('localidad', 'Localidad')}{campo('provincia', 'Provincia')}{campo('telefono', 'Teléfono')}
            {campo('contacto', 'Contacto / quién recibe', 'span 3')}
          </div>
        </div>

        <div style={S.card}>
          <b>Artículos</b>
          <input style={{ ...S.input, marginTop: 4 }} placeholder="Buscar SKU o nombre para agregar…" value={buscaArt} onChange={e => setBuscaArt(e.target.value)} />
          {artFiltrados.length > 0 && (
            <div style={{ border: '1px solid #ddd', borderRadius: 6, marginTop: 2 }}>
              {artFiltrados.map(a => <div key={a.id} onClick={() => { setItems(l => [...l, { sku: a.sku, descripcion: a.descripcion, cantidad: 1 }]); setBuscaArt('') }} style={{ padding: 6, cursor: 'pointer', borderBottom: '1px solid #f0f0f0', fontSize: 13 }}>{a.sku} · {a.descripcion}</div>)}
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td style={S.td}><input type="number" min="1" style={{ ...S.input, width: 60 }} value={it.cantidad} onChange={e => setItems(l => l.map((x, j) => j === i ? { ...x, cantidad: e.target.value } : x))} /></td>
                  <td style={S.td}><span style={{ fontSize: 11, color: '#666' }}>{it.sku}</span> {it.descripcion}</td>
                  <td style={S.td}><button style={{ ...S.btn, padding: '4px 8px' }} onClick={() => setItems(l => l.filter((_, j) => j !== i))}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button style={{ ...S.btn, marginTop: 6, fontSize: 12 }} onClick={() => setItems(l => [...l, { sku: '', descripcion: 'Mercadería varia', cantidad: 1 }])}>+ Línea libre</button>
          {items.some(x => x.sku === '' ) && <div style={{ fontSize: 12, color: '#777', marginTop: 4 }}>Las líneas libres se editan acá:</div>}
          {items.map((it, i) => it.sku === '' && (
            <input key={'d' + i} style={{ ...S.input, marginTop: 4 }} value={it.descripcion} onChange={e => setItems(l => l.map((x, j) => j === i ? { ...x, descripcion: e.target.value } : x))} />
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, position: 'sticky', top: 8 }}>
        <div style={S.card}>
          <b>{tipo === 'micro' ? 'Empresa de micro' : 'Expreso'}</b>
          <select style={{ ...S.input, marginTop: 4 }} value="" onChange={e => { const t = transportes[Number(e.target.value)]; if (t) setTransp(t) }}>
            <option value="">Elegir uno guardado…</option>
            {transportes.map((t, i) => <option key={i} value={i}>{t.nombre}{t.destino ? ' → ' + t.destino : ''}</option>)}
          </select>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
            <input style={S.input} placeholder="Nombre" value={transp.nombre} onChange={e => setTransp({ ...transp, nombre: e.target.value })} />
            <input style={S.input} placeholder="CUIT (opcional)" value={transp.cuit} onChange={e => setTransp({ ...transp, cuit: e.target.value })} />
            <input style={S.input} placeholder="Domicilio / depósito" value={transp.domicilio} onChange={e => setTransp({ ...transp, domicilio: e.target.value })} />
            <input style={S.input} placeholder={tipo === 'micro' ? 'Terminal destino' : 'Destino'} value={transp.destino} onChange={e => setTransp({ ...transp, destino: e.target.value })} />
          </div>
        </div>
        <div style={S.card}>
          <b>Bultos</b>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 6 }}>
            <label style={{ fontSize: 12 }}>Cantidad<input type="number" min="1" style={S.input} value={bultos} onChange={e => setBultos(e.target.value)} /></label>
            <label style={{ fontSize: 12 }}>Peso total kg<input style={S.input} value={peso} onChange={e => setPeso(e.target.value)} /></label>
            <label style={{ fontSize: 12 }}>Valor declarado $<input style={S.input} value={valor} onChange={e => setValor(e.target.value)} /></label>
          </div>
          <label style={{ fontSize: 13, display: 'block', marginTop: 6 }}><input type="checkbox" checked={fragil} onChange={e => setFragil(e.target.checked)} /> Marcar FRÁGIL en las etiquetas</label>
          <input style={{ ...S.input, marginTop: 6 }} placeholder="Observaciones (horario, etc.)" value={obs} onChange={e => setObs(e.target.value)} />
          <button style={{ ...S.btnP, width: '100%', marginTop: 10, opacity: enviando ? 0.5 : 1 }} disabled={enviando} onClick={generar}>
            {enviando ? 'Generando…' : tipo === 'micro' ? 'Generar remito 15×10' : `Generar remito + ${Math.max(1, Number(bultos) || 1)} etiqueta(s)`}
          </button>
          <div style={{ fontSize: 11, color: '#777', marginTop: 6 }}>Se abren los PDF: el remito (A4, original y duplicado) y las etiquetas 15×10 en otro archivo, para imprimirlas en la térmica.</div>
        </div>
        <div style={S.card}>
          <b>Últimos remitos</b>
          {remitos.slice(0, 15).map(r => (
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
              <span>{r.id} · {r.destinatario?.nombre} · {r.tipo === 'micro' ? '🚌' : '🚚'} {r.bultos}b</span>
              <button style={{ ...S.btn, padding: '2px 8px' }} onClick={() => reimprimir(r.id)}>Reimprimir</button>
            </div>
          ))}
          {!remitos.length && <div style={{ fontSize: 13, color: '#888' }}>Todavía no hay remitos.</div>}
        </div>
      </div>
    </div>
  )
}

// ───────────────────────── Conexión ARCA ─────────────────────────
function Conexion() {
  const [cargando, setCargando] = useState(false)
  const [res, setRes] = useState(null)
  const probar = async () => {
    setCargando(true); setRes(null)
    try { setRes(await llamarArca('estado')) } catch (e) { setRes({ ok: false, error: e.message }) }
    setCargando(false)
  }
  const srv = res?.servidores
  const okSrv = srv && srv.AppServer === 'OK' && srv.DbServer === 'OK' && srv.AuthServer === 'OK'
  return (
    <div style={S.card}>
      <p style={{ color: '#555', marginTop: 0 }}>Prueba <b>sin emitir nada</b>: pregunta a ARCA el último número de cada comprobante del punto de venta 12.</p>
      <button style={S.btnP} onClick={probar} disabled={cargando}>{cargando ? 'Consultando a ARCA…' : 'Probar conexión con ARCA'}</button>
      {res && !res.ok && <div style={{ marginTop: 12, padding: 10, background: '#fde8e8', borderRadius: 8 }}>❌ <b>No funcionó:</b> {res.error}</div>}
      {res?.ok && (
        <div style={{ marginTop: 12 }}>
          <div style={{ padding: 10, background: okSrv ? '#e6f4ea' : '#fff4e5', borderRadius: 8 }}>
            {okSrv ? '✅ Conectado con ARCA' : '⚠️ Conectó, pero ARCA informa servidores con problemas'} — {res.ambiente}, CUIT {res.cuit}, PV {res.puntoDeVenta}
          </div>
          <table style={{ marginTop: 8 }}><tbody>
            {Object.entries(res.ultimos || {}).map(([k, v]) => <tr key={k}><td style={S.td}>{k}</td><td style={S.td}>último nº {String(v)}</td></tr>)}
          </tbody></table>
        </div>
      )}
    </div>
  )
}

export default function Facturacion({ products = [], combos = [], loadPhotos }) {
  const [sub, setSub] = useState('vender')
  const [clientes, setClientes] = useState([])
  const [errCli, setErrCli] = useState(null)
  const [version, setVersion] = useState(0)

  const cargarClientes = useCallback(async () => {
    try {
      const s = await getDocs(collection(db, 'clientes'))
      setClientes(s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es')))
      setErrCli(null)
    } catch (e) { setErrCli(e.message) }
  }, [])
  useEffect(() => { cargarClientes() }, [cargarClientes])

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: '0 12px 0 0' }}>🧾 Facturación</h2>
        {[['vender', '🛒 Vender'], ['remitos', '🚚 Remitos'], ['comprobantes', '📑 Comprobantes'], ['clientes', '👤 Clientes'], ['conexion', '🔌 Conexión ARCA']].map(([k, txt]) => (
          <button key={k} onClick={() => setSub(k)} style={{ ...S.btn, background: sub === k ? '#1f6feb' : '#f7f7f7', color: sub === k ? '#fff' : '#222' }}>{txt}</button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#777' }}>BP IMPORT S.R.L. · PV 12 STOCK ML</span>
      </div>
      {sub === 'vender' && <Vender products={products} combos={combos} loadPhotos={loadPhotos} clientes={clientes} recargarClientes={cargarClientes} onEmitido={() => setVersion(v => v + 1)} />}
      {sub === 'remitos' && <Remitos products={products} combos={combos} clientes={clientes} recargarClientes={cargarClientes} />}
      {sub === 'comprobantes' && <Comprobantes version={version} />}
      {sub === 'clientes' && <Clientes clientes={clientes} recargar={cargarClientes} error={errCli} />}
      {sub === 'conexion' && <Conexion />}
    </div>
  )
}
