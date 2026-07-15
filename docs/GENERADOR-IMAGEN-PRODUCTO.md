# Generador de imagen del producto (cartel publicitario)

Memoria del estado del generador de imágenes del panel (`social.html` → botón
**🎨 Imagen IA** → `api/image.js`). Última actualización: 2026-07-08.

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
