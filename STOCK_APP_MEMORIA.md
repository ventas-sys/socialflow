# 🧠 Memoria técnica — App Stock & Inventario

App PWA de gestión de inventario para **Distribuidora Universo**.
Rama: `claude/stock-inventory-app-06rlv5` · PR #38 · Deploy: Vercel.

## Stack
- React + Vite + PWA (vite-plugin-pwa, autoUpdate + skipWaiting/clientsClaim)
- Firebase Auth (Google) + Firestore
- xlsx (leer/escribir Excel) · exceljs (export con imágenes, carga diferida) · jszip (leer fotos pegadas en Excel) · html5-qrcode (escáner)

## Config / acceso
- `src/config.js`: `ORG_ID = 'distribuidora-universo'` (espacio compartido) · `ADMIN_EMAIL = ventas@distribuidorauniverso.com`
- **Inventario compartido**: todos los datos usan `userId = ORG_ID`. Varias cuentas de Google ven el mismo stock.
- **Equipo**: el admin agrega/quita emails (colección `members`) desde el panel del Dashboard. Auditoría por movimiento (userName/userEmail).
- `firestore.rules`: acceso por `isMember()`; `settings` y `members` solo escribe el admin. Colecciones: products, combos, movements, photos, settings, members.

## Modelo de datos (Firestore)
- **products/{id}**: name, code (SKU), `barcodes[]` (varios; barcode = barcodes[0]), category, price, quantity (stock, puede ser negativo), minStock, location, stockType (FULL/FERRE/BASE), description, hasPhotos, userId, createdAt/updatedAt
- **combos/{id}**: name, code (SKU MLA), `barcodes[]`, price, location, stockType, `items[]` ({productId, quantity}), itemBarcodes[] (para buscar el combo por sus componentes), hasPhotos, userId...
- **photos/{id}**: `{ photos: [...dataURLs], userId }` — separado de products/combos para que el listado cargue liviano. Se leen **on-demand** (LazyThumb con IntersectionObserver + cache en memoria en App.jsx `loadPhotos`).
- **movements/{id}**: productId, productName, type ('entrada'|'salida'), quantity, reason, reference, comboId?, breakdown?, userName, userEmail, date, userId
- **settings/{ORG_ID}**: depositMapPhoto (mapa del depósito, solo admin lo edita)

## Funciones implementadas
- Inventario unificado (productos + combos) con filtro Todos/Productos/Combos y buscador (por nombre, SKU, cualquier código de barras, ubicación, tipo) + escaneo con cámara. Tarjeta de resultado destacada con foto grande, nombre y **ubicación en naranja**.
- Productos y combos: hasta 5 fotos; **varios códigos de barras** (textarea, uno por línea).
- Combos: descuentan el stock de sus productos base al mover. Stock puede quedar negativo.
- FULL/FERRE/BASE, ubicación en depósito, mapa del depósito en Dashboard (solo admin sube; todos ven).
- Escáner con **pitido** (Web Audio); reconoce SKU/códigos de productos, combos y componentes.
- Movimientos entrada/salida (manual y por combo) con auditoría.
- Reportes.

## Import/Export Excel
- **Productos** (pestaña Inventario → Importar/Exportar/Plantilla): columnas FOTO, Nombre, SKU, Código de Barras, Categoría, Precio, Cantidad, Stock Mínimo, Ubicación, Tipo, Descripción. Foto pegada en la columna FOTO (imagen flotante sobre la fila). Agrupa por SKU → **un producto con varios códigos de barras**. Actualiza si el SKU/código ya existe.
- **Combos** (pestaña Combos → Importar/Exportar/Plantilla): formato **multi-fila** — cada combo ocupa varias filas (una por producto o por código de barras). Reconoce el formato real del catálogo:
  - `SKU` (MLA...) = combo · `Nombre` = nombre · `Código de barras` = códigos del combo (varios) · `UBICACIÓN` · `TIPO` (FULL/FERRE) · **`Codigo (ARMADO P)`** = producto base componente · **`ARMADO S`** = cantidad de ese producto en el combo.
  - Agrupa por SKU MLA; filas repetidas con el mismo producto NO suman (son códigos de barras distintos del combo), se deduplican por producto. El producto base se busca por SKU/código de barras/nombre y **ya debe existir**.
- **Compra / Ajuste** (botón en Inventario): Excel con `SKU o Código` + `Cantidad` (+ `Factura` opcional). **Positivo suma, negativo resta** stock. Muestra **vista previa** (Código → Producto → Stock actual → Cambio → Stock nuevo) y **no aplica hasta confirmar**. Registra un movimiento por renglón.

## Pendiente (pedido por el usuario, no hecho)
1. **Stock desde foto de factura/remito (OCR)** — hay base reutilizable en `api/contabilium.js` (Gemini Vision). Requiere API key de IA.
2. **Descontar por ventas de MercadoLibre (2 cuentas: FULL y FERRE)** — base OAuth en `api/ml/exchange.js` (exchange/refresh/test ya funcionan). Reglas definidas por el usuario:
   - **Cuándo**: 1 vez por día, después de las 18hs ART (UTC-3) → cron diario ~21:00 UTC. (confirmar hora exacta)
   - **Qué descontar**: de cada orden mirar el envío (`/shipments/{id}` → `logistic_type`). Se descuenta TODO menos `fulfillment` (bodega ML / Full). O sea SÍ descuentan: FLEX (`self_service`), correo (`cross_docking`/`drop_off`/`xd_drop_off`), retiro (`pickup`/acordar). NO descuenta `fulfillment`.
   - **Misma regla para ambas cuentas** (FULL y FERRE). El stock en la bodega de ML ya salió del depósito propio al enviarlo a Full.
   - **Mapeo**: item vendido trae SKU de la publicación (MLA...) o seller_sku → coincide con `code` del combo → descuenta sus productos base × cantidad. Si es SKU de producto suelto, descuenta ese producto.
   - **Devoluciones/claims**: suman stock de vuelta.
   - **Evitar doble descuento**: colección `ml_orders` con las órdenes ya procesadas.
   - **Credenciales**: App ID + Secret de cada cuenta como env vars en Vercel (no en el repo). Redirect URI sugerida `<dominio>/ml-callback`.
   - **Fases**: (1) conectar cuentas + botón "Sincronizar ventas" con vista previa/confirmación ✅ HECHO Y VALIDADO con datos reales; (2) automático diario por cron + devoluciones (PENDIENTE).
   - **Apps ML reales**: FULL = "Uniproveedores MCP" (Client ID 5731065254303938). FERRE = "Publicacion-por-telegram" (Client ID 914895574262615). Redirect URI configurada: `https://socialflow-git-claude-stock-in-858296-ventas-sys-2783s-projects.vercel.app/`.
   - **Operación clave**: en la app entrar SIEMPRE con el admin (ventas@distribuidorauniverso.com) — solo el admin puede guardar ml_accounts. Para conectar cada cuenta, el navegador debe tener la sesión de MercadoLibre de esa cuenta (FULL o FERRE). Los combos cargados tienen SKU MLA de la cuenta FULL; FERRE tiene sus propias MLA (muchas ventas FERRE caen en "Sin producto" si ese combo no está cargado).
   - **Fase 1 validada**: FULL 41 ventas (131 Full excluidas), FERRE 78 ventas (0 Full). Mapeo combo→base OK.
3. **Envíos a bodega Full de ML** — registrar/descontar lo enviado a Full (esto SÍ descuenta del depósito propio al enviar).
4. **Sección Envíos (logística)** — YA creada (escanear etiqueta, mapa Leaflet, motoqueros, estados). Falta: de dónde salen dirección/destinatario (administrado.net da 403).

## Producción del automático (cron ML)
- Proyecto Vercel SEPARADO **stock-inventario** (dominio `stock-inventario-sable.vercel.app`), Production Branch = `claude/stock-inventory-app-06rlv5`. NO toca el proyecto viejo `socialflow` (main = WhatsApp).
- Env vars en ese proyecto: CRON_EMAIL, CRON_PASSWORD.
- Cron `/api/ml/cron` a las `0 21 * * *` (18hs ART). Corre solo en la producción de stock-inventario.
- El cron usa los refresh tokens ya guardados en Firestore (ml_accounts) → no necesita re-OAuth aunque el dominio cambie.
- Botón "▶️ Probar automático ahora" en la sección ML dispara el mismo proceso a demanda. Validado OK.

## ⚠️ Nota de entorno (IMPORTANTE)
El repo real `ventas-sys/socialflow` es el proyecto viejo de redes/ML/WhatsApp (archivos .html, api/, lib/). La app de stock (React, carpeta `src/`) vive SOLO en la rama `claude/stock-inventory-app-06rlv5`. Al abrir un contenedor nuevo, si el checkout queda en otra rama, hacer:
`git fetch origin claude/stock-inventory-app-06rlv5 && git checkout -B claude/stock-inventory-app-06rlv5 origin/claude/stock-inventory-app-06rlv5`

## Notas operativas
- **Caché PWA**: si el usuario "no ve" un cambio, es caché → Ctrl+Shift+R o borrar datos del sitio o incógnito.
- **Deployment Protection de Vercel**: debe estar en Disabled para que el link sea público (Settings → Deployment Protection).
- Firebase config real embebida en `src/firebase.js` (pública por diseño; la seguridad la dan las reglas).
- Después de agregar colecciones nuevas, **publicar firestore.rules** (el archivo tiene la versión final).
