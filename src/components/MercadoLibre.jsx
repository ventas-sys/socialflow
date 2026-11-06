import React, { useState, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { cordonDe } from '../utils/cordon'
import { findProductOrCombo } from '../utils/refMatch'
import { compressImage } from '../utils/images'
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

export default function MercadoLibre({ products, combos, mlAccounts, onSaveAccount, onPurchase, onGuardarFotos }) {
  const [forms, setForms] = useState({}) // edición de clientId/secret por cuenta
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState({})
  const [preview, setPreview] = useState(null) // { account, lines, orders, skipped }

  const redirectUri = `${window.location.origin}/`

  // Mapear un item de ML (por SKU o MLA) a producto/combo → lista de deltas de stock
  const findByRef = (ref) => findProductOrCombo(products, combos, ref)

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
    const mpToken = (f.mpToken ?? mlAccounts?.[key]?.mpToken ?? '').trim()
    await onSaveAccount(key, { clientId, clientSecret, mpToken })
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

  // --- Fotos de los productos base, traídas de las publicaciones de ML ---
  //
  // Hay cientos de productos base sin ninguna foto, y la foto YA EXISTE: está
  // en la publicación que vende ese producto. Esto la trae sola: entra a cada
  // producto sin foto, busca a qué publicación corresponde, se queda con la
  // PRIMERA foto de esa publicación y la guarda en el producto base.
  //
  // A qué publicación corresponde cada producto se resuelve igual que en el
  // resto de la solapa: el SKU (o el MLA) de la publicación cae sobre un
  // producto o sobre un combo, y el combo lleva productos adentro.
  //
  // Regla importante, la misma que usa fotoDeCombo: si la publicación arma un
  // combo que MEZCLA productos distintos, su foto no representa a ninguno de
  // ellos y NO se usa. Poner la foto de un combo de cinco cosas en un producto
  // base es peor que dejarlo sin foto: quien arma el pedido agarra lo que no es.
  //
  // A los productos que ya tienen foto no se los toca nunca.
  const sinFotoCount = useMemo(() => products.filter(p => !p.hasPhotos).length, [products])
  const [fotosBusy, setFotosBusy] = useState(false)
  const [fotosMsg, setFotosMsg] = useState('')
  const [fotosRes, setFotosRes] = useState(null)

  // Las fotos de ML vienen como secure_url, pero si alguna llega en http la
  // página (que es https) la bloquea como contenido mixto y no se baja nunca.
  const aHttps = (u) => String(u || '').replace(/^http:\/\//, 'https://')

  const traerFotosDeML = async () => {
    const sinFoto = products.filter(p => !p.hasPhotos)
    if (!sinFoto.length) { setFotosMsg('✅ Todos los productos base ya tienen foto.'); return }
    const conectadas = ACCOUNTS.filter(a => mlAccounts?.[a.key]?.accessToken)
    if (!conectadas.length) { setFotosMsg('⚠️ No hay ninguna cuenta de ML conectada.'); return }
    if (!onGuardarFotos) { setFotosMsg('⚠️ Esta versión no puede guardar las fotos. Actualizá la app.'); return }

    setFotosBusy(true); setFotosMsg(''); setFotosRes(null)
    try {
      // 1) Publicaciones activas de todas las cuentas conectadas
      const activas = []
      let faltaronPub = 0
      for (const { key, label } of conectadas) {
        setFotosMsg(`⏳ Leyendo las publicaciones de ${label}...`)
        const token = await ensureToken(key)
        const r = await fetch(`${API}?action=items`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        }).then(x => x.json())
        if (!r.ok) throw new Error(`${label}: ${r.error || 'no se pudieron leer las publicaciones'}`)
        faltaronPub += r.faltaron || 0
        r.items.forEach(it => {
          if (!it.status || it.status === 'active') activas.push({ ...it, cuenta: label, key })
        })
      }

      // 2) Qué publicaciones podrían dar la foto de cada producto sin foto.
      //    Se guardan hasta 2 candidatas por producto, ordenadas: primero la
      //    publicación que cae derecho sobre el producto, después la que lo
      //    vende a través de un combo de un solo artículo.
      setFotosMsg('⏳ Cruzando las publicaciones con los productos sin foto...')
      const faltan = new Map(sinFoto.map(p => [p.id, p]))
      const cand = new Map()
      let mezclados = 0
      const agregar = (pid, it, prioridad, via) => {
        const lista = cand.get(pid) || []
        if (lista.some(x => x.mla === it.mla)) return
        lista.push({ mla: it.mla, cuenta: it.cuenta, key: it.key, titulo: it.title, prioridad, via })
        lista.sort((a, b) => a.prioridad - b.prioridad)
        cand.set(pid, lista.slice(0, 2))
      }
      for (const it of activas) {
        const m = findByRef(it.sku) || findByRef(it.mla)
        if (!m) continue
        if (m.type === 'product') {
          if (faltan.has(m.p.id)) agregar(m.p.id, it, 1, 'publicación del producto')
          continue
        }
        const ids = [...new Set((m.c.items || []).map(ci => ci.productId).filter(Boolean))]
        if (ids.length > 1) { mezclados++; continue }
        if (ids.length !== 1) continue
        if (faltan.has(ids[0])) {
          agregar(ids[0], it, 2, `combo ${m.c.code || m.c.name || ''}`.trim())
        }
      }

      // 3) Las fotos de esas publicaciones. Cada publicación se pide con el
      //    token de SU cuenta, de a 200.
      const porCuenta = new Map()
      for (const lista of cand.values()) {
        for (const c of lista) {
          if (!porCuenta.has(c.key)) porCuenta.set(c.key, new Set())
          porCuenta.get(c.key).add(c.mla)
        }
      }
      const picsDe = new Map()
      for (const [key, set] of porCuenta) {
        const label = ACCOUNTS.find(a => a.key === key)?.label || key
        const ids = [...set]
        const token = await ensureToken(key)
        for (let i = 0; i < ids.length; i += 200) {
          setFotosMsg(`⏳ Buscando las fotos en ${label} (${Math.min(i + 200, ids.length)}/${ids.length})...`)
          const r = await fetch(`${API}?action=itemdetail`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, ids: ids.slice(i, i + 200) }),
          }).then(x => x.json())
          if (!r.ok) throw new Error(`${label}: ${r.error || 'no se pudieron leer las fotos'}`)
          r.items.forEach(x => picsDe.set(x.mla, x.pics || []))
        }
      }

      // 4) Para cada producto, la primera foto de la primera publicación que
      //    tenga alguna
      const plan = []
      const sinPublicacion = []
      const sinFotoEnML = []
      for (const p of sinFoto) {
        const lista = cand.get(p.id) || []
        if (!lista.length) { sinPublicacion.push(p); continue }
        const elegido = lista.find(c => (picsDe.get(c.mla) || []).length)
        if (!elegido) { sinFotoEnML.push({ ...p, mla: lista[0].mla, cuenta: lista[0].cuenta }); continue }
        plan.push({ p, ...elegido, url: aHttps(picsDe.get(elegido.mla)[0]) })
      }

      const resumen = {
        sinFoto: sinFoto.length,
        publicaciones: activas.length,
        cuentas: conectadas.map(c => c.label).join(' + '),
        mezclados,
        faltaronPub,
        sinPublicacion,
        sinFotoEnML,
      }

      if (!plan.length) {
        setFotosRes({ ...resumen, puestas: [], fallaron: [] })
        setFotosMsg('⚠️ No se encontró ninguna foto para traer. Mirá el detalle de abajo.')
        return
      }

      const seguir = window.confirm(
        `Voy a poner la PRIMERA foto de la publicación en ${plan.length} productos base que hoy no tienen ninguna.\n\n` +
        `• ${sinPublicacion.length} quedan sin foto: ninguna publicación activa cae sobre ellos.\n` +
        `• ${sinFotoEnML.length} tienen publicación, pero la publicación no tiene fotos.\n` +
        (mezclados ? `• ${mezclados} publicaciones son combos de productos distintos: no se usan, porque esa foto no representa a ninguno.\n` : '') +
        (faltaronPub ? `• ⚠️ ${faltaronPub} publicaciones no se pudieron leer (ML cortó). Si alguna era de estos productos, van a quedar sin foto; se puede volver a correr después.\n` : '') +
        `\nA los ${products.length - sinFoto.length} productos que YA tienen foto no se los toca. ¿Seguir?`
      )
      if (!seguir) { setFotosMsg('Cancelado, no se tocó nada.'); return }

      // 5) Bajar y comprimir (de a 4 para no ahogar la conexión del depósito)
      const listos = []
      const fallaron = []
      let n = 0
      const bajar = async (item) => {
        try {
          const r = await fetch(item.url)
          if (!r.ok) throw new Error('HTTP ' + r.status)
          const blob = await r.blob()
          if (!blob.size) throw new Error('la foto vino vacía')
          const dataUrl = await compressImage(blob, 700, 0.7)
          listos.push({ id: item.p.id, photos: [dataUrl], item })
        } catch (e) {
          fallaron.push({ ...item.p, mla: item.mla, cuenta: item.cuenta, motivo: 'No se pudo bajar la foto: ' + (e?.message || e) })
        } finally {
          n++
          setFotosMsg(`⏳ Bajando fotos... ${n}/${plan.length}`)
        }
      }
      for (let i = 0; i < plan.length; i += 4) {
        await Promise.all(plan.slice(i, i + 4).map(bajar))
      }

      // 6) Guardar
      let guardados = 0
      if (listos.length) {
        setFotosMsg(`⏳ Guardando ${listos.length} fotos...`)
        const r = await onGuardarFotos(
          listos.map(({ id, photos }) => ({ id, photos })),
          (hechas) => setFotosMsg(`⏳ Guardando fotos... ${hechas}/${listos.length}`),
        )
        guardados = r?.guardados ?? listos.length
        const malos = new Map((r?.fallaron || []).map(f => [f.id, f.motivo]))
        for (const l of listos) {
          if (malos.has(l.id)) {
            fallaron.push({ ...l.item.p, mla: l.item.mla, cuenta: l.item.cuenta, motivo: 'No se pudo guardar: ' + malos.get(l.id) })
          }
        }
      }
      const puestas = listos
        .filter(l => !fallaron.some(f => f.id === l.id))
        .map(l => ({ ...l.item.p, mla: l.item.mla, cuenta: l.item.cuenta, via: l.item.via, titulo: l.item.titulo }))

      // 7) Excel de lo que pasó, para revisarlo con calma
      const rows = [['Código', 'Producto', 'Resultado', 'Publicación (MLA)', 'Cuenta', 'De dónde salió la foto', 'Título de la publicación']]
      puestas.forEach(x => rows.push([x.code || '', x.name || '', 'Foto puesta', x.mla || '', x.cuenta || '', x.via || '', x.titulo || '']))
      fallaron.forEach(x => rows.push([x.code || '', x.name || '', x.motivo || 'Falló', x.mla || '', x.cuenta || '', '', '']))
      sinFotoEnML.forEach(x => rows.push([x.code || '', x.name || '', 'La publicación no tiene fotos', x.mla || '', x.cuenta || '', '', '']))
      sinPublicacion.forEach(x => rows.push([x.code || '', x.name || '', 'Ninguna publicación activa cae sobre este producto', '', '', '', '']))
      const ws = XLSX.utils.aoa_to_sheet(rows)
      ws['!cols'] = [{ wch: 14 }, { wch: 45 }, { wch: 46 }, { wch: 16 }, { wch: 10 }, { wch: 26 }, { wch: 50 }]
      const info = XLSX.utils.aoa_to_sheet([
        ['FOTOS DE PRODUCTOS BASE TRAÍDAS DE LAS PUBLICACIONES DE ML'],
        [''],
        [`Cuentas miradas: ${resumen.cuentas}`],
        [`Publicaciones activas leídas: ${activas.length}`],
        [`Productos base sin foto antes de empezar: ${sinFoto.length}`],
        [`Fotos puestas: ${puestas.length}`],
        [`No se pudieron bajar o guardar: ${fallaron.length}`],
        [`Con publicación pero la publicación no tiene fotos: ${sinFotoEnML.length}`],
        [`Sin ninguna publicación activa: ${sinPublicacion.length}`],
        [''],
        ['Cómo se eligió la foto:'],
        ['  1) Si hay una publicación cuyo SKU es el del producto, se usa esa.'],
        ['  2) Si no, la publicación de un combo que lleve SOLO ese producto.'],
        ['  3) De la publicación elegida se toma la PRIMERA foto, la principal.'],
        [''],
        [`Las publicaciones que son combos de productos DISTINTOS no se usaron (${mezclados}).`],
        ['Esa foto no representa a ninguno de los productos que lleva adentro, y'],
        ['ponerla en el producto base hace que quien arma el pedido agarre lo que no es.'],
        [''],
        ['A los productos que ya tenían foto no se los tocó.'],
      ])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, info, 'Resumen')
      XLSX.utils.book_append_sheet(wb, ws, 'Detalle')
      XLSX.writeFile(wb, `fotos-desde-ml-${new Date().toISOString().slice(0, 10)}.xlsx`)

      setFotosRes({ ...resumen, puestas, fallaron })
      setFotosMsg(`✅ Se pusieron ${puestas.length} fotos${fallaron.length ? `, ${fallaron.length} fallaron` : ''}. Se bajó el Excel con el detalle.`)
    } catch (e) {
      setFotosMsg('❌ ' + (e?.message || 'Error'))
    } finally {
      setFotosBusy(false)
    }
  }

  // --- Qué falta publicar en FULL, y qué publicación parecida hay en ML ---
  //
  // Son cientos de productos base que no están publicados en la cuenta FULL.
  // Armar cada publicación de cero es el cuello de botella. Esto arma la lista
  // y, para cada producto, busca en el mercado de ML hasta 3 publicaciones
  // parecidas, con el link, para que el usuario mire y ponga el OK.
  //
  // FERRE no se mira (decisión del usuario, 6/11/2026): se buscan candidatas
  // del mercado para TODOS los que falten, estén o no publicados en FERRE.
  //
  // De las publicaciones de otros vendedores no se copia nada: sirven de
  // referencia de categoría, ficha, precio y sobre todo del PRODUCTO DE
  // CATÁLOGO, que es lo que permite publicar rápido. Nada se marca como
  // "igual": esa decisión es del usuario mirando el link.
  //
  // Este botón NO publica ni modifica nada en ML. Sólo mira.
  const [pubBusy, setPubBusy] = useState(false)
  const [pubMsg, setPubMsg] = useState('')
  const [pubRes, setPubRes] = useState(null)

  // El nombre del producto, limpio, para buscarlo en ML. Los nombres del
  // depósito traen signos, la palabra "cod" y el código interno pegado, y todo
  // eso ensucia la búsqueda: ML no conoce nuestros códigos y los usa como
  // palabras, así que traía cualquier cosa.
  const RUIDO = new Set(['cod', 'codigo', 'sku', 'art', 'articulo', 'ref', 'unidad', 'unidades'])
  const comoBusqueda = (nombre, codigo) => String(nombre || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1)
    .filter(w => !RUIDO.has(w.toLowerCase()))
    // Números sueltos de 3 o más cifras: son códigos internos, no medidas
    .filter(w => !/^\d{3,}$/.test(w))
    .filter(w => !codigo || w.toLowerCase() !== String(codigo).toLowerCase())
    .slice(0, 10).join(' ')
    .slice(0, 60).trim()

  // Qué productos quedan cubiertos por una lista de publicaciones: la que cae
  // sobre un combo cubre a todos los productos que el combo lleva adentro.
  const cubiertosPor = (activas) => {
    const set = new Set()
    for (const it of activas) {
      const m = findByRef(it.sku) || findByRef(it.mla)
      if (!m) continue
      if (m.type === 'product') { set.add(m.p.id); continue }
      ;(m.c.items || []).forEach(ci => { if (ci.productId) set.add(ci.productId) })
    }
    return set
  }

  const buscarParaPublicarEnFull = async () => {
    if (!mlAccounts?.full?.accessToken) { setPubMsg('⚠️ La cuenta FULL no está conectada.'); return }
    setPubBusy(true); setPubMsg(''); setPubRes(null)
    try {
      // 1) Lo que YA está publicado en FULL
      setPubMsg('⏳ Leyendo las publicaciones de FULL...')
      const token = await ensureToken('full')
      const r = await fetch(`${API}?action=items`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }).then(x => x.json())
      if (!r.ok) throw new Error('FULL: ' + (r.error || 'no se pudieron leer las publicaciones'))
      const activas = r.items.filter(it => !it.status || it.status === 'active')
      const cubiertos = cubiertosPor(activas)
      const faltan = products.filter(p => !cubiertos.has(p.id))

      if (!faltan.length) {
        setPubMsg(`✅ Los ${products.length} productos base ya están publicados en FULL.`)
        return
      }

      const seguir = window.confirm(
        `Faltan publicar ${faltan.length} productos base en FULL.\n\n` +
        `Voy a buscar en el mercado de Mercado Libre, uno por uno, hasta 3 publicaciones\n` +
        `parecidas a cada uno, para que las mires y marques las que sirven.\n\n` +
        `Tarda unos minutos. Al final se baja el Excel.\n\n` +
        `No se publica ni se modifica NADA en ML: esto sólo mira. ¿Seguir?`
      )
      if (!seguir) { setPubMsg('Cancelado, no se tocó nada.'); return }

      // 2) Buscar candidatas en el mercado para todos los que faltan
      const encontradas = new Map()
      let sinBuscar = 0
      const consultas = faltan
        .map(p => ({ ref: p.id, q: comoBusqueda(p.name, p.code) }))
        .filter(c => { if (!c.q) { sinBuscar++; return false } return true })
      for (let i = 0; i < consultas.length; i += 120) {
        setPubMsg(`⏳ Buscando en Mercado Libre (${Math.min(i + 120, consultas.length)}/${consultas.length})...`)
        const rs = await fetch(`${API}?action=mlsearch`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, consultas: consultas.slice(i, i + 120) }),
        }).then(x => x.json())
        if (!rs.ok) throw new Error('Búsqueda: ' + (rs.error || 'no se pudo buscar'))
        rs.items.forEach(x => encontradas.set(x.ref, x))
      }

      // 3) Una fila por producto
      setPubMsg('⏳ Armando el Excel...')
      const filas = faltan.map(p => {
        const b = encontradas.get(p.id)
        const cands = b?.candidatas || []
        const conCatalogo = cands.find(c => c.catalogProductId)
        return {
          p,
          caso: cands.length ? 'Hay candidatas' : 'De cero',
          candidatas: cands,
          categoria: cands[0]?.categoryId || '',
          catalogo: conCatalogo?.catalogProductId || '',
          nota: cands.length
            ? (conCatalogo
              ? 'Hay ficha de catálogo de ML: publicar contra el catálogo es lo más rápido.'
              : 'Candidatas del mercado, sólo de referencia. NO copiar fotos ni descripción.')
            : (b?.problema ? 'No se pudo buscar: ' + b.problema : 'No apareció nada parecido: hay que armarla de cero.'),
        }
      }).sort((a, b) => (Number(b.p.quantity) || 0) - (Number(a.p.quantity) || 0))

      // 4) Excel
      const cab = ['Código', 'Producto', 'Stock', 'Precio tuyo', 'Caso', 'OK']
      for (let i = 1; i <= 3; i++) cab.push(`Candidata ${i}`, `Precio ${i}`, `Link ${i}`)
      cab.push('Categoría ML', 'Producto de catálogo', 'Notas')
      const rows = [cab]
      filas.forEach(f => {
        const fila = [
          f.p.code || '', f.p.name || '', Number(f.p.quantity) || 0, Number(f.p.price) || 0,
          f.caso, '',
        ]
        for (let i = 0; i < 3; i++) {
          const c = f.candidatas[i]
          fila.push(c?.title || '', c?.price ?? '', c?.permalink || '')
        }
        fila.push(f.categoria, f.catalogo, f.nota)
        rows.push(fila)
      })
      const ws = XLSX.utils.aoa_to_sheet(rows)
      ws['!cols'] = [
        { wch: 14 }, { wch: 42 }, { wch: 7 }, { wch: 12 }, { wch: 14 }, { wch: 6 },
        { wch: 42 }, { wch: 11 }, { wch: 40 },
        { wch: 42 }, { wch: 11 }, { wch: 40 },
        { wch: 42 }, { wch: 11 }, { wch: 40 },
        { wch: 14 }, { wch: 18 }, { wch: 60 },
      ]
      const conCands = filas.filter(f => f.candidatas.length).length
      const deCero = filas.length - conCands
      const conCatalogo = filas.filter(f => f.catalogo).length
      const info = XLSX.utils.aoa_to_sheet([
        ['PRODUCTOS BASE QUE FALTAN PUBLICAR EN LA CUENTA FULL'],
        [''],
        [`Productos base en el sistema: ${products.length}`],
        [`Publicaciones activas leídas en FULL: ${activas.length}`],
        [`FALTAN PUBLICAR EN FULL: ${faltan.length}`],
        [''],
        [`Con candidatas encontradas en el mercado de ML: ${conCands}`],
        [`Sin nada parecido, hay que armarla de cero: ${deCero}`],
        [`Con ficha de producto de catálogo de ML: ${conCatalogo}`],
        [''],
        ['CÓMO USAR ESTE ARCHIVO'],
        ['  • La columna OK está vacía a propósito: poné una X en las que te sirven.'],
        ['  • Está ordenado por stock, así arriba queda lo que más plata tiene quieta.'],
        ['  • Los links abren la publicación en ML para que la mires antes de decidir.'],
        [''],
        ['LAS CANDIDATAS SON PUBLICACIONES DE OTROS VENDEDORES.'],
        ['Sirven para ver la categoría, la ficha técnica, el rango de precio y si'],
        ['existe ficha de catálogo. NO se copian fotos ni descripción: es contenido'],
        ['de ellos y Mercado Libre lo sanciona.'],
        [''],
        ['Si hay PRODUCTO DE CATÁLOGO, publicar contra esa ficha es lo más rápido:'],
        ['ML ya tiene el título, las fotos y los atributos; vos ponés precio y stock.'],
        [''],
        ['OJO: el cruce por nombre no es exacto. Nada está marcado como "igual":'],
        ['esa decisión es tuya mirando el link. Por eso está la columna OK.'],
        [''],
        ['Este botón NO publicó ni modificó nada en Mercado Libre. Sólo miró.'],
      ])
      info['!cols'] = [{ wch: 78 }]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, info, 'Resumen')
      XLSX.utils.book_append_sheet(wb, ws, 'Para publicar')
      XLSX.writeFile(wb, `para-publicar-en-full-${new Date().toISOString().slice(0, 10)}.xlsx`)

      setPubRes({
        faltan: faltan.length, conCands, deCero, conCatalogo,
        publicaciones: activas.length,
        faltaronPub: r.faltaron || 0,
        sinBuscar,
        filas: filas.slice(0, 40),
      })
      setPubMsg(`✅ ${faltan.length} productos para publicar en FULL. Se bajó el Excel.`)
    } catch (e) {
      setPubMsg('❌ ' + (e?.message || 'Error'))
    } finally {
      setPubBusy(false)
    }
  }

  // Al revés que "Publicaciones faltantes": acá se busca lo que HAY EN EL DEPÓSITO
  // y NO se puede vender en ML, porque ninguna publicación activa termina en ese
  // producto. Es plata quieta: mercadería que está pero que nadie puede comprar.
  //
  // Un producto está "cubierto" si alguna publicación activa cae sobre él, ya sea
  // directamente o a través del armado de un combo. Se miran TODAS las cuentas
  // conectadas juntas, porque alcanza con estar publicado en una.
  const [sinPubBusy, setSinPubBusy] = useState(false)
  const [sinPubMsg, setSinPubMsg] = useState('')
  const [sinPub, setSinPub] = useState(null)

  const exportSinPublicar = async () => {
    setSinPubBusy(true); setSinPubMsg(''); setSinPub(null)
    try {
      const conectadas = ACCOUNTS.filter(a => mlAccounts?.[a.key]?.accessToken)
      if (!conectadas.length) throw new Error('No hay ninguna cuenta de ML conectada.')

      // 1) Publicaciones de todas las cuentas conectadas
      const activas = []
      let faltaronPub = 0
      for (const { key, label } of conectadas) {
        setSinPubMsg(`⏳ Leyendo las publicaciones de ${label}...`)
        const token = await ensureToken(key)
        const r = await fetch(`${API}?action=items`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        }).then(x => x.json())
        if (!r.ok) throw new Error(`${label}: ${r.error || 'no se pudieron leer las publicaciones'}`)
        faltaronPub += r.faltaron || 0
        r.items.forEach(it => {
          if (!it.status || it.status === 'active') activas.push({ ...it, cuenta: label })
        })
      }
      setSinPubMsg('⏳ Cruzando con el stock...')

      // 2) Qué productos cubre cada publicación
      const cubierto = new Map()  // productId -> Set de cuentas que lo publican
      const noAsociadas = []      // publicaciones que no caen en ningún combo/producto
      const sinArmado = []        // publicaciones asociadas a un combo vacío
      for (const it of activas) {
        const m = findByRef(it.sku) || findByRef(it.mla)
        if (!m) { noAsociadas.push(it); continue }
        const marcar = (pid) => {
          if (!cubierto.has(pid)) cubierto.set(pid, new Set())
          cubierto.get(pid).add(it.cuenta)
        }
        if (m.type === 'product') { marcar(m.p.id); continue }
        const partes = (m.c.items || []).filter(ci => ci.productId)
        if (!partes.length) { sinArmado.push({ ...it, combo: m.c.name }); continue }
        partes.forEach(ci => marcar(ci.productId))
      }

      // 3) Lo que hay físico y nadie publica
      const combosDe = new Map()  // productId -> cantidad de combos que lo usan
      combos.forEach(c => (c.items || []).forEach(ci => {
        if (ci.productId) combosDe.set(ci.productId, (combosDe.get(ci.productId) || 0) + 1)
      }))

      const huerfanos = products
        .filter(p => (Number(p.quantity) || 0) > 0 && !cubierto.has(p.id))
        .map(p => {
          const n = combosDe.get(p.id) || 0
          return {
            ...p,
            stock: Number(p.quantity) || 0,
            nCombos: n,
            motivo: n === 0
              ? 'No está en ningún combo — hay que crear la publicación'
              : `Está en ${n} combo${n > 1 ? 's' : ''}, pero ninguno tiene publicación activa asociada`,
          }
        })
        .sort((a, b) => b.stock - a.stock)

      const unidades = huerfanos.reduce((s, p) => s + p.stock, 0)
      const plata = huerfanos.reduce((s, p) => s + p.stock * (Number(p.price) || 0), 0)

      setSinPub({
        huerfanos, unidades, plata,
        publicaciones: activas.length,
        faltaronPub,
        cuentas: conectadas.map(c => c.label).join(' + '),
        noAsociadas: noAsociadas.length,
        sinArmado,
        conStock: products.filter(p => (Number(p.quantity) || 0) > 0).length,
      })

      // 4) Excel
      const rows = [['Código', 'Nombre', 'Stock', 'Precio', 'Valor', 'Ubicación', 'Categoría', 'Por qué no se vende']]
      huerfanos.forEach(p => rows.push([
        p.code || '', p.name || '', p.stock, Number(p.price) || 0,
        p.stock * (Number(p.price) || 0), p.location || '', p.category || '', p.motivo,
      ]))
      const ws = XLSX.utils.aoa_to_sheet(rows)
      ws['!cols'] = [{ wch: 14 }, { wch: 45 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 18 }, { wch: 55 }]
      const info = XLSX.utils.aoa_to_sheet([
        ['STOCK FÍSICO QUE NO SE PUEDE VENDER EN MERCADO LIBRE'],
        [''],
        [`Cuentas miradas: ${conectadas.map(c => c.label).join(' + ')}`],
        [`Publicaciones activas leídas: ${activas.length}`],
        [`Productos con stock: ${products.filter(p => (Number(p.quantity) || 0) > 0).length}`],
        [`Productos con stock y SIN publicación: ${huerfanos.length}  (${unidades} unidades)`],
        [''],
        ['OJO, leer esto antes de sacar conclusiones:'],
        [`${noAsociadas.length} publicaciones activas no se pudieron asociar a ningún combo ni producto`],
        ['del sistema. Mientras esas queden sin asociar, algún producto de esta lista puede estar'],
        ['publicado igual y aparecer acá por error. Primero conviene correr "🔍 Publicaciones'],
        ['faltantes" y asociarlas; después este listado queda fino.'],
        [''],
        ['La columna "Por qué no se vende" distingue dos casos:'],
        ['  • No está en ningún combo -> falta crear la publicación en ML y cargarla acá.'],
        ['  • Está en N combos -> el combo existe pero su MLA no está asociado o la publicación'],
        ['    no está activa. Se arregla asociando el código, no creando nada nuevo.'],
      ])
      info['!cols'] = [{ wch: 95 }]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, info, 'Leer primero')
      XLSX.utils.book_append_sheet(wb, ws, 'Sin publicar')
      XLSX.writeFile(wb, `stock-sin-publicar-${new Date().toISOString().slice(0, 10)}.xlsx`)

      setSinPubMsg(`✅ ${huerfanos.length} productos con stock sin publicación (${unidades} unidades). Bajé el Excel.`)
    } catch (e) {
      setSinPubMsg('❌ ' + e.message)
    } finally {
      setSinPubBusy(false)
    }
  }

  // Ranking de lo más vendido (las 2 cuentas, todos los tipos de envío) para
  // priorizar qué cargar primero: medidas, foto y ubicación
  const [topMsg, setTopMsg] = useState('')
  const [topBusy, setTopBusy] = useState(false)

  const exportTopSold = async () => {
    setTopBusy(true); setTopMsg('')
    try {
      const juntos = new Map()
      let ordenes = 0, truncado = false
      for (const key of ['full', 'ferre']) {
        if (!mlAccounts[key]?.accessToken) continue
        const token = await ensureToken(key)
        const r = await fetch(`${API}?action=topsold`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, days: 30, limit: 400 }),
        }).then(x => x.json())
        if (!r.ok) throw new Error(`${key.toUpperCase()}: ${r.error || 'Error'}`)
        ordenes += r.ordenes || 0
        if (r.truncado) truncado = true
        for (const t of r.top) {
          const k = t.mla || t.sku
          const x = juntos.get(k) || { ...t, unidades: 0, ventas: 0, cuentas: new Set() }
          x.unidades += t.unidades; x.ventas += t.ventas; x.cuentas.add(key.toUpperCase())
          if (!x.titulo && t.titulo) x.titulo = t.titulo
          juntos.set(k, x)
        }
      }
      if (!juntos.size) throw new Error('No hubo ventas en los últimos 30 días (¿las cuentas están conectadas?)')

      const top = [...juntos.values()].sort((a, b) => b.unidades - a.unidades).slice(0, 200)
      const si = v => (v ? 'SI' : 'FALTA')
      const filas = top.map((t, i) => {
        const m = findByRef(t.mla) || (t.sku ? findByRef(t.sku) : null)
        const combo = m?.type === 'combo' ? m.c : null
        const prod = m?.type === 'product' ? m.p : null
        const bases = combo
          ? (combo.items || []).map(ci => products.find(p => p.id === ci.productId)).filter(Boolean)
          : (prod ? [prod] : [])
        const sinMedida = bases.filter(p => !p.dims)
        const sinUbic = bases.filter(p => !p.location)
        const conFoto = combo ? combo.hasPhotos : prod?.hasPhotos
        return {
          '#': i + 1,
          'SKU (ML)': t.mla || t.sku,
          'Publicación': t.titulo,
          'Unidades vendidas (30 días)': t.unidades,
          'Ventas': t.ventas,
          'Cuenta': [...t.cuentas].join(' + '),
          'En el sistema': combo ? 'Combo' : (prod ? 'Producto' : 'NO ESTÁ'),
          'Nombre en el sistema': combo?.name || prod?.name || '',
          'Foto': m ? si(conFoto) : '',
          'Medidas': bases.length ? si(!sinMedida.length) : '',
          'Ubicación': bases.length ? si(!sinUbic.length) : '',
          'Productos que faltan completar': [...new Set([
            ...sinMedida.map(p => `${p.code || p.name} (medidas)`),
            ...sinUbic.map(p => `${p.code || p.name} (ubicación)`),
          ])].join(' · '),
        }
      })

      const ws = XLSX.utils.json_to_sheet(filas)
      ws['!cols'] = [{ wch: 5 }, { wch: 16 }, { wch: 55 }, { wch: 12 }, { wch: 8 }, { wch: 12 },
                     { wch: 13 }, { wch: 40 }, { wch: 8 }, { wch: 9 }, { wch: 10 }, { wch: 50 }]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Top 200')
      XLSX.writeFile(wb, `top200-vendidos-${new Date().toISOString().slice(0, 10)}.xlsx`)

      const faltan = filas.filter(f => f.Medidas === 'FALTA' || f.Ubicación === 'FALTA' || f.Foto === 'FALTA').length
      setTopMsg(`✅ ${ordenes} ventas de 30 días · top 200 exportado. ${faltan} de los 200 tienen algo sin cargar.`
        + (truncado ? ' ⚠️ Alguna semana superó el máximo de 10.000 ventas que deja leer ML y quedó incompleta.' : ''))
    } catch (err) {
      setTopMsg('❌ ' + err.message)
    } finally {
      setTopBusy(false)
    }
  }

  // Excel de TODAS las ventas FLEX de las dos cuentas, con el costo del envío,
  // quién lo pagó y en qué cordón cayó. Sirve para comparar lo que nos cobra ML
  // contra lo que le pagamos a los motoqueros.
  //
  // Son muchos meses y cada venta necesita su envío, así que se pide por tramos
  // cortos: si un tramo tarda demasiado y falla, se parte al medio y se
  // reintenta solo esa parte. Lo que ya vino no se pierde.
  const [flexMsg, setFlexMsg] = useState('')
  const [flexBusy, setFlexBusy] = useState(false)
  const [flexDesde, setFlexDesde] = useState('2025-08-01')

  const exportFlexSales = async () => {
    const desdeMs = new Date(flexDesde + 'T00:00:00-03:00').getTime()
    if (!Number.isFinite(desdeMs)) { setFlexMsg('❌ Poné una fecha válida en "desde"'); return }
    const hastaMs = Date.now()
    if (desdeMs >= hastaMs) { setFlexMsg('❌ La fecha "desde" tiene que ser anterior a hoy'); return }

    const meses = Math.round((hastaMs - desdeMs) / (30 * 24 * 3600 * 1000))
    if (!window.confirm(
      `Voy a leer venta por venta de las 2 cuentas desde el ${flexDesde} (unos ${meses} meses) y de cada una su envío.\n\n` +
      'Puede tardar bastante (decenas de minutos). No cierres esta pestaña mientras corre.\n\n¿Arranco?')) return

    setFlexBusy(true); setFlexMsg('⏳ Empezando...')
    const filas = []
    const avisos = []
    try {
      // Tramos de 12 días: es lo que entra cómodo en una corrida del servidor
      const TRAMO = 12 * 24 * 3600 * 1000
      const tramos = []
      for (let ini = desdeMs; ini < hastaMs; ini += TRAMO) {
        tramos.push([ini, Math.min(ini + TRAMO, hastaMs)])
      }

      for (const key of ['full', 'ferre']) {
        if (!mlAccounts[key]?.accessToken) { avisos.push(`${key.toUpperCase()} no está conectada`); continue }
        const token = await ensureToken(key)

        // Un tramo puede fallar por tiempo: se parte al medio y se reintenta
        const traer = async (ini, fin, profundidad = 0) => {
          const body = { token, desde: new Date(ini).toISOString(), hasta: new Date(fin).toISOString() }
          let r
          try {
            r = await fetch(`${API}?action=flexsales`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }).then(x => x.json())
          } catch (e) {
            r = { ok: false, error: e.message }
          }
          if (r?.ok) {
            r.filas.forEach(f => filas.push({ ...f, cuenta: key.toUpperCase() }))
            if (r.truncado) avisos.push(`${key.toUpperCase()} ${new Date(ini).toISOString().slice(0, 10)}: una semana superó las 10.000 ventas que deja leer ML`)
            return
          }
          if (profundidad >= 3 || fin - ini < 12 * 3600 * 1000) {
            avisos.push(`${key.toUpperCase()} ${new Date(ini).toISOString().slice(0, 10)} → ${new Date(fin).toISOString().slice(0, 10)}: ${r?.error || 'no se pudo leer'}`)
            return
          }
          const medio = ini + Math.floor((fin - ini) / 2)
          await traer(ini, medio, profundidad + 1)
          await traer(medio, fin, profundidad + 1)
        }

        for (let i = 0; i < tramos.length; i++) {
          const [ini, fin] = tramos[i]
          setFlexMsg(`⏳ ${key.toUpperCase()} · tramo ${i + 1} de ${tramos.length} (${new Date(ini).toISOString().slice(0, 10)}) · ${filas.length} envíos FLEX hasta ahora`)
          await traer(ini, fin)
        }
      }

      if (!filas.length) throw new Error('No se encontró ninguna venta FLEX en ese período. ' + avisos.join(' · '))

      const AR = 3 * 3600 * 1000
      const fechaAR = (iso) => new Date(new Date(iso).getTime() - AR).toISOString()
      const titulo = (s) => String(s || '').replace(/\b\w/g, c => c.toUpperCase())
      const quienPaga = (comprador, nosotros) => {
        if (comprador > 0 && nosotros > 0) return 'Compartido'
        if (comprador > 0) return 'Comprador'
        if (nosotros > 0) return 'Nosotros'
        return 'Sin costo (bonificado)'
      }

      const detalle = filas.map(f => {
        const comprador = Number(f.costoComprador || 0)
        const nosotros = Number(f.costoNosotros || 0)
        const z = cordonDe(f)
        const fa = fechaAR(f.fecha)
        return {
          'Cuenta': f.cuenta,
          'Fecha': fa.slice(0, 10),
          'Hora': fa.slice(11, 16),
          'N° de venta': String(f.orderId || ''),
          'N° de envío': String(f.shipmentId || ''),
          'Estado del envío': f.estadoEnvio || '',
          'Comprador': f.comprador || '',
          'SKU': f.sku || '',
          'Publicación': f.titulo || '',
          'Unidades': f.unidades || 0,
          'Total de la venta': Number(f.total || 0),
          'Provincia': f.provincia || '',
          'Localidad': f.localidad || '',
          'Partido': titulo(z.partido || f.municipio || ''),
          'CP': f.cp || '',
          'Zona (cordón)': z.zona,
          'Cómo se determinó la zona': z.criterio,
          'Quién pagó el envío': quienPaga(comprador, nosotros),
          'Costo envío — comprador': comprador,
          'Costo envío — nosotros': nosotros,
          'Bonificación de ML': Number(f.bonificacion || 0),
          'Costo del envío (total)': comprador + nosotros,
        }
      }).sort((a, b) => (a.Fecha + a.Hora).localeCompare(b.Fecha + b.Hora))

      // Resumen por zona y cuenta: es lo que se compara con lo que le pagamos
      // a la logística
      const res = new Map()
      for (const d of detalle) {
        const k = d['Zona (cordón)'] + '|' + d.Cuenta
        const x = res.get(k) || {
          'Zona (cordón)': d['Zona (cordón)'], 'Cuenta': d.Cuenta, 'Envíos': 0,
          'Pagó el comprador': 0, 'Pagamos nosotros': 0, 'Bonificó ML': 0, 'Costo total': 0,
        }
        x['Envíos'] += 1
        x['Pagó el comprador'] += d['Costo envío — comprador']
        x['Pagamos nosotros'] += d['Costo envío — nosotros']
        x['Bonificó ML'] += d['Bonificación de ML']
        x['Costo total'] += d['Costo del envío (total)']
        res.set(k, x)
      }
      const resumen = [...res.values()]
        .map(x => ({ ...x, 'Costo promedio por envío': Math.round(x['Costo total'] / x['Envíos']) }))
        .sort((a, b) => a['Zona (cordón)'].localeCompare(b['Zona (cordón)']) || a.Cuenta.localeCompare(b.Cuenta))

      const wb = XLSX.utils.book_new()
      const wsR = XLSX.utils.json_to_sheet(resumen)
      wsR['!cols'] = [{ wch: 24 }, { wch: 9 }, { wch: 9 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 20 }]
      XLSX.utils.book_append_sheet(wb, wsR, 'Resumen por zona')
      const wsD = XLSX.utils.json_to_sheet(detalle)
      wsD['!cols'] = [{ wch: 8 }, { wch: 11 }, { wch: 6 }, { wch: 15 }, { wch: 13 }, { wch: 15 }, { wch: 18 },
                      { wch: 20 }, { wch: 45 }, { wch: 9 }, { wch: 14 }, { wch: 16 }, { wch: 22 }, { wch: 20 },
                      { wch: 8 }, { wch: 16 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 16 }, { wch: 20 }]
      XLSX.utils.book_append_sheet(wb, wsD, 'Ventas FLEX')
      XLSX.writeFile(wb, `ventas-flex-${flexDesde}_a_${new Date().toISOString().slice(0, 10)}.xlsx`)

      setFlexMsg(`✅ ${detalle.length} ventas FLEX exportadas (${new Set(detalle.map(d => d['N° de envío'])).size} envíos).`
        + (avisos.length ? ` ⚠️ ${avisos.length} tramos con problemas: ${avisos.slice(0, 3).join(' · ')}${avisos.length > 3 ? '…' : ''}` : ''))
    } catch (err) {
      setFlexMsg('❌ ' + err.message)
    } finally {
      setFlexBusy(false)
    }
  }

  // Diagnóstico de Mercado Pago: prueba con cuál de las dos cuentas se puede
  // leer el saldo, los pagos con su comisión y el informe de liquidaciones.
  // Sirve para saber qué se puede mostrar antes de construirlo.
  const [mpMsg, setMpMsg] = useState('')
  const [mpBusy, setMpBusy] = useState(false)
  const [mpDatos, setMpDatos] = useState(null)

  const probarMP = async () => {
    setMpBusy(true); setMpMsg(''); setMpDatos(null)
    try {
      const salida = []
      for (const key of ['full', 'ferre']) {
        if (!mlAccounts[key]?.accessToken) { salida.push({ cuenta: key.toUpperCase(), sinConectar: true }); continue }
        const token = await ensureToken(key)
        const r = await fetch(`${API}?action=mptest`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        }).then(x => x.json())
        if (!r.ok) { salida.push({ cuenta: key.toUpperCase(), error: r.error || 'Error' }); continue }
        salida.push({ cuenta: key.toUpperCase(), nickname: r.cuenta, scopes: r.scopes, resultados: r.resultados })
      }
      setMpDatos(salida)
      const andan = salida.flatMap(s => Object.values(s.resultados || {})).filter(x => x.anda).length
      setMpMsg(`✅ Listo. ${andan} de las consultas respondieron bien. Pasame esta pantalla y te digo qué se puede armar.`)
    } catch (err) {
      setMpMsg('❌ ' + err.message)
    } finally {
      setMpBusy(false)
    }
  }

  // Búsqueda a fondo del saldo: prueba nueve puertas distintas con el token de
  // ML y con el de Mercado Pago, y muestra qué contestó cada combinación.
  const [saldoMsg, setSaldoMsg] = useState('')
  const [saldoBusy, setSaldoBusy] = useState(false)
  const [saldoDatos, setSaldoDatos] = useState(null)

  const buscarSaldo = async () => {
    setSaldoBusy(true); setSaldoMsg(''); setSaldoDatos(null)
    try {
      const salida = []
      for (const key of ['full', 'ferre']) {
        const acc = mlAccounts[key] || {}
        if (!acc.accessToken && !acc.mpToken) continue
        const token = acc.accessToken ? await ensureToken(key) : ''
        const r = await fetch(`${API}?action=mpsaldotest`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, mpToken: acc.mpToken || '' }),
        }).then(x => x.json())
        salida.push({ cuenta: key.toUpperCase(), ...r })
      }
      setSaldoDatos(salida)
      const ok = salida.flatMap(s => [
        ...Object.values(s.conTokenDeML || {}),
        ...Object.values(s.conTokenDeMP || {}),
      ]).filter(x => x.anda).length
      setSaldoMsg(ok
        ? `✅ ${ok} respondieron bien. Pasame la pantalla y veo cuál sirve para el saldo.`
        : '⚠️ Ninguna puerta devolvió el saldo. Pasame igual la pantalla: los mensajes dicen por qué.')
    } catch (err) {
      setSaldoMsg('❌ ' + err.message)
    } finally {
      setSaldoBusy(false)
    }
  }

  // Dispara el proceso automático (el mismo del cron de las 18hs) una vez
  const [cronMsg, setCronMsg] = useState('')
  const [cronBusy, setCronBusy] = useState(false)
  const runCronNow = async () => {
    if (!window.confirm('Descuenta las ventas Flex y de Correo/Colecta de las 2 cuentas (las ventas Full NO se descuentan). ¿Seguir?')) return
    setCronBusy(true); setCronMsg('')
    try {
      const r = await fetch('/api/ml/cron', { method: 'POST' }).then(x => x.json())
      if (!r.ok) throw new Error(r.error || 'Error')
      const parts = Object.entries(r.summary || {}).map(([k, v]) => {
        if (typeof v === 'string') return `${k.toUpperCase()}: ${v}`
        const d = v.descuentan || {}, n = v.noDescuentan || {}
        const noDesc = [
          n.full ? `${n.full} Full` : '',
          n.canceladas ? `${n.canceladas} canceladas` : '',
          n.sinCobrar ? `${n.sinCobrar} sin cobrar` : '',
          n.tipoDeEnvioDesconocido ? `${n.tipoDeEnvioDesconocido} sin tipo de envío` : '',
        ].filter(Boolean).join(', ')
        return `${k.toUpperCase()}: ${v.enVentana48hs} ventas en 48hs · descuentan ${d.flex || 0} flex + ${d.correoColecta || 0} correo` +
          `${d.sinEnvioML ? ` + ${d.sinEnvioML} sin envío ML` : ''}` +
          ` → ${v.ordenesNuevas} nuevas (${v.unidadesDescontadas} unidades de ${v.productos} productos)` +
          `${v.yaProcesadas ? `, ${v.yaProcesadas} ya procesadas` : ''}` +
          `${noDesc ? ` · NO descuentan: ${noDesc}` : ''}`
      })
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
          <div className="ml-top-row">
            <button className="ml-btn-missing" onClick={buscarParaPublicarEnFull} disabled={pubBusy}>
              {pubBusy ? '⏳ Buscando...' : '🆕 Qué falta publicar en FULL'}
            </button>
            {pubMsg && <span className={`ml-cron-msg ${pubMsg.startsWith('✅') ? 'ok' : pubMsg.startsWith('⏳') ? '' : 'warn'}`}>{pubMsg}</span>}
          </div>

          <div className="ml-top-row">
            <button className="ml-btn-missing" onClick={exportSinPublicar} disabled={sinPubBusy}>
              {sinPubBusy ? '⏳ Cruzando...' : '📦 Stock físico que NO está publicado en ML'}
            </button>
            {sinPubMsg && <span className={`ml-cron-msg ${sinPubMsg.startsWith('✅') ? 'ok' : sinPubMsg.startsWith('⏳') ? '' : 'warn'}`}>{sinPubMsg}</span>}
          </div>

          <div className="ml-top-row">
            <button className="ml-btn-missing" onClick={traerFotosDeML} disabled={fotosBusy || !sinFotoCount}>
              {fotosBusy ? '⏳ Trayendo fotos...' : `📸 Traer las fotos que faltan desde ML (${sinFotoCount} sin foto)`}
            </button>
            {fotosMsg && <span className={`ml-cron-msg ${fotosMsg.startsWith('✅') ? 'ok' : fotosMsg.startsWith('⏳') ? '' : 'warn'}`}>{fotosMsg}</span>}
          </div>

          <div className="ml-top-row">
            <button className="ml-btn-missing" onClick={exportTopSold} disabled={topBusy}>
              {topBusy ? '⏳ Leyendo las ventas del mes...' : '🏆 Top 200 más vendidos (30 días)'}
            </button>
            {topMsg && <span className={`ml-cron-msg ${topMsg.startsWith('✅') ? 'ok' : 'warn'}`}>{topMsg}</span>}
          </div>
          <div className="ml-top-row">
            <button className="ml-btn-missing" onClick={probarMP} disabled={mpBusy}>
              {mpBusy ? '⏳ Probando...' : '💳 Probar qué datos de plata deja ver ML'}
            </button>
            {mpMsg && <span className={`ml-cron-msg ${mpMsg.startsWith('✅') ? 'ok' : 'warn'}`}>{mpMsg}</span>}
          </div>

          <div className="ml-top-row">
            <button className="ml-btn-missing" onClick={buscarSaldo} disabled={saldoBusy}>
              {saldoBusy ? '⏳ Probando 9 puertas...' : '🔎 Buscar el saldo por todos lados'}
            </button>
            {saldoMsg && <span className={`ml-cron-msg ${saldoMsg.startsWith('✅') ? 'ok' : 'warn'}`}>{saldoMsg}</span>}
          </div>

          {saldoDatos && (
            <div className="mp-diag">
              {saldoDatos.map(c => (
                <div className="mp-diag-cuenta" key={c.cuenta}>
                  <h4>{c.cuenta}</h4>
                  <p className="mt-hint">
                    Token de ML: {c.tokenDeML?.nickname || '—'}
                    {c.tokenDeML?.scopes ? ` · permisos: ${[].concat(c.tokenDeML.scopes).join(' ')}` : ''}
                    {' · '}Token de MP: {c.tokenDeMP?.nickname || '— sin cargar'}
                  </p>
                  {[['Con el token de ML', c.conTokenDeML], ['Con el token de MP', c.conTokenDeMP]].map(([titulo, res]) => res && (
                    <div key={titulo}>
                      <strong className="mp-diag-sub">{titulo}</strong>
                      <table className="mp-diag-tabla">
                        <tbody>
                          {Object.entries(res).map(([k, v]) => (
                            <tr key={k} className={v.anda ? 'anda' : 'no'}>
                              <td>{v.anda ? '✅' : '❌'}</td>
                              <td>{k}</td>
                              <td className="mp-diag-estado">{v.estado || '—'}</td>
                              <td className="mp-diag-resp">{v.respuesta}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {mpDatos && (
            <div className="mp-diag">
              {mpDatos.map(c => (
                <div className="mp-diag-cuenta" key={c.cuenta}>
                  <h4>{c.cuenta}{c.nickname ? ` · ${c.nickname}` : ''}</h4>
                  {c.sinConectar && <p className="mp-diag-no">No está conectada.</p>}
                  {c.error && <p className="mp-diag-no">Error: {c.error}</p>}
                  {c.resultados && (
                    <table className="mp-diag-tabla">
                      <tbody>
                        {Object.entries(c.resultados).map(([k, v]) => (
                          <tr key={k} className={v.anda ? 'anda' : 'no'}>
                            <td>{v.anda ? '✅' : '❌'}</td>
                            <td>{v.que}</td>
                            <td className="mp-diag-estado">{v.estado || 'sin respuesta'}</td>
                            <td className="mp-diag-resp">{v.respuesta}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="ml-top-row">
            <label className="ml-desde">
              Ventas FLEX desde
              <input type="date" value={flexDesde} onChange={e => setFlexDesde(e.target.value)} disabled={flexBusy} />
            </label>
            <button className="ml-btn-missing" onClick={exportFlexSales} disabled={flexBusy}>
              {flexBusy ? '⏳ Leyendo...' : '🚚 Excel de ventas FLEX (costo de envío y zona)'}
            </button>
            {flexMsg && <span className={`ml-cron-msg ${flexMsg.startsWith('✅') ? 'ok' : flexMsg.startsWith('⏳') ? '' : 'warn'}`}>{flexMsg}</span>}
          </div>
        </div>
      </div>

      {sinPub && (
        <div className="ml-sinpub">
          <h3>📦 Está en el depósito y no se puede vender</h3>
          <p className="ml-sinpub-sub">
            {sinPub.cuentas} · {sinPub.publicaciones} publicaciones activas · {sinPub.conStock} productos con stock
          </p>

          <div className="ml-sinpub-nums">
            <div><strong>{sinPub.huerfanos.length}</strong><span>productos</span></div>
            <div><strong>{sinPub.unidades.toLocaleString('es-AR')}</strong><span>unidades</span></div>
            {sinPub.plata > 0 && (
              <div><strong>${Math.round(sinPub.plata).toLocaleString('es-AR')}</strong><span>a precio de lista</span></div>
            )}
          </div>

          {sinPub.faltaronPub > 0 && (
            <p className="ml-sinpub-ojo">
              🔴 OJO: {sinPub.faltaronPub} publicaciones no se pudieron leer (ML cortó la respuesta).
              Esta lista puede traer productos que SÍ están publicados. Volvé a correrlo más tarde
              antes de tomar decisiones con esto.
            </p>
          )}

          {sinPub.noAsociadas > 0 && (
            <p className="ml-sinpub-ojo">
              ⚠️ Ojo: {sinPub.noAsociadas} publicaciones activas no se pudieron asociar a ningún combo ni
              producto del sistema. Hasta que esas se asocien, algo de esta lista puede estar publicado
              igual y figurar acá por error. Corré primero <strong>🔍 Publicaciones faltantes</strong>.
            </p>
          )}
          {sinPub.sinArmado.length > 0 && (
            <p className="ml-sinpub-ojo">
              ⚠️ {sinPub.sinArmado.length} publicaciones caen en un combo <strong>sin armado cargado</strong>,
              así que no descuentan nada: {sinPub.sinArmado.slice(0, 3).map(x => x.combo || x.mla).join(', ')}
              {sinPub.sinArmado.length > 3 ? '…' : ''}
            </p>
          )}

          {sinPub.huerfanos.length === 0 ? (
            <p className="ml-sinpub-ok">✅ Todo lo que tenés con stock está publicado en al menos una cuenta.</p>
          ) : (
            <>
              <div className="ml-preview-table-wrap">
                <table className="ml-preview-table">
                  <thead>
                    <tr><th>Código</th><th>Producto</th><th>Stock</th><th>Ubicación</th><th>Por qué</th></tr>
                  </thead>
                  <tbody>
                    {sinPub.huerfanos.slice(0, 40).map(p => (
                      <tr key={p.id}>
                        <td className="ml-code">{p.code || '—'}</td>
                        <td>{p.name}</td>
                        <td className="ml-new">{p.stock}</td>
                        <td>{p.location || '—'}</td>
                        <td className="ml-sinpub-motivo">{p.motivo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {sinPub.huerfanos.length > 40 && (
                <p className="ml-sinpub-sub">
                  Se muestran los 40 de más stock. Los {sinPub.huerfanos.length} están en el Excel que se bajó.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {pubRes && (
        <div className="ml-sinpub">
          <h3>🆕 Falta publicar en FULL</h3>
          <p className="ml-sinpub-sub">
            {pubRes.publicaciones} publicaciones activas en FULL · {pubRes.faltan} productos base sin publicar
          </p>

          <div className="ml-sinpub-nums">
            <div><strong>{pubRes.faltan}</strong><span>sin publicar</span></div>
            <div><strong>{pubRes.conCands}</strong><span>con candidatas</span></div>
            <div><strong>{pubRes.deCero}</strong><span>de cero</span></div>
            <div><strong>{pubRes.conCatalogo}</strong><span>con ficha de catálogo</span></div>
          </div>
          {pubRes.faltaronPub > 0 && (
            <p className="ml-sinpub-ojo">
              🔴 OJO: {pubRes.faltaronPub} publicaciones no se pudieron leer (ML cortó la respuesta).
              Puede haber en esta lista algún producto que SÍ está publicado. Volvé a correrlo más tarde.
            </p>
          )}
          {pubRes.sinBuscar > 0 && (
            <p className="ml-sinpub-ojo">
              ⚠️ {pubRes.sinBuscar} productos no se pudieron buscar porque el nombre quedó vacío al limpiarlo.
            </p>
          )}

          <div className="ml-preview-table-wrap">
            <table className="ml-preview-table">
              <thead>
                <tr><th>Código</th><th>Producto</th><th>Stock</th><th>Caso</th><th>Candidata</th></tr>
              </thead>
              <tbody>
                {pubRes.filas.map(f => (
                  <tr key={f.p.id}>
                    <td className="ml-code">{f.p.code || '—'}</td>
                    <td>{f.p.name}</td>
                    <td className="ml-new">{Number(f.p.quantity) || 0}</td>
                    <td className="ml-code">{f.caso}</td>
                    <td className="ml-sinpub-motivo">
                      {f.candidatas[0]
                        ? <a href={f.candidatas[0].permalink} target="_blank" rel="noreferrer">{f.candidatas[0].title}</a>
                        : f.nota}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ml-sinpub-sub">
            Se muestran los primeros 40 por stock. Los {pubRes.faltan} están en el Excel, con hasta 3
            candidatas cada uno y la columna <strong>OK</strong> para que marques las que sirven.
          </p>
        </div>
      )}

      {fotosRes && (
        <div className="ml-sinpub">
          <h3>📸 Fotos traídas de las publicaciones</h3>
          <p className="ml-sinpub-sub">
            {fotosRes.cuentas} · {fotosRes.publicaciones} publicaciones activas · {fotosRes.sinFoto} productos base sin foto
          </p>

          <div className="ml-sinpub-nums">
            <div><strong>{fotosRes.puestas.length}</strong><span>fotos puestas</span></div>
            <div><strong>{fotosRes.sinPublicacion.length}</strong><span>sin publicación</span></div>
            <div><strong>{fotosRes.sinFotoEnML.length}</strong><span>publicación sin fotos</span></div>
            {fotosRes.fallaron.length > 0 && (
              <div><strong>{fotosRes.fallaron.length}</strong><span>fallaron</span></div>
            )}
          </div>

          {fotosRes.faltaronPub > 0 && (
            <p className="ml-sinpub-ojo">
              ⚠️ {fotosRes.faltaronPub} publicaciones no se pudieron leer (ML cortó la respuesta).
              Si alguna era la de estos productos, quedaron sin foto: se puede volver a correr el botón
              más tarde y completa las que falten.
            </p>
          )}

          {fotosRes.mezclados > 0 && (
            <p className="ml-sinpub-ojo">
              ⚠️ {fotosRes.mezclados} publicaciones son combos que mezclan productos distintos: no se usaron.
              Esa foto no representa a ninguno de los productos que lleva adentro, y ponerla en el producto
              base hace que quien arma el pedido agarre lo que no es.
            </p>
          )}

          {fotosRes.puestas.length === 0 ? (
            <p className="ml-sinpub-ojo">
              No se pudo traer ninguna foto. El Excel que se bajó dice, producto por producto, por qué.
            </p>
          ) : (
            <>
              <div className="ml-preview-table-wrap">
                <table className="ml-preview-table">
                  <thead>
                    <tr><th>Código</th><th>Producto</th><th>Publicación</th><th>Cuenta</th><th>De dónde salió</th></tr>
                  </thead>
                  <tbody>
                    {fotosRes.puestas.slice(0, 40).map(x => (
                      <tr key={x.id}>
                        <td className="ml-code">{x.code || '—'}</td>
                        <td>{x.name}</td>
                        <td className="ml-code">{x.mla}</td>
                        <td>{x.cuenta}</td>
                        <td className="ml-sinpub-motivo">{x.via}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {fotosRes.puestas.length > 40 && (
                <p className="ml-sinpub-sub">
                  Se muestran las primeras 40. Las {fotosRes.puestas.length} están en el Excel que se bajó.
                </p>
              )}
            </>
          )}
        </div>
      )}

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
              <label className="ml-label">
                Access Token de Mercado Pago <span className="ml-opc">— opcional, para ver el saldo real</span>
              </label>
              <input
                type="password"
                value={f.mpToken ?? acc.mpToken ?? ''}
                onChange={e => setForm(key, 'mpToken', e.target.value)}
                placeholder="APP_USR-..."
              />
              <p className="ml-ayuda">
                Se saca de <strong>mercadopago.com.ar/developers</strong> → Tus integraciones → tu aplicación →
                <strong> Credenciales de producción</strong> → Access Token. Es de ESTA cuenta y sirve para leer
                el saldo, que con el permiso de ML da error. Se guarda como la Secret Key: solo lo ve el master.
              </p>

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
