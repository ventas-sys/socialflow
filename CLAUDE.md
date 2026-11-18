# SocialFlow — notas para Claude

App en Vercel (socialflow-flax.vercel.app). Front estático (`social.html`) + funciones en `api/`.

## Modelos de IA (revisar cuando algo diga "does not exist" / "no longer available")
Todo en `api/image.js` (un solo endpoint para no pasar el límite de funciones de Vercel).

- **Imagen (cartel)**: OpenAI `/v1/images/edits`. `gpt-image-1` se apagó el 23/10/2026.
  Se prueban en orden `gpt-image-2.5-flare`, `gpt-image-2.5-sunburst`, `gpt-image-2`
  (`OPENAI_IMAGE_MODELS`); se puede forzar con la env `OPENAI_IMAGE_MODEL`.
  Si OpenAI falla, respaldo con Gemini `gemini-2.5-flash-image`.
- **Video**: Veo 3.1 Preview se apagó el 22/10/2026. Ahora `gemini-omni-1.1-flash` vía
  Interactions API (`POST /v1beta/interactions`, `background: true`, headers
  `x-goog-api-key` + `Api-Revision: 2026-05-20`; poll `GET /v1beta/interactions/{id}`,
  video en `steps` como bloque `{type:'video', data|uri}`). Respaldo: Veo GA (`VEO_MODELS`).
  El front usa `action: 'video-start'` / `'video-poll'` con `operation` = `interactions/<id>`.
- **Texto/brief**: Gemini (`lib/gemini-texto.js`), keys en `lib/gemini-keys.js`
  (imagen/video usan la key de MEDIA para no afectar los bots de ML/WhatsApp).

Al migrar un modelo: confirmar el reemplazo en las páginas oficiales de deprecaciones
(developers.openai.com/api/docs/deprecations, ai.google.dev/gemini-api/docs/deprecations)
y dejar respaldo automático en vez de cortar con error.
