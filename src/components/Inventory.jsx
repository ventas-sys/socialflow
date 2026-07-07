import React, { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { compressImage, MAX_PHOTOS, MAX_PHOTOS_BYTES, photosSize } from '../utils/images'
import { extractImagesByRow } from '../utils/excelImages'
import { comboAvailable, STOCK_TYPES } from './Combos'
import Scanner from './Scanner'
import LazyThumb from './LazyThumb'
import './Inventory.css'

const EMPTY_FORM = {
  name: '',
  code: '',
  barcode: '',
  category: '',
  price: '',
  minStock: '5',
  quantity: '0',
  location: '',
  stockType: '',
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
  'stock minimo': 'minStock', minimo: 'minStock', 'min stock': 'minStock',
  ubicacion: 'location', location: 'location', deposito: 'location', estante: 'location', posicion: 'location', pasillo: 'location',
  tipo: 'stockType', 'tipo de stock': 'stockType', 'tipo stock': 'stockType', canal: 'stockType', 'full ferre base': 'stockType',
  descripcion: 'description', description: 'description', detalle: 'description',
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
  loadPhotos,
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
  const [importResult, setImportResult] = useState('')
  const fileInputRef = useRef(null)
  const photoInputRef = useRef(null)

  const resetForm = () => {
    setFormData(EMPTY_FORM)
    setEditingId(null)
    setError('')
  }

  const handleEdit = async (product) => {
    setFormData({
      name: product.name || '',
      code: product.code || '',
      barcode: product.barcode || '',
      category: product.category || '',
      price: product.price || '',
      minStock: product.minStock || '5',
      quantity: product.quantity ?? '0',
      location: product.location || '',
      stockType: product.stockType || '',
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
      const data = {
        ...formData,
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

      const rows = rawRows
        .map(raw => {
          const p = {}
          Object.entries(raw).forEach(([key, value]) => {
            const field = COLUMN_MAP[normalize(key)]
            if (field) p[field] = value
          })
          if (!p.name || !String(p.name).trim()) return null
          // __rowNum__ es la fila real (base 0) en la hoja, para mapear las fotos
          const sheetRow = raw.__rowNum__
          return {
            name: String(p.name).trim(),
            code: p.code !== undefined ? String(p.code).trim() : '',
            barcode: p.barcode !== undefined ? String(p.barcode).trim() : '',
            category: p.category !== undefined ? String(p.category).trim() : '',
            price: parseNumber(p.price),
            quantity: Math.round(parseNumber(p.quantity)),
            minStock: p.minStock !== undefined ? Math.round(parseNumber(p.minStock)) : 5,
            location: p.location !== undefined ? String(p.location).trim() : '',
            stockType: p.stockType !== undefined ? String(p.stockType).trim().toUpperCase() : '',
            description: p.description !== undefined ? String(p.description).trim() : '',
            photos: photosByRow.get(sheetRow) || [],
          }
        })
        .filter(Boolean)

      if (!rows.length) {
        setImportResult(
          '⚠️ No se encontró la columna "Nombre". El Excel debe tener encabezados en la primera fila: ' +
          'Nombre (obligatorio), SKU, Código de Barras, Categoría, Precio, Cantidad, Stock Mínimo, Ubicación, Tipo, Descripción. ' +
          'Descargá la plantilla de ejemplo para ver el formato.'
        )
        return
      }

      // Si el SKU o el código de barras ya existen, se ACTUALIZA el producto
      // en vez de duplicarlo (permite exportar → modificar → volver a importar)
      const byCode = new Map()
      const byBarcode = new Map()
      products.forEach(p => {
        if (p.code) byCode.set(p.code.toLowerCase(), p)
        if (p.barcode) byBarcode.set(p.barcode.toLowerCase(), p)
      })
      rows.forEach(r => {
        const existing =
          (r.code && byCode.get(r.code.toLowerCase())) ||
          (r.barcode && byBarcode.get(r.barcode.toLowerCase()))
        if (existing) r.existingId = existing.id
      })

      const result = await onImport(rows)
      const skipped = rawRows.length - rows.length
      const withPhotos = rows.filter(r => r.photos.length > 0).length
      setImportResult(
        `✅ ${result.created} productos nuevos, ${result.updated} actualizados.` +
        (withPhotos > 0 ? ` ${withPhotos} con fotos del Excel.` : '') +
        (skipped > 0 ? ` Se saltearon ${skipped} filas sin nombre.` : '')
      )
    } catch (err) {
      setImportResult('❌ Error al importar: ' + err.message)
    } finally {
      setImporting(false)
    }
  }

  const exportExcel = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Nombre', 'SKU', 'Código de Barras', 'Categoría', 'Precio', 'Cantidad', 'Stock Mínimo', 'Ubicación', 'Tipo', 'Descripción'],
      ...products.map(p => [
        p.name || '',
        p.code || '',
        p.barcode || '',
        p.category || '',
        p.price || 0,
        p.quantity || 0,
        p.minStock || 5,
        p.location || '',
        p.stockType || '',
        p.description || '',
      ]),
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Productos')
    XLSX.writeFile(wb, 'inventario.xlsx')
  }

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Nombre', 'SKU', 'Código de Barras', 'Categoría', 'Precio', 'Cantidad', 'Stock Mínimo', 'Ubicación', 'Tipo', 'Descripción'],
      ['Martillo carpintero', 'SKU-001', '7790001001234', 'Herramientas', 1500, 10, 5, 'Estante A3', 'FERRE', 'Mango de madera'],
      ['Destornillador Phillips', 'SKU-002', '7790001005678', 'Herramientas', 800, 25, 5, 'Estante A4', 'BASE', ''],
    ])
    ws['!cols'] = [{ wch: 24 }, { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 9 }, { wch: 9 }, { wch: 11 }, { wch: 14 }, { wch: 8 }, { wch: 24 }]

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
      ['4) FOTOS  —  ¡OJO, no van en ninguna columna!'],
      ['   Las fotos se PEGAN como imagen sobre la fila del producto:'],
      ['   • En Excel: menú Insertar → Imágenes → elegí la foto.'],
      ['   • Arrastrá la imagen para que quede ENCIMA de la fila del producto'],
      ['     (que su esquina de arriba a la izquierda caiga dentro de esa fila).'],
      ['   • Podés poner hasta 5 fotos por producto (una al lado de la otra).'],
      ['   • Al importar, la app detecta cada foto y la asigna a ese producto.'],
      [''],
      ['5) Si no ponés fotos acá, igual las podés cargar después desde la app'],
      ['   (botón Editar ✏️ en cada producto → Agregar foto 📷).'],
      [''],
      ['6) Para MODIFICAR productos ya cargados: usá el botón "Exportar",'],
      ['   cambiá lo que quieras y volvé a Importar el mismo archivo.'],
      ['   La app reconoce el SKU o el código de barras y actualiza sin duplicar.'],
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
      return [p?.barcode, p?.code].filter(Boolean)
    })
    return [...live, ...(combo.itemBarcodes || [])]
  }

  const matchesSearch = (item) => {
    if (!searchTerm.trim()) return true
    const q = searchTerm.toLowerCase()
    if (
      item.name?.toLowerCase().includes(q) ||
      item.code?.toLowerCase().includes(q) ||
      item.barcode?.toLowerCase().includes(q) ||
      item.location?.toLowerCase().includes(q) ||
      item.stockType?.toLowerCase().includes(q)
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
          <button onClick={downloadTemplate} className="btn-outline" title="Excel de ejemplo con el formato correcto">
            📄 Plantilla
          </button>
          <button
            onClick={exportExcel}
            className="btn-outline"
            disabled={products.length === 0}
            title="Descargar el inventario para modificarlo masivamente y volver a importarlo"
          >
            ⬆️ Exportar
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
            {showForm ? '✕ Cancelar' : '+ Nuevo Producto'}
          </button>
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
                <label>|||| Código de barras</label>
                <input
                  type="text"
                  value={formData.barcode}
                  onChange={e => setFormData({ ...formData, barcode: e.target.value })}
                  placeholder="EAN / UPC (ej: 7790001001234)"
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
          📦 Productos ({products.length})
        </button>
        <button
          className={`chip-btn ${kindFilter === 'combos' ? 'active' : ''}`}
          onClick={() => setKindFilter('combos')}
        >
          🎁 Combos ({combos.length})
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
              <div className="found-info">
                <div className="found-name">{row.name}</div>
                {row.barcode && <div className="found-code">|||| {row.barcode}</div>}
                {row.code && <div className="found-code sku">{row.code}</div>}
                <div className="found-stock">
                  Stock: {row.kind === 'combo' ? `${comboAvailable(row, products)} armables` : (row.quantity || 0)}
                </div>
              </div>
              <div className={`found-location ${row.location ? '' : 'empty'}`}>
                {row.location ? (
                  <>
                    <span className="pin">📍</span>
                    {row.location}
                  </>
                ) : (
                  'Sin ubicación'
                )}
              </div>
              <div className="found-actions">
                <button
                  onClick={() => (row.kind === 'combo' ? onEditCombo(row) : handleEdit(row))}
                  className="btn-edit"
                  title="Editar"
                >
                  ✏️
                </button>
                <button
                  onClick={() => (row.kind === 'combo' ? handleDeleteCombo(row.id) : handleDelete(row.id))}
                  className="btn-del"
                  title="Eliminar"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {allRows.length === 0 ? (
        <div className="empty-state">
          <p>📦</p>
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
                <th>Estado</th>
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
                        {isCombo ? '🎁 Combo' : '📦 Producto'}
                      </span>
                    </td>
                    <td className="bold">{row.name}</td>
                    <td>{row.code || '-'}</td>
                    <td className="barcode-cell">{row.barcode || '-'}</td>
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
                      <span className={`badge ${!isLow ? 'ok' : 'warn'}`}>
                        {!isLow ? '✓ OK' : (isCombo ? '⚠ Sin stock' : '⚠ Bajo')}
                      </span>
                    </td>
                    <td className="actions">
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
