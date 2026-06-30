# Plan de Publicación Unificada — Cross-Network

> **Objetivo**: 1 click → publicar simultáneamente en FB, IG, Threads, YouTube, TikTok, WhatsApp, LinkedIn (las que tengan ROI).
> **Estado actual**: copies y imágenes generados con IA en `social.html`. Publicación directa FB+IG vía conector Meta nativo (ya construido).

---

## ✅ DECISIÓN TOMADA (2026-06-30): conector NATIVO, no n8n

Al revisar el proyecto encontramos que ya existe `conexiones.html` + backend OAuth
(ML, Tienda Nube, Contabilium). En vez de sumar n8n (herramienta externa), se
construyó el **conector Meta nativo** siguiendo el mismo patrón:

- `api/meta/exchange.js` — OAuth → token largo (~60d) + páginas FB + IG Business
- `api/meta/publish.js` — publica en página FB (feed/photos) e IG (container + media_publish)
- `meta-callback.html` — callback OAuth
- `conexiones.html` — tarjeta Meta funcional (App ID/Secret + Autorizar)
- `social.html` — botón "🚀 Publicar" real en FB/IG + YouTube como 7ma red

**Pendiente para que publique imágenes**: IG (y fotos de FB por URL) requieren
imagen con **URL pública**. Hoy `/api/image` devuelve data URL (base64). Falta
un paso de hosting (subir la imagen generada a un bucket público / Vercel Blob).
El publicado de **texto a FB** ya funciona end-to-end.

**Pendiente de credenciales (lo hace la usuaria)**: crear app en
developers.facebook.com, pegar App ID + App Secret en Conexiones, autorizar.

Las secciones de abajo quedan como referencia histórica del análisis de opciones.

---

---

## 🎯 TL;DR

3 caminos viables. Mi recomendación: **🅰️ Híbrido (Meta Business Suite + n8n para el resto)**, balance entre costo, control y velocidad de armado.

| Camino | Costo | Tiempo armar | Control | Recomendación |
|---|---|---|---|---|
| 🅰️ **Híbrido** (Meta Suite + n8n) | $0/mes | 1-2 semanas | Alto | ⭐ Recomendado |
| 🅱️ **Buffer / Metricool** | $15-50/mes | 1-2 horas | Bajo | Para arrancar YA |
| 🅲️ **n8n custom 100%** | $0/mes (+ VPS) | 3-4 semanas | Total | Si querés escalar a agencia |

---

## 🅰️ Camino Híbrido — Recomendado (⭐)

**Idea**: usar las herramientas nativas donde son buenas, automatizar el resto con n8n.

### Arquitectura

```
                                ┌─────────────────────┐
   social.html  ───────────► │   n8n (orquestador)  │
   (genera copies + img)        │   en VPS Hostinger   │
                                └──────┬──────────────┘
                                       │
                ┌──────────────┬────────┴────────┬────────────────┐
                ▼              ▼                 ▼                ▼
         ┌──────────┐   ┌──────────┐    ┌──────────┐    ┌──────────┐
         │ Meta API │   │ YouTube  │    │ TikTok   │    │ Otros    │
         │ FB+IG+Th │   │ Data API │    │ Content  │    │ (LI, WA) │
         └──────────┘   └──────────┘    │  API     │    └──────────┘
                                         └──────────┘
```

### Distribución de responsabilidades

| Red | Quién publica | Cómo |
|---|---|---|
| Facebook | **Meta Graph API vía n8n** | Una llamada API → post en página |
| Instagram | **Meta Graph API vía n8n** | Reels/posts/stories. IG → FB cross-post nativo |
| Threads | **Threads API beta vía n8n** | Si API beta no funciona, manual (es nicho) |
| WhatsApp | **`wa-bridge.mjs` (ya tenés)** | n8n manda webhook al bridge → bridge difunde |
| YouTube Shorts | **YouTube Data API vía n8n** | Subida + título + descripción + thumbnail |
| TikTok | **TikTok Content Posting API vía n8n** | Más cerrada, requiere aplicación previa |
| LinkedIn | **Manual o LinkedIn API** | Si vale ROI, integramos. Si no, manual |
| X / Twitter | **Manual o descartar** | API paga rompe ROI |

### Ventajas
- ✅ **$0/mes recurrente** (VPS Hostinger ya lo pagás)
- ✅ Reutilizás `wa-bridge.mjs` y el VPS que ya tenés
- ✅ Cada flujo se debuggea visualmente en n8n
- ✅ Yo puedo escribir/modificar los workflows JSON sin que vos tengas que abrir n8n
- ✅ Extensible: agregar Mercado Libre, Tienda Nube, alertas, etc.

### Desventajas
- 🟡 Curva de aprendizaje inicial (n8n + APIs)
- 🟡 Cada red tiene su API con quirks
- 🟡 TikTok requiere registrar app de developer (proceso de ~1 semana de espera)

### Plan de armado (en sprints)

| Sprint | Entregable | Tiempo |
|---|---|---|
| 1 | n8n instalado en VPS + webhook básico | 1 día |
| 2 | Workflow "publicar en FB + IG" desde social.html | 2-3 días |
| 3 | Workflow YouTube Shorts | 2 días |
| 4 | Workflow TikTok (después que apruebe app) | 2 días + espera |
| 5 | UI en social.html para "Publicar todo" | 1 día |
| 6 | Calendario editorial (publicaciones programadas) | 1 semana |

---

## 🅱️ Camino Buffer / Metricool — Para arrancar YA

**Idea**: usar una herramienta SaaS comercial que ya hace todo el cross-posting.

### Opciones comparadas

| Tool | Plan adecuado | Costo/mes | FB | IG | TH | YT | TK | LI | X |
|---|---|---|---|---|---|---|---|---|---|
| **Buffer** | Essentials | $5/canal | ✅ | ✅ | ✅ | ✅ Shorts | ✅ | ✅ | ✅ |
| **Metricool** | Starter | €18 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Later** | Starter | $25 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Hootsuite** | Pro | $99 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### Flujo
1. Generás copies + imágenes en `social.html`
2. Copiás cada uno a Buffer/Metricool manualmente (o vía Zapier ~$20/mes)
3. La herramienta publica simultáneo a las redes que conectes
4. Te da métricas unificadas

### Ventajas
- ✅ **Activo en 1-2 horas** (sin programar nada)
- ✅ Maneja todas las APIs por vos (incluida la baja de X)
- ✅ UI bien pulida para calendario editorial
- ✅ Soporte si rompe

### Desventajas
- 🔴 **$15-100/mes para siempre**
- 🔴 Dependencia de tercero (si Buffer sube precios, si cambia política…)
- 🔴 Limitado a lo que la herramienta soporta
- 🔴 No integra con tu wa-bridge ni con tu flujo custom de Tienda Nube

### Cuándo elegir esto
- Querés probar 1-2 meses sin programar nada
- Volumen bajo (≤10 posts/semana)
- No tenés ganas de mantener infra
- Después podés migrar a 🅰️ cuando quieras

---

## 🅲️ Camino n8n 100% custom — Para escalar a agencia

**Idea**: como 🅰️ pero ABSORBIENDO TODO en n8n incluso lo de WhatsApp.

### Diferencias con 🅰️
- En vez de Meta Business Suite manual, **n8n maneja Meta + WhatsApp + todo**
- Migrar `wa-bridge.mjs` lógica a flujos n8n
- Centralizar TODO en una sola UI

### Ventajas
- ✅ Visión unificada de TODO
- ✅ Multi-cliente (si Uniproveedores se vuelve agencia para terceros)
- ✅ Métricas unificadas custom

### Desventajas
- 🔴 **3-4 semanas de armado**
- 🔴 Riesgo de romper el bot de WA que ya funciona
- 🔴 Sobre-ingeniería para tu volumen actual

### Cuándo elegir esto
- Estás convencida que vas a abrir una agencia de redes
- Querés ofrecer este sistema como servicio a otros
- Tenés 1 mes de capacity sin urgencias

---

## 🤔 Cómo decidir

Respondé estas 3 preguntas y te digo:

### Pregunta 1 — ¿Cuántos posts vas a publicar por semana?
- 🅰️ <5 posts → cualquiera sirve
- 🅱️ 5-15 posts → Buffer/Metricool es lo más rápido, híbrido si querés invertir tiempo
- 🅲️ >15 posts → híbrido o n8n custom

### Pregunta 2 — ¿Cuánto presupuesto tenés para SaaS?
- $0/mes → híbrido o n8n custom
- $15-30/mes → cualquiera
- >$30/mes → cualquiera

### Pregunta 3 — ¿Querés crecer esto como negocio (agencia para terceros)?
- Sí → n8n custom 100%
- No, solo para Uniproveedores → híbrido (suficiente)
- Tal vez después → híbrido (después podés escalar)

---

## 💡 Mi recomendación FINAL

Para Uniproveedores (vendedor de seguridad e indumentaria laboral), perfil de volumen medio, presupuesto cuidado:

→ **🅰️ Camino Híbrido**

Razones:
1. Costo $0/mes → ROI infinito
2. Tiempo de armado razonable (2 semanas)
3. Aprovechás VPS + wa-bridge que ya tenés
4. Yo puedo escribir los workflows en JSON (vos no tenés que abrir n8n)
5. Si crece a agencia → migrás a 🅲️ sin tirar nada

**Si querés algo activo YA**:
→ **🅱️ Metricool Starter (€18/mes)** como puente. La armás en 2 horas, te aguanta 3-6 meses mientras desarrollamos el camino 🅰️.

---

## 🚀 Próximos pasos (orden propuesto)

1. **Hoy**: dejar este doc + el de inventario + el de YouTube MCP commiteados ✅
2. **Mañana**:
   - Setup YouTube API + MCP (paso 1 común a todos los caminos)
   - Decidir qué camino elegimos
   - Si 🅰️: instalar n8n en VPS Hostinger
   - Si 🅱️: registrarte en Metricool y conectar redes
3. **Próxima semana**: armar workflow piloto (post a FB + IG con copy del social.html)
4. **2 semanas**: agregar YouTube Shorts al pipeline
5. **3 semanas**: TikTok + métricas unificadas

---

## ❓ Lo que necesito de vos para decidir

- ✅ Volumen actual de publicaciones por semana
- ✅ Presupuesto disponible para SaaS (si lo hay)
- ✅ Visión a 6-12 meses: ¿esto crece a agencia o queda interno?
- ✅ Networks priorizadas: cuáles SÍ o SÍ, cuáles podrían quedar afuera

Con esas 4 respuestas mañana decidimos en 5 minutos.
