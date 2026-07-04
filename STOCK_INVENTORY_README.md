# 📦 Stock & ML Inventory

Aplicación PWA (Progressive Web App) de gestión de inventario con React, Vite y Firebase.

## ✨ Características

- ✅ **Autenticación** con Google
- ✅ **Gestión de Productos**: Crear, editar, eliminar productos
- ✅ **Control de Stock**: Registra entradas y salidas con auditoría
- ✅ **Movimientos**: Historial completo de todos los movimientos
- ✅ **Reportes**: Estadísticas, top products, análisis por categoría
- ✅ **PWA**: Instalable en celulares como app nativa
- ✅ **Offline**: Funciona sin conexión (datos en caché)
- ✅ **Auditoría**: Cada movimiento registra quién, cuándo y por qué
- ✅ **Responsive**: Funciona en desktop, tablet y mobile
- ✅ **Dark Mode**: Soporte para modo oscuro del sistema

## 🚀 Instalación

### 1. Requisitos previos
- Node.js 24.x (o superior)
- npm o yarn
- Una cuenta de Google
- Una cuenta de Firebase (gratuita)

### 2. Crear proyecto en Firebase

1. Ve a https://console.firebase.google.com/
2. Haz clic en "Crear proyecto"
3. Nombra tu proyecto (ej: "Stock Inventory")
4. Sigue los pasos de configuración
5. Una vez creado, ve a "Configuración del proyecto" (⚙️)
6. En la pestaña "General", desplázate hasta "Tus apps"
7. Haz clic en "Agregar app" → "Web" (</> )
8. Copia los valores de `firebaseConfig`

### 3. Configurar variables de entorno

1. Copia `.env.example` a `.env.local`:
   ```bash
   cp .env.example .env.local
   ```

2. Abre `.env.local` y reemplaza los valores con los de tu Firebase:
   ```
   VITE_FIREBASE_API_KEY=tu_api_key_aqui
   VITE_FIREBASE_AUTH_DOMAIN=tu_proyecto.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=tu_proyecto_id
   VITE_FIREBASE_STORAGE_BUCKET=tu_proyecto.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
   VITE_FIREBASE_APP_ID=tu_app_id
   ```

### 4. Configurar Firestore (base de datos)

1. En Firebase Console, ve a "Firestore Database" (en el menú izquierdo)
2. Haz clic en "Crear base de datos"
3. Selecciona la región más cercana a tu ubicación
4. Modo de inicio: **Modo de inicio seguro**
5. Espera a que se cree (tarda unos segundos)

### 5. Configurar autenticación con Google

1. En Firebase Console, ve a "Authentication" (en el menú izquierdo)
2. Haz clic en "Comenzar"
3. En "Métodos de inicio de sesión", busca "Google"
4. Haz clic en el icono de Google
5. Habilita el proveedor Google
6. En "Email de soporte del proyecto", selecciona tu email
7. Haz clic en "Guardar"

### 6. Instalar dependencias y ejecutar

```bash
# Instalar dependencias
npm install

# Ejecutar en desarrollo
npm run dev

# La app se abrirá en http://localhost:5173
```

## 🛠️ Desarrollo

```bash
# Iniciar servidor de desarrollo
npm run dev

# Build para producción
npm run build

# Vista previa del build
npm run preview
```

## 📱 Instalar como App

### En Android
1. Abre la app en Chrome
2. Haz clic en el menú (⋮) → "Instalar aplicación" o "Agregar a pantalla de inicio"

### En iOS
1. Abre la app en Safari
2. Haz clic en el botón Compartir
3. Selecciona "Agregar a pantalla de inicio"

## 🚀 Deploy en Firebase Hosting

### Opción 1: Deploy automático (recomendado)

```bash
# Instalar Firebase CLI (si no lo tienes)
npm install -g firebase-tools

# Login en Firebase
firebase login

# Inicializar Firebase en tu proyecto (si no está hecho)
firebase init hosting

# Build y deploy
npm run build
firebase deploy
```

Tu app estará disponible en: `https://tu-proyecto.web.app`

### Opción 2: Deploy manual en otra plataforma

Si prefieres usar Vercel, Netlify o similar:

```bash
npm run build
# Sube la carpeta "dist/" a tu plataforma de hosting
```

## 📊 Estructura de datos

### Colección: `products`
```javascript
{
  id: "auto-generado",
  userId: "usuario-google-id",
  name: "Nombre del producto",
  code: "SKU-123",
  category: "Categoría",
  price: 100.50,
  quantity: 50,
  minStock: 10,
  description: "Descripción",
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

### Colección: `movements`
```javascript
{
  id: "auto-generado",
  userId: "usuario-google-id",
  productId: "id-producto",
  productName: "Nombre del producto",
  type: "entrada" | "salida",
  quantity: 10,
  reason: "Motivo (compra, venta, ajuste, etc.)",
  reference: "FAC-2024-001",
  date: Timestamp,
  userName: "nombre-usuario"
}
```

## 🔐 Seguridad

Las reglas de Firestore están configuradas para que:
- Solo usuarios autenticados puedan leer/escribir
- Cada usuario solo ve sus propios productos y movimientos
- No se puede acceder a datos de otros usuarios

## 📝 Notas importantes

1. **Backup**: Firebase automáticamente guarda tus datos. No te preocupes por pérdida de información.

2. **Límite gratuito**: Firebase tiene un plan gratuito muy generoso:
   - 50,000 escrituras/día
   - 100,000 lecturas/día
   - Es suficiente para pequeños negocios

3. **Costos**: El plan gratuito es completamente gratis. Si lo necesitas, puedes escalar a pago.

4. **Datos**: Tus datos están almacenados de forma segura en los servidores de Google.

## 🆘 Troubleshooting

### Error: "Firebase config not found"
- Asegúrate de tener `.env.local` con los valores correctos
- Reinicia el servidor (`npm run dev`)

### Error: "User not authenticated"
- Verifica que la autenticación con Google esté habilitada en Firebase Console
- Limpia el localStorage: abre DevTools → Storage → clear

### Error: "Permission denied" al leer/escribir
- Verifica que Firestore Database esté creada
- Revisa las reglas de seguridad en Firestore Console

### La app es lenta
- Si es la primera carga, Firebase necesita inicializar
- Verifica tu conexión a internet
- En desarrollo, usa `npm run build && npm run preview` para probar performance

## 📚 Recursos útiles

- [Firebase Documentation](https://firebase.google.com/docs)
- [React Documentation](https://react.dev)
- [Vite Documentation](https://vitejs.dev)
- [PWA Documentation](https://web.dev/progressive-web-apps/)

## 📄 Licencia

Libre para uso personal y comercial.

---

**¡Buenas ventas! 🚀**
