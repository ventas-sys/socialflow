import React, { useState, useMemo, useRef, useEffect } from 'react'
import { fotoDeCombo } from '../utils/fotoCombo'
import * as XLSX from 'xlsx'
import { findProductOrCombo, barcodesOf } from '../utils/refMatch'
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

// El listado que da ML (el PDF de "instrucciones de preparación", pasado a
// Excel) mete los tres códigos en UNA sola celda, con el título abajo:
//   "Código ML: RKAP87989 Código universal: N/A SKU: MLA812887061
//    100 Regaton De Goma 22 Mm. Negro"
// El que se escanea en el depósito es el Código ML (4 letras + 5 números).
// OJO: un mismo SKU de ML puede aparecer con varios Códigos ML (las variantes
// de color/medida), así que el renglón se identifica por el Código ML.
const RX_ML = /c[oó]digo\s*ml:\s*([A-Z0-9]+)[\s\S]*?c[oó]digo\s*universal:\s*(\S+)[\s\S]*?sku:\s*(\S+)/i

// Encabezados posibles de un Excel armado a mano (formato libre)
const COLS_REF = ['sku', 'codigo', 'codigo universal', 'codigo de barras', 'publicacion', 'nro de publicacion',
  'n de publicacion', 'numero de publicacion', 'codigo de publicacion', 'mla', 'sku del producto',
  'codigo sku', 'identificador']
const COLS_QTY = ['cantidad', 'unidades', 'stock', 'cantidad a enviar', 'unidades a enviar', 'qty',
  'stock a enviar', 'cantidad enviada', 'total']
const COLS_NAME = ['titulo', 'nombre', 'producto', 'descripcion', 'titulo de la publicacion']

// Las cantidades con las que realmente se manda a Full. Tocar una la FIJA (no
// suma), que es como se piensa al armar: "de este van 10". Cualquier otro
// número sale con el − / + de abajo; son pocas para que todo entre en la
// pantalla del celular sin tener que scrollear.
const CANTIDADES = [1, 3, 6, 10, 50]

const hoyAR = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)
const fmtFecha = (t) => {
  const ms = t?.toMillis ? t.toMillis() : (t ? new Date(t).getTime() : 0)
  return ms ? new Date(ms).toLocaleDateString('es-AR') : ''
}

export default function FullShipment({
  products, combos, envios = [], loadPhotos,
  onCreate, onUpdate, onDelete, onDescontar, onAsociarCodigos, canEdit = true,
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
  // Marcar de un clic sólo en la PC: en el celular se escanea, y un toque de
  // más con el dedo descontaría stock sin querer.
  const [esPC, setEsPC] = useState(false)
  const [elegidos, setElegidos] = useState(() => new Set())
  // Códigos del pedido de ML que apuntan a algo que SÍ está en el sistema pero
  // que todavía no están cargados como código de barras de ese combo
  const [porAsociar, setPorAsociar] = useState(null)
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

  // Cuántas unidades de un renglón YA salieron del stock.
  //
  // Antes esto era un booleano y la app no sabía CUÁNTAS había sacado. Con eso,
  // bajar la cantidad armada o borrar el renglón dejaba el stock descontado
  // igual, "falta" volvía a crecer, y al marcarlo de nuevo se descontaba DOS
  // VECES. Ahora es un número y la regla es simple: lo armado siempre es igual
  // a lo que salió del stock.
  const yaDescontado = (s) => {
    if (s?.descontado === true) return Number(s.cantidad) || 0   // renglones viejos
    return Math.max(0, Number(s?.descontado) || 0)
  }
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
    // Misma regla que en Inventario y Combos, en un solo lugar
    const foto = fotoDeCombo(c, products)
    const lugares = [...new Set(bases.map(b => (b.bp.location || '').trim()).filter(Boolean))]
    return {
      tipo: 'combo', id: c.id, nombre: c.name, code: c.code || ref,
      ubicacion: lugares.join(' · ') || c.location || '',
      primerEmpaque: bases.some(b => b.bp.primerEmpaque),
      fragile: bases.some(b => b.bp.fragile),
      fotoId: foto.fotoId,
      fotoKind: foto.fotoKind,
      fotoHas: foto.hasPhotos,
      bases: bases.map(({ bp, ...b }) => b),
    }
  }

  // Un renglón del pedido trae hasta tres códigos (ML, universal y SKU): se
  // prueban todos, porque en la app el producto puede estar cargado con
  // cualquiera de ellos
  const clave = (refs) => {
    for (const r of [].concat(refs).filter(Boolean)) {
      const m = buscar(r)
      if (m) return `${m.type}:${m.type === 'product' ? m.p.id : m.c.id}`
    }
    return 'x:' + normalize([].concat(refs)[0] || '')
  }

  // ---- Cuadro de avance: lo pedido por ML contra lo escaneado ----
  const avance = useMemo(() => {
    const porRef = new Map()
    pedido.forEach(l => {
      const k = clave(l.refs?.length ? l.refs : l.ref)
      const x = porRef.get(k) || { k, ref: l.ref, nombre: l.nombre || '', pedido: 0, escaneado: 0, enSistema: !k.startsWith('x:'), variantes: [] }
      x.pedido += Number(l.cantidad) || 0
      x.variantes.push({ ref: l.ref, nombre: l.nombre || '', cantidad: Number(l.cantidad) || 0 })
      if (!x.nombre && l.nombre) x.nombre = l.nombre
      porRef.set(k, x)
    })
    escaneos.forEach(s => {
      const k = clave(s.ref)
      const x = porRef.get(k) || { k, ref: s.ref, nombre: s.nombre || '', pedido: 0, escaneado: 0, enSistema: !k.startsWith('x:'), variantes: [] }
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
    // Lo que este envío sacó del stock. Tiene que dar igual que "armado": si no
    // da, es que algo se descontó de más o de menos.
    const salidas = escaneos.reduce((a, s) => a + yaDescontado(s), 0)
    return { pedidas, escaneadas, faltan, demas, salidas, completo: pedidas > 0 && faltan === 0 }
  }, [avance, escaneos])

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
    // Cuánto pidió ML de este artículo y cuánto va armado, para avisar si se
    // pasa de lo pedido
    const fila = avance.find(f => f.k === `${info.tipo}:${info.id}`)
    setPendiente({
      ...info,
      yaLleva: fila?.escaneado || 0,
      pedidoML: fila?.pedido || 0,
      variantes: fila?.variantes || [],
      hayPedido: pedido.length > 0,
    })
  }

  // Confirmar: anota en el envío Y descuenta el stock de una vez
  const confirmar = async () => {
    if (!pendiente || pendiente.noEncontrado || !envio) return
    const n = Math.round(Number(cantidad) || 0)
    if (!n) return
    // En negativo es una CORRECCIÓN: saca unidades del envío y las devuelve al
    // stock, que es lo que hace falta cuando se cargó de más
    if (n < 0) {
      const sacar = Math.min(-n, pendiente.yaLleva || 0)
      if (!sacar) { setMsg('❌ Ese artículo no tiene unidades cargadas en este envío'); return }
      setBusy(true)
      try {
        await onDescontar(
          pendiente.bases.map(b => ({
            productId: b.productId, productName: b.productName,
            quantity: Math.abs(b.quantity * sacar),
            reason: `Corrección envío a Full N° ${envio.numero}`,
          })),
          { reference: `Envío Full N° ${envio.numero}`, reason: `Corrección envío a Full N° ${envio.numero}` }
        )
        const queda = (pendiente.yaLleva || 0) - sacar
        const nuevos = queda > 0
          ? escaneos.map(s => (normalize(s.ref) === normalize(pendiente.code)
              ? { ...s, cantidad: queda, descontado: Math.min(yaDescontado(s), queda) }
              : s))
          : escaneos.filter(s => normalize(s.ref) !== normalize(pendiente.code))
        await onUpdate(envio.id, { escaneos: nuevos })
        setMsg(`↩️ ${pendiente.nombre} — se sacaron ${sacar} del envío y volvieron al stock. Quedan ${queda}.`)
        setPendiente(null)
        if (volverACamara) setShowScanner(true)
      } catch (err) {
        setMsg('❌ No se pudo corregir: ' + err.message)
      } finally {
        setBusy(false)
      }
      return
    }
    // Avisar ANTES de descontar si se está pasando de lo que pidió ML
    const total = (pendiente.yaLleva || 0) + n
    if (pendiente.pedidoML > 0 && total > pendiente.pedidoML) {
      const sobran = total - pendiente.pedidoML
      if (!window.confirm(
        `⚠️ TE ESTÁS PASANDO\n\nML pidió ${pendiente.pedidoML} de este artículo y con estas ${n} ` +
        `quedarían ${total}: ${sobran} de más.\n\n¿Cargarlas igual?`
      )) return
    } else if (pendiente.hayPedido && !pendiente.pedidoML) {
      if (!window.confirm(
        `⚠️ Este artículo NO figura en el pedido de ML de este envío.\n\n¿Cargarlo igual?`
      )) return
    }
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
      if (i >= 0) nuevos[i] = {
        ...nuevos[i],
        cantidad: (Number(nuevos[i].cantidad) || 0) + n,
        descontado: yaDescontado(nuevos[i]) + n,
      }
      else nuevos.push({ ref: pendiente.code, nombre: pendiente.nombre, cantidad: n, tipo: pendiente.tipo, descontado: n })
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

  // Cambiar lo armado de un renglón. Si baja por debajo de lo que ya salió del
  // stock, esas unidades VUELVEN al stock: salieron de la caja del envío, así
  // que están de nuevo en el depósito. Antes no volvían y ese era el agujero
  // por el que se descontaba dos veces.
  const ajustarRenglon = async (ref, cantidad) => {
    if (!envio || envio.estado === 'cerrado') return
    const linea = escaneos.find(s => normalize(s.ref) === normalize(ref))
    if (!linea) return
    const n = Math.max(0, Math.round(Number(cantidad) || 0))
    if (n === (Number(linea.cantidad) || 0)) return
    const salidas = yaDescontado(linea)
    const devolver = Math.max(0, salidas - n)
    const info = devolver ? resolver(ref) : null
    if (devolver && !info) {
      setMsg(`❌ ${ref} no está en el sistema: no se puede devolver el stock a mano desde acá`)
      return
    }
    if (devolver && !window.confirm(
      `${linea.nombre || ref}\n\n` +
      `Armado: de ${linea.cantidad} a ${n}.\n` +
      `Se DEVUELVEN ${devolver} unidades al stock.\n\n¿Confirmás?`
    )) return
    setBusy(true); setMsg('')
    try {
      if (devolver) {
        await onDescontar(
          info.bases.map(b => ({
            productId: b.productId, productName: b.productName,
            quantity: Math.abs(b.quantity * devolver),
            reason: `Corrección envío a Full N° ${envio.numero}`,
          })),
          { reference: `Envío Full N° ${envio.numero}`, reason: `Corrección envío a Full N° ${envio.numero}` }
        )
      }
      const nuevos = n === 0
        ? escaneos.filter(s => normalize(s.ref) !== normalize(ref))
        : escaneos.map(s => (normalize(s.ref) === normalize(ref)
            ? { ...s, cantidad: n, descontado: Math.min(salidas, n) }
            : s))
      await onUpdate(envio.id, { escaneos: nuevos })
      if (devolver) setMsg(`↩️ ${devolver} unidades volvieron al stock.`)
    } catch (err) {
      setMsg('❌ No se pudo corregir: ' + err.message)
    } finally {
      setBusy(false)
    }
  }
  const quitar = (ref) => ajustarRenglon(ref, 0)
  const cambiarCantidad = (ref, cantidad) => ajustarRenglon(ref, cantidad)

  useEffect(() => {
    const mirar = () => {
      const conMouse = window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches
      setEsPC(!!conMouse && window.innerWidth >= 900)
    }
    mirar()
    window.addEventListener('resize', mirar)
    return () => window.removeEventListener('resize', mirar)
  }, [])

  // Marcar varios renglones como ya enviados, sin escanearlos: descuenta del
  // stock lo que falta de cada uno y lo anota en el envío.
  //
  // Va todo junto a propósito. Al principio era un botón por renglón, pero
  // preguntaba y escribía en la base una vez por clic, y marcar veinte
  // artículos tardaba una eternidad. Ahora se tildan los que hicieron falta,
  // se pregunta una sola vez y se escribe una sola vez.
  const marcarElegidos = async () => {
    if (!envio || envio.estado === 'cerrado') return
    const filas = avance.filter(f => elegidos.has(f.k) && f.falta > 0 && f.enSistema)
    if (!filas.length) return

    const renglones = []
    const nuevos = [...escaneos]
    const sinResolver = []
    filas.forEach(f => {
      const info = resolver(f.ref)
      if (!info) { sinResolver.push(f.ref); return }
      const n = f.falta
      info.bases.forEach(b => renglones.push({
        productId: b.productId, productName: b.productName,
        quantity: -Math.abs(b.quantity * n),
        reason: `Envío a Full N° ${envio.numero}`,
      }))
      const i = nuevos.findIndex(x => normalize(x.ref) === normalize(f.ref))
      if (i >= 0) nuevos[i] = {
        ...nuevos[i],
        cantidad: (Number(nuevos[i].cantidad) || 0) + n,
        descontado: yaDescontado(nuevos[i]) + n,
      }
      else nuevos.push({ ref: f.ref, nombre: info.nombre, cantidad: n, tipo: info.tipo, descontado: n })
    })
    if (!renglones.length) { setMsg('❌ Ninguno de los elegidos está en el sistema'); return }

    const unidades = filas.reduce((a, f) => a + f.falta, 0)
    if (!window.confirm(
      `Marcar ${filas.length} ${filas.length === 1 ? 'artículo' : 'artículos'} como enviados ` +
      `(${unidades} unidades en total).\n\nSe descuentan del stock y se anotan en el envío N° ${envio.numero}.` +
      (sinResolver.length ? `\n\n⚠️ ${sinResolver.length} quedan afuera porque no están en el sistema.` : '') +
      `\n\n¿Confirmás?`
    )) return

    setBusy(true); setMsg('')
    try {
      await onDescontar(renglones, {
        reference: `Envío Full N° ${envio.numero}`,
        reason: `Envío a Full N° ${envio.numero}`,
      })
      await onUpdate(envio.id, { escaneos: nuevos })
      setElegidos(new Set())
      setMsg(`✅ ${filas.length} ${filas.length === 1 ? 'artículo marcado' : 'artículos marcados'} como enviados — ${unidades} unidades descontadas del stock.`)
    } catch (err) {
      setMsg('❌ No se pudo descontar: ' + err.message)
    } finally {
      setBusy(false)
    }
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

  // Qué cambió ML entre el listado que teníamos y el que se está cargando.
  // Sirve para poder actualizar el pedido sin tocar lo ya armado: lo escaneado
  // y descontado queda igual, y lo que se recalcula es cuánto falta.
  const compararPedidos = (viejo, nuevo) => {
    const juntar = (lista) => {
      const m = new Map()
      lista.forEach(l => {
        const k = clave(l.refs?.length ? l.refs : l.ref)
        const x = m.get(k) || { k, ref: l.ref, nombre: l.nombre || '', cantidad: 0 }
        x.cantidad += Number(l.cantidad) || 0
        if (!x.nombre && l.nombre) x.nombre = l.nombre
        m.set(k, x)
      })
      return m
    }
    const antes = juntar(viejo)
    const ahora = juntar(nuevo)
    const cambios = []
    new Set([...antes.keys(), ...ahora.keys()]).forEach(k => {
      const a = antes.get(k)?.cantidad || 0
      const b = ahora.get(k)?.cantidad || 0
      if (a === b) return
      const info = ahora.get(k) || antes.get(k)
      cambios.push({ ref: info.ref, nombre: info.nombre, antes: a, ahora: b })
    })
    cambios.sort((x, y) => Math.abs(y.ahora - y.antes) - Math.abs(x.ahora - x.antes))
    return cambios
  }

  // Guardar los códigos sueltos como código de barras del combo/producto que ya
  // existe. Es ADITIVO: los códigos que ya tenía quedan como están.
  const asociarCodigos = async () => {
    if (!porAsociar?.length || !onAsociarCodigos) return
    const total = porAsociar.reduce((a, x) => a + x.faltan.length, 0)
    if (!window.confirm(
      `Asociar ${total} ${total === 1 ? 'código' : 'códigos'} a ${porAsociar.length} ` +
      `${porAsociar.length === 1 ? 'artículo' : 'artículos'} que ya están en el sistema.\n\n` +
      `Se AGREGAN como código de barras: los que ya tenían cargados no se tocan.\n\n¿Confirmás?`
    )) return
    setBusy(true); setMsg('')
    try {
      const patches = { products: [], combos: [] }
      porAsociar.forEach(x => {
        const actual = x.tipo === 'product'
          ? products.find(p => p.id === x.id)
          : combos.find(c => c.id === x.id)
        if (!actual) return
        const previos = barcodesOf(actual)
        const nuevos = [...previos]
        x.faltan.forEach(r => {
          if (!nuevos.some(b => normalize(b) === normalize(r))) nuevos.push(r)
        })
        const destino = x.tipo === 'product' ? patches.products : patches.combos
        destino.push({ id: x.id, patch: { barcodes: nuevos, barcode: nuevos[0] || '' } })
      })
      await onAsociarCodigos(patches)
      setPorAsociar(null)
      setMsg(`🔗 ${total} códigos asociados. Volvé a escanear las etiquetas: ahora tienen que entrar.`)
    } catch (err) {
      setMsg('❌ No se pudieron asociar: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  // Volver al pedido que había antes de la última actualización. Lo armado y
  // descontado no se toca nunca: esto sólo cambia contra qué se compara.
  const volverAlAnterior = async () => {
    if (!envio?.pedidoAnterior?.length) return
    if (envio.estado === 'cerrado') { setMsg('❌ Este envío está cerrado. Reabrilo primero.'); return }
    const u = envio.pedidoAnterior.reduce((a, r) => a + (Number(r.cantidad) || 0), 0)
    if (!window.confirm(
      `Volver al pedido anterior: ${envio.pedidoAnterior.length} renglones · ${u} unidades.\n\n` +
      `Lo armado y descontado no se toca.\n\n¿Confirmás?`
    )) return
    setBusy(true); setMsg('')
    try {
      await onUpdate(envio.id, { pedido: envio.pedidoAnterior, pedidoAnterior: [], ultimoCambio: null })
      setMsg(`↩️ Se volvió al pedido anterior: ${envio.pedidoAnterior.length} renglones, ${u} unidades.`)
    } catch (err) {
      setMsg('❌ No se pudo volver atrás: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  // ---- Listado que pidió ML ----
  const importarPedido = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !envio) return
    if (envio.estado === 'cerrado') { setMsg('❌ Este envío está cerrado. Reabrilo si de verdad querés cambiarle el pedido.'); return }
    setBusy(true); setMsg('')
    try {
      const wb = XLSX.read(await file.arrayBuffer())
      let filas = []

      // 1) Formato de ML: los tres códigos en una celda. Se recorre fila por
      //    fila, salteando los encabezados que el PDF repite en cada página.
      for (const nombre of wb.SheetNames) {
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, defval: '' })
        const encontradas = []
        for (const fila of aoa) {
          const texto = fila.map(c => String(c ?? '')).join(' \n ')
          const m = RX_ML.exec(texto)
          if (!m) continue
          const [, codigoML, universal, sku] = m
          // La cantidad es el primer número suelto de la fila (columna UNIDADES)
          let cant = 0
          for (let i = 1; i < fila.length; i++) {
            const n = Number(String(fila[i] ?? '').replace(/\./g, '').replace(',', '.'))
            if (n > 0) { cant = Math.round(n); break }
          }
          // El título del producto viene después del salto de línea
          const titulo = String(fila[0] ?? '').split('\n').slice(1).join(' ').trim()
          const vale = (c) => c && !/^(n\/?a|-+)$/i.test(c)
          const refs = [codigoML, universal, sku].filter(vale)
          encontradas.push({ ref: codigoML, refs, sku, cantidad: cant, nombre: titulo })
        }
        if (encontradas.length) { filas = encontradas; break }
      }

      // 2) Si no es el listado de ML, se acepta un Excel común con encabezados
      if (!filas.length) {
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
          // Sin columna de cantidad NO se sigue. Antes se asumía 1 por renglón
          // y eso pisó un pedido de 3262 unidades con uno de 52 sin decir nada.
          if (!cols.qty) {
            throw new Error(
              `Encontré los códigos pero ninguna columna de cantidad en la hoja "${nombre}". ` +
              `Las columnas son: ${Object.keys(raw[0]).join(' · ')}. ` +
              `Renombrá la de unidades a "Cantidad" y volvé a subirlo.`
            )
          }
          filas = raw.map(r => ({
            ref: String(r[cols.ref] ?? '').trim(),
            refs: [String(r[cols.ref] ?? '').trim()],
            cantidad: Math.max(0, Math.round(Number(String(r[cols.qty] ?? 0).replace(/\./g, '').replace(',', '.')) || 0)),
            nombre: cols.name ? String(r[cols.name] ?? '').trim() : '',
          })).filter(r => r.ref)
          if (filas.length) break
        }
      }
      if (!filas.length) throw new Error('No reconocí el archivo. Tiene que ser el listado de preparación de ML (el PDF pasado a Excel) o un Excel con una columna de código y otra de cantidad.')
      const sinSistema = filas.filter(r => !(r.refs || [r.ref]).some(x => buscar(x))).length

      // Las etiquetas de Full traen el CÓDIGO ML (4 letras + 5 números, el que
      // se escanea) y el SKU (MLA...). Si el combo está cargado con el MLA pero
      // nunca se le guardó el código ML, escanear la etiqueta da "no está en el
      // sistema" aunque el artículo exista. Acá se detectan esos casos para
      // poder asociarlos: se AGREGAN códigos, no se pisa ninguno.
      const sueltos = []
      const vistos = new Set()
      filas.forEach(l => {
        const refs = (l.refs?.length ? l.refs : [l.ref]).filter(Boolean)
        const m = refs.map(r => buscar(r)).find(Boolean)
        if (!m) return                                  // no está en el sistema: otro problema
        const x = m.type === 'product' ? m.p : m.c
        const yaTiene = new Set([x.code, ...barcodesOf(x)].filter(Boolean).map(v => normalize(v)))
        const faltan = refs.filter(r => !yaTiene.has(normalize(r)))
        if (!faltan.length || vistos.has(x.id)) return
        vistos.add(x.id)
        sueltos.push({ tipo: m.type, id: x.id, nombre: x.name, code: x.code || '', faltan })
      })
      setPorAsociar(sueltos.length ? sueltos : null)
      const unidades = filas.reduce((s, r) => s + r.cantidad, 0)

      // Si el envío ya tenía un pedido cargado, esto es una ACTUALIZACIÓN: ML
      // cambió lo que pide. Lo armado y descontado no se toca — sólo cambia
      // contra qué se compara.
      let cambios = []
      if (pedido.length) {
        cambios = compararPedidos(pedido, filas)
        if (!cambios.length) {
          setMsg('El listado nuevo pide exactamente lo mismo que el que ya estaba. No cambió nada.')
          return
        }
        const nuevos = cambios.filter(c => c.antes === 0).length
        const sacados = cambios.filter(c => c.ahora === 0).length
        const movidos = cambios.length - nuevos - sacados
        const armadas = escaneos.reduce((a, x) => a + (Number(x.cantidad) || 0), 0)
        const unidadesAntes = pedido.reduce((a, r) => a + (Number(r.cantidad) || 0), 0)
        // Si el total se desploma, casi siempre es que el archivo se leyó mal
        const sospechoso = unidadesAntes > 0 && unidades < unidadesAntes / 2
        if (!window.confirm(
          `ML cambió el pedido de este envío:\n\n` +
          `ANTES: ${pedido.length} renglones · ${unidadesAntes} unidades\n` +
          `AHORA: ${filas.length} renglones · ${unidades} unidades\n\n` +
          `· ${nuevos} ${nuevos === 1 ? 'artículo nuevo' : 'artículos nuevos'}\n` +
          `· ${sacados} que ya no ${sacados === 1 ? 'pide' : 'piden'}\n` +
          `· ${movidos} con otra cantidad\n\n` +
          (sospechoso
            ? `⚠️ OJO: el total cayó de ${unidadesAntes} a ${unidades} unidades. ` +
              `Si ML no bajó el pedido tanto, el archivo se leyó mal — cancelá y revisalo.\n\n`
            : '') +
          `Las ${armadas} unidades que ya armaste y descontaste NO se tocan: ` +
          `queda todo como está y sólo se recalcula cuánto falta.\n\n¿Actualizar el pedido?`
        )) return
      }

      await onUpdate(envio.id, {
        pedido: filas,
        // El pedido anterior se guarda entero para poder volver atrás de un
        // clic si el archivo se leyó mal
        ...(cambios.length ? {
          pedidoAnterior: pedido,
          ultimoCambio: { fecha: new Date().toISOString(), cambios: cambios.slice(0, 60) },
        } : {}),
      })
      setMsg(
        (cambios.length ? `✅ Pedido actualizado: ` : `✅ Pedido de ML cargado: `) +
        `${filas.length} renglones, ${unidades} unidades.` +
        (cambios.length ? ` Cambiaron ${cambios.length} artículos. Lo armado quedó intacto.` : '') +
        (sinSistema ? ` ⚠️ ${sinSistema} no están cargados en la app.` : '') +
        (sueltos.length ? ` 🔗 ${sueltos.length} tienen códigos sin asociar (abajo).` : '')
      )
    } catch (err) {
      setMsg('❌ ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  // ---- Descontar stock ----
  const pendientesDeDescontar = escaneos.filter(s => yaDescontado(s) < (Number(s.cantidad) || 0))
  const descontar = async () => {
    if (!envio || !pendientesDeDescontar.length) return
    const renglones = []
    const noEncontrados = []
    pendientesDeDescontar.forEach(s => {
      const info = resolver(s.ref)
      if (!info) { noEncontrados.push(s.ref); return }
      // Sólo lo que todavía NO salió del stock de este renglón
      const falta = (Number(s.cantidad) || 0) - yaDescontado(s)
      if (falta <= 0) return
      info.bases.forEach(b => renglones.push({
        productId: b.productId,
        productName: b.productName,
        quantity: -Math.abs(b.quantity * falta),
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
        escaneos: escaneos.map(s => ({ ...s, descontado: Number(s.cantidad) || 0 })),
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
    if (!window.confirm(
      `¿Cerrar el Envío a Full N° ${envio.numero}?\n\n` +
      `Queda bloqueado: no se puede escanear, ni marcar, ni cambiar cantidades, ni actualizar el pedido de ML. ` +
      `Para tocarlo hay que reabrirlo a propósito.`
    )) return
    await onUpdate(envio.id, { estado: 'cerrado', closedAt: new Date().toISOString() })
  }
  const reabrir = async () => envio && onUpdate(envio.id, { estado: 'abierto' })

  const filasTabla = soloFaltan ? avance.filter(f => f.falta > 0) : avance
  // Lo que se puede marcar de un tilde: falta algo y está cargado en la app
  const marcables = filasTabla.filter(f => f.falta > 0 && f.enSistema)
  const elegidasUnidades = avance
    .filter(f => elegidos.has(f.k))
    .reduce((a, f) => a + f.falta, 0)

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
              ✅ Todo lo de este envío ya está descontado del stock ({totales.salidas} unidades).
            </div>
          )}

          {totales.salidas > totales.escaneadas && (
            <div className="full-aviso mal">
              ⚠️ Este envío sacó {totales.salidas} unidades del stock pero tiene {totales.escaneadas} armadas:
              hay {totales.salidas - totales.escaneadas} descontadas de más. Cargá la entrada desde Movimientos.
            </div>
          )}

          {canEdit && porAsociar?.length > 0 && (
            <div className="full-asociar">
              <div className="full-asociar-top">
                <strong>🔗 {porAsociar.length} artículos del pedido tienen códigos sin asociar</strong>
                <button className="full-btn" onClick={asociarCodigos} disabled={busy}>
                  {busy ? '⏳ Asociando...' : 'Asociar todos'}
                </button>
                <button className="full-btn plano" onClick={() => setPorAsociar(null)} disabled={busy}>
                  Ahora no
                </button>
              </div>
              <p className="full-asociar-hint">
                Están cargados en el sistema con su SKU de ML, pero les falta el código de la etiqueta
                de Full. Por eso al escanearlos dice "no está en el sistema". Asociarlos sólo AGREGA
                códigos: los que ya tenían quedan igual.
              </p>
              <table>
                <thead><tr><th>Artículo</th><th>SKU cargado</th><th>Códigos a agregar</th></tr></thead>
                <tbody>
                  {porAsociar.map(x => (
                    <tr key={x.id}>
                      <td>{x.nombre}</td>
                      <td className="full-code">{x.code || '—'}</td>
                      <td className="full-code">{x.faltan.join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {envio.ultimoCambio?.cambios?.length > 0 && (
            <details className="full-cambios">
              <summary>
                📝 ML cambió el pedido el {fmtFecha(envio.ultimoCambio.fecha)} —
                {' '}{envio.ultimoCambio.cambios.length} artículos. Lo armado no se tocó.
              </summary>
              {canEdit && envio.pedidoAnterior?.length > 0 && (
                <button className="full-btn plano" onClick={volverAlAnterior} disabled={busy}>
                  ↩️ Volver al pedido anterior ({envio.pedidoAnterior.reduce((a, r) => a + (Number(r.cantidad) || 0), 0)} unidades)
                </button>
              )}
              <table>
                <thead>
                  <tr><th>Código</th><th>Producto</th><th>Pedía</th><th>Pide ahora</th></tr>
                </thead>
                <tbody>
                  {envio.ultimoCambio.cambios.map((c, i) => (
                    <tr key={i} className={c.ahora === 0 ? 'sacado' : (c.antes === 0 ? 'nuevo' : '')}>
                      <td className="full-code">{c.ref}</td>
                      <td>{c.nombre || '—'}</td>
                      <td className="num">{c.antes || '—'}</td>
                      <td className="num">{c.ahora || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}

          <div className="full-acciones">
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={importarPedido} />
            {canEdit && envio.estado !== 'cerrado' && (
              <>
                <button className="full-btn" onClick={() => setShowScanner(true)}>📷 Escanear</button>
                <button className="full-btn sec" onClick={() => fileRef.current?.click()} disabled={busy}>
                  📥 {pedido.length ? 'Actualizar pedido de ML' : 'Cargar pedido de ML'}
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
              <button className="full-btn" type="submit">🔍 Buscar</button>
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
                      {pendiente.pedidoML > 0 ? (
                        <div className="full-modal-pedido">
                          <span>ML pidió <strong>{pendiente.pedidoML}</strong></span>
                          <span>Ya van <strong>{pendiente.yaLleva}</strong></span>
                          <span>Faltan <strong>{Math.max(0, pendiente.pedidoML - pendiente.yaLleva)}</strong></span>
                        </div>
                      ) : null}
                      {pendiente.variantes?.length > 1 && (
                        <div className="full-modal-variantes">
                          ML lo pide en {pendiente.variantes.length} variantes:{' '}
                          {pendiente.variantes.map(v => `${v.nombre || v.ref} (${v.cantidad})`).join(' · ')}
                        </div>
                      )}
                      {!pendiente.pedidoML && pendiente.yaLleva > 0 && (
                        <div className="full-modal-ya">Ya van {pendiente.yaLleva} en este envío</div>
                      )}
                    </div>
                  </div>

                  {pendiente.pedidoML > 0 && (pendiente.yaLleva + cantidad) > pendiente.pedidoML && (
                    <div className="full-modal-exceso">
                      ⚠️ TE ESTÁS PASANDO — ML pidió {pendiente.pedidoML} y quedarían{' '}
                      {pendiente.yaLleva + cantidad}: {pendiente.yaLleva + cantidad - pendiente.pedidoML} de más
                    </div>
                  )}
                  {pendiente.hayPedido && !pendiente.pedidoML && (
                    <div className="full-modal-exceso suave">
                      ⚠️ Este artículo NO está en el pedido de ML de este envío
                    </div>
                  )}

                  <div className={`full-modal-empaque ${pendiente.primerEmpaque ? 'si' : 'no'}`}>
                    {pendiente.primerEmpaque
                      ? '📦 LLEVA PRIMER EMPAQUE — envolvelo antes de meterlo'
                      : '✔️ NO LLEVA PRIMER EMPAQUE'}
                  </div>
                  {pendiente.fragile && <div className="full-modal-fragil">⚠️ FRÁGIL</div>}

                  <div className="full-modal-cant-titulo">¿Cuántas van?</div>
                  <div className="full-modal-chips">
                    {CANTIDADES.map(n => (
                      <button
                        key={n}
                        className={`full-chip ${cantidad === n ? 'active' : ''}`}
                        onClick={() => setCantidad(n)}
                        disabled={busy}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <div className="full-modal-cant">
                    <button
                      onClick={() => setCantidad(c => Math.max(-(pendiente.yaLleva || 0), c - 1))}
                      disabled={busy}
                    >−</button>
                    <input
                      type="number" min={-(pendiente.yaLleva || 0)} value={cantidad}
                      onChange={e => setCantidad(Math.round(Number(e.target.value) || 0))}
                    />
                    <button onClick={() => setCantidad(c => c + 1)} disabled={busy}>+</button>
                    <span>unidades</span>
                  </div>

                  <button
                    className={`full-modal-btn ${cantidad < 0 ? 'devolver' : ''}`}
                    onClick={confirmar}
                    disabled={busy || cantidad === 0}
                  >
                    {busy ? '⏳ Guardando...'
                      : cantidad === 0 ? 'Poné una cantidad'
                      : cantidad < 0
                        ? `↩️ Sacar ${-cantidad} ${cantidad === -1 ? 'unidad' : 'unidades'} del envío y devolverlas al stock`
                        : `✅ Descontar ${cantidad} ${cantidad === 1 ? 'unidad' : 'unidades'} y anotar en envío N° ${envio.numero}`}
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
                    <th>Código</th><th>Producto</th><th>Pedido ML</th><th>Armado</th><th>Falta</th><th>De más</th>
                    {esPC && (
                      <th className="full-check-col">
                        <input
                          type="checkbox"
                          title="Elegir todo lo que falta"
                          checked={marcables.length > 0 && marcables.every(f => elegidos.has(f.k))}
                          onChange={e => setElegidos(e.target.checked ? new Set(marcables.map(f => f.k)) : new Set())}
                        />
                      </th>
                    )}
                    <th />
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
                      {esPC && (
                        <td className="full-check-col">
                          {canEdit && envio.estado !== 'cerrado' && f.falta > 0 && f.enSistema && (
                            <input
                              type="checkbox"
                              disabled={busy}
                              checked={elegidos.has(f.k)}
                              onChange={e => setElegidos(prev => {
                                const n = new Set(prev)
                                if (e.target.checked) n.add(f.k); else n.delete(f.k)
                                return n
                              })}
                              title={`Marcar las ${f.falta} que faltan como enviadas`}
                            />
                          )}
                        </td>
                      )}
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

          {esPC && elegidos.size > 0 && (
            <div className="full-barra">
              <span>
                <strong>{elegidos.size}</strong> {elegidos.size === 1 ? 'artículo elegido' : 'artículos elegidos'}
                {' · '}<strong>{elegidasUnidades}</strong> unidades
              </span>
              <button className="full-btn ok" onClick={marcarElegidos} disabled={busy}>
                {busy ? '⏳ Descontando...' : '✓ Marcar como enviados y descontar'}
              </button>
              <button className="full-btn plano" onClick={() => setElegidos(new Set())} disabled={busy}>
                Destildar todo
              </button>
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
