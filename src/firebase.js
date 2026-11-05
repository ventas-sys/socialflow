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
const CLAVE_CONEXION = 'conexionAlternativa'

export function conexionAlternativa() {
  try { return localStorage.getItem(CLAVE_CONEXION) === '1' } catch { return false }
}

// Prende o apaga la conexión alternativa en ESTE equipo y recarga la app
// (Firestore sólo toma esta opción al arrancar).
export function cambiarConexionAlternativa(prender) {
  try {
    if (prender) localStorage.setItem(CLAVE_CONEXION, '1')
    else localStorage.removeItem(CLAVE_CONEXION)
  } catch { /* storage bloqueado: no se puede guardar */ }
  window.location.reload()
}

function crearDb() {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      // Firestore habla con el servidor por una conexión de larga duración
      // (WebChannel). Hay redes —con proxy, filtro de contenido o ciertos
      // WiFi— que la rompen SIN dar error. Pasó en la tablet del depósito:
      // traer TRES motoqueros tardaba más de 25 segundos y nunca llegaba.
      // OJO: la autodetección (experimentalAutoDetectLongPolling) YA viene
      // prendida por defecto en esta versión del SDK, así que no alcanzó.
      // El paso siguiente es FORZAR long-polling, pero SOLO en el equipo donde
      // se prende desde el botón del cartel de error (queda guardado en ese
      // equipo). La PC y el celular que andan bien no cambian.
      ...(conexionAlternativa()
        ? { experimentalForceLongPolling: true }
        : { experimentalAutoDetectLongPolling: true }),
    })
  } catch (e) {
    console.warn('Sin caché local de Firestore:', e?.code || e?.message)
    return getFirestore(app)
  }
}

export const db = crearDb()

export default app
