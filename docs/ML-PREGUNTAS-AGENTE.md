# 🤖 Agente IA de Preguntas de Mercado Libre — Uniproveedores

> Auto-respondedor de las **preguntas de las publicaciones de Mercado Libre**, con IA,
> multi-cuenta, orientado a **cerrar la venta**. Hermano del bot de WhatsApp (mismo patrón).
> Estado: **CONSTRUIDO — cuentas cargadas** (falta test + webhook).

## 📌 Estado al 1-ago-2026 (retomar acá el lunes)
- ✅ Código del agente desplegado en producción (endpoint `/api/ml/questions`, cerebro Gemini, multi-cuenta, cross-account, idempotente).
- ✅ Panel `conexiones.html` con exportador + **verificador** de `ML_ACCOUNTS` (avisa si los tokens tienen puntitos/placeholder).
- ✅ Variable **`ML_ACCOUNTS`** cargada en Vercel (Sensible, Production + Preview) con las **2 cuentas**:
  - `full`  → user_id **80460157** (Envíos Full, sin retiro local)
  - `local` → user_id **46539072** (envío normal + retiro por local)
  - El verificador dio **✅ TODO OK** para ambas (client_id, client_secret, refresh_token, user_id reales).
- ✅ Redeploy hecho por el cliente.
- ⏳ **PENDIENTE (lunes):** correr los tests (Paso 2) — no se pudo desde acá por el proxy de red (403); probar desde el navegador/panel o pedirle al cliente. Después activar el **webhook** (Paso 3) y **entrenar el estilo** con el listado de Q&A por cuenta (Paso 4).

Ambas cuentas usan la MISMA app de ML (client_id `5731065254303938`, "Uniproveedores MCP"); redirect `https://socialflow-flax.vercel.app/ml-callback`.


## 🎯 Objetivo
Responder cada pregunta de ML en **< 30 segundos**, con coherencia, en tono de
**empleado joven principiante pero con muchas ganas de ayudar**, para cerrar la venta.

## ✅ Requisitos (definidos con el cliente)
1. **Responde desde las publicaciones de Mercado Libre** (API de Preguntas/Respuestas).
2. **< 30 segundos** de latencia → vía **notificaciones/webhooks de ML** (no polling lento).
3. **Multi-cuenta:** opera en las **2 cuentas**:
   - Cuenta A: **Envíos Full**.
   - Cuenta B: **Envío normal + retiro por el local**.
4. **Corre en el VPS** (junto al bot de WhatsApp) — 24/7.
5. **Autoresponde**, pero **UNA sola respuesta por pregunta** (nunca repite; ML de por sí
   permite responder una vez, pero además llevamos registro para no doble-postear).
6. **Lee la publicación** (item) para responder con datos reales.
7. **Sabe contestar para cerrar venta:**
   - Variantes (color / medida / modelo).
   - **Stock** (en Full y en local).
   - **Medidas / atributos** del producto.
   - **Retiro por el local** (cuando la cuenta lo permite).
   - Envío (Full vs normal).
   - Precio y cuotas.

## 📏 Reglas de negocio del agente
- **Precio local = precio ML** (vendemos igual en el local que en Mercado Libre).
- Si preguntan **"precio por fuera de ML"** → responder que **sale igual** + dar **horarios**
  del local. **NUNCA** ofrecer vender por fuera (política ML → riesgo de baneo).
- Si en la cuenta **Full no hay retiro por local** → la IA **busca el MISMO producto en la
  otra cuenta** (la de retiro) y le pasa esa opción/link al cliente.
- **Horarios del local:** Lun–Vie 9:30–13:00 y 14:00–18:30 · Sáb 9:30–13:00 · Dom cerrado.
- **Dirección:** Bacacay 4726, CABA. **WhatsApp:** 011 3551-0715.
- Tono: joven, cercano, humilde, con ganas ("¡Hola! Sí, te cuento…"). Cerrar siempre con un
  empujón a la compra ("¡Cualquier cosa avisame y lo despachamos enseguida!").
- **Cumplimiento ML:** sin pedir datos de contacto, sin ofrecer venta externa, sin precios fuera de ML.

## 🏗️ Arquitectura (reusa lo del bot WhatsApp)
1. **Webhook ML** (`/api/ml/questions-webhook` o servicio en VPS): ML notifica topic
   `questions` → llega `resource` (`/questions/{id}`) + `user_id` (para saber la cuenta).
2. **Multi-cuenta:** tokens de las 2 cuentas guardados **en el servidor** (VPS), con refresh
   automático (ya existe `api/ml/refresh` / `exchange.js`). Mapa `user_id → cuenta`.
3. **Contexto:** `GET /questions/{id}` → item_id + texto. `GET /items/{item_id}` →
   atributos/medidas, variations, price, available_quantity, shipping.logistic_type
   (fulfillment=Full / me2=normal). Opcional descripción.
4. **Cerebro IA (Gemini):** arma la respuesta con el contexto + reglas + tono. (Igual patrón
   que `lib/wa/ia-guide.js` / `brain.js`.)
5. **Cross-account:** si aplica (Full sin retiro y preguntan retiro), buscar mismo producto en
   la cuenta B (`/users/{B}/items/search` + match por título/SKU) → sugerir esa publicación.
6. **Responder:** `POST /answers` `{question_id, text}` con el token de la cuenta correcta.
7. **Anti-repetición:** registrar `question_id` respondidas (persistencia como el WA bridge).

## 🧠 Aprendizaje (mejora continua)
- El cliente entrega, **por cada cuenta**, un **listado de preguntas + las respuestas que dan
  hoy** → se usa como base de conocimiento / few-shot para que la IA imite el estilo y lo
  **mejore para cerrar venta** (guía tipo `ia-guide.js`).

## 🔌 Estado actual del repo (base para construir)
- OAuth ML: `api/ml/exchange.js`, refresh en `conexiones.html` / `api/ml/refresh`.
- API ML usada: `api/ml/envios-flex.js` (orders/shipments), `publish.js`, `category.js`.
- Tokens hoy: en **localStorage del navegador** (1 cuenta). → **Falta:** guardar 2 cuentas en el VPS.
- Patrón "IA responde": `lib/wa/brain.js`, `ia-guide.js`, `business-config.js`, `bridge/wa-bridge.mjs`.

## 📋 Plan de construcción (por fases)
- **Fase 0 (ya):** este diseño + reglas + tono.
- **Fase 1 (lunes, con tokens):** conectar las 2 cuentas en el server + leer preguntas sin responder.
- **Fase 2:** cerebro IA (contexto item + reglas + tono) → generar respuesta (modo prueba/log).
- **Fase 3:** webhook ML para < 30s + auto-responder con anti-repetición.
- **Fase 4:** cross-account (buscar producto en la otra cuenta) + ingestar el listado de Q&A del cliente.
- **Fase 5:** tuning con casos reales.

## ⏳ FALTA (del cliente)
- **Lunes:** tokens/OAuth de **las 2 cuentas** de Mercado Libre.
- **Listado por cuenta** de preguntas frecuentes + respuestas actuales (para entrenar el estilo).

## 🔌 CÓMO CONECTAR (lunes) — todo el código ya está listo
Código ya escrito y probado (sintaxis): `api/ml/questions.js` + `lib/ml/qa-config.js`,
`lib/ml/ml-api.js`, `lib/ml/qa-brain.js`. Corre como **función de Vercel** (webhook <30s).

**Paso 1 — Cargar las 2 cuentas** en Vercel → Settings → Environment Variables →
variable **`ML_ACCOUNTS`** con este JSON (en una línea):
```json
[{"label":"full","mode":"full","user_id":123456,"client_id":"...","client_secret":"...","refresh_token":"..."},{"label":"local","mode":"local","user_id":789012,"client_id":"...","client_secret":"...","refresh_token":"..."}]
```
- `refresh_token`, `client_id`, `client_secret`, `user_id` salen del OAuth de cada cuenta
  (el flujo que ya existe en `/conexiones`). `GEMINI_API_KEY` ya está.
- Redeploy.

**Paso 2 — Probar (sin webhook todavía):**
- `POST /api/ml/questions?action=test` → debe listar las 2 cuentas.
- `POST /api/ml/questions?action=unanswered` body `{"account":"full"}` → preguntas sin responder.
- `POST /api/ml/questions?action=answer` body `{"account":"full","question_id":123,"autopost":false}`
  → genera la respuesta SIN postear (para revisar el tono). Con `"autopost":true` la publica.

**Paso 3 — Activar el <30s (webhook de ML):**
- En la app de ML (DevCenter) → Notificaciones → **URL de callback:**
  `https://socialflow-flax.vercel.app/api/ml/questions` → topic **`questions`**.
- Listo: cada pregunta nueva se responde sola. (El `middleware.js` ya deja pasar esa ruta
  sin la contraseña del sitio.)

**Paso 4 — Entrenar el estilo:** cargar el listado de Q&A del cliente en `qa-brain.js`
(few-shot) para afinar el cierre de venta.

> Nota técnica: en v1 el webhook procesa y responde 200 (unos segundos, dentro de los 30).
> La idempotencia está garantizada porque solo se responde si la pregunta sigue `UNANSWERED`
> (ML permite una sola respuesta). Para alto volumen, más adelante se puede pasar a cola/VPS.

## ⚠️ Nota de cumplimiento
Todo lo público en ML respeta las políticas: precio igual dentro/fuera, sin venta externa,
sin pedir contacto por afuera. El retiro por local se ofrece **vía Mercado Libre**.
</content>
