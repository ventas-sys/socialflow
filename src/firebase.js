import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

// Reemplaza estos valores con tu configuración de Firebase
// Obtén estos datos en: https://console.firebase.google.com/
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'YOUR_API_KEY_HERE',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'YOUR_AUTH_DOMAIN_HERE',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'YOUR_PROJECT_ID_HERE',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'YOUR_STORAGE_BUCKET_HERE',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || 'YOUR_MESSAGING_SENDER_ID_HERE',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || 'YOUR_APP_ID_HERE'
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()
export const db = getFirestore(app)

export default app
