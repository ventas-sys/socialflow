import React, { useState, useEffect } from 'react'
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
  query,
  where,
  Timestamp,
  writeBatch,
} from 'firebase/firestore'
import Dashboard from './components/Dashboard'
import Inventory from './components/Inventory'
import Combos from './components/Combos'
import Movements from './components/Movements'
import Reports from './components/Reports'
import Auth from './components/Auth'
import './App.css'

export default function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [currentTab, setCurrentTab] = useState('dashboard')
  const [products, setProducts] = useState([])
  const [combos, setCombos] = useState([])
  const [movements, setMovements] = useState([])
  const [depositMap, setDepositMap] = useState(null)
  const [loadingData, setLoadingData] = useState(false)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser)
      setLoading(false)
      if (currentUser) {
        loadUserData(currentUser.uid)
      }
    })
    return unsubscribe
  }, [])

  const loadUserData = async (userId) => {
    setLoadingData(true)
    try {
      // Se ordena en el cliente para no requerir índices compuestos en Firestore
      const toMillis = (t) => (t?.toMillis ? t.toMillis() : new Date(t || 0).getTime())

      const [productsSnap, combosSnap, movementsSnap, settingsSnap] = await Promise.all([
        getDocs(query(collection(db, 'products'), where('userId', '==', userId))),
        getDocs(query(collection(db, 'combos'), where('userId', '==', userId))),
        getDocs(query(collection(db, 'movements'), where('userId', '==', userId))),
        getDoc(doc(db, 'settings', userId)),
      ])

      setDepositMap(settingsSnap.exists() ? settingsSnap.data().depositMapPhoto || null : null)

      setProducts(
        productsSnap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
      )
      setCombos(
        combosSnap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
      )
      setMovements(
        movementsSnap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => toMillis(b.date) - toMillis(a.date))
      )
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoadingData(false)
    }
  }

  const handleLogin = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider)
      setUser(result.user)
      loadUserData(result.user.uid)
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
      setCurrentTab('dashboard')
    } catch (error) {
      console.error('Logout error:', error)
    }
  }

  const addProduct = async (productData) => {
    if (!user) return
    const docRef = await addDoc(collection(db, 'products'), {
      ...productData,
      userId: user.uid,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    })
    setProducts([
      { id: docRef.id, ...productData, userId: user.uid, createdAt: new Date() },
      ...products,
    ])
    return docRef.id
  }

  // Importación masiva desde Excel (lotes de hasta 400 por límite de Firestore)
  const importProducts = async (rows) => {
    if (!user) return 0
    const created = []
    for (let i = 0; i < rows.length; i += 400) {
      const chunk = rows.slice(i, i + 400)
      const batch = writeBatch(db)
      const refs = chunk.map(r => {
        const ref = doc(collection(db, 'products'))
        batch.set(ref, {
          ...r,
          userId: user.uid,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        })
        return ref
      })
      await batch.commit()
      chunk.forEach((r, idx) => {
        created.push({ id: refs[idx].id, ...r, userId: user.uid, createdAt: new Date() })
      })
    }
    setProducts([...created.reverse(), ...products])
    return created.length
  }

  const updateProduct = async (productId, productData) => {
    if (!user) return
    await updateDoc(doc(db, 'products', productId), {
      ...productData,
      updatedAt: Timestamp.now(),
    })
    setProducts(products.map(p =>
      p.id === productId ? { ...p, ...productData, updatedAt: new Date() } : p
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
    setProducts(products.filter(p => p.id !== productId))
  }

  const saveDepositMap = async (photoDataUrl) => {
    if (!user) return
    await setDoc(
      doc(db, 'settings', user.uid),
      { depositMapPhoto: photoDataUrl, userId: user.uid },
      { merge: true }
    )
    setDepositMap(photoDataUrl)
  }

  const addCombo = async (comboData) => {
    if (!user) return
    const docRef = await addDoc(collection(db, 'combos'), {
      ...comboData,
      userId: user.uid,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    })
    setCombos([
      { id: docRef.id, ...comboData, userId: user.uid, createdAt: new Date() },
      ...combos,
    ])
    return docRef.id
  }

  const updateCombo = async (comboId, comboData) => {
    if (!user) return
    await updateDoc(doc(db, 'combos', comboId), {
      ...comboData,
      updatedAt: Timestamp.now(),
    })
    setCombos(combos.map(c =>
      c.id === comboId ? { ...c, ...comboData, updatedAt: new Date() } : c
    ))
  }

  const deleteCombo = async (comboId) => {
    if (!user) return
    await deleteDoc(doc(db, 'combos', comboId))
    setCombos(combos.filter(c => c.id !== comboId))
  }

  const addMovement = async (movementData) => {
    if (!user) return
    const movementDoc = {
      ...movementData,
      userId: user.uid,
      date: Timestamp.now(),
      userName: user.displayName || user.email,
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
                depositMap={depositMap}
                onSaveMap={saveDepositMap}
              />
            )}
            {currentTab === 'inventory' && (
              <Inventory
                products={products}
                onAdd={addProduct}
                onUpdate={updateProduct}
                onDelete={deleteProduct}
                onImport={importProducts}
              />
            )}
            {currentTab === 'combos' && (
              <Combos
                combos={combos}
                products={products}
                onAdd={addCombo}
                onUpdate={updateCombo}
                onDelete={deleteCombo}
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
            {currentTab === 'reports' && <Reports products={products} movements={movements} />}
          </>
        )}
      </main>
    </div>
  )
}
