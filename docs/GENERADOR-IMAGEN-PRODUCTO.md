# Generador de imagen del producto (cartel publicitario)

Memoria del estado del generador de imágenes del panel (`social.html` → botón
**🎨 Cartel IA** → `api/image.js`). Última actualización: 2026-07-08.

---
## ✅ ESTADO FINAL (2026-07-25) — imagen 9/10 + video

**Cómo funciona el Cartel IA hoy (HÍBRIDO, la solución que quedó bien):**
1. **Gemini texto** (`geminiBrief`) lee la foto real + la descripción de ML y
   arma el brief: producto, título, subtítulo/medida, gancho, tipo (hexágono),
   materiales, 3+ virtudes con descripción, usos, sello.
2. **gpt-image-1** genera SOLO el producto + escena cinematográfica **SIN texto
   ni logo** (`buildScenePrompt`), con el producto en la mitad de abajo y la
   franja de arriba despejada. Calidad **alta**, con **reintento automático a
   media** si Vercel corta por los 60s (front, `quality`).
3. El front dibuja por CÓDIGO, integrado, ENCIMA de la escena
   (`window.composeAdOverlay` en `pro-card.js`): scrims arriba/abajo, **logo
   real integrado** arriba-izq, **título 2 colores**, cinta de subtítulo,
   **checklist con tildes verdes**, y **sello** (OFERTA + precio) abajo-derecha.
   Texto SIEMPRE perfecto en castellano AR. Overlay **adaptativo** al formato
   (usa `S=min(W,H)`; scrims más chicos en horizontal/cuadrado).
4. **Tamaño EXACTO por red** (`window.formatForPlatform`): IG/FB 1080x1350,
   WA/TK 1080x1920, LinkedIn 1080x1080, X/YT 16:9. No corta el diseño: rellena
   los bordes con copia desenfocada.

**Por qué el híbrido:** gpt-image-1 escribe MAL el texto chico (gibberish). Al
dibujar el texto por código se resolvió de raíz. Verificado con **render local**
(Chromium headless + playwright-core) antes de cada deploy — así dejé de iterar
a ciegas en la parte de layout/texto/logo.

**Logo:** el PNG real vino 1024x1536 con mucho transparente; se **recortó** a
883x283 (`lib/brand-logo.js` base64 + `/logo-uniproveedores.png` estático).

**El botón "🏆 Cartel Pro" (canvas puro) se SACÓ** por pedido del cliente
(la función `genPro` quedó como código muerto inofensivo).

## 🎬 VIDEO (Google Veo) — botón "🎬 Video"
- Anima el cartel ya generado (imagen→video, ~8s) con **Google Veo**, misma
  clave `GEMINI_API_KEY`.
- Integrado DENTRO de `api/image.js` (`action=video-start` | `video-poll`) para
  no pasar el límite de **12 funciones serverless** de Vercel (quedan 11).
- **Asíncrono**: start devuelve `operation`; el front hace polling cada 10s
  (`genVideo` en `social.html`) hasta que termina, baja el mp4 server-side y lo
  muestra con descarga. Formato 9:16 (o 16:9 en YT/X).
- El modelo se elige probando una lista (`VEO_MODELS`: veo-3.1-generate-preview,
  veo-3.1-fast, veo-3.0-…, veo-2.0-…) porque el id exacto varía; `veo-3.0-
  generate-001` daba "model not found".
- **Costo por segundo** en la cuenta de Google (avisado en un confirm antes de
  generar). Necesita facturación activa de Google (ya la tiene).

## Higgsfield (aclaración importante)
- El cliente pagó **Plus US$49/mes (905 créditos) en higgsfield.ai (web)**.
- El **conector Higgsfield del chat (MCP) es OTRA cuenta, gratis (4 créditos)** →
  por eso desde el chat daba "minimum_basic_plan_required". Web y MCP NO comparten
  créditos.
- **El panel NO usa Higgsfield**: usa Google Veo. La cuenta Plus web le sirve al
  cliente para hacer videos manualmente en higgsfield.ai si quiere.

## ✍️ COPY de venta (`api/generate.js`) — HECHO (2026-08-01)
- Genera el texto por red con **Gemini** (`gemini-2.5-flash`). Mejora aplicada:
  - **HOOK** siempre en la 1ª línea (frase que frena el scroll).
  - **Hashtags optimizados por red** (`tips`): IG 8-12, FB 3-5, X 2-3, LinkedIn
    3-4 pro, TikTok 4-6 virales (#fyp/#parati), YouTube #Shorts, **WhatsApp sin
    hashtags**.
  - El **link de Mercado Libre se incluye EXACTO** (no se cambia ni acorta), con
    CTA "Comprá acá 👉". Castellano de Argentina.

## ⚠️ VIDEO Veo — tope de gasto de Google (2026-08-01)
- Si el video tira **"Your project has exceeded its monthly spending cap"**, NO
  es bug: es el **spend cap mensual del proyecto de Google**. Se sube en
  **AI Studio → https://ai.studio/spend**. Veo cuesta ~US$1-3 por clip de ~8s.

## Pendientes / próximos pasos
- **Publicar/Programar en TODAS las redes**: recomendado usar un publicador
  open-source self-hosted (**Mixpost** o **Postiz**) en el VPS; el panel manda
  imagen+video+copy y desde ahí se programa. No implementado.
- Veo: si se quiere 10s reales (Veo da ~8s), evaluar extender el clip.
---

## Qué tiene que hacer (pedido del cliente)
- Partir de la **foto real** del producto y armar un **cartel publicitario**
  (estilo ChatGPT), NO una foto "limpia" de estudio.
- **Respetar el producto** de la foto (misma forma, color, marca) — que la IA
  NO lo invente ni le pegue texto falso encima.
- **Formato por cada red social** (cuadrado / horizontal / vertical).
- **Siempre** con el **logo UNIPROVEEDORES** y los **colores de marca**
  (verde manzana #C6DE00, blanco, gris, negro).
- Destacar **3 virtudes** del producto como texto.

## Cómo está implementado (PR #46, branch claude/sales-agency-setup-GuexB)
Pipeline en 2 pasos dentro de `api/image.js`:
1. **Gemini texto** (`gemini-2.5-flash`) mira la foto real y devuelve JSON
   `{product, virtues[3]}` con 3 virtudes cortas del producto.
2. **Motor de imagen** arma el cartel con el producto real + logo + colores +
   las 3 virtudes:
   - Si hay `OPENAI_API_KEY` → **gpt-image-1** (motor de ChatGPT), endpoint
     `/v1/images/edits`, **edita** la foto real (multipart), `quality: medium`.
     Es el bueno: respeta el producto y escribe bien el texto/logo.
   - Si no hay clave → **Gemini** `gemini-2.5-flash-image` (respaldo). Este es
     el que fallaba: inventa producto y texto basura ("8K ULTRA HD").
   - Sin foto → `imagen-4.0-fast-generate-001` (texto→imagen).

Formatos (`openaiSize` / `geminiAr`):
- ig, wa → 1024x1024 (1:1)
- fb, yt → 1536x1024 (16:9)
- tk → 1024x1536 (9:16 vertical)

La respuesta trae `engine` ('gpt-image-1' | 'gemini'); el front muestra
"(ChatGPT)" en el aviso cuando usó el motor bueno.
`export const config = { maxDuration: 60 }` para el tiempo de gpt-image-1.

## ⚠️ PENDIENTE del cliente para activar ChatGPT
Cargar la clave de OpenAI en Vercel (si no, cae a Gemini que da mal resultado):
1. platform.openai.com → API keys → crear `sk-...` (necesita saldo en Billing;
   ~US$0.04–0.08 por imagen en calidad media).
2. Vercel → proyecto socialflow → Settings → Environment Variables →
   `OPENAI_API_KEY = sk-...` (marcar Production).
3. Redeploy.
> Nunca pegar la clave en el chat; se carga directo en Vercel.

## Cómo probar
Panel → subir foto del producto → elegir red → **🎨 Imagen IA**. Si el aviso
dice "(ChatGPT)" está usando gpt-image-1. Comparar contra la referencia de
ChatGPT del mismo producto.

## Historial del problema
- 1ª versión (imagen 4 texto→imagen): inventaba el producto entero. Mal.
- 2ª (gemini-2.5-flash-image "mantener idéntico, sin texto"): seguía metiendo
  badges/precios falsos y no ponía el logo. Mal.
- 3ª (gemini con prompt de escena cinematográfica): seguía inventando producto
  y texto ("8K ULTRA HD PIXELES", "OFERTA", "$2560"). Mal.
- 4ª (ACTUAL): 2 pasos + gpt-image-1 editando la foto real. A la espera de que
  el cliente cargue `OPENAI_API_KEY` y valide el resultado.

## Estado 2026-07-15 (funcionando en producción)
- Motor **gpt-image-1** activo (OPENAI_API_KEY cargada en Vercel Production).
- **Logo real** de UNIPROVEEDORES incrustado en `lib/brand-logo.js` (PNG base64,
  256 KB, subido por el cliente a Drive). Se pasa a gpt-image-1 como 2ª imagen
  (`image[]`) para copiarlo exacto arriba a la izquierda.
- Colores oficiales (#A4D72B verde manzana, #9AA0A6 gris, #0D0D0D negro, blanco).
- 3 virtudes del producto siempre.
- El panel muestra el motor usado (🟢 ChatGPT / 🟡 Gemini) y badge de versión
  "Cartel IA v3" en el header (para descartar caché del navegador).
- Diagnóstico clave que costó tiempo: el cliente probaba con la **página vieja
  en caché** (texto de carga viejo) tras cada deploy → usar `?v=algo` o
  Ctrl+Shift+R.
- **Animación de video (10s)**: pedida por el cliente; DEFERIDA por decisión de
  él ("sigamos solo con foto por el momento"). Opciones evaluadas: Google Veo
  (video, ~8s extendible), Higgsfield/HeyGen (imagen→video, ya conectados).
  Idea: botón "🎬 Animar 10s" que convierte el cartel en clip para Reels/Shorts.

## Próximo paso
Cuando el cliente cargue la clave y pruebe: ajustar el prompt de `buildAdPrompt`
si hace falta (balance de fondo, posición del logo, tamaño de las virtudes) para
el rubro ferretería. Ver conversación: el producto de prueba era un adaptador de
viaje universal.
