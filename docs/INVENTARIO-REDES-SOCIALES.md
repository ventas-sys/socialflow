# Inventario de Redes Sociales — Uniproveedores

> **Última actualización**: 2026-06-25
> **Objetivo**: Mapa único del estado de cada red para planear publicación unificada.

---

## 🎯 TL;DR para mañana

**Lo que YA tenés cubierto:**
- ✅ Generación de copies + imágenes con IA (`social.html` con Gemini 2.5/3.1) para 6 redes
- ✅ Meta family (FB + IG + Threads) bajo un único Business Portfolio
- ✅ Bot WhatsApp con IA, follow-ups y reglas (`bridge/wa-bridge.mjs`)

**Lo que FALTA para "publicar todo junto":**
- 🔴 Publicación con 1 click → hoy el flujo es generar y pegar manualmente en cada red
- 🔴 YouTube no está integrado en `social.html` (no hay módulo para Shorts/videos)
- 🔴 TikTok / X / LinkedIn están en el generador pero sin API de publicación directa

**Camino propuesto** (detalle en `PLAN-PUBLICACION-UNIFICADA.md`): usar n8n como orquestador, con APIs nativas para Meta y YouTube, y caída a Buffer/Metricool para el resto.

---

## 📋 Estado de cada red

### Meta Family (FB + IG + Threads) — bajo Business Portfolio único

| Red | Handle | Seguidores | Estado | Acceso programático |
|---|---|---|---|---|
| Facebook (página) | Uniproveedores | 0 | 🟢 Operativa | ✅ Meta Graph API |
| Instagram | @uniproveedoresok | 163 | 🟢 Operativa, 2FA activa | ✅ Meta Graph API (vía cuenta business) |
| Threads (1) | uniproveedoresok | — | 🟢 Operativo | ⚠️ Threads API beta (limitada) |
| Threads (2) | uni.proveedores | — | 🟢 Operativo | ⚠️ Threads API beta |

**Cross-posting nativo Meta:**
- ✅ Posts de IG pueden auto-publicarse en FB (configuración del IG)
- ✅ Reels de IG → comparten en FB automáticamente
- 🟡 Threads se nutre del IG si se configura, no es 100% automático
- ✅ Meta Business Suite tiene "Composer" que publica simultáneo en FB + IG

### WhatsApp

| Red | Handle | Estado |
|---|---|---|
| WhatsApp Business app | `+541135510715` | 🟢 "Cuenta empresa" verificada |
| WhatsApp Bot | `bridge/wa-bridge.mjs` en VPS | 🟢 Activo (FAQ + IA + follow-ups) |

**Acceso programático:**
- ✅ `wa-bridge.mjs` controla envío/recepción vía `whatsapp-web.js`
- 🟡 Para canales/estados/listas de difusión: WhatsApp Cloud API oficial (no implementado)

### YouTube — ⚠️ NUEVO (no estaba en el inventario antes)

| Item | Estado | Acción mañana |
|---|---|---|
| Canal | A confirmar (la usuaria tiene playlist WL → cuenta sí, canal de marca a verificar) | 🟡 Confirmar si hay canal `@uniproveedoresok` |
| YouTube Data API v3 | ❌ No configurada | 🔴 Setup mañana (ver `SETUP-YOUTUBE-MCP.md`) |
| MCP de YouTube en Claude | ❌ No conectado | 🔴 Setup mañana |
| Generación de copies para YouTube en `social.html` | ❌ Faltante | 🟡 Agregar plataforma "yt" al generador |
| Publicación de Shorts | 🚫 Manual desde el cel | 🟡 Vía API una vez configurada |

### TikTok

| Item | Estado |
|---|---|
| Cuenta | A confirmar |
| TikTok API for Developers | ❌ No configurada |
| Generación de copies | ✅ En `social.html` (id `chk-tk`) |
| Publicación | 🚫 Manual (abre tab y se copia) |

### X / Twitter

| Item | Estado |
|---|---|
| Cuenta | A confirmar |
| API v2 | ❌ No configurada (API ahora es paga ~$100/mes para escribir) |
| Generación de copies | ✅ En `social.html` (id `chk-tw`) |
| Publicación | 🚫 Manual |

> 💡 **Nota costo X**: La API de Twitter/X ya no es gratuita para publicar. Si X no genera ROI claro, recomiendo dejarlo en manual o discontinuarlo.

### LinkedIn

| Item | Estado |
|---|---|
| Página de empresa | A confirmar |
| LinkedIn Marketing API | ❌ No configurada |
| Generación de copies | ✅ En `social.html` (id `chk-li`) |
| Publicación | 🚫 Manual |

> 💡 **Nota relevancia LinkedIn**: Para Uniproveedores (B2B/B2C local de seguridad e indumentaria laboral) puede tener sentido. Si vende a empresas, sí. Si es solo retail, baja prioridad.

### Tienda Nube

| Item | Estado |
|---|---|
| Tienda | `uniproveedores.com.ar` |
| API | ✅ Integrada en `wa-bridge` (stock, precios) |
| Catálogo | ✅ Sincronizado |

### Mercado Libre

| Item | Estado |
|---|---|
| Cuenta vendedor | ✅ Activa |
| API | ✅ Parcial (envíos flex, ver commits recientes) |
| Webhooks → WA | ⏳ Pendiente conectar nuevos pedidos → notificación WA al cliente |

### Google Workspace + redes@

| Item | Estado |
|---|---|
| Mail | `redes@uniproveedores.com.ar` |
| 2FA | ✅ Authenticator + SMS + Passkey + códigos respaldo |
| Drive | ✅ Disponible |
| YouTube login | ✅ Misma cuenta (clave para configurar YouTube API) |

---

## 🔍 Gap analysis — qué falta para "publicación unificada"

### Gap 1 — YouTube no integrado
- 🔴 No hay módulo en `social.html` para YouTube
- 🔴 No hay API conectada
- 🔴 No hay MCP en Claude Code para que yo lea/escriba tu YouTube

**Resuelve**: ejecutar `SETUP-YOUTUBE-MCP.md` mañana

### Gap 2 — Publicación con 1 click
Hoy: generás copies → copiás y pegás en cada red.
Meta: que un botón "Publicar" empuje a las 4-6 redes a la vez.

**Resuelve**: workflow n8n + APIs (ver `PLAN-PUBLICACION-UNIFICADA.md`)

### Gap 3 — Coordinación de contenido
Hoy no hay calendario editorial centralizado. Cada post se decide en el momento.

**Resuelve**: Google Calendar de `redes@` + reglas n8n cron para auto-publicar agendados

### Gap 4 — Métricas unificadas
Hoy hay que entrar a Insights de cada red por separado.

**Resuelve** (futuro, no urgente): dashboard simple en `social.html` que consuma stats vía APIs.

---

## ✅ Recomendación inmediata para mañana

1. **Configurar YouTube Data API + MCP** (1-2 hs) → ver `SETUP-YOUTUBE-MCP.md`
2. **Conectar cuenta YouTube oficial** y verificar canal de marca
3. **Agregar módulo YouTube a `social.html`** (después de tener API): generar título + descripción + thumbnail prompt
4. **Definir si seguís con n8n** para publicación unificada (ver `PLAN-PUBLICACION-UNIFICADA.md`)
5. **Discontinuar / replantear X**: la API paga rompe el ROI

---

## Próximos hitos sugeridos

| Sprint | Entregable | Tiempo estimado |
|---|---|---|
| Sprint 1 | YouTube API + MCP funcional | Mañana (3-4 hs con ella) |
| Sprint 2 | Módulo YouTube en `social.html` | 1 día solo |
| Sprint 3 | Workflow n8n de publicación FB+IG | 2-3 días |
| Sprint 4 | Workflow n8n para YouTube Shorts | 2 días |
| Sprint 5 | Workflow n8n para TikTok | 2-3 días (API más cerrada) |
| Sprint 6 | Calendario editorial automatizado | 1 semana |
