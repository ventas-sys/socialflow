# Agencia de Ventas IA — Uniproveedores

Panel de control con **4 agentes IA** que gestionan toda la venta digital de Uniproveedores.com.ar:

| Agente | URL | Función |
|---|---|---|
| 🛒 Mercado Libre | `/ml` | Optimiza listings (título 60ch SEO, bullets, descripción, keywords, estrategia MercadoLíder, calculadora de comisión) |
| 🏪 Tienda Nube | `/tiendanube` | Genera ficha SEO completa (meta-title, meta-desc, slug, etiquetas, HTML, tips pixel/conversión) |
| 📣 Redes Sociales | `/social` | Copies + imágenes IA para IG, FB, WA, LinkedIn, X, TikTok (con publicación de un clic) |
| ✅ Verificación | `/verification` | Checklist y plan IA personalizado para tilde azul: Meta, X, TikTok, LinkedIn, ML, Google Business, Tienda Nube, WhatsApp Business |

El **Panel de Control (`/`)** muestra KPIs en tiempo real (canales activos, verificaciones, última actividad) usando `localStorage` — el estado se comparte entre agentes.

## Stack
- Frontend: HTML+JS vanilla, deploy estático en Vercel
- IA: Gemini 2.5 Flash (texto) + Imagen 4 Fast (imágenes)
- Sin base de datos — estado en `localStorage`

## Deploy
1. Push a GitHub → conectar repo en Vercel
2. Variables de entorno (Vercel → Settings → Environment Variables):
   - `GEMINI_API_KEY` — obligatoria para los agentes IA
   - `SITE_PASSWORD` — **obligatoria**, contraseña para acceder al sitio (cualquier string fuerte)
3. Redeploy

## Privacidad
El sitio es **privado**: `middleware.js` exige HTTP Basic Auth en todas las rutas (HTML + API) usando `SITE_PASSWORD`. Al entrar, el navegador pide usuario y contraseña:
- **Usuario**: `uniproveedores` (o `admin`, o dejar vacío)
- **Contraseña**: la que pusiste en `SITE_PASSWORD`

Los tokens de Mercado Libre y Tienda Nube **no se guardan en el servidor** — quedan solo en `localStorage` del navegador.

## Endpoints API
- `POST /api/agent` — `{ agent: 'ml'|'tiendanube'|'verification', input: {...} }`
- `POST /api/generate` — copies por red social (legacy SocialFlow)
- `POST /api/image` — imágenes con Imagen 4

## Estructura
```
socialflow/
├── middleware.js        Basic Auth global (sitio privado)
├── index.html           Panel de Control
├── producto.html        Editor producto activo
├── conexiones.html      Tokens ML + TN
├── ml.html              Agente Mercado Libre
├── tiendanube.html      Agente Tienda Nube
├── social.html          Agente Redes Sociales
├── verification.html    Agente Verificación
├── vercel.json
├── package.json
└── api/
    ├── _http.js         Helper HTTPS + CORS
    ├── agent.js         Backend ML/TN/Verificación (IA)
    ├── generate.js      Backend copies redes (legacy)
    ├── image.js         Backend Imagen 4
    ├── ml/
    │   ├── test.js
    │   ├── category.js
    │   └── publish.js
    └── tn/
        ├── test.js
        └── publish.js
```
