import React, { useState, useEffect, useRef } from 'react'
import * as XLSX from 'xlsx'
import { findByRef } from '../utils/refMatch'
import { compressImage, MAX_PHOTOS, MAX_PHOTOS_BYTES, photosSize } from '../utils/images'
import { extractImagesByRow } from '../utils/excelImages'
import LazyThumb from './LazyThumb'
import './Combos.css'

export const STOCK_TYPES = ['FULL', 'FERRE', 'BASE']

const normalize = (s) =>
  String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()

// Mapea encabezados del Excel de combos a campos.
// Formato multi-fila: cada combo ocupa varias filas (una por producto que lo
// compone). El SKU y el nombre del combo se repiten en cada fila del combo.
const COMBO_COLS = {
  'sku combo': 'comboCode', 'sku del combo': 'comboCode', 'codigo combo': 'comboCode',
  'codigo del combo': 'comboCode', sku: 'comboCode', codigo: 'comboCode', combo: 'comboCode',
  'nombre combo': 'comboName', 'nombre del combo': 'comboName', nombre: 'comboName',
  'codigo de barras': 'barcode', 'codigo de barras combo': 'barcode', barcode: 'barcode',
  precio: 'price', price: 'price',
  ubicacion: 'location', location: 'location', deposito: 'location',
  tipo: 'stockType', 'tipo de stock': 'stockType', canal: 'stockType',
  producto: 'itemRef', 'producto (sku)': 'itemRef', 'sku producto': 'itemRef',
  'producto sku': 'itemRef', componente: 'itemRef', item: 'itemRef', articulo: 'itemRef',
  'codigo (armado p)': 'itemRef', 'armado p': 'itemRef', 'codigo armado': 'itemRef',
  cantidad: 'itemQty', cant: 'itemQty', qty: 'itemQty', unidades: 'itemQty',
  'armado s': 'itemQty', armado: 'itemQty',
}

const parseNumber = (v) => {
  if (typeof v === 'number') return v
  const n = parseFloat(String(v).replace(',', '.'))
  return isNaN(n) ? 0 : n
}

const EMPTY_FORM = {
  name: '',
  code: '',
  barcodes: '', // uno por línea (el combo puede tener varios)
  price: '',
  location: '',
  stockType: '',
  items: [{ productId: '', quantity: '1' }],
  photos: [],
}

// Cuántos combos completos se pueden armar con el stock actual (solo informativo,
// no bloquea nada: el stock puede quedar negativo)
export function comboAvailable(combo, products) {
  if (!combo.items?.length) return 0
  let available = Infinity
  for (const item of combo.items) {
    const p = products.find(pp => pp.id === item.productId)
    if (!p) return 0
    available = Math.min(available, Math.floor((p.quantity || 0) / item.quantity))
  }
  return available === Infinity ? 0 : Math.max(0, available)
}

export default function Combos({ combos, products, onAdd, onUpdate, onDelete, onImport, editRequest, loadPhotos, canEdit = true }) {
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [formData, setFormData] = useState(EMPTY_FORM)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [importResult, setImportResult] = useState('')
  const photoInputRef = useRef(null)
  const fileInputRef = useRef(null)

  // Busca un producto por SKU, código de barras o nombre exacto
  const findProduct = (ref) => {
    const q = String(ref ?? '').trim().toLowerCase()
    if (!q) return null
    // Por código / código de barras (tolera los ceros que se come el Excel)
    const porCodigo = findByRef(products, q)
    if (porCodigo) return porCodigo
    return products.find(p => p.name && p.name.toLowerCase() === q) || null
  }

  // Abre el formulario cuando se pide editar un combo desde Inventario
  useEffect(() => {
    if (editRequest?.combo) {
      handleEdit(editRequest.combo)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRequest?.ts])

  const resetForm = () => {
    setFormData(EMPTY_FORM)
    setEditingId(null)
    setError('')
  }

  const handleEdit = async (combo) => {
    const bcs = combo.barcodes?.length ? combo.barcodes : (combo.barcode ? [combo.barcode] : [])
    setFormData({
      name: combo.name || '',
      code: combo.code || '',
      barcodes: bcs.join('\n'),
      price: combo.price || '',
      location: combo.location || '',
      stockType: combo.stockType || '',
      items: combo.items?.length
        ? combo.items.map(i => ({ productId: i.productId, quantity: String(i.quantity) }))
        : [{ productId: '', quantity: '1' }],
      photos: [],
    })
    setEditingId(combo.id)
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    if (combo.hasPhotos && loadPhotos) {
      const photos = await loadPhotos(combo.id)
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
        setError(`Máximo ${MAX_PHOTOS} fotos por combo`)
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
        setError(`Se agregaron solo ${room} fotos (máximo ${MAX_PHOTOS} por combo)`)
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

  const setItem = (index, field, value) => {
    const items = formData.items.map((item, i) =>
      i === index ? { ...item, [field]: value } : item
    )
    setFormData({ ...formData, items })
  }

  const addItemRow = () => {
    setFormData({
      ...formData,
      items: [...formData.items, { productId: '', quantity: '1' }],
    })
  }

  const removeItemRow = (index) => {
    if (formData.items.length <= 1) return
    setFormData({
      ...formData,
      items: formData.items.filter((_, i) => i !== index),
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!formData.name.trim()) {
      setError('El nombre del combo es requerido')
      return
    }

    const items = formData.items
      .filter(i => i.productId)
      .map(i => ({ productId: i.productId, quantity: Math.max(1, parseInt(i.quantity) || 1) }))

    if (!items.length) {
      setError('El combo debe tener al menos un producto')
      return
    }

    const ids = items.map(i => i.productId)
    if (new Set(ids).size !== ids.length) {
      setError('Hay productos repetidos en el combo. Uní las cantidades en una sola fila.')
      return
    }

    setLoading(true)
    try {
      // Guarda también los códigos de barras y SKU de los productos que
      // componen el combo, para que un operario pueda encontrar el combo
      // escaneando cualquiera de sus productos
      const itemBarcodes = items.flatMap(item => {
        const p = products.find(pp => pp.id === item.productId)
        return [...(p?.barcodes || (p?.barcode ? [p.barcode] : [])), p?.code].filter(Boolean)
      })

      const barcodes = [...new Set(
        String(formData.barcodes).split(/[\n,;]+/).map(s => s.trim()).filter(Boolean)
      )]

      const data = {
        name: formData.name.trim(),
        code: formData.code.trim(),
        barcodes,
        barcode: barcodes[0] || '',
        price: formData.price ? parseFloat(formData.price) : 0,
        location: formData.location.trim(),
        stockType: formData.stockType,
        items,
        itemBarcodes,
        photos: formData.photos,
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
    if (!window.confirm('¿Eliminar este combo? (No afecta el stock de los productos)')) return
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
      const named = workbook.SheetNames.find(n => normalize(n) === 'combos')
      const sheet = named ? workbook.Sheets[named] : workbook.Sheets[workbook.SheetNames[0]]
      const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
      if (!rawRows.length) {
        setImportResult('⚠️ El archivo está vacío.')
        return
      }
      const photosByRow = await extractImagesByRow(buffer)

      // Agrupar filas por combo (mismo SKU de combo; si no hay SKU, por nombre).
      // Cada fila aporta un producto componente.
      const groups = new Map()
      rawRows.forEach(raw => {
        const c = {}
        Object.entries(raw).forEach(([key, value]) => {
          const field = COMBO_COLS[normalize(key)]
          if (field) c[field] = value
        })
        const code = String(c.comboCode || '').trim()
        const name = String(c.comboName || '').trim()
        const key = (code || name).toLowerCase()
        if (!key) return
        if (!groups.has(key)) {
          groups.set(key, {
            code, name, barcodes: [], price: 0, location: '', stockType: '',
            rows: [], firstRowNum: raw.__rowNum__,
          })
        }
        const g = groups.get(key)
        if (!g.name && name) g.name = name
        if (!g.code && code) g.code = code
        // Varias filas del mismo combo aportan sus códigos de barras (del combo)
        if (c.barcode) {
          String(c.barcode).split(/[\n,;]+/).forEach(part => {
            const s = part.trim()
            if (s && !g.barcodes.some(b => b.toLowerCase() === s.toLowerCase())) g.barcodes.push(s)
          })
        }
        if (c.price) g.price = parseNumber(c.price)
        if (c.location && !g.location) g.location = String(c.location).trim()
        if (c.stockType && !g.stockType) g.stockType = String(c.stockType).trim().toUpperCase()
        if (c.itemRef !== undefined && String(c.itemRef).trim()) {
          g.rows.push({
            ref: String(c.itemRef).trim(),
            qty: c.itemQty !== undefined && String(c.itemQty).trim()
              ? Math.max(1, Math.round(parseNumber(c.itemQty)) || 1)
              : 1,
          })
        }
      })

      const allNotFound = new Set()
      const noItems = []
      const valid = []
      for (const g of groups.values()) {
        // Deduplicar componentes por producto: filas repetidas del mismo producto
        // son por los distintos códigos de barras del combo, NO cantidades a sumar
        const items = []
        for (const r of g.rows) {
          const p = findProduct(r.ref)
          if (!p) { allNotFound.add(r.ref); continue }
          if (items.some(it => it.productId === p.id)) continue
          items.push({ productId: p.id, quantity: r.qty })
        }
        if (!items.length) { noItems.push(g.name || g.code); continue }
        const itemBarcodes = items.flatMap(item => {
          const p = products.find(pp => pp.id === item.productId)
          return [...(p?.barcodes || (p?.barcode ? [p.barcode] : [])), p?.code].filter(Boolean)
        })
        valid.push({
          name: g.name || g.code,
          code: g.code,
          barcodes: g.barcodes,
          barcode: g.barcodes[0] || '',
          price: g.price,
          location: g.location,
          stockType: g.stockType,
          items,
          itemBarcodes,
          photos: photosByRow.get(g.firstRowNum) || [],
        })
      }

      if (!valid.length) {
        setImportResult(
          '⚠️ No se pudo armar ningún combo. Revisá que el producto de cada combo ' +
          '(columna "Producto" o "Codigo (ARMADO P)") coincida con el SKU o código de ' +
          'barras de productos que ya existan en tu inventario. ' +
          'Descargá la plantilla de ejemplo para ver el formato.'
        )
        return
      }

      // Reconocer combos existentes por SKU o cualquier código de barras → actualizar
      const byCode = new Map(), byBarcode = new Map()
      combos.forEach(c => {
        if (c.code) byCode.set(c.code.toLowerCase(), c)
        const bcs = c.barcodes?.length ? c.barcodes : (c.barcode ? [c.barcode] : [])
        bcs.forEach(b => byBarcode.set(String(b).toLowerCase(), c))
      })
      valid.forEach(r => {
        let ex = r.code && byCode.get(r.code.toLowerCase())
        if (!ex) ex = r.barcodes.map(b => byBarcode.get(b.toLowerCase())).find(Boolean)
        if (ex) r.existingId = ex.id
      })

      const result = await onImport(valid)
      let msg = `✅ ${result.created} combos nuevos, ${result.updated} actualizados.`
      if (noItems.length) msg += ` ⚠️ ${noItems.length} sin productos válidos (${noItems.slice(0, 3).join(', ')}${noItems.length > 3 ? '…' : ''}).`
      if (allNotFound.size) msg += ` No se encontraron estos códigos: ${[...allNotFound].slice(0, 5).join(', ')}${allNotFound.size > 5 ? '…' : ''}.`
      setImportResult(msg)
    } catch (err) {
      setImportResult('❌ Error al importar: ' + err.message)
    } finally {
      setImporting(false)
    }
  }

  const downloadTemplate = () => {
    const sku1 = products[0]?.code || products[0]?.barcode || products[0]?.name || 'SKU-001'
    const sku2 = products[1]?.code || products[1]?.barcode || products[1]?.name || 'SKU-002'
    // Una fila por producto que compone el combo; el SKU y nombre del combo se repiten
    const ws = XLSX.utils.aoa_to_sheet([
      ['FOTO', 'SKU Combo', 'Código de Barras', 'Nombre Combo', 'Precio', 'Ubicación', 'Tipo', 'Producto (SKU)', 'Cantidad'],
      ['', 'COMBO-001', '7790000000011', 'Combo Amoladora + accesorios', 5000, 'Estante B1', 'FULL', sku1, 2],
      ['', 'COMBO-001', '', 'Combo Amoladora + accesorios', '', '', '', sku2, 1],
      ['', 'COMBO-002', '7790000000028', 'Combo Pintura', 3000, 'Estante B2', 'BASE', sku1, 1],
    ])
    ws['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 28 }, { wch: 9 }, { wch: 14 }, { wch: 8 }, { wch: 20 }, { wch: 10 }]

    const info = XLSX.utils.aoa_to_sheet([
      ['CÓMO CARGAR COMBOS POR EXCEL'],
      [''],
      ['Cada combo ocupa VARIAS FILAS: una fila por cada producto que lo compone.'],
      ['El "SKU Combo" y el "Nombre Combo" se REPITEN en cada fila del mismo combo.'],
      [''],
      ['Ejemplo (el combo COMBO-001 tiene 2 productos):'],
      [''],
      ['   SKU Combo | Nombre Combo    | Producto (SKU) | Cantidad'],
      ['   COMBO-001 | Combo Amoladora | 0505           | 2'],
      ['   COMBO-001 | Combo Amoladora | 0201           | 1'],
      [''],
      ['COLUMNAS:'],
      ['• SKU Combo (obligatorio): el código del combo. Debe repetirse igual en'],
      ['  todas las filas de ese combo. Sirve también para actualizarlo después.'],
      ['• Nombre Combo: el nombre del combo (repetido en cada fila).'],
      ['• Código de Barras: el código de barras propio del combo (opcional, va en'],
      ['  la primera fila del combo). Sirve para buscar/escanear el combo.'],
      ['• Producto (SKU): el SKU, código de barras o nombre exacto de un producto'],
      ['  que YA EXISTE en tu inventario.'],
      ['• Cantidad: cuántas unidades de ese producto lleva el combo (si la dejás'],
      ['  vacía se toma 1).'],
      ['• Precio / Ubicación / Tipo: se leen de la primera fila del combo (opcional).'],
      ['• FOTO: pegala como imagen en la columna FOTO, en la primera fila del combo.'],
      [''],
      ['Al mover un combo se descuenta el stock de cada producto que lo compone,'],
      ['multiplicado por su cantidad y por la cantidad de combos.'],
    ])
    info['!cols'] = [{ wch: 74 }]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, info, 'Instrucciones')
    XLSX.utils.book_append_sheet(wb, ws, 'Combos')
    XLSX.writeFile(wb, 'plantilla-combos.xlsx')
  }

  const exportCombos = async () => {
    setExporting(true)
    try {
      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Combos')
      ws.columns = [
        { header: 'FOTO', key: 'foto', width: 12 },
        { header: 'SKU Combo', key: 'code', width: 14 },
        { header: 'Código de Barras', key: 'barcode', width: 16 },
        { header: 'Nombre Combo', key: 'name', width: 28 },
        { header: 'Precio', key: 'price', width: 10 },
        { header: 'Ubicación', key: 'location', width: 14 },
        { header: 'Tipo', key: 'tipo', width: 8 },
        { header: 'Producto (SKU)', key: 'item', width: 20 },
        { header: 'Cantidad', key: 'qty', width: 10 },
      ]
      ws.getRow(1).font = { bold: true }

      // Una fila por producto de cada combo (multi-fila). La foto va en la
      // primera fila de cada combo.
      let excelRow = 1 // 0-indexed: encabezado = 0
      for (const c of combos) {
        const items = c.items?.length ? c.items : [null]
        const firstRowIdx = excelRow
        items.forEach((it, idx) => {
          const p = it ? products.find(pp => pp.id === it.productId) : null
          ws.addRow({
            code: c.code || '',
            barcode: idx === 0 ? (c.barcode || '') : '',
            name: c.name || '',
            price: idx === 0 ? (c.price || 0) : '',
            location: idx === 0 ? (c.location || '') : '',
            tipo: idx === 0 ? (c.stockType || '') : '',
            item: p ? (p.code || p.barcode || p.name) : '',
            qty: it ? it.quantity : '',
          })
          excelRow++
        })
        if (c.hasPhotos && loadPhotos) {
          const photos = await loadPhotos(c.id)
          if (photos && photos[0]) {
            ws.getRow(firstRowIdx + 1).height = 60
            const imgId = wb.addImage({ base64: photos[0].split(',')[1], extension: 'jpeg' })
            ws.addImage(imgId, { tl: { col: 0.15, row: firstRowIdx + 0.15 }, ext: { width: 72, height: 72 } })
          }
        }
      }

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'combos.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('Error al exportar: ' + err.message)
    } finally {
      setExporting(false)
    }
  }

  const productName = (id) => products.find(p => p.id === id)?.name || '(producto eliminado)'

  return (
    <div className="combos-container">
      <div className="combos-header">
        <div>
          <h1>🎁 Combos</h1>
          <p>Armá paquetes de varios productos. Al vender un combo se descuenta el stock de cada producto que lo compone.</p>
        </div>
        <div className="header-buttons">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
          {canEdit && (
            <button onClick={downloadTemplate} className="btn-outline" title="Excel de ejemplo para cargar combos">
              📄 Plantilla
            </button>
          )}
          <button
            onClick={exportCombos}
            className="btn-outline"
            disabled={combos.length === 0 || exporting}
            title="Descargar los combos para modificarlos y reimportarlos"
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
              {showForm ? '✕ Cancelar' : '+ Nuevo Combo'}
            </button>
          )}
        </div>
      </div>

      {importResult && (
        <div className={importResult.startsWith('✅') ? 'import-ok' : 'import-warn'}>
          {importResult}
          {!importResult.startsWith('✅') && (
            <button className="btn-template" onClick={downloadTemplate}>
              ⬇️ Descargar plantilla de combos
            </button>
          )}
        </div>
      )}

      {showForm && (
        <div className="form-panel">
          <h2>{editingId ? 'Editar Combo' : 'Nuevo Combo'}</h2>
          {error && <div className="error-message">{error}</div>}

          <form onSubmit={handleSubmit} className="combo-form">
            <div className="form-grid">
              <div className="form-group">
                <label>Nombre del combo *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ej: Combo limpieza x3"
                  disabled={loading}
                />
              </div>
              <div className="form-group">
                <label>SKU</label>
                <input
                  type="text"
                  value={formData.code}
                  onChange={e => setFormData({ ...formData, code: e.target.value })}
                  placeholder="SKU del combo"
                  disabled={loading}
                />
              </div>
              <div className="form-group">
                <label>|||| Códigos de barras del combo (uno por línea)</label>
                <textarea
                  value={formData.barcodes}
                  onChange={e => setFormData({ ...formData, barcodes: e.target.value })}
                  placeholder={'El combo puede tener varios.\nESVG88396\nGBOB95228'}
                  rows="2"
                  disabled={loading}
                />
              </div>
              <div className="form-group">
                <label>Precio del combo ($)</label>
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
                <label>📍 Ubicación en el depósito</label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={e => setFormData({ ...formData, location: e.target.value })}
                  placeholder="Ej: Estante B1, Zona armado"
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
              <label>Productos que lo componen *</label>
              {products.length === 0 ? (
                <p className="no-products-hint">
                  Primero cargá productos en la pestaña Inventario.
                </p>
              ) : (
                <div className="items-editor">
                  {formData.items.map((item, i) => (
                    <div key={i} className="item-row">
                      <select
                        value={item.productId}
                        onChange={e => setItem(i, 'productId', e.target.value)}
                        disabled={loading}
                      >
                        <option value="">-- Elegí un producto --</option>
                        {products.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name} (Stock: {p.quantity || 0})
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={e => setItem(i, 'quantity', e.target.value)}
                        title="Cantidad de unidades en el combo"
                        disabled={loading}
                      />
                      <button
                        type="button"
                        className="btn-row-del"
                        onClick={() => removeItemRow(i)}
                        disabled={loading || formData.items.length <= 1}
                        title="Quitar fila"
                      >
                        🗑️
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn-row-add"
                    onClick={addItemRow}
                    disabled={loading}
                  >
                    + Agregar otro producto
                  </button>
                </div>
              )}
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
                {loading ? '⏳ Guardando...' : (editingId ? '✓ Actualizar' : '✓ Crear Combo')}
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

      {combos.length === 0 ? (
        <div className="empty-state">
          <p>🎁</p>
          <p>No hay combos todavía. Creá uno combinando productos del inventario.</p>
        </div>
      ) : (
        <div className="combos-grid">
          {combos.map(combo => {
            const available = comboAvailable(combo, products)
            return (
              <div key={combo.id} className="combo-card">
                <div className="combo-card-header">
                  <div className="combo-title-row">
                    <LazyThumb
                      id={combo.id}
                      hasPhotos={combo.hasPhotos}
                      kind="combo"
                      loadPhotos={loadPhotos}
                      className="combo-photo"
                    />
                    <div>
                      <div className="combo-name">🎁 {combo.name}</div>
                      <div className="combo-meta">
                        {combo.code && <span>SKU: {combo.code} · </span>}
                        {combo.barcode && (
                          <span>|||| {combo.barcode}{combo.barcodes?.length > 1 ? ` +${combo.barcodes.length - 1}` : ''} · </span>
                        )}
                        {combo.price ? `$${Number(combo.price).toFixed(2)}` : 'Sin precio'}
                        {combo.location && <span> · 📍 {combo.location}</span>}
                        {combo.stockType && (
                          <span className={`badge-st ${combo.stockType.toLowerCase()}`}> {combo.stockType}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <span className={`badge ${available > 0 ? 'ok' : 'warn'}`}>
                    {available > 0 ? `✓ ${available} disponibles` : '⚠ Sin stock'}
                  </span>
                </div>
                <ul className="combo-items">
                  {combo.items?.map((item, i) => (
                    <li key={i}>
                      <strong>{item.quantity}×</strong> {productName(item.productId)}
                    </li>
                  ))}
                </ul>
                <div className="combo-actions">
                  <button onClick={() => handleEdit(combo)} className="btn-edit" title="Editar">
                    ✏️ Editar
                  </button>
                  <button onClick={() => handleDelete(combo.id)} className="btn-del" title="Eliminar">
                    🗑️ Eliminar
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
