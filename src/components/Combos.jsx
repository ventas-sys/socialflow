import React, { useState, useEffect, useRef } from 'react'
import * as XLSX from 'xlsx'
import { compressImage, MAX_PHOTOS, MAX_PHOTOS_BYTES, photosSize } from '../utils/images'
import { extractImagesByRow } from '../utils/excelImages'
import LazyThumb from './LazyThumb'
import './Combos.css'

export const STOCK_TYPES = ['FULL', 'FERRE', 'BASE']

const normalize = (s) =>
  String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()

// Mapea encabezados del Excel de combos a campos
const COMBO_COLS = {
  nombre: 'name', combo: 'name', name: 'name',
  sku: 'code', codigo: 'code', code: 'code',
  'codigo de barras': 'barcode', barcode: 'barcode', ean: 'barcode', upc: 'barcode',
  precio: 'price', price: 'price',
  ubicacion: 'location', location: 'location', deposito: 'location',
  tipo: 'stockType', 'tipo de stock': 'stockType', canal: 'stockType',
  productos: 'itemsText', items: 'itemsText', componentes: 'itemsText',
  contenido: 'itemsText', 'productos (sku x cantidad)': 'itemsText',
}

const parseNumber = (v) => {
  if (typeof v === 'number') return v
  const n = parseFloat(String(v).replace(',', '.'))
  return isNaN(n) ? 0 : n
}

const EMPTY_FORM = {
  name: '',
  code: '',
  barcode: '',
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

export default function Combos({ combos, products, onAdd, onUpdate, onDelete, onImport, editRequest, loadPhotos }) {
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

  // Busca un producto por SKU o código de barras (para resolver los items del Excel)
  const findProduct = (codeStr) => {
    const q = String(codeStr).trim().toLowerCase()
    if (!q) return null
    return products.find(p =>
      (p.code && p.code.toLowerCase() === q) ||
      (p.barcode && p.barcode.toLowerCase() === q)
    )
  }

  // Parsea "SKU-001 x2 ; SKU-002 x1" → items + lista de códigos no encontrados
  const parseItems = (text) => {
    const items = []
    const notFound = []
    const seen = new Set()
    let chunks = String(text).split(/[;\n]+/).map(s => s.trim()).filter(Boolean)
    if (chunks.length <= 1) chunks = String(text).split(',').map(s => s.trim()).filter(Boolean)
    for (const chunk of chunks) {
      const m = chunk.match(/^(.*?)\s*[x×:*]\s*(\d+)\s*$/i) || chunk.match(/^(\d+)\s*[x×:*]\s*(.*?)$/i)
      let codeStr, qty
      if (m && /^\d+$/.test(m[2])) { codeStr = m[1]; qty = parseInt(m[2]) }
      else if (m) { codeStr = m[2]; qty = parseInt(m[1]) }
      else { codeStr = chunk; qty = 1 }
      const p = findProduct(codeStr)
      if (!p) { notFound.push(codeStr); continue }
      if (seen.has(p.id)) continue
      seen.add(p.id)
      items.push({ productId: p.id, quantity: Math.max(1, qty || 1) })
    }
    return { items, notFound }
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
    setFormData({
      name: combo.name || '',
      code: combo.code || '',
      barcode: combo.barcode || '',
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
        return [p?.barcode, p?.code].filter(Boolean)
      })

      const data = {
        name: formData.name.trim(),
        code: formData.code.trim(),
        barcode: formData.barcode.trim(),
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

      const allNotFound = new Set()
      const rows = rawRows.map(raw => {
        const c = {}
        Object.entries(raw).forEach(([key, value]) => {
          const field = COMBO_COLS[normalize(key)]
          if (field) c[field] = value
        })
        if (!c.name || !String(c.name).trim()) return null
        const { items, notFound } = parseItems(c.itemsText || '')
        notFound.forEach(n => allNotFound.add(n))
        if (!items.length) return { __noItems: String(c.name).trim() }
        const itemBarcodes = items.flatMap(item => {
          const p = products.find(pp => pp.id === item.productId)
          return [p?.barcode, p?.code].filter(Boolean)
        })
        return {
          name: String(c.name).trim(),
          code: c.code !== undefined ? String(c.code).trim() : '',
          barcode: c.barcode !== undefined ? String(c.barcode).trim() : '',
          price: parseNumber(c.price),
          location: c.location !== undefined ? String(c.location).trim() : '',
          stockType: c.stockType !== undefined ? String(c.stockType).trim().toUpperCase() : '',
          items,
          itemBarcodes,
          photos: photosByRow.get(raw.__rowNum__) || [],
        }
      }).filter(Boolean)

      const noItems = rows.filter(r => r.__noItems).map(r => r.__noItems)
      const valid = rows.filter(r => !r.__noItems)

      if (!valid.length) {
        setImportResult(
          '⚠️ No se pudo armar ningún combo. Revisá que la columna "Productos" tenga ' +
          'los SKU o códigos de barras de productos que ya existan en tu inventario. ' +
          'Descargá la plantilla de ejemplo para ver el formato.'
        )
        return
      }

      // Reconocer combos existentes por SKU o código de barras → actualizar
      const byCode = new Map(), byBarcode = new Map()
      combos.forEach(c => {
        if (c.code) byCode.set(c.code.toLowerCase(), c)
        if (c.barcode) byBarcode.set(c.barcode.toLowerCase(), c)
      })
      valid.forEach(r => {
        const ex = (r.code && byCode.get(r.code.toLowerCase())) ||
                   (r.barcode && byBarcode.get(r.barcode.toLowerCase()))
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
    const ejemploSku = products[0]?.code || products[0]?.barcode || 'SKU-001'
    const ejemploSku2 = products[1]?.code || products[1]?.barcode || 'SKU-002'
    const ws = XLSX.utils.aoa_to_sheet([
      ['FOTO', 'Nombre', 'SKU', 'Código de Barras', 'Precio', 'Ubicación', 'Tipo', 'Productos (SKU x Cantidad)'],
      ['', 'Combo limpieza x3', 'COMBO-001', '', 5000, 'Estante B1', 'FULL', `${ejemploSku} x2 ; ${ejemploSku2} x1`],
    ])
    ws['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 12 }, { wch: 16 }, { wch: 9 }, { wch: 14 }, { wch: 8 }, { wch: 34 }]

    const info = XLSX.utils.aoa_to_sheet([
      ['CÓMO CARGAR COMBOS POR EXCEL'],
      [''],
      ['1) Una fila por combo en la hoja "Combos". Solo "Nombre" es obligatorio.'],
      [''],
      ['2) Columna "Productos (SKU x Cantidad)": acá indicás qué productos'],
      ['   componen el combo y cuántas unidades de cada uno. Formato:'],
      [''],
      ['        SKU-001 x2 ; SKU-002 x1 ; SKU-003 x4'],
      [''],
      ['   • Separá cada producto con punto y coma (;).'],
      ['   • Después del SKU poné "x" y la cantidad (x2 = dos unidades).'],
      ['   • Podés usar el SKU o el código de barras del producto.'],
      ['   • Los productos TIENEN que existir ya en tu inventario.'],
      [''],
      ['3) Columna "Tipo": FULL, FERRE o BASE (o vacía).'],
      [''],
      ['4) FOTO del combo: pegala como imagen en la columna FOTO de esa fila'],
      ['   (Insertar → Imágenes). También podés cargarla luego desde la app.'],
      [''],
      ['5) Al vender/mover un combo se descuenta el stock de cada producto que'],
      ['   lo compone, multiplicado por la cantidad del combo.'],
      [''],
      ['6) Para modificar combos ya cargados: poné el mismo SKU del combo y'],
      ['   se actualizan en vez de duplicarse.'],
    ])
    info['!cols'] = [{ wch: 72 }]

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
        { header: 'Nombre', key: 'name', width: 26 },
        { header: 'SKU', key: 'code', width: 12 },
        { header: 'Código de Barras', key: 'barcode', width: 18 },
        { header: 'Precio', key: 'price', width: 10 },
        { header: 'Ubicación', key: 'location', width: 14 },
        { header: 'Tipo', key: 'tipo', width: 8 },
        { header: 'Productos (SKU x Cantidad)', key: 'items', width: 40 },
      ]
      ws.getRow(1).font = { bold: true }

      for (let i = 0; i < combos.length; i++) {
        const c = combos[i]
        const itemsText = (c.items || []).map(it => {
          const p = products.find(pp => pp.id === it.productId)
          const code = p?.code || p?.barcode || '(?)'
          return `${code} x${it.quantity}`
        }).join(' ; ')
        ws.addRow({
          name: c.name || '',
          code: c.code || '',
          barcode: c.barcode || '',
          price: c.price || 0,
          location: c.location || '',
          tipo: c.stockType || '',
          items: itemsText,
        })
        if (c.hasPhotos && loadPhotos) {
          const photos = await loadPhotos(c.id)
          if (photos && photos[0]) {
            const rowIdx = i + 1
            ws.getRow(rowIdx + 1).height = 60
            const imgId = wb.addImage({ base64: photos[0].split(',')[1], extension: 'jpeg' })
            ws.addImage(imgId, { tl: { col: 0.15, row: rowIdx + 0.15 }, ext: { width: 72, height: 72 } })
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
          <button onClick={downloadTemplate} className="btn-outline" title="Excel de ejemplo para cargar combos">
            📄 Plantilla
          </button>
          <button
            onClick={exportCombos}
            className="btn-outline"
            disabled={combos.length === 0 || exporting}
            title="Descargar los combos para modificarlos y reimportarlos"
          >
            {exporting ? '⏳ Exportando...' : '⬆️ Exportar'}
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="btn-import"
            disabled={importing}
          >
            {importing ? '⏳ Importando...' : '📥 Importar Excel'}
          </button>
          <button
            onClick={() => {
              resetForm()
              setShowForm(!showForm)
            }}
            className="btn-add"
          >
            {showForm ? '✕ Cancelar' : '+ Nuevo Combo'}
          </button>
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
                <label>|||| Código de barras del combo</label>
                <input
                  type="text"
                  value={formData.barcode}
                  onChange={e => setFormData({ ...formData, barcode: e.target.value })}
                  placeholder="EAN / UPC del combo"
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
                        {combo.barcode && <span>|||| {combo.barcode} · </span>}
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
