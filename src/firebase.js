import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

// Reemplaza estos valores con tu configuración de Firebase
// Obtén estos datos en: https://console.firebase.google.com/
// Config del proyecto "STOCK e INVENTARIO". Estos valores son públicos por diseño
// (viajan en el bundle de toda app web Firebase); la seguridad la dan las reglas
// de Firestore y los dominios autorizados. Se pueden pisar con variables VITE_*.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyDnIYGZF37XaTetiG3a_0jrk4DvpKlF8JY',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'stock-e-inventario.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'stock-e-inventario',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'stock-e-inventario.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '189841276349',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:189841276349:web:ed4a4b0f96f49a0a7966d4'
}

// true cuando todavía se está usando la config de relleno
export const isFirebaseConfigured = true

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()
export const db = getFirestore(app)

export default app
