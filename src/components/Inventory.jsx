import React, { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { findByRef as matchRef } from '../utils/refMatch'
import { compressImage, MAX_PHOTOS, MAX_PHOTOS_BYTES, photosSize } from '../utils/images'
import { extractImagesByRow } from '../utils/excelImages'
import { comboAvailable, STOCK_TYPES } from './Combos'
import Scanner from './Scanner'
import LazyThumb from './LazyThumb'
import { stockStatus, daysLeftText } from '../utils/stock'
import './Inventory.css'

const EMPTY_FORM = {
  name: '',
  code: '',
  barcodes: '', // uno por línea (un producto puede tener varios)
  category: '',
  price: '',
  minStock: '5',
  quantity: '0',
  location: '',
  stockType: '',
  fragile: false,
  dims: '', // medidas del artículo en cm "largo x ancho x alto" (para elegir bolsa al empaquetar)
  description: '',
  photos: [],
}

// Mapea encabezados del Excel (sin acentos, minúsculas) a campos del producto
const COLUMN_MAP = {
  nombre: 'name', producto: 'name', name: 'name', articulo: 'name', descripcion_corta: 'name',
  codigo: 'code', sku: 'code', code: 'code',
  'codigo de barras': 'barcode', barcode: 'barcode', ean: 'barcode', upc: 'barcode', 'codigo universal': 'barcode',
  categoria: 'category', category: 'category', rubro: 'category',
  precio: 'price', price: 'price', 'precio venta': 'price',
  cantidad: 'quantity', stock: 'quantity', qty: 'quantity', unidades: 'quantity', existencia: 'quantity',
  'armado s': 'quantity', armado: 'quantity',
  'stock minimo': 'minStock', minimo: 'minStock', 'min stock': 'minStock',
  ubicacion: 'location', location: 'location', deposito: 'location', estante: 'location', posicion: 'location', pasillo: 'location',
  tipo: 'stockType', 'tipo de stock': 'stockType', 'tipo stock': 'stockType', canal: 'stockType', 'full ferre base': 'stockType',
  'codigo (armado p)': 'code2', 'armado p': 'code2', 'codigo armado': 'code2', 'codigo interno': 'code2',
  descripcion: 'description', description: 'description', detalle: 'description',
}

// Columnas del Excel de compra (identifica el producto + cantidad comprada)
const PURCHASE_COLS = {
  sku: 'ref', codigo: 'ref', code: 'ref', producto: 'ref',
  'sku o codigo': 'ref', 'codigo o sku': 'ref', 'sku / codigo': 'ref',
  'codigo de barras': 'ref', barcode: 'ref', ean: 'ref', 'codigo (armado p)': 'ref',
  cantidad: 'qty', 'cantidad comprada': 'qty', qty: 'qty', unidades: 'qty', comprado: 'qty', cant: 'qty',
  'armado s': 'qty', ajuste: 'qty',
  factura: 'reference', remito: 'reference', referencia: 'reference', comprobante: 'reference', 'nro factura': 'reference',
}

const normalize = (s) =>
  String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()

const parseNumber = (v) => {
  if (typeof v === 'number') return v
  const n = parseFloat(String(v).replace(',', '.'))
  return isNaN(n) ? 0 : n
}

export default function Inventory({
  products,
  combos = [],
  onAdd,
  onUpdate,
  onDelete,
  onImport,
  onDeleteCombo,
  onEditCombo,
  onPurchase,
  loadPhotos,
  consumption,
  canEdit = true, // los ayudantes sin permiso de modificar solo consultan
  onBulkPatch,
}) {
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [formData, setFormData] = useState(EMPTY_FORM)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [kindFilter, setKindFilter] = useState('all') // all | products | combos
  const [showSearchScanner, setShowSearchScanner] = useState(false)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [importResult, setImportResult] = useState('')
  const [purchasing, setPurchasing] = useState(false)
  const [purchaseResult, setPurchaseResult] = useState('')
  const [purchasePreview, setPurchasePreview] = useState(null)
  const [invoiceScanning, setInvoiceScanning] = useState(false)
  const invoiceInputRef = useRef(null)
  const [measuring, setMeasuring] = useState(false)
  const measInputRef = useRef(null)
  const fileInputRef = useRef(null)
  const purchaseInputRef = useRef(null)
  const photoInputRef = useRef(null)

  const resetForm = () => {
    setFormData(EMPTY_FORM)
    setEditingId(null)
    setError('')
  }

  const handleEdit = async (product) => {
    const bcs = product.barcodes?.length ? product.barcodes : (product.barcode ? [product.barcode] : [])
    setFormData({
      name: product.name || '',
      code: product.code || '',
      barcodes: bcs.join('\n'),
      category: product.category || '',
      price: product.price || '',
      minStock: product.minStock || '5',
      quantity: product.quantity ?? '0',
      location: product.location || '',
      stockType: product.stockType || '',
      fragile: !!product.fragile,
      dims: product.dims || '',
      description: product.description || '',
      photos: [],
    })
    setEditingId(product.id)
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    // Las fotos se cargan on-demand (no vienen en el listado)
    if (product.hasPhotos && loadPhotos) {
      const photos = await loadPhotos(product.id)
      setFormData(f => ({ ...f, photos }))
    }
  }

  const handleAddPhotos = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setError('')
    try {
      const room = MAX_PHOTOS - formData.photos.length
      if (room <= 0) {
        setError(`Máximo ${MAX_PHOTOS} fotos por producto`)
        return
      }
      const newPhotos = []
      for (const file of files.slice(0, room)) {
        newPhotos.push(await compressImage(file))
      }
      const all = [...formData.photos, ...newPhotos]
      if (photosSize(all) > MAX_PHOTOS_BYTES) {
        setError('Las fotos superan el tamaño máximo. Probá con imágenes más chicas o menos fotos.')
        return
      }
      setFormData({ ...formData, photos: all })
      if (files.length > room) {
        setError(`Se agregaron solo ${room} fotos (máximo ${MAX_PHOTOS} por producto)`)
      }
    } catch (err) {
      setError('Error al procesar la imagen: ' + err.message)
    }
  }

  const removePhoto = (index) => {
    setFormData({
      ...formData,
      photos: formData.photos.filter((_, i) => i !== index),
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!formData.name.trim()) {
      setError('El nombre es requerido')
      return
    }
    setLoading(true)
    try {
      // El textarea de códigos de barras → array (uno por línea o separados por coma)
      const barcodes = [...new Set(
        String(formData.barcodes)
          .split(/[\n,;]+/)
          .map(s => s.trim())
          .filter(Boolean)
      )]
      const { barcodes: _bc, ...rest } = formData
      const data = {
        ...rest,
        barcodes,
        barcode: barcodes[0] || '',
        price: formData.price ? parseFloat(formData.price) : 0,
        minStock: parseInt(formData.minStock) || 5,
        quantity: parseInt(formData.quantity) || 0,
      }
      if (editingId) {
        await onUpdate(editingId, data)
      } else {
        await onAdd(data)
      }
      setShowForm(false)
      resetForm()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('¿Estás seguro de que quieres eliminar este producto?')) return
    try {
      await onDelete(id)
    } catch (err) {
      alert(err.message)
    }
  }

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true)
    setImportResult('')
    try {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer)
      // Elegir la hoja de datos: preferir "Productos", si no la primera que
      // tenga una columna reconocible como Nombre (ignora "Instrucciones")
      const pickSheet = () => {
        const named = workbook.SheetNames.find(n => normalize(n) === 'productos')
        if (named) return workbook.Sheets[named]
        for (const n of workbook.SheetNames) {
          const rows = XLSX.utils.sheet_to_json(workbook.Sheets[n], { defval: '' })
          if (rows.length && Object.keys(rows[0]).some(k => COLUMN_MAP[normalize(k)] === 'name')) {
            return workbook.Sheets[n]
          }
        }
        return workbook.Sheets[workbook.SheetNames[0]]
      }
      const sheet = pickSheet()
      const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' })

      if (!rawRows.length) {
        setImportResult('⚠️ El archivo está vacío o no tiene filas de datos.')
        return
      }

      // Fotos pegadas en el Excel, agrupadas por fila de la hoja
      const photosByRow = await extractImagesByRow(buffer)

      // Agrupar por SKU: varias filas con el MISMO SKU son el mismo producto
      // con varios códigos de barras. Sin SKU, cada fila es un producto aparte.
      const groups = new Map()
      let anon = 0
      let skippedNoName = 0
      for (const raw of rawRows) {
        const p = {}
        Object.entries(raw).forEach(([key, value]) => {
          const field = COLUMN_MAP[normalize(key)]
          if (field) p[field] = value
        })
        if (!p.name || !String(p.name).trim()) { skippedNoName++; continue }
        const code = p.code !== undefined ? String(p.code).trim() : ''
        const key = code ? 's:' + code.toLowerCase() : 'r:' + (anon++)
        if (!groups.has(key)) {
          groups.set(key, {
            name: String(p.name).trim(),
            code,
            barcodes: [],
            category: p.category !== undefined ? String(p.category).trim() : '',
            price: parseNumber(p.price),
            quantity: Math.round(parseNumber(p.quantity)),
            minStock: p.minStock !== undefined ? Math.round(parseNumber(p.minStock)) : 5,
            location: p.location !== undefined ? String(p.location).trim() : '',
            stockType: p.stockType !== undefined ? String(p.stockType).trim().toUpperCase() : '',
            description: p.description !== undefined ? String(p.description).trim() : '',
            photos: photosByRow.get(raw.__rowNum__) || [],
          })
        }
        const g = groups.get(key)
        // juntar códigos de barras (columna código de barras + código interno);
        // acepta varias filas con el mismo SKU y también varios por celda
        const addBc = (v) => {
          if (v === undefined) return
          String(v).split(/[\n,;]+/).forEach(part => {
            const s = part.trim()
            if (s && !g.barcodes.some(b => b.toLowerCase() === s.toLowerCase())) g.barcodes.push(s)
          })
        }
        addBc(p.barcode)
        addBc(p.code2)
        // completar datos que hayan quedado vacíos en la primera fila del grupo
        if (!g.location && p.location) g.location = String(p.location).trim()
        if (!g.price && p.price) g.price = parseNumber(p.price)
        if (!g.quantity && p.quantity) g.quantity = Math.round(parseNumber(p.quantity))
        if (!g.stockType && p.stockType) g.stockType = String(p.stockType).trim().toUpperCase()
        if (!g.photos.length) { const ph = photosByRow.get(raw.__rowNum__); if (ph) g.photos = ph }
      }

      const rows = [...groups.values()].map(g => ({ ...g, barcode: g.barcodes[0] || '' }))

      if (!rows.length) {
        setImportResult(
          '⚠️ No se encontró la columna "Nombre". El Excel debe tener encabezados en la primera fila: ' +
          'Nombre (obligatorio), SKU, Código de Barras, Precio, Cantidad, Ubicación, Tipo, Descripción. ' +
          'Descargá la plantilla de ejemplo para ver el formato.'
        )
        return
      }

      // Reconocer productos existentes por SKU o por cualquier código de barras
      const byCode = new Map()
      const byBarcode = new Map()
      products.forEach(p => {
        if (p.code) byCode.set(p.code.toLowerCase(), p)
        const bcs = p.barcodes?.length ? p.barcodes : (p.barcode ? [p.barcode] : [])
        bcs.forEach(b => byBarcode.set(String(b).toLowerCase(), p))
      })
      rows.forEach(r => {
        let ex = r.code && byCode.get(r.code.toLowerCase())
        if (!ex) ex = r.barcodes.map(b => byBarcode.get(b.toLowerCase())).find(Boolean)
        if (ex) r.existingId = ex.id
      })

      const result = await onImport(rows)
      const withPhotos = rows.filter(r => r.photos.length > 0).length
      const totalBarcodes = rows.reduce((s, r) => s + r.barcodes.length, 0)
      setImportResult(
        `✅ ${result.created} productos nuevos, ${result.updated} actualizados ` +
        `(${totalBarcodes} códigos de barras en total).` +
        (withPhotos > 0 ? ` ${withPhotos} con fotos del Excel.` : '') +
        (skippedNoName > 0 ? ` Se saltearon ${skippedNoName} filas sin nombre.` : '')
      )
    } catch (err) {
      setImportResult('❌ Error al importar: ' + err.message)
    } finally {
      setImporting(false)
    }
  }

  // Exporta el inventario con la FOTO pegada en su columna (usa ExcelJS, que
  // sí soporta imágenes). Carga las fotos on-demand de los que tengan.
  const exportExcel = async () => {
    setExporting(true)
    try {
      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Productos')
      ws.columns = [
        { header: 'FOTO', key: 'foto', width: 12 },
        { header: 'Nombre', key: 'name', width: 26 },
        { header: 'SKU', key: 'code', width: 12 },
        { header: 'Código de Barras', key: 'barcode', width: 18 },
        { header: 'Categoría', key: 'category', width: 14 },
        { header: 'Precio', key: 'price', width: 10 },
        { header: 'Cantidad', key: 'quantity', width: 10 },
        { header: 'Stock Mínimo', key: 'minStock', width: 12 },
        { header: 'Ubicación', key: 'location', width: 14 },
        { header: 'Tipo', key: 'tipo', width: 8 },
        { header: 'Descripción', key: 'description', width: 26 },
      ]
      ws.getRow(1).font = { bold: true }

      for (let i = 0; i < products.length; i++) {
        const p = products[i]
        const bcs = p.barcodes?.length ? p.barcodes : (p.barcode ? [p.barcode] : [])
        ws.addRow({
          name: p.name || '',
          code: p.code || '',
          barcode: bcs.join(', '),
          category: p.category || '',
          price: p.price || 0,
          quantity: p.quantity || 0,
          minStock: p.minStock || 5,
          location: p.location || '',
          tipo: p.stockType || '',
          description: p.description || '',
        })
        if (p.hasPhotos && loadPhotos) {
          const photos = await loadPhotos(p.id)
          if (photos && photos[0]) {
            const rowIdx = i + 1 // 0-indexed: encabezado = 0, 1er producto = 1
            ws.getRow(rowIdx + 1).height = 60
            const b64 = photos[0].split(',')[1]
            const imgId = wb.addImage({ base64: b64, extension: 'jpeg' })
            ws.addImage(imgId, {
              tl: { col: 0.15, row: rowIdx + 0.15 },
              ext: { width: 72, height: 72 },
            })
          }
        }
      }

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'inventario.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('Error al exportar: ' + err.message)
    } finally {
      setExporting(false)
    }
  }

  // Carga de compra: suma stock a productos existentes (por SKU o código de barras)
  const findByRef = (ref) => matchRef(products, ref)

  // Lee el Excel y arma la VISTA PREVIA (no aplica nada todavía)
  // Buscar combo por SKU o código de barras
  const findComboByRef = (ref) => matchRef(combos, ref)

  const handlePurchaseFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPurchaseResult('')
    setPurchasePreview(null)
    try {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer)
      const sheetName = wb.SheetNames.find(n => normalize(n) === 'compra') || wb.SheetNames[0]
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' })
      if (!raw.length) {
        setPurchaseResult('⚠️ El archivo está vacío.')
        return
      }
      // Agrupar por producto base final. Un COMBO expande a sus productos:
      // cada componente se ajusta por (cantidad del combo × cantidad del ajuste).
      const byProduct = new Map()
      const rows = []
      const notFound = new Set()
      let reference = ''
      const addDelta = (p, delta, origin, reason) => {
        rows.push({ productId: p.id, productName: p.name, quantity: delta, reason })
        if (!byProduct.has(p.id)) {
          byProduct.set(p.id, { productName: p.name, origins: new Set(), current: p.quantity || 0, delta: 0 })
        }
        const e = byProduct.get(p.id)
        e.delta += delta
        e.origins.add(origin)
      }
      raw.forEach(r => {
        const o = {}
        Object.entries(r).forEach(([k, v]) => {
          const f = PURCHASE_COLS[normalize(k)]
          if (f) o[f] = v
        })
        if (o.reference && !reference) reference = String(o.reference).trim()
        const refCode = o.ref !== undefined ? String(o.ref).trim() : ''
        const qty = Math.round(parseNumber(o.qty))
        if (!refCode || qty === 0) return
        // 1) ¿es un producto?
        const p = findByRef(refCode)
        if (p) { addDelta(p, qty, refCode); return }
        // 2) ¿es un combo? → expandir a sus productos base
        const combo = findComboByRef(refCode)
        if (combo) {
          const reason = `Ajuste combo ${combo.code || refCode}`
          combo.items?.forEach(item => {
            const bp = products.find(pp => pp.id === item.productId)
            if (!bp) return
            addDelta(bp, item.quantity * qty, `${refCode} (combo)`, reason)
          })
          return
        }
        notFound.add(refCode)
      })
      if (!rows.length) {
        if (notFound.size > 0) {
          setPurchaseResult(
            `⚠️ Ninguno de los códigos existe como producto ni como combo. Revisá que el ` +
            `SKU o código de barras coincida con algo ya cargado. Ejemplos que no se ` +
            `encontraron: ${[...notFound].slice(0, 8).join(', ')}${notFound.size > 8 ? '…' : ''}.`
          )
        } else {
          setPurchaseResult(
            '⚠️ No se pudo cargar la compra. El archivo debe tener una columna con el ' +
            'SKU o código de barras del producto y otra con la Cantidad. ' +
            'Descargá la plantilla de compra para ver el formato.'
          )
        }
        return
      }
      setPurchasePreview({
        rows,
        reference,
        lines: [...byProduct.values()],
        notFound: [...notFound],
      })
    } catch (err) {
      setPurchaseResult('❌ Error al leer el archivo: ' + err.message)
    }
  }

  // ---- Ingreso por FOTO de factura/remito (Gemini lee los renglones) ----
  // Comprimir la foto en el navegador para no pasarse del límite del servidor
  const compressPhoto = (file) => new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const MAX = 1600
      const scale = Math.min(1, MAX / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1])
      URL.revokeObjectURL(img.src)
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })

  const handleInvoicePhoto = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPurchaseResult('')
    setPurchasePreview(null)
    setInvoiceScanning(true)
    try {
      const photoB64 = await compressPhoto(file)
      const resp = await fetch('/api/contabilium?action=extract', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoB64, mimeType: 'image/jpeg' }),
      })
      const text = await resp.text()
      let r
      try { r = JSON.parse(text) } catch {
        throw new Error('El servidor falló al procesar la foto (' + resp.status + '): ' + text.slice(0, 120))
      }
      if (!r.ok) throw new Error(r.error || 'No se pudo leer la factura')
      const f = r.factura || {}
      const items = (f.items || []).filter(it => Math.round(Number(it.cantidad)) > 0)
      if (!items.length) throw new Error('La IA no encontró renglones de artículos. ' + (f.observaciones || 'Probá con una foto más derecha y con buena luz.'))

      // Matching por nombre cuando la factura no trae código: puntúa cuántas
      // palabras de la descripción aparecen en el nombre del producto
      const nrm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      const fuzzyProduct = (desc) => {
        const toks = nrm(desc).split(/[^a-z0-9]+/).filter(t => t.length >= 3)
        if (!toks.length) return null
        let best = null, bestScore = 0
        products.forEach(p => {
          const name = nrm(p.name)
          const hits = toks.filter(t => name.includes(t)).length
          const score = hits / toks.length
          if ((hits >= 2 || (toks.length === 1 && hits === 1)) && score > bestScore) { best = p; bestScore = score }
        })
        return bestScore >= 0.5 ? best : null
      }

      const byProduct = new Map()
      const rows = []
      const notFound = []
      const reference = [f.tipoComprobante, [f.puntoVenta, f.numeroComprobante].filter(Boolean).join('-'), f.proveedor?.razonSocial]
        .filter(Boolean).join(' ').trim() || 'Foto de factura'
      const addDelta = (p, delta, origin, reason) => {
        rows.push({ productId: p.id, productName: p.name, quantity: delta, reason: reason || `Compra por foto (${reference})` })
        if (!byProduct.has(p.id)) {
          byProduct.set(p.id, { productName: p.name, origins: new Set(), current: p.quantity || 0, delta: 0 })
        }
        const en = byProduct.get(p.id)
        en.delta += delta
        en.origins.add(origin)
      }
      items.forEach(it => {
        const qty = Math.round(Number(it.cantidad))
        const code = String(it.codigo || '').trim()
        const desc = String(it.descripcion || '').trim()
        // 1) por código exacto (producto o combo)
        if (code) {
          const p = findByRef(code)
          if (p) { addDelta(p, qty, code); return }
          const combo = findComboByRef(code)
          if (combo) {
            combo.items?.forEach(item => {
              const bp = products.find(pp => pp.id === item.productId)
              if (bp) addDelta(bp, item.quantity * qty, `${code} (combo)`, `Compra por foto — combo ${combo.code}`)
            })
            return
          }
        }
        // 2) por descripción (aprox.)
        const fp = fuzzyProduct(desc)
        if (fp) { addDelta(fp, qty, `"${desc}" ≈`); return }
        notFound.push(`${desc || code} (×${qty})`)
      })
      if (!rows.length) {
        setPurchaseResult(
          `⚠️ Leí la factura (${items.length} renglones) pero no pude asociar ninguno a tus productos. ` +
          `Renglones: ${notFound.slice(0, 6).join(' · ')}. Cargalos con el buscador de Movimientos o por Excel.`
        )
        return
      }
      setPurchasePreview({ rows, reference, lines: [...byProduct.values()], notFound })
    } catch (err) {
      setPurchaseResult('❌ ' + err.message)
    } finally {
      setInvoiceScanning(false)
    }
  }

  // ---- Importar medidas y códigos desde el Reporte de Planificación de ML ----
  // Formato: columna CODIGO (código de barras/inventario Full), columna SKU
  // (uno o varios MLA separados por coma) y columna Tamaño ("15 x 20 x 20").
  // El código se agrega como código de barras del combo o producto que matchee
  // (un combo puede acumular varios códigos), y el tamaño se guarda como
  // medidas del PRODUCTO base (aclarado por el usuario el 24/8).
  const handleMeasuresFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImportResult('')
    setMeasuring(true)
    try {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer)
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
      const hi = rows.findIndex(r => r.some(c => normalize(c) === 'codigo') && r.some(c => normalize(c) === 'sku'))
      if (hi === -1) throw new Error('No encontré las columnas CODIGO y SKU (¿es el Reporte de Planificación de ML?)')
      const head = rows[hi].map(c => normalize(c))
      const iCod = head.indexOf('codigo')
      const iSku = head.indexOf('sku')
      const iTam = head.findIndex(c => ['tamano', 'tamaño', 'medidas', 'dimensiones'].includes(c))
      const prodPatches = new Map()
      const comboPatches = new Map()
      const notFound = new Set()
      let nBar = 0
      rows.slice(hi + 1).forEach(r => {
        const barcode = String(r[iCod] || '').trim()
        const dims = iTam >= 0 ? String(r[iTam] || '').trim() : ''
        const skus = String(r[iSku] || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)
        skus.forEach(ref => {
          const combo = findComboByRef(ref)
          const target = combo || findByRef(ref)
          if (!target) { notFound.add(ref); return }
          // Código de barras → al que matchea (combo o producto); acumula varios
          const map = combo ? comboPatches : prodPatches
          const patch = map.get(target.id) || {}
          const bcs = patch.barcodes || (target.barcodes?.length ? [...target.barcodes] : (target.barcode ? [target.barcode] : []))
          if (barcode && !bcs.includes(barcode)) {
            bcs.push(barcode)
            patch.barcodes = bcs
            patch.barcode = bcs[0]
            nBar++
          }
          if (Object.keys(patch).length) map.set(target.id, patch)
          // Medidas → SIEMPRE al PRODUCTO: directo si es producto, o a los
          // productos base si el SKU es un combo
          if (dims) {
            const baseIds = combo
              ? (combo.items || []).map(ci => ci.productId).filter(pid => products.some(pp => pp.id === pid))
              : [target.id]
            baseIds.forEach(pid => {
              const pPatch = prodPatches.get(pid) || {}
              pPatch.dims = dims
              prodPatches.set(pid, pPatch)
            })
          }
        })
      })
      if (!prodPatches.size && !comboPatches.size) {
        setImportResult('⚠️ Ningún SKU del reporte existe en el sistema. Ejemplos: ' + [...notFound].slice(0, 6).join(', '))
        return
      }
      await onBulkPatch({
        products: [...prodPatches].map(([id, patch]) => ({ id, patch })),
        combos: [...comboPatches].map(([id, patch]) => ({ id, patch })),
      })
      setImportResult(
        `✅ Medidas y códigos aplicados: ${comboPatches.size} combos y ${prodPatches.size} productos ` +
        `(${nBar} códigos de barras nuevos).` +
        (notFound.size ? ` ⚠️ ${notFound.size} SKU no encontrados (ej: ${[...notFound].slice(0, 6).join(', ')}…)` : '')
      )
    } catch (err) {
      setImportResult('❌ ' + err.message)
    } finally {
      setMeasuring(false)
    }
  }

  const confirmPurchase = async () => {
    if (!purchasePreview) return
    setPurchasing(true)
    try {
      const result = await onPurchase(purchasePreview.rows, { reference: purchasePreview.reference })
      setPurchaseResult(
        `✅ Aplicado: ${result.entradas} entradas (+) y ${result.salidas} salidas (−) ` +
        `sobre ${result.updated} productos.`
      )
      setPurchasePreview(null)
    } catch (err) {
      setPurchaseResult('❌ Error al aplicar: ' + err.message)
    } finally {
      setPurchasing(false)
    }
  }

  // Plantilla del importador 📐 Medidas ML (mismo formato que el Reporte de
  // Planificación que descarga MercadoLibre desde Full → Planificación)
  const downloadMeasuresTemplate = () => {
    const mla = combos[0]?.code || 'MLA1234567890'
    const mla2 = combos[1]?.code || 'MLA9876543210'
    const ws = XLSX.utils.aoa_to_sheet([
      ['CODIGO', 'SKU', 'Tamaño'],
      ['TEEH94301', mla, '15 x 20 x 20'],
      ['UJVG21180', `${mla2}, MLA1111222333`, '25 x 30 x 10'],
    ])
    ws['!cols'] = [{ wch: 14 }, { wch: 34 }, { wch: 14 }]
    const info = XLSX.utils.aoa_to_sheet([
      ['CÓMO CARGAR MEDIDAS Y CÓDIGOS (botón 📐 Medidas ML)'],
      [''],
      ['Es el MISMO formato del "Reporte de Planificación" que descarga'],
      ['MercadoLibre (Full → Planificación → descargar reporte): ese archivo'],
      ['se puede subir DIRECTO, sin tocarlo.'],
      [''],
      ['Si lo armás a mano, una fila por código con estas columnas:'],
      ['1) CODIGO: el código de barras / código de inventario (ej: TEEH94301).'],
      ['   Se agrega como código de barras del combo o producto que corresponda'],
      ['   (un combo puede tener varios códigos: se van sumando, no se pisan).'],
      ['2) SKU: el MLA de la publicación. Pueden ir VARIOS separados por coma'],
      ['   (el código y el tamaño se aplican a todos).'],
      ['3) Tamaño: medidas DEL PRODUCTO en cm, "largo x ancho x alto"'],
      ['   (ej: 15 x 20 x 20). Se guardan SIEMPRE en el producto: si el SKU es'],
      ['   un combo, van a su producto base. Empaquetado las usa para decir'],
      ['   qué bolsa va.'],
      [''],
      ['Los SKU tienen que existir como combo o producto. Los que no se'],
      ['encuentren se listan al final y no se tocan.'],
    ])
    info['!cols'] = [{ wch: 75 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Medidas')
    XLSX.utils.book_append_sheet(wb, info, 'Instrucciones')
    XLSX.writeFile(wb, 'plantilla-medidas-ml.xlsx')
  }

  const downloadPurchaseTemplate = () => {
    const sku = products[0]?.code || products[0]?.barcode || 'SKU-001'
    const sku2 = products[1]?.code || products[1]?.barcode || 'SKU-002'
    const ws = XLSX.utils.aoa_to_sheet([
      ['SKU o Código', 'Cantidad', 'Factura'],
      [sku, 12, 'FAC-A-0001'],
      [sku2, -3, 'AJUSTE'],
    ])
    ws['!cols'] = [{ wch: 22 }, { wch: 10 }, { wch: 16 }]
    const info = XLSX.utils.aoa_to_sheet([
      ['CÓMO CARGAR STOCK POR EXCEL (SUMA o RESTA)'],
      [''],
      ['1) Una fila por producto, en la hoja "Compra".'],
      ['2) Columna "SKU o Código": el SKU o el código de barras del producto'],
      ['   (tiene que existir ya en tu inventario).'],
      ['3) Columna "Cantidad":'],
      ['   • Número POSITIVO (ej: 12) → SUMA stock (compra/entrada).'],
      ['   • Número NEGATIVO (ej: -3) → RESTA stock (descuento/salida).'],
      ['   El stock puede quedar negativo.'],
      ['4) Columna "Factura" (opcional): número de factura/remito/ajuste. Queda'],
      ['   registrado en cada movimiento para la auditoría.'],
      [''],
      ['Ojo: esto NO crea productos nuevos ni cambia precios. Solo suma/resta stock'],
      ['a productos que ya existen. Para crear productos usá "Importar Excel".'],
    ])
    info['!cols'] = [{ wch: 72 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, info, 'Instrucciones')
    XLSX.utils.book_append_sheet(wb, ws, 'Compra')
    XLSX.writeFile(wb, 'plantilla-compra.xlsx')
  }

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['FOTO', 'Nombre', 'SKU', 'Código de Barras', 'Categoría', 'Precio', 'Cantidad', 'Stock Mínimo', 'Ubicación', 'Tipo', 'Descripción'],
      ['', 'Martillo carpintero', 'SKU-001', '7790001001234', 'Herramientas', 1500, 10, 5, 'Estante A3', 'FERRE', 'Mango de madera'],
      ['', 'Destornillador Phillips', 'SKU-002', '7790001005678', 'Herramientas', 800, 25, 5, 'Estante A4', 'BASE', ''],
    ])
    ws['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 9 }, { wch: 9 }, { wch: 11 }, { wch: 14 }, { wch: 8 }, { wch: 24 }]

    // Hoja de instrucciones (incluye cómo cargar las fotos)
    const info = XLSX.utils.aoa_to_sheet([
      ['CÓMO USAR ESTA PLANTILLA'],
      [''],
      ['1) Completá una fila por producto en la hoja "Productos".'],
      ['   Solo "Nombre" es obligatorio; el resto es opcional.'],
      [''],
      ['2) Columna "Tipo": poné FULL, FERRE o BASE (o dejala vacía).'],
      [''],
      ['3) Columna "Ubicación": dónde está en el depósito (ej: Estante A3).'],
      [''],
      ['4) FOTO: pegá la imagen del producto en la columna "FOTO" (la primera),'],
      ['   en la MISMA FILA del producto:'],
      ['   • En Excel: hacé clic en la celda FOTO de esa fila.'],
      ['   • Menú Insertar → Imágenes → elegí la foto.'],
      ['   • Ajustá la imagen para que quede dentro de la fila del producto.'],
      ['   • Al importar, la app toma esa foto y la asigna a ese producto.'],
      ['   • También podés cargarla después desde la app (Editar ✏️ → 📷).'],
      [''],
      ['5) Para MODIFICAR productos ya cargados: usá el botón "Exportar",'],
      ['   cambiá lo que quieras y volvé a Importar el mismo archivo.'],
      ['   La app reconoce el SKU o el código de barras y actualiza sin duplicar.'],
      ['   Al exportar, las fotos vienen pegadas en la columna FOTO.'],
    ])
    info['!cols'] = [{ wch: 70 }]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, info, 'Instrucciones')
    XLSX.utils.book_append_sheet(wb, ws, 'Productos')
    XLSX.writeFile(wb, 'plantilla-productos.xlsx')
  }

  const handleDeleteCombo = async (id) => {
    if (!window.confirm('¿Eliminar este combo? (No afecta el stock de los productos)')) return
    try {
      await onDeleteCombo(id)
    } catch (err) {
      alert(err.message)
    }
  }

  // Productos y combos unificados en una sola lista
  const toMillis = (t) => (t?.toMillis ? t.toMillis() : new Date(t || 0).getTime())

  // Un combo se encuentra por nombre, su código de barras, su SKU o el
  // código de barras / SKU de cualquier producto que lo compone
  const comboComponentCodes = (combo) => {
    const live = (combo.items || []).flatMap(item => {
      const p = products.find(pp => pp.id === item.productId)
      return [...(p?.barcodes || (p?.barcode ? [p.barcode] : [])), p?.code].filter(Boolean)
    })
    return [...live, ...(combo.itemBarcodes || [])]
  }

  // Todos los códigos de barras de un producto (soporta varios por producto)
  const allBarcodes = (item) => item.barcodes?.length ? item.barcodes : (item.barcode ? [item.barcode] : [])

  const matchesSearch = (item) => {
    if (!searchTerm.trim()) return true
    const q = searchTerm.toLowerCase()
    if (
      item.name?.toLowerCase().includes(q) ||
      item.code?.toLowerCase().includes(q) ||
      item.location?.toLowerCase().includes(q) ||
      item.stockType?.toLowerCase().includes(q) ||
      allBarcodes(item).some(b => String(b).toLowerCase().includes(q))
    ) return true
    if (item.kind === 'combo') {
      return comboComponentCodes(item).some(c => c.toLowerCase().includes(q))
    }
    return false
  }

  const allRows = [
    ...(kindFilter !== 'combos' ? products.map(p => ({ kind: 'product', ...p })) : []),
    ...(kindFilter !== 'products' ? combos.map(c => ({ kind: 'combo', ...c })) : []),
  ]
    .filter(matchesSearch)
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))

  return (
    <div className="inventory-container">
      <div className="inventory-header">
        <div>
          <h1>📦 Inventario</h1>
          <p>Gestiona tus productos y stock</p>
        </div>
        <div className="header-buttons">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
          <input
            ref={purchaseInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={handlePurchaseFile}
          />
          {canEdit && (
            <button onClick={downloadTemplate} className="btn-outline" title="Excel de ejemplo con el formato correcto">
              📄 Plantilla
            </button>
          )}
          {canEdit && (
            <button
              onClick={() => purchaseInputRef.current?.click()}
              className="btn-purchase"
              disabled={purchasing}
              title="Subir un Excel para sumar (+) o restar (−) stock por SKU/código"
            >
              {purchasing ? '⏳ Cargando...' : '🧾 Compra / Ajuste'}
            </button>
          )}
          {canEdit && (
            <>
              <input
                ref={measInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: 'none' }}
                onChange={handleMeasuresFile}
              />
              <button
                onClick={downloadMeasuresTemplate}
                className="btn-outline"
                title="Excel de ejemplo con el formato de medidas (es el mismo del Reporte de Planificación de ML)"
              >
                📄 Plantilla medidas
              </button>
              <button
                onClick={() => measInputRef.current?.click()}
                className="btn-outline"
                disabled={measuring}
                title="Subir el Reporte de Planificación de ML (o la plantilla): agrega el código de barras a cada MLA y guarda el tamaño del paquete para elegir la bolsa al empaquetar"
              >
                {measuring ? '⏳ Aplicando...' : '📐 Medidas ML'}
              </button>
            </>
          )}
          {canEdit && (
            <>
              <input
                ref={invoiceInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: 'none' }}
                onChange={handleInvoicePhoto}
              />
              <button
                onClick={() => invoiceInputRef.current?.click()}
                className="btn-purchase"
                disabled={invoiceScanning}
                title="Sacá una foto de la factura o remito: la IA lee los renglones y te muestra la precarga para confirmar"
              >
                {invoiceScanning ? '⏳ Leyendo factura...' : '📷 Foto factura'}
              </button>
            </>
          )}
          <button
            onClick={exportExcel}
            className="btn-outline"
            disabled={products.length === 0 || exporting}
            title="Descargar el inventario (con fotos) para modificarlo masivamente y volver a importarlo"
          >
            {exporting ? '⏳ Exportando...' : '⬆️ Exportar'}
          </button>
          {canEdit && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="btn-import"
              disabled={importing}
            >
              {importing ? '⏳ Importando...' : '📥 Importar Excel'}
            </button>
          )}
          {canEdit && (
            <button
              onClick={() => {
                resetForm()
                setShowForm(!showForm)
              }}
              className="btn-add"
            >
              {showForm ? '✕ Cancelar' : '+ Nuevo Producto'}
            </button>
          )}
        </div>
      </div>

      {importResult && (
        <div className={importResult.startsWith('✅') ? 'import-ok' : 'import-warn'}>
          {importResult}
          {!importResult.startsWith('✅') && (
            <button className="btn-template" onClick={downloadTemplate}>
              ⬇️ Descargar plantilla de ejemplo
            </button>
          )}
        </div>
      )}

      {purchaseResult && (
        <div className={purchaseResult.startsWith('✅') ? 'import-ok' : 'import-warn'}>
          {purchaseResult}
          {!purchaseResult.startsWith('✅') && (
            <button className="btn-template" onClick={downloadPurchaseTemplate}>
              ⬇️ Descargar plantilla de compra
            </button>
          )}
        </div>
      )}

      {purchasePreview && (
        <div className="purchase-preview">
          <div className="pp-header">
            <h3>Revisá antes de aplicar</h3>
            {purchasePreview.reference && (
              <span className="pp-ref">Ref: {purchasePreview.reference}</span>
            )}
          </div>
          <p className="pp-note">
            Se va a ajustar el stock de <strong>{purchasePreview.lines.length} productos</strong>.
            Los combos descuentan sus productos base (× la cantidad).
            Verificá que sea correcto y confirmá.
          </p>
          <div className="pp-table-wrap">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Producto</th>
                  <th>Stock actual</th>
                  <th>Cambio</th>
                  <th>Stock nuevo</th>
                </tr>
              </thead>
              <tbody>
                {purchasePreview.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="pp-code">{[...l.origins].join(', ')}</td>
                    <td>{l.productName}</td>
                    <td>{l.current}</td>
                    <td className={l.delta >= 0 ? 'pp-plus' : 'pp-minus'}>
                      {l.delta >= 0 ? `+${l.delta}` : l.delta}
                    </td>
                    <td className="pp-new">{l.current + l.delta}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {purchasePreview.notFound.length > 0 && (
            <p className="pp-notfound">
              ⚠️ No se encontraron (se ignoran): {purchasePreview.notFound.slice(0, 10).join(', ')}
              {purchasePreview.notFound.length > 10 ? '…' : ''}
            </p>
          )}
          <div className="pp-actions">
            <button className="btn-primary" onClick={confirmPurchase} disabled={purchasing}>
              {purchasing ? '⏳ Aplicando...' : `✓ Confirmar y aplicar (${purchasePreview.lines.length})`}
            </button>
            <button className="btn-secondary" onClick={() => setPurchasePreview(null)} disabled={purchasing}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <div className="form-panel">
          <h2>{editingId ? 'Editar Producto' : 'Nuevo Producto'}</h2>
          {error && <div className="error-message">{error}</div>}

          <form onSubmit={handleSubmit} className="product-form">
            <div className="form-grid">
              <div className="form-group">
                <label>Nombre *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Nombre del producto"
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label>SKU</label>
                <input
                  type="text"
                  value={formData.code}
                  onChange={e => setFormData({ ...formData, code: e.target.value })}
                  placeholder="Código interno / SKU"
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label>|||| Códigos de barras (uno por línea)</label>
                <textarea
                  value={formData.barcodes}
                  onChange={e => setFormData({ ...formData, barcodes: e.target.value })}
                  placeholder={'Un producto puede tener varios.\n7790001001234\nESVG88396'}
                  rows="2"
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label>Categoría</label>
                <input
                  type="text"
                  value={formData.category}
                  onChange={e => setFormData({ ...formData, category: e.target.value })}
                  placeholder="Categoría"
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label>Precio ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.price}
                  onChange={e => setFormData({ ...formData, price: e.target.value })}
                  placeholder="0.00"
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label>Cantidad Actual (puede ser negativa)</label>
                <input
                  type="number"
                  value={formData.quantity}
                  onChange={e => setFormData({ ...formData, quantity: e.target.value })}
                  placeholder="0"
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label>Stock Mínimo</label>
                <input
                  type="number"
                  min="0"
                  value={formData.minStock}
                  onChange={e => setFormData({ ...formData, minStock: e.target.value })}
                  placeholder="5"
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label>📍 Ubicación en el depósito</label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={e => setFormData({ ...formData, location: e.target.value })}
                  placeholder="Ej: Estante A3, Pasillo 2"
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label>Tipo de stock</label>
                <select
                  value={formData.stockType}
                  onChange={e => setFormData({ ...formData, stockType: e.target.value })}
                  disabled={loading}
                >
                  <option value="">-- Sin asignar --</option>
                  {STOCK_TYPES.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>Medidas del artículo (cm) — para elegir la bolsa al empaquetar</label>
              <input
                type="text"
                value={formData.dims}
                onChange={e => setFormData({ ...formData, dims: e.target.value })}
                placeholder="largo x ancho x alto — ej: 25x12x4"
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label className="fragile-check">
                <input
                  type="checkbox"
                  checked={!!formData.fragile}
                  onChange={e => setFormData({ ...formData, fragile: e.target.checked })}
                  disabled={loading}
                />
                ⚠️ Producto FRÁGIL (se avisa al empaquetar)
              </label>
            </div>

            <div className="form-group">
              <label>Descripción</label>
              <textarea
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                placeholder="Descripción del producto"
                rows="3"
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label>Fotos ({formData.photos.length}/{MAX_PHOTOS})</label>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={handleAddPhotos}
              />
              <div className="photos-row">
                {formData.photos.map((photo, i) => (
                  <div key={i} className="photo-thumb">
                    <img src={photo} alt={`Foto ${i + 1}`} />
                    <button
                      type="button"
                      className="photo-remove"
                      onClick={() => removePhoto(i)}
                      title="Quitar foto"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {formData.photos.length < MAX_PHOTOS && (
                  <button
                    type="button"
                    className="photo-add"
                    onClick={() => photoInputRef.current?.click()}
                    disabled={loading}
                  >
                    📷<br />Agregar
                  </button>
                )}
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? '⏳ Guardando...' : (editingId ? '✓ Actualizar' : '✓ Crear Producto')}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setShowForm(false)
                  resetForm()
                }}
                disabled={loading}
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="filter-chips">
        <button
          className={`chip-btn ${kindFilter === 'all' ? 'active' : ''}`}
          onClick={() => setKindFilter('all')}
        >
          Todos ({products.length + combos.length})
        </button>
        <button
          className={`chip-btn ${kindFilter === 'products' ? 'active' : ''}`}
          onClick={() => setKindFilter('products')}
        >
          🏷️ Productos ({products.length})
        </button>
        <button
          className={`chip-btn ${kindFilter === 'combos' ? 'active' : ''}`}
          onClick={() => setKindFilter('combos')}
        >
          🧩 Combos ({combos.length})
        </button>
      </div>

      <div className="search-box search-row">
        <input
          type="text"
          placeholder="🔍 Buscar por nombre, SKU, código de barras, ubicación o tipo..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
        <button
          className="btn-search-scan"
          onClick={() => setShowSearchScanner(true)}
          title="Buscar escaneando con la cámara"
        >
          📷
        </button>
      </div>

      {showSearchScanner && (
        <Scanner
          onScan={(code) => {
            setShowSearchScanner(false)
            setSearchTerm(code)
          }}
          onClose={() => setShowSearchScanner(false)}
        />
      )}

      {searchTerm.trim() && allRows.length > 0 && (
        <div className="found-list">
          {allRows.slice(0, 5).map(row => (
            <div key={`found-${row.kind}-${row.id}`} className="found-card">
              <LazyThumb
                id={row.id}
                hasPhotos={row.hasPhotos}
                kind={row.kind}
                loadPhotos={loadPhotos}
                className="found-photo"
              />
              <div className="found-body">
                <div className="found-top">
                  <div className="found-name">
                    {row.kind === 'combo' ? '🧩 ' : ''}{row.name}
                  </div>
                  <div className={`found-location ${row.location ? '' : 'empty'}`}>
                    {row.location ? (
                      <><span className="pin">📍</span>{row.location}</>
                    ) : (
                      'Sin ubicación'
                    )}
                  </div>
                </div>
                <div className="found-meta">
                  {row.code && <span className="fm-sku">SKU: {row.code}</span>}
                  {row.barcode && (
                    <span className="fm-bar">
                      |||| {row.barcode}
                      {row.barcodes?.length > 1 ? ` +${row.barcodes.length - 1}` : ''}
                    </span>
                  )}
                  <span className="fm-stock">
                    Stock: {row.kind === 'combo' ? `${comboAvailable(row, products)} armables` : (row.quantity || 0)}
                  </span>
                  {row.kind !== 'combo' && (() => {
                    const h = stockStatus(row, consumption?.get(row.id) || 0)
                    return (
                      <span className={`health health-${h.status}`}>
                        {h.label}{h.daysLeft != null && h.status !== 'sin' ? ` · ${daysLeftText(h)}` : ''}
                      </span>
                    )
                  })()}
                </div>
                {canEdit && (
                  <div className="found-actions">
                    <button
                      onClick={() => (row.kind === 'combo' ? onEditCombo(row) : handleEdit(row))}
                      className="btn-edit"
                      title="Editar"
                    >
                      ✏️ Editar
                    </button>
                    <button
                      onClick={() => (row.kind === 'combo' ? handleDeleteCombo(row.id) : handleDelete(row.id))}
                      className="btn-del"
                      title="Eliminar"
                    >
                      🗑️
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {allRows.length === 0 ? (
        <div className="empty-state">
          <p>🏷️</p>
          <p>{searchTerm ? 'No se encontraron resultados' : 'No hay productos. Creá uno o importá tu Excel para empezar.'}</p>
          {!searchTerm && (
            <button className="btn-template" onClick={downloadTemplate}>
              ⬇️ Descargar plantilla Excel
            </button>
          )}
        </div>
      ) : (
        <div className="products-table-container">
          <table className="products-table">
            <thead>
              <tr>
                <th>Foto</th>
                <th>Tipo</th>
                <th>Nombre</th>
                <th>SKU</th>
                <th>Cód. Barras</th>
                <th>FULL/FERRE/BASE</th>
                <th>Precio</th>
                <th>Stock</th>
                <th>📍 Ubicación</th>
                <th>Salud / Días</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {allRows.map(row => {
                const isCombo = row.kind === 'combo'
                const stock = isCombo ? comboAvailable(row, products) : (row.quantity || 0)
                const isLow = isCombo ? stock <= 0 : (row.quantity ?? 0) < (row.minStock || 5)
                return (
                  <tr key={`${row.kind}-${row.id}`} className={isLow ? 'low-stock' : ''}>
                    <td>
                      <LazyThumb
                        id={row.id}
                        hasPhotos={row.hasPhotos}
                        kind={row.kind}
                        loadPhotos={loadPhotos}
                      />
                    </td>
                    <td>
                      <span className={`kind-badge ${row.kind}`}>
                        {isCombo ? '🧩 Combo' : '🏷️ Producto'}
                      </span>
                    </td>
                    <td className="bold">{row.name}</td>
                    <td>{row.code || '-'}</td>
                    <td className="barcode-cell">
                      {row.barcode || '-'}
                      {row.barcodes?.length > 1 && (
                        <span className="bc-more"> +{row.barcodes.length - 1}</span>
                      )}
                    </td>
                    <td>
                      {row.stockType ? (
                        <span className={`badge-st ${row.stockType.toLowerCase()}`}>{row.stockType}</span>
                      ) : '-'}
                    </td>
                    <td>${row.price ? Number(row.price).toFixed(2) : '0.00'}</td>
                    <td className="stock">
                      {stock}
                      {isCombo && <span className="stock-note"> armables</span>}
                    </td>
                    <td>{row.location || '-'}</td>
                    <td>
                      {isCombo ? (
                        <span className={`badge ${stock > 0 ? 'ok' : 'warn'}`}>
                          {stock > 0 ? '✓ OK' : '⚠ Sin stock'}
                        </span>
                      ) : (() => {
                        const h = stockStatus(row, consumption?.get(row.id) || 0)
                        return (
                          <span className={`health health-${h.status}`} title={h.dailyRate > 0 ? `${h.dailyRate.toFixed(1)} u/día` : ''}>
                            {h.label}
                            {h.daysLeft != null && h.status !== 'sin' && <em> · {daysLeftText(h)}</em>}
                          </span>
                        )
                      })()}
                    </td>
                    <td className="actions">
                      {canEdit && (
                        <>
                          <button
                            onClick={() => (isCombo ? onEditCombo(row) : handleEdit(row))}
                            className="btn-edit"
                            title="Editar"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => (isCombo ? handleDeleteCombo(row.id) : handleDelete(row.id))}
                            className="btn-del"
                            title="Eliminar"
                          >
                            🗑️
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
