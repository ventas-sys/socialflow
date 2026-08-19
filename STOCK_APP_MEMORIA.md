# 🧠 Memoria técnica — App Stock & Inventario (Distribuidora Universo)

**ÚNICA fuente de verdad del proyecto. Leer entera antes de tocar nada.**
Rama: `claude/stock-inventory-app-06rlv5` · PR #38 (draft) · Repo: ventas-sys/socialflow

## ⚠️ Entorno (leer PRIMERO en cada sesión nueva)
- El repo `ventas-sys/socialflow` en `main` es OTRO proyecto (redes/WhatsApp, .html). La app de stock (React, `src/`) vive SOLO en la rama `claude/stock-inventory-app-06rlv5`. Si el contenedor clona otra rama: `git fetch origin claude/stock-inventory-app-06rlv5 && git checkout -B claude/stock-inventory-app-06rlv5 origin/claude/stock-inventory-app-06rlv5` y `npm install`.
- **2 proyectos Vercel del mismo repo**: `socialflow` (viejo, main, NO tocar) y **`stock-inventario`** (producción de esta app, Production Branch = la rama de stock, dominio **`stock-inventario-sable.vercel.app`**). El preview largo `socialflow-git-claude-stock-in-858296-...vercel.app` es el que usa el usuario a diario y es la Redirect URI de ML.
- **Caché PWA**: problema recurrente. La app muestra la versión de build en el subtítulo (`v2026-...`, definida en vite.config `__APP_VERSION__`). Si el usuario reporta algo "que no anda", PRIMERO verificar versión → Ctrl+Shift+R / incógnito / borrar datos del sitio.
- Deploys: cada push a la rama deploya preview + producción (~2 min). El usuario espera que le avise cuando queda verde.

## Stack y estructura
- React + Vite + PWA (autoUpdate, skipWaiting, navigateFallbackDenylist para `/api/`), Firebase Auth (Google + email/password) + Firestore, xlsx / exceljs / jszip / html5-qrcode / **leaflet** (OpenStreetMap).
- Backend serverless en `api/` (mismo repo): `api/ml/exchange.js` (OAuth ML + orders + items), `api/ml/cron.js` (descuento diario), `api/_http.js`.
- `src/config.js`: `ORG_ID='distribuidora-universo'`, `ADMIN_EMAIL='ventas@distribuidorauniverso.com'`. Todos los datos con `userId=ORG_ID` (inventario compartido). Miembros en colección `members` (los gestiona el admin desde Dashboard). Auditoría por movimiento.
- `firestore.rules` (publicadas): isAdmin = ventas@ **o cron@distribuidorauniverso.com**; isMember = admin o email en `members`. Colecciones: products, combos, movements, photos, shipments, couriers, ml_orders (member) y ml_accounts, settings (solo admin escribe; ml_accounts solo admin lee).

## Modelo de datos (Firestore)
- **products**: name, code (SKU), `barcodes[]` (varios; barcode=primero), category, price, quantity (puede ser negativo), minStock, location, stockType (FULL/FERRE/BASE), description, hasPhotos.
- **combos**: name, code (**SKU MLA** de la publicación), `barcodes[]`, price, location, stockType, `items[]` {productId, quantity}, itemBarcodes[], hasPhotos. Un combo = N unidades de producto(s) base.
- **photos/{id}**: dataURLs aparte, on-demand (LazyThumb + cache).
- **movements**: productId, productName, type entrada/salida, quantity, reason, reference, userName/userEmail, date.
- **shipments**: code (shipmentId ML), packId, recipient, address, lat/lng, status (pendiente/armado/camino/entregado/demorado/**archivado**), courierId/courierName, zone, courierPay, buyerPay, timestamps (armadoAt/assignedAt/deliveredAt/demoradoAt/archivedAt), account (full/ferre).
- **couriers**: {name}. **ml_accounts/{full|ferre}**: clientId, clientSecret, tokens, expiresAt, lastSyncAt. **ml_orders/{cuenta_orderId}**: órdenes ya descontadas (no repetir).

## Funciones principales
- **Inventario**: productos+combos unificados, filtros, búsqueda por nombre/SKU/cualquier código de barras/ubicación/tipo + escáner con pitido; tarjeta destacada con foto y ubicación naranja; salud de stock (utils/stock.js: consumo 60 días → Sin stock / Bajo ≤20d / Saludable 21-75d / Sobre >75d / Sin ventas) en tabla, tarjeta y panel "Se terminan primero" del Dashboard.
- **Import/Export Excel**:
  - Productos: agrupa por SKU → varios códigos de barras por producto; fotos pegadas en el Excel; actualiza existentes.
  - Combos (formato catálogo real): `SKU` MLA = combo, `Codigo (ARMADO P)` = producto base, `ARMADO S` = cantidad, filas repetidas = códigos de barras del combo (no suman). Base debe existir.
  - **Compra/Ajuste**: `SKU o Código` + `Cantidad` (+ negativo resta) + `Factura`; acepta SKU de COMBO (expande a base × cantidad); **vista previa obligatoria** antes de aplicar; registra movimientos.
- **Movimientos**: tabs funcionales Todos/Entradas/Salidas/**Hoy/Ayer/Semana** + buscador + resumen entró/salió/neto; tarjetas con +verde/−rojo grande y SKU.
- **MercadoLibre (solapa ML)**: 2 cuentas conectadas por OAuth — **FULL** = app "Uniproveedores MCP" (client 5731065254303938), **FERRE** = app "Publicacion-por-telegram" (914895574262615). Redirect URI = preview largo con `/` final. En la app SIEMPRE loguearse como admin; el navegador define qué cuenta ML se autoriza. Sincronizar ventas (vista previa → descuenta stock, excluye `fulfillment`, mapea SKU/MLA → combo → base, marca ml_orders), **cron diario 21:00 UTC (18hs AR)** con **ventana móvil de 48hs** (antes usaba "medianoche del servidor" = 21hs AR del día anterior y las ventas de 18–21hs AR se perdían para siempre — bug corregido 16/8; ml_orders evita doble descuento) en producción stock-inventario (env: CRON_EMAIL/CRON_PASSWORD = usuario Firebase cron@distribuidorauniverso.com; la service account key está bloqueada por política de org, por eso login email/password), botón "Probar automático ahora", "Publicaciones faltantes" (Excel de MLA sin cargar).
- **Envíos (logística FLEX)**: ver bloque siguiente.
- **📦 Empaquetado** (`src/components/Packing.jsx`): flujo guiado de armado. Escanea QR de la venta (mismo matching flexible que Envíos) → **Paso 1**: banner de bolsa según medidas ML (`dims` del envío; bolsas REALES: verde 20×30 / blanca 30×40 / gris 40×50 cm, si no entra → empaque especial; criterio de encaje en bolsa plana: ancho+alto+2 ≤ ancho bolsa y largo+alto+2 ≤ largo bolsa). Si ML no manda medidas, se **estima con el campo "Medidas" del producto** (cm "largo x ancho x alto", nuevo en el formulario de Inventario 18/8): 1 artículo → apila unidades y prueba encaje; varios → suma volúmenes vs capacidad (cap: verde 1500 / blanca 4800 / gris 11000 cm³); banner dice "por tamaño de los artículos", aviso FRÁGIL si algún producto lo es (checkbox `fragile` nuevo en formulario de producto), checklist de artículos con foto/ubicación/cantidad (SKU combo se expande a productos base × cantidad). Al continuar pasa el envío a **Armado** automático. **Paso 2**: total de unidades gigante + checks de cantidades y papelitos de calificación/devolución. **Paso 3**: leyenda "pegá la etiqueta del lado LISO" + cuenta regresiva 6s que vuelve sola al escáner. Requiere que el envío tenga `items`/`dims` (los guarda el sync desde commit 75d6f6e; envíos anteriores muestran aviso — Vaciar+Traer una vez si se necesita el detalle en todos).
- **Reportes** y Dashboard con mapa del depósito (settings, solo admin).

## Envíos — estado final
- Entran SOLOS desde ML: al abrir + **cada 30 min** + botón (con leyenda "esperá" animada SIEMPRE, incluso auto). Solo `self_service` (FLEX/Turbo); excluye correo/Full/retiro/cancelados. **UN envío por compra** (packId || shipmentId). Trae destinatario, dirección, coords → pin automático.
- Ventana **7 días** (usuario mueve ~300 envíos/día → backend trae hasta **3000 órdenes/cuenta con detalle de envíos en paralelo, lotes de 10**). Estado inicial: delivered→Entregado (con fecha), shipped ≤48hs→En camino, más viejo o not_delivered→Demorado, abierto ≤48hs→Pendiente, abierto viejo→Demorado. El sync agrega nuevos (dedup por seen) y además **refresca los ya cargados contra ML** (18/8): delivered→Entregado, not_delivered→Demorado, en camino >48hs→Demorado; armado/motoquero puestos a mano NO se tocan. **No usar Vaciar** salvo reset total (pierde gestión).
- Flujo: Pendiente de imprimir → Armado → En camino (auto al asignar motoquero SOLO desde pendiente/armado; un DEMORADO sigue demorado al asignarle moto — si no "desaparecía" del filtro) → Entregado → **Archivado**. Filtro de motoqueros muestra las cantidades del día de cada uno: asignados (✅ entregados · 🛵 pendientes). (sale de mapa y de "Todos"; filtro propio; sigue contando como entregado en reporte). QR de etiqueta FLEX solo BUSCA (parse JSON id / dígitos, matching flexible); si no encuentra muestra el contenido del QR.
- Mapa: en "Todos" solo activos del día; **al elegir un filtro de estado muestra ese estado**; búsqueda y motoquero también filtran el mapa. Leyenda de colores solo PC (rojo pendiente / naranja armado / azul camino).
- Barra de búsqueda (código/pack/destinatario/dirección/motoquero) con acciones en la tarjeta. Costo NO está en el tablero.
- **Reporte (solo PC, oculto en celular)**: hoy/7/30 días + **filtro por motoquero** y **cuadro resumen por motoquero** (envíos/entregados/demorados/demora prom./cobro ML/pago — visible con "Todos" y hoja 2 "Por motoquero" en el Excel); por envío: **Zona FLEX** (cercana $4.490 / media $6.490 / lejana $8.690 / muylejana $9.990 — constantes ZONES en Shipments.jsx, actualizar cuando ML cambie) con **zona automática**: primero por la localidad de la etiqueta ML (`zoneOf`: dirección con "Capital Federal"/"CABA" = cercana), si no por coordenadas (CABA_POLY + anillos desde el Obelisco ≤20km media, ≤38km lejana, más = muylejana); `effZone` = s.zone guardada pisa el cálculo; columna Zona muestra 📍 localidad (`locOf` = dirección después de la calle) y el Excel tiene columna Localidad → Cobro ML auto; **Pago motoquero automático por zona COMPLETO** (19/8: cercana $2.750 / media $4.500 / lejana $6.000 / muylejana $8.000; lo cargado a mano pisa lo automático) y **Pagó comprador** editable; totales + export Excel.
- Lección técnica: setShipments/setCouriers SIEMPRE en forma funcional + shipmentsLiveRef para dup-check (los adds en ráfaga se pisaban y parecía que nada guardaba).

## Pendiente (no hecho)
1. **Devoluciones de ML** que SUMAN stock.
2. **Cargar stock real** de productos base (el usuario lo va ajustando con Compra/Ajuste).
3. Stock desde **foto de factura (OCR)** — base en `api/contabilium.js` (Gemini Vision), necesita API key.
4. Envíos a bodega **Full** (descuento al enviar).
5. Si se quiere usar el dominio corto para conectar ML: agregar `https://stock-inventario-sable.vercel.app/` como Redirect URI en ambas apps ML y reconectar.
6. Valores de zonas FLEX editables desde la app (hoy constantes).
7. **Verificar el cron de las 18hs** tras el fix de paralelización (5d7314d): el usuario debe abrir `https://stock-inventario-sable.vercel.app/api/ml/cron` y pegar el JSON, o mirar View Logs del cron en stock-inventario.
8. Marcar productos frágiles (checkbox nuevo en Inventario) para que Empaquetado avise.

## Reglas de negocio clave (definidas por el usuario)
- Stock: descuenta TODO lo despachado desde el depósito propio (FLEX+correo+retiro), NUNCA `fulfillment` (Full ya salió al enviarse a bodega). Igual para ambas cuentas. 1 vez/día después de las 18hs. Stock puede quedar negativo.
- Reparto (Envíos): SOLO FLEX/Turbo (motos propias). Por venta/cliente, no por producto. Historial 7 días para ver evolución; demorados hasta 1 semana.
- ML paga por zona (bonificación); al motoquero se le paga otro monto; el comprador puede haber pagado o no el envío — 3 columnas separadas en el reporte.
