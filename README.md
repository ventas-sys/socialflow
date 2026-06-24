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
- IA: Gemini 2.5 Flash (texto) + Gemini 3.1 Flash Image (imágenes, Nano Banana 2)
- Sin base de datos — estado en `localStorage`

## Deploy
1. Push a GitHub → conectar repo en Vercel
2. Variables de entorno (Vercel → Settings → Environment Variables):
   - `GEMINI_API_KEY` — obligatoria
3. Redeploy

## Endpoints API
- `POST /api/agent` — `{ agent: 'ml'|'tiendanube'|'verification', input: {...} }`
- `POST /api/generate` — copies por red social (legacy SocialFlow)
- `POST /api/image` — imágenes con Gemini 3.1 Flash Image

## Estructura
```
socialflow/
├── index.html           Panel de Control
├── ml.html              Agente Mercado Libre
├── tiendanube.html      Agente Tienda Nube
├── social.html          Agente Redes Sociales
├── verification.html    Agente Verificación
├── vercel.json
├── package.json
└── api/
    ├── agent.js         Backend ML/TN/Verificación
    ├── generate.js      Backend copies redes
    └── image.js         Backend Gemini 3.1 Flash Image
```
