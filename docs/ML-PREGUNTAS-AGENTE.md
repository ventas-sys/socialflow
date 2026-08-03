# 🤖 Agente IA de Preguntas de Mercado Libre — Uniproveedores

> Auto-respondedor de las **preguntas de las publicaciones de Mercado Libre**, con IA,
> multi-cuenta, orientado a **cerrar la venta**. Hermano del bot de WhatsApp (mismo patrón).
> Estado: **FUNCIONANDO — "Tatiana"** (probado en manual; falta activar webhook).

## 📌 Estado al 3-ago-2026 (retomar acá mañana)
- ✅ Agente **"Tatiana"** desplegado y probado en MANUAL en las 2 cuentas (botón "Probar respuesta" en el panel). Responde bien.
- ✅ `ML_ACCOUNTS` cargada y verificada en Vercel: `full` (80460157) y `local` (46539072). Misma app `5731065254303938` ("Uniproveedores MCP"), redirect `.../ml-callback`.
- ✅ Reglas del cerebro (`qa-brain.js` + `questions.js`) ya implementadas:
  - Nombre **Tatiana**, firma "Uniproveedores". Saludo según hora AR (mañana/tarde/noche, siempre alentando a estar feliz).
  - Respuestas de **250 caracteres**, en **un solo renglón** (ML no permite saltos de línea), separadas con "...".
  - Horarios de retiro: **L-V 14 a 17:30, Sáb 10 a 13**. Retiro SOLO en cuenta LOCAL.
  - **Cross-account:** en FULL, si preguntan retiro/ubicación ("dónde están", etc.) pasa el link del mismo producto en LOCAL; si no lo encuentra, pasa el link del **catálogo LOCAL filtrado** (`listado.mercadolibre.com.ar/<palabra>_CustId_46539072`).
  - **Otro producto:** busca en el catálogo de la cuenta + propone **armar carrito** (envío único).
  - **Medidas/detalles:** invita a mirar la **3ª foto**.
  - **Color:** si no hay variante de color → "el color es indiferente al uso" (evita devoluciones). Si hay → elegir variante.
  - **Variantes:** se eligen "abajo del precio" en la publicación.
  - **Pedido ya hecho:** no se cambia ni agrega nada; cancelar y rearmar (sin carrito).
  - **Factura A/B**; precio "por fuera" = sale igual.
  - **Anti-loop:** si el mismo comprador repite o pregunta +3 veces → NO responde, lo atiende un humano (1h mín). `shouldEscalate` + `getItemQuestions`.
- ✅ **Interruptor de seguridad:** en Vercel, `ML_AUTOANSWER=off` pausa el auto-respondido al instante (default: on).
- ✅ **Registro a Excel:** botón "📊 Descargar registro (Excel)" en el panel → CSV con Q&A de las 2 cuentas (acción `log`).
- ⏳ **PENDIENTE (mañana):** activar el **WEBHOOK** en DevCenter (Notificaciones callback URL `https://socialflow-flax.vercel.app/api/ml/questions` + topic `questions`). El cliente lo estaba configurando (ojo: el campo mostraba `mercadoshops.com.ar` por defecto — confirmar que sea la app "Uniproveedores MCP"). Después: prueba real (preguntar y ver que responde sola en <30s).

## 🌐 Roadmap bots de redes (consultado el 3-ago)
Reusando el mismo cerebro "Tatiana", conexión (OAuth+webhook) por red:
- ✅ Factibles: **Instagram + Facebook** (una sola app de Meta cubre las dos, DMs y comentarios) y **YouTube** (comentarios, API de Google).
- ⚠️ **X/Twitter**: factible pero API PAGA (~USD 100/mes).
- ❌ **TikTok** y **LinkedIn**: sin API pública abierta para auto-responder (por ahora no).
- Recomendación: arrancar por **Meta (IG+FB)**, luego **YouTube**.

## 📲 WhatsApp (bot ya vivo, VPS) — cambios del 3-ago
- Recordatorio post-contacto: premio del video corregido a **$15.000** + bloque con **todas las redes** (links completos) — `lib/wa/business-config.js` (`REDES`, `REDES_TEXTO`).
- Persona del bot pasada a **"Tatiana"** (femenino), se presenta como Tatiana si le preguntan — `lib/wa/ia-guide.js`.
- ⚠️ Estos cambios están en el repo/main; falta **desplegar en el VPS** (`cd /opt/socialflow && git pull origin main && pm2 restart wa-bridge`).
- A confirmar: URLs exactas de **Facebook** y **X** (se usaron los handles estándar).

### 📇 Agenda en Google Contactos (nuevo, código listo — falta autorizar Google)
- El bot agenda a quien escribe, auto-clasificado: **Cliente NN**, **Nombre x Mayor NN** (con CUIT + qué compra en notas), **Nombre - Proveedor NN (atendido)**. Grupos/etiquetas por categoría + número secuencial. Idempotente por teléfono. Si no dio el nombre → guarda con el número.
- Cuenta destino: **ventas@uniproveedores.com.ar**. Clasifica la IA (`lib/wa/ia-guide.js` → `contacto`); agenda `lib/google/contacts.js` (People API, sin deps); dispara el bridge fire-and-forget.
- **PENDIENTE (mañana):** autorizar Google (OAuth client en Google Cloud con scope `contacts` para ventas@uniproveedores.com.ar) → setear `GOOGLE_CONTACTS_CLIENT_ID`, `GOOGLE_CONTACTS_CLIENT_SECRET`, `GOOGLE_CONTACTS_REFRESH_TOKEN` + redeploy del bridge. Sin esas vars, no hace nada (bot sigue igual). Opción: armar botón "Autorizar Google Contactos" en el panel (como ML).


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
