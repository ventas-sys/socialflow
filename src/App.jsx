import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { computeConsumption } from './utils/stock'
import { auth, googleProvider, db } from './firebase'
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth'
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteField,
  query,
  where,
  Timestamp,
  writeBatch,
} from 'firebase/firestore'
import { ORG_ID, ADMIN_EMAIL } from './config'
import Dashboard from './components/Dashboard'
import Inventory from './components/Inventory'
import Combos from './components/Combos'
import Movements from './components/Movements'
import Reports from './components/Reports'
import Shipments from './components/Shipments'
import Auth from './components/Auth'
import './App.css'

export default function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [currentTab, setCurrentTab] = useState('dashboard')
  const [products, setProducts] = useState([])
  const [combos, setCombos] = useState([])
  const [movements, setMovements] = useState([])
  const [shipments, setShipments] = useState([])
  const [couriers, setCouriers] = useState([])
  const [depositMap, setDepositMap] = useState(null)
  const [loadingData, setLoadingData] = useState(false)
  const [accessDenied, setAccessDenied] = useState(false)
  const [members, setMembers] = useState([])
  // Pedido de edición de un combo desde la pestaña Inventario
  const [comboEditRequest, setComboEditRequest] = useState(null)
  // Cache en memoria de las fotos ya cargadas (se leen on-demand, no al inicio)
  const photoCache = useRef(new Map())

  const isAdmin = user?.email === ADMIN_EMAIL

  // Consumo (salidas) de los últimos 2 meses por producto → estimar días de stock
  const consumption = useMemo(() => computeConsumption(movements), [movements])

  // Lee las fotos de un producto/combo solo cuando se necesitan (búsqueda, edición,
  // miniatura visible). Así abrir la app no descarga miles de fotos de golpe.
  const loadPhotos = useCallback(async (id) => {
    if (!id) return []
    if (photoCache.current.has(id)) return photoCache.current.get(id)
    try {
      const snap = await getDoc(doc(db, 'photos', id))
      const photos = snap.exists() ? (snap.data().photos || []) : []
      photoCache.current.set(id, photos)
      return photos
    } catch {
      return []
    }
  }, [])

  // Guarda (o borra) las fotos de un producto/combo en la colección "photos"
  const savePhotos = async (id, photos) => {
    if (photos && photos.length) {
      await setDoc(doc(db, 'photos', id), { photos, userId: ORG_ID })
      photoCache.current.set(id, photos)
    } else {
      await deleteDoc(doc(db, 'photos', id)).catch(() => {})
      photoCache.current.set(id, [])
    }
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser)
      setLoading(false)
      if (currentUser) {
        loadUserData(currentUser)
      }
    })
    return unsubscribe
  }, [])

  // Migra los datos viejos (guardados por usuario) al espacio compartido.
  // Solo la corre el administrador y solo si encuentra documentos viejos.
  const migrateOldData = async (uid) => {
    for (const collName of ['products', 'combos', 'movements']) {
      const snap = await getDocs(
        query(collection(db, collName), where('userId', '==', uid))
      )
      for (let i = 0; i < snap.docs.length; i += 400) {
        const batch = writeBatch(db)
        snap.docs.slice(i, i + 400).forEach(d => batch.update(d.ref, { userId: ORG_ID }))
        await batch.commit()
      }
    }
    const oldSettings = await getDoc(doc(db, 'settings', uid))
    if (oldSettings.exists()) {
      const orgSettings = await getDoc(doc(db, 'settings', ORG_ID))
      if (!orgSettings.exists()) {
        await setDoc(doc(db, 'settings', ORG_ID), { ...oldSettings.data(), userId: ORG_ID })
      }
    }
  }

  // Mueve las fotos que estén guardadas DENTRO de products/combos a la
  // colección "photos" aparte, para que el listado principal cargue liviano.
  // Se ejecuta una sola vez cuando quedan fotos inline por migrar.
  const migrateInlinePhotos = async () => {
    for (const collName of ['products', 'combos']) {
      const snap = await getDocs(
        query(collection(db, collName), where('userId', '==', ORG_ID))
      )
      const withPhotos = snap.docs.filter(d => Array.isArray(d.data().photos) && d.data().photos.length)
      for (const d of withPhotos) {
        const photos = d.data().photos
        await setDoc(doc(db, 'photos', d.id), { photos, userId: ORG_ID })
        await updateDoc(d.ref, { photos: deleteField(), hasPhotos: true })
        photoCache.current.set(d.id, photos)
      }
    }
  }

  const loadUserData = async (currentUser) => {
    setLoadingData(true)
    setAccessDenied(false)
    try {
      if (currentUser.email === ADMIN_EMAIL) {
        await migrateOldData(currentUser.uid)
        await migrateInlinePhotos()
      }

      // Se ordena en el cliente para no requerir índices compuestos en Firestore
      const toMillis = (t) => (t?.toMillis ? t.toMillis() : new Date(t || 0).getTime())
      // Nunca guardamos las fotos en el listado (se cargan on-demand); solo el flag
      const strip = ({ photos, ...rest }) => ({ ...rest, hasPhotos: rest.hasPhotos || (photos?.length > 0) })

      const [productsSnap, combosSnap, movementsSnap, settingsSnap] = await Promise.all([
        getDocs(query(collection(db, 'products'), where('userId', '==', ORG_ID))),
        getDocs(query(collection(db, 'combos'), where('userId', '==', ORG_ID))),
        getDocs(query(collection(db, 'movements'), where('userId', '==', ORG_ID))),
        getDoc(doc(db, 'settings', ORG_ID)),
      ])

      setDepositMap(settingsSnap.exists() ? settingsSnap.data().depositMapPhoto || null : null)

      // Envíos y motoqueros: colecciones opcionales. Si sus reglas todavía no
      // están publicadas, se ignoran sin romper la carga del inventario.
      try {
        const [shipmentsSnap, couriersSnap] = await Promise.all([
          getDocs(query(collection(db, 'shipments'), where('userId', '==', ORG_ID))),
          getDocs(query(collection(db, 'couriers'), where('userId', '==', ORG_ID))),
        ])
        setShipments(
          shipmentsSnap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
        )
        setCouriers(couriersSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      } catch (err) {
        console.warn('Envíos/motoqueros no disponibles (¿faltan reglas?):', err?.code)
        setShipments([])
        setCouriers([])
      }

      setProducts(
        productsSnap.docs
          .map(d => ({ id: d.id, ...strip(d.data()) }))
          .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
      )
      setCombos(
        combosSnap.docs
          .map(d => ({ id: d.id, ...strip(d.data()) }))
          .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
      )
      setMovements(
        movementsSnap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => toMillis(b.date) - toMillis(a.date))
      )

      if (currentUser.email === ADMIN_EMAIL) {
        const membersSnap = await getDocs(collection(db, 'members'))
        setMembers(membersSnap.docs.map(d => ({ email: d.id, ...d.data() })))
      }
    } catch (error) {
      console.error('Error loading data:', error)
      // El administrador nunca queda bloqueado por un error de permisos
      if (error.code === 'permission-denied' && currentUser.email !== ADMIN_EMAIL) {
        setAccessDenied(true)
      }
    } finally {
      setLoadingData(false)
    }
  }

  const addMember = async (email) => {
    const clean = email.trim().toLowerCase()
    if (!clean || !clean.includes('@')) throw new Error('Ingresá un email válido')
    await setDoc(doc(db, 'members', clean), {
      addedBy: user.email,
      addedAt: Timestamp.now(),
    })
    setMembers([...members.filter(m => m.email !== clean), { email: clean, addedBy: user.email }])
  }

  const removeMember = async (email) => {
    await deleteDoc(doc(db, 'members', email))
    setMembers(members.filter(m => m.email !== email))
  }

  const handleLogin = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider)
      setUser(result.user)
      loadUserData(result.user)
    } catch (error) {
      console.error('Login error:', error)
      alert('Error al iniciar sesión: ' + error.message)
    }
  }

  const handleLogout = async () => {
    try {
      await signOut(auth)
      setUser(null)
      setProducts([])
      setCombos([])
      setMovements([])
      setShipments([])
      setCouriers([])
      setCurrentTab('dashboard')
    } catch (error) {
      console.error('Logout error:', error)
    }
  }

  const addProduct = async (productData) => {
    if (!user) return
    const { photos = [], ...data } = productData
    const hasPhotos = photos.length > 0
    const docRef = await addDoc(collection(db, 'products'), {
      ...data,
      hasPhotos,
      userId: ORG_ID,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    })
    if (hasPhotos) await savePhotos(docRef.id, photos)
    setProducts([
      { id: docRef.id, ...data, hasPhotos, userId: ORG_ID, createdAt: new Date() },
      ...products,
    ])
    return docRef.id
  }

  // Importación masiva desde Excel (lotes de hasta 400 por límite de Firestore).
  // Las filas con existingId actualizan el producto en vez de crear uno nuevo,
  // lo que permite exportar → modificar → volver a importar sin duplicados.
  const importProducts = async (rows) => {
    if (!user) return { created: 0, updated: 0 }

    const toCreate = rows.filter(r => !r.existingId)
    const toUpdate = rows.filter(r => r.existingId)
    const photoWrites = [] // { id, photos } para guardar aparte

    for (let i = 0; i < toUpdate.length; i += 400) {
      const batch = writeBatch(db)
      toUpdate.slice(i, i + 400).forEach(r => {
        const { existingId, photos, ...data } = r
        const hasNewPhotos = photos && photos.length > 0
        if (hasNewPhotos) photoWrites.push({ id: existingId, photos })
        batch.update(doc(db, 'products', existingId), {
          ...data,
          ...(hasNewPhotos ? { hasPhotos: true } : {}),
          updatedAt: Timestamp.now(),
        })
      })
      await batch.commit()
    }

    const created = []
    for (let i = 0; i < toCreate.length; i += 400) {
      const chunk = toCreate.slice(i, i + 400)
      const batch = writeBatch(db)
      const refs = chunk.map(r => {
        const { photos, ...data } = r
        const hasPhotos = photos && photos.length > 0
        const ref = doc(collection(db, 'products'))
        if (hasPhotos) photoWrites.push({ id: ref.id, photos })
        batch.set(ref, {
          ...data,
          hasPhotos,
          userId: ORG_ID,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        })
        return ref
      })
      await batch.commit()
      chunk.forEach((r, idx) => {
        const { photos, ...data } = r
        created.push({ id: refs[idx].id, ...data, hasPhotos: !!(photos && photos.length), userId: ORG_ID, createdAt: new Date() })
      })
    }

    // Guardar las fotos (de celdas del Excel) en la colección aparte
    for (const { id, photos } of photoWrites) {
      await savePhotos(id, photos)
    }

    const updatedById = new Map(toUpdate.map(r => [r.existingId, r]))
    setProducts([
      ...created.reverse(),
      ...products.map(p => {
        const r = updatedById.get(p.id)
        if (!r) return p
        const { existingId, photos, ...data } = r
        const hasNewPhotos = photos && photos.length > 0
        return { ...p, ...data, ...(hasNewPhotos ? { hasPhotos: true } : {}), updatedAt: new Date() }
      }),
    ])
    return { created: created.length, updated: toUpdate.length }
  }

  // Carga de compra: SUMA stock a productos existentes y registra un
  // movimiento de entrada por cada renglón (para la auditoría de la factura).
  const registerPurchase = async (rows, meta = {}) => {
    if (!user) return { updated: 0, movements: 0, notFound: [] }
    const now = Timestamp.now()
    const userName = user.displayName || user.email

    // Sumar por producto (varias filas del mismo producto se acumulan)
    const deltas = new Map()
    rows.forEach(r => deltas.set(r.productId, (deltas.get(r.productId) || 0) + r.quantity))
    const newQty = new Map()
    deltas.forEach((delta, pid) => {
      const p = products.find(pp => pp.id === pid)
      newQty.set(pid, (p?.quantity || 0) + delta)
    })

    // Actualizar stock de los productos (en lotes)
    const affected = [...deltas.keys()]
    for (let i = 0; i < affected.length; i += 400) {
      const batch = writeBatch(db)
      affected.slice(i, i + 400).forEach(pid => {
        batch.update(doc(db, 'products', pid), { quantity: newQty.get(pid), updatedAt: now })
      })
      await batch.commit()
    }

    // Registrar un movimiento de entrada por renglón
    const allMovements = []
    for (let i = 0; i < rows.length; i += 400) {
      const batch = writeBatch(db)
      rows.slice(i, i + 400).forEach(r => {
        const mRef = doc(collection(db, 'movements'))
        // Cantidad positiva = entrada (compra); negativa = salida (descuento/ajuste)
        const isEntrada = r.quantity >= 0
        const mDoc = {
          productId: r.productId,
          productName: r.productName,
          type: isEntrada ? 'entrada' : 'salida',
          quantity: Math.abs(r.quantity),
          reason: r.reason || meta.reason || (isEntrada ? 'Compra' : 'Ajuste (Excel)'),
          reference: meta.reference || '',
          userId: ORG_ID,
          date: now,
          userName,
          userEmail: user.email,
        }
        batch.set(mRef, mDoc)
        allMovements.push({ id: mRef.id, ...mDoc, date: new Date() })
      })
      await batch.commit()
    }

    setProducts(products.map(p => (newQty.has(p.id) ? { ...p, quantity: newQty.get(p.id) } : p)))
    setMovements([...allMovements.reverse(), ...movements])
    return {
      updated: affected.length,
      movements: rows.length,
      entradas: rows.filter(r => r.quantity > 0).length,
      salidas: rows.filter(r => r.quantity < 0).length,
    }
  }

  const updateProduct = async (productId, productData) => {
    if (!user) return
    const { photos, ...data } = productData
    const hasPhotos = photos !== undefined ? photos.length > 0 : undefined
    await updateDoc(doc(db, 'products', productId), {
      ...data,
      ...(hasPhotos !== undefined ? { hasPhotos } : {}),
      updatedAt: Timestamp.now(),
    })
    if (photos !== undefined) await savePhotos(productId, photos)
    setProducts(products.map(p =>
      p.id === productId
        ? { ...p, ...data, ...(hasPhotos !== undefined ? { hasPhotos } : {}), updatedAt: new Date() }
        : p
    ))
  }

  const deleteProduct = async (productId) => {
    if (!user) return
    const usedIn = combos.filter(c => c.items?.some(i => i.productId === productId))
    if (usedIn.length > 0) {
      throw new Error(
        'Este producto forma parte de los combos: ' +
        usedIn.map(c => c.name).join(', ') +
        '. Editá o eliminá esos combos primero.'
      )
    }
    await deleteDoc(doc(db, 'products', productId))
    await deleteDoc(doc(db, 'photos', productId)).catch(() => {})
    photoCache.current.delete(productId)
    setProducts(products.filter(p => p.id !== productId))
  }

  // --- Envíos (logística) ---
  const addShipment = async (data) => {
    if (!user) return null
    const docRef = await addDoc(collection(db, 'shipments'), {
      ...data,
      userId: ORG_ID,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    })
    setShipments([{ id: docRef.id, ...data, userId: ORG_ID, createdAt: new Date() }, ...shipments])
    return docRef.id
  }

  const updateShipment = async (id, data) => {
    if (!user) return
    await updateDoc(doc(db, 'shipments', id), { ...data, updatedAt: Timestamp.now() })
    setShipments(shipments.map(s => (s.id === id ? { ...s, ...data } : s)))
  }

  const deleteShipment = async (id) => {
    if (!user) return
    await deleteDoc(doc(db, 'shipments', id))
    setShipments(shipments.filter(s => s.id !== id))
  }

  const addCourier = async (name) => {
    if (!user) return
    const docRef = await addDoc(collection(db, 'couriers'), {
      name,
      userId: ORG_ID,
      createdAt: Timestamp.now(),
    })
    setCouriers([...couriers, { id: docRef.id, name }])
  }

  const removeCourier = async (id) => {
    if (!user) return
    await deleteDoc(doc(db, 'couriers', id))
    setCouriers(couriers.filter(c => c.id !== id))
  }

  const saveDepositMap = async (photoDataUrl) => {
    if (!user) return
    await setDoc(
      doc(db, 'settings', ORG_ID),
      { depositMapPhoto: photoDataUrl, userId: ORG_ID },
      { merge: true }
    )
    setDepositMap(photoDataUrl)
  }

  const addCombo = async (comboData) => {
    if (!user) return
    const { photos = [], ...data } = comboData
    const hasPhotos = photos.length > 0
    const docRef = await addDoc(collection(db, 'combos'), {
      ...data,
      hasPhotos,
      userId: ORG_ID,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    })
    if (hasPhotos) await savePhotos(docRef.id, photos)
    setCombos([
      { id: docRef.id, ...data, hasPhotos, userId: ORG_ID, createdAt: new Date() },
      ...combos,
    ])
    return docRef.id
  }

  const updateCombo = async (comboId, comboData) => {
    if (!user) return
    const { photos, ...data } = comboData
    const hasPhotos = photos !== undefined ? photos.length > 0 : undefined
    await updateDoc(doc(db, 'combos', comboId), {
      ...data,
      ...(hasPhotos !== undefined ? { hasPhotos } : {}),
      updatedAt: Timestamp.now(),
    })
    if (photos !== undefined) await savePhotos(comboId, photos)
    setCombos(combos.map(c =>
      c.id === comboId
        ? { ...c, ...data, ...(hasPhotos !== undefined ? { hasPhotos } : {}), updatedAt: new Date() }
        : c
    ))
  }

  const deleteCombo = async (comboId) => {
    if (!user) return
    await deleteDoc(doc(db, 'combos', comboId))
    await deleteDoc(doc(db, 'photos', comboId)).catch(() => {})
    photoCache.current.delete(comboId)
    setCombos(combos.filter(c => c.id !== comboId))
  }

  // Importación masiva de combos desde Excel. Cada row ya viene con los items
  // resueltos (productId+quantity) y opcionalmente existingId para actualizar.
  const importCombos = async (rows) => {
    if (!user) return { created: 0, updated: 0 }
    const toCreate = rows.filter(r => !r.existingId)
    const toUpdate = rows.filter(r => r.existingId)
    const photoWrites = []
    const newCombos = []

    for (const r of toCreate) {
      const { photos, ...data } = r
      const hasPhotos = photos && photos.length > 0
      const ref = await addDoc(collection(db, 'combos'), {
        ...data,
        hasPhotos,
        userId: ORG_ID,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      })
      if (hasPhotos) photoWrites.push({ id: ref.id, photos })
      newCombos.push({ id: ref.id, ...data, hasPhotos, userId: ORG_ID, createdAt: new Date() })
    }

    for (const r of toUpdate) {
      const { existingId, photos, ...data } = r
      const hasNewPhotos = photos && photos.length > 0
      await updateDoc(doc(db, 'combos', existingId), {
        ...data,
        ...(hasNewPhotos ? { hasPhotos: true } : {}),
        updatedAt: Timestamp.now(),
      })
      if (hasNewPhotos) photoWrites.push({ id: existingId, photos })
    }

    for (const { id, photos } of photoWrites) {
      await savePhotos(id, photos)
    }

    const updatedById = new Map(toUpdate.map(r => [r.existingId, r]))
    setCombos([
      ...newCombos.reverse(),
      ...combos.map(c => {
        const r = updatedById.get(c.id)
        if (!r) return c
        const { existingId, photos, ...data } = r
        const hasNewPhotos = photos && photos.length > 0
        return { ...c, ...data, ...(hasNewPhotos ? { hasPhotos: true } : {}), updatedAt: new Date() }
      }),
    ])
    return { created: newCombos.length, updated: toUpdate.length }
  }

  const addMovement = async (movementData) => {
    if (!user) return
    const movementDoc = {
      ...movementData,
      userId: ORG_ID,
      date: Timestamp.now(),
      userName: user.displayName || user.email,
      userEmail: user.email,
    }
    const factor = movementData.type === 'entrada' ? 1 : -1

    // Movimiento de COMBO: descuenta/suma el stock de cada producto componente
    if (movementData.comboId) {
      const combo = combos.find(c => c.id === movementData.comboId)
      if (!combo) throw new Error('Combo no encontrado')

      const batch = writeBatch(db)
      const mRef = doc(collection(db, 'movements'))
      batch.set(mRef, movementDoc)

      const newQuantities = {}
      combo.items.forEach(item => {
        const p = products.find(pp => pp.id === item.productId)
        if (!p) return
        const newQty = (p.quantity || 0) + factor * item.quantity * movementData.quantity
        newQuantities[p.id] = newQty
        batch.update(doc(db, 'products', p.id), {
          quantity: newQty,
          updatedAt: Timestamp.now(),
        })
      })
      await batch.commit()

      setProducts(products.map(p =>
        newQuantities[p.id] !== undefined ? { ...p, quantity: newQuantities[p.id] } : p
      ))
      setMovements([{ id: mRef.id, ...movementDoc, date: new Date() }, ...movements])
      return mRef.id
    }

    // Movimiento de producto simple
    const docRef = await addDoc(collection(db, 'movements'), movementDoc)
    if (movementData.productId) {
      const currentProduct = products.find(p => p.id === movementData.productId)
      if (currentProduct) {
        const newQty = (currentProduct.quantity || 0) + factor * movementData.quantity
        await updateDoc(doc(db, 'products', movementData.productId), {
          quantity: newQty,
          updatedAt: Timestamp.now(),
        })
        setProducts(products.map(p =>
          p.id === movementData.productId ? { ...p, quantity: newQty } : p
        ))
      }
    }
    setMovements([{ id: docRef.id, ...movementDoc, date: new Date() }, ...movements])
    return docRef.id
  }

  if (loading) {
    return (
      <div className="app-loading">
        <div className="spinner"></div>
        <p>Cargando...</p>
      </div>
    )
  }

  if (!user) {
    return <Auth onLogin={handleLogin} />
  }

  if (accessDenied) {
    return (
      <div className="app-loading">
        <div style={{ fontSize: '3rem' }}>🔒</div>
        <h2 style={{ margin: '0.5rem 0' }}>Sin acceso al inventario</h2>
        <p style={{ maxWidth: 420, textAlign: 'center', color: '#6b7280' }}>
          Tu cuenta <strong>{user.email}</strong> todavía no fue autorizada.
          Pedile al administrador que la agregue desde el Dashboard
          (panel "Equipo") y volvé a entrar.
        </p>
        <button onClick={handleLogout} className="btn-logout" style={{ marginTop: '1rem' }}>
          Salir y probar con otra cuenta
        </button>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <h1 className="app-title">📦 Stock & ML Inventory</h1>
          <p className="app-subtitle">Gestión de inventario en tiempo real</p>
        </div>
        <div className="header-right">
          <div className="user-info">
            <img src={user.photoURL} alt={user.displayName} className="user-avatar" />
            <div className="user-details">
              <div className="user-name">{user.displayName}</div>
              <div className="user-email">{user.email}</div>
            </div>
          </div>
          <button onClick={handleLogout} className="btn-logout">
            Salir
          </button>
        </div>
      </header>

      <nav className="app-nav">
        <button
          className={`nav-btn ${currentTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setCurrentTab('dashboard')}
        >
          📊 Dashboard
        </button>
        <button
          className={`nav-btn ${currentTab === 'inventory' ? 'active' : ''}`}
          onClick={() => setCurrentTab('inventory')}
        >
          📦 Inventario
        </button>
        <button
          className={`nav-btn ${currentTab === 'combos' ? 'active' : ''}`}
          onClick={() => setCurrentTab('combos')}
        >
          🎁 Combos
        </button>
        <button
          className={`nav-btn ${currentTab === 'movements' ? 'active' : ''}`}
          onClick={() => setCurrentTab('movements')}
        >
          🔄 Movimientos
        </button>
        <button
          className={`nav-btn ${currentTab === 'shipments' ? 'active' : ''}`}
          onClick={() => setCurrentTab('shipments')}
        >
          🚚 Envíos
        </button>
        <button
          className={`nav-btn ${currentTab === 'reports' ? 'active' : ''}`}
          onClick={() => setCurrentTab('reports')}
        >
          📈 Reportes
        </button>
      </nav>

      <main className="app-main">
        {loadingData ? (
          <div className="loading-container">
            <div className="spinner"></div>
            <p>Cargando datos...</p>
          </div>
        ) : (
          <>
            {currentTab === 'dashboard' && (
              <Dashboard
                products={products}
                movements={movements}
                consumption={consumption}
                depositMap={depositMap}
                onSaveMap={saveDepositMap}
                isAdmin={isAdmin}
                members={members}
                onAddMember={addMember}
                onRemoveMember={removeMember}
              />
            )}
            {currentTab === 'inventory' && (
              <Inventory
                products={products}
                combos={combos}
                onAdd={addProduct}
                onUpdate={updateProduct}
                onDelete={deleteProduct}
                onImport={importProducts}
                onPurchase={registerPurchase}
                onDeleteCombo={deleteCombo}
                loadPhotos={loadPhotos}
                consumption={consumption}
                onEditCombo={(combo) => {
                  setComboEditRequest({ combo, ts: Date.now() })
                  setCurrentTab('combos')
                }}
              />
            )}
            {currentTab === 'combos' && (
              <Combos
                combos={combos}
                products={products}
                onAdd={addCombo}
                onUpdate={updateCombo}
                onDelete={deleteCombo}
                onImport={importCombos}
                editRequest={comboEditRequest}
                loadPhotos={loadPhotos}
              />
            )}
            {currentTab === 'movements' && (
              <Movements
                products={products}
                combos={combos}
                movements={movements}
                onAdd={addMovement}
              />
            )}
            {currentTab === 'shipments' && (
              <Shipments
                shipments={shipments}
                couriers={couriers}
                onAddShipment={addShipment}
                onUpdateShipment={updateShipment}
                onDeleteShipment={deleteShipment}
                onAddCourier={addCourier}
                onRemoveCourier={removeCourier}
              />
            )}
            {currentTab === 'reports' && <Reports products={products} movements={movements} />}
          </>
        )}
      </main>
    </div>
  )
}
