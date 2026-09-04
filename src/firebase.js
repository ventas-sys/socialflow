import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'

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
// Mostrar siempre el selector de cuentas de Google en vez de entrar
// automáticamente con la última cuenta usada
googleProvider.setCustomParameters({ prompt: 'select_account' })
// Caché local en el dispositivo: el inventario queda guardado en el celular /
// la PC, así la segunda vez que se abre la app aparece al instante (y sigue
// mostrándose aunque se corte internet) mientras se actualiza contra el
// servidor por atrás. Si el navegador no la soporta (modo incógnito, storage
// bloqueado, varias pestañas viejas), se sigue sin caché como antes.
function crearDb() {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    })
  } catch (e) {
    console.warn('Sin caché local de Firestore:', e?.code || e?.message)
    return getFirestore(app)
  }
}

export const db = crearDb()

export default app
