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
  query,
  where,
  orderBy,
  Timestamp,
  writeBatch,
} from 'firebase/firestore'
import Dashboard from './components/Dashboard'
import Inventory from './components/Inventory'
import Movements from './components/Movements'
import Reports from './components/Reports'
import Auth from './components/Auth'
import './App.css'

export default function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [currentTab, setCurrentTab] = useState('dashboard')
  const [products, setProducts] = useState([])
  const [movements, setMovements] = useState([])
  const [loadingData, setLoadingData] = useState(false)

  // Auth state listener
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
      const productsSnap = await getDocs(
        query(
          collection(db, 'products'),
          where('userId', '==', userId),
          orderBy('createdAt', 'desc')
        )
      )
      setProducts(productsSnap.docs.map(d => ({ id: d.id, ...d.data() })))

      const movementsSnap = await getDocs(
        query(
          collection(db, 'movements'),
          where('userId', '==', userId),
          orderBy('date', 'desc')
        )
      )
      setMovements(movementsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
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
      setMovements([])
      setCurrentTab('dashboard')
    } catch (error) {
      console.error('Logout error:', error)
    }
  }

  const addProduct = async (productData) => {
    if (!user) return
    try {
      const docRef = await addDoc(collection(db, 'products'), {
        ...productData,
        userId: user.uid,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      })
      const newProduct = {
        id: docRef.id,
        ...productData,
        userId: user.uid,
        createdAt: new Date(),
      }
      setProducts([newProduct, ...products])
      return docRef.id
    } catch (error) {
      console.error('Error adding product:', error)
      throw error
    }
  }

  const updateProduct = async (productId, productData) => {
    if (!user) return
    try {
      const docRef = doc(db, 'products', productId)
      await updateDoc(docRef, {
        ...productData,
        updatedAt: Timestamp.now(),
      })
      setProducts(products.map(p =>
        p.id === productId
          ? { ...p, ...productData, updatedAt: new Date() }
          : p
      ))
    } catch (error) {
      console.error('Error updating product:', error)
      throw error
    }
  }

  const deleteProduct = async (productId) => {
    if (!user) return
    try {
      await deleteDoc(doc(db, 'products', productId))
      setProducts(products.filter(p => p.id !== productId))
    } catch (error) {
      console.error('Error deleting product:', error)
      throw error
    }
  }

  const addMovement = async (movementData) => {
    if (!user) return
    try {
      const movementDoc = {
        ...movementData,
        userId: user.uid,
        date: Timestamp.now(),
        userName: user.displayName || user.email,
      }

      const docRef = await addDoc(collection(db, 'movements'), movementDoc)

      // Actualizar stock del producto
      if (movementData.productId && movementData.type) {
        const productRef = doc(db, 'products', movementData.productId)
        const currentProduct = products.find(p => p.id === movementData.productId)
        if (currentProduct) {
          const quantityChange =
            movementData.type === 'entrada'
              ? movementData.quantity
              : -movementData.quantity

          await updateDoc(productRef, {
            quantity: (currentProduct.quantity || 0) + quantityChange,
            updatedAt: Timestamp.now(),
          })

          setProducts(products.map(p =>
            p.id === movementData.productId
              ? {
                  ...p,
                  quantity: (p.quantity || 0) + quantityChange,
                  updatedAt: new Date(),
                }
              : p
          ))
        }
      }

      const newMovement = {
        id: docRef.id,
        ...movementDoc,
        date: new Date(),
      }
      setMovements([newMovement, ...movements])
      return docRef.id
    } catch (error) {
      console.error('Error adding movement:', error)
      throw error
    }
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
            {currentTab === 'dashboard' && <Dashboard products={products} movements={movements} />}
            {currentTab === 'inventory' && (
              <Inventory
                products={products}
                onAdd={addProduct}
                onUpdate={updateProduct}
                onDelete={deleteProduct}
              />
            )}
            {currentTab === 'movements' && (
              <Movements
                products={products}
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
