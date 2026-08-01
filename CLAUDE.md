# socialflow — Agencia de Ventas IA (Uniproveedores)

Panel de control con agentes IA que gestionan la venta digital de Uniproveedores.com.ar
(Mercado Libre + Tienda Nube). Ver `README.md` para la descripción completa del producto.

## Idioma

Respondé siempre en **español (castellano rioplatense/Argentina)**, incluso si el código,
los commits o los nombres de archivo están en inglés.

## Stack y convenciones

- Frontend: HTML + JS vanilla (sin build step), deploy estático en Vercel. Cada "agente" es
  una página propia (`ml.html`, `tiendanube.html`, `social.html`, `youtube.html`,
  `verification.html`, `ml-clips.html`, `conexiones.html`, etc.).
- Backend: funciones serverless en `api/*.js` (Node, `"type": "module"`), un archivo por
  integración, multiplexando acciones por query param `?action=...` (ver `api/ml/exchange.js`,
  `api/tn.js`, `api/youtube.js` como referencia).
- Helper compartido: `api/_http.js` (`httpRequest`, `cors`) — reusalo en vez de reimplementar
  llamadas HTTP.
- **Sin base de datos.** Todo el estado (conexiones, tokens, actividad, producto activo) vive en
  `localStorage` bajo la clave `up_state`, compartido entre páginas. Los tokens/API keys nunca se
  guardan en el servidor — viajan del navegador al backend solo cuando se ejecuta una acción.
- `conexiones.html` es el patrón para agregar una integración nueva: tarjeta con campos,
  `saveConn(prov)` / `testConn(prov)` / `clearConn(prov)` genéricos en el mismo archivo — al sumar
  un proveedor nuevo hay que tocar esas tres funciones (ver el caso `yt` como ejemplo reciente).
- IA: Gemini 2.5 Flash (texto) e Imagen 4 Fast (imágenes) para los agentes de contenido.

## Estado reciente (PR #73)

Se agregó una conexión de **YouTube** (Data API v3, solo API Key + canal, sin OAuth) en
`/conexiones` y una sección en el Agente YouTube (`youtube.html`) para listar los últimos
videos/Shorts publicados del canal. Endpoint: `api/youtube.js` (`?action=test`, `?action=videos`).

## Testing

No hay suite de tests automatizada. Para cambios de frontend: `node --check` sobre los archivos
`api/*.js` tocados, y probar el flujo en navegador (mockeando `fetch` si no hay credenciales
reales a mano) antes de dar el cambio por terminado.
