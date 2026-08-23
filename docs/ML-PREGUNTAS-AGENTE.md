# 🤖 Agente IA de Preguntas de Mercado Libre — Uniproveedores

> Auto-respondedor de las **preguntas de las publicaciones de Mercado Libre**, con IA,
> multi-cuenta, orientado a **cerrar la venta**. Hermano del bot de WhatsApp (mismo patrón).
> Estado: **EN VIVO — "Tatiana" 100% automática** (webhook activo, probado con pregunta real).

## 📈 Control de conversión (preguntas → ventas, por SKU)

`GET/POST /api/ml/questions?action=conversion&dias=30&limit=100` · botón
**"📈 Control de conversión (Excel)"** en `/conexiones`.

Cruza **cada pregunta con las ventas del período** para responder lo único que importa:
*¿esta pregunta terminó en venta?* Y agrupa por SKU para decir **qué le falta a cada publicación**.

**Cómo decide si convirtió:** el que preguntó (`from.id`) compró **ese mismo ítem** después de
haber preguntado (`/orders/search` cruzado por comprador + item + fecha).
- `convirtio` → preguntó y compró ese producto.
- `compro_otro` → preguntó por uno y se llevó otro (cross-sell).
- `post_venta` → ya lo había comprado ANTES de preguntar (típico "¿cuándo llega?").
  **No cuenta como conversión perdida** y sale del denominador de la tasa.

**Qué le pregunta la gente** (`lib/ml/conversion.js`, una pregunta puede tener varias):
medidas · cantidad/por mayor · retiro por el local · compatibilidad · material · color · stock ·
envío · precio/cuotas · factura · garantía · pregunta por otro artículo.

**Qué devuelve por SKU:** `convierte SÍ/NO`, preguntas, convertidas, tasa, `post_venta`,
`sin_responder`, **cantidad de fotos**, precio, ventas y monto del período, y una lista de
**recomendaciones concretas**. La regla que pidió el cliente:

> Si la publicación tuvo preguntas y **ninguna terminó en venta** → `❌ SIN CONVERSIÓN — VER FOTOS`,
> y si además tiene menos de 5 fotos lo dice con el número exacto.

Además marca la demanda que no se está capturando: si preguntan por mayor → sugiere armar packs;
si preguntan medidas → cargarlas en la ficha y en una foto; etc.

**Salida:** el botón baja **2 CSV** (se abren en Excel):
- `conversion-por-sku.csv` — una fila por publicación, ordenada **peor primero** (las que tienen
  preguntas y cero ventas arriba de todo), con la columna `que_corregir`.
- `conversion-detalle.csv` — una fila por pregunta, con su respuesta, los motivos detectados y si
  convirtió.

⚠️ **Plan Hobby:** la función corta a los 10 s y esto pega varias veces a la API de ML (preguntas +
órdenes paginadas + multiget de publicaciones). Si da timeout, bajá la ventana: `&dias=7`, o pedí
una cuenta sola con `&account=full`.

---
## 🔎 22-ago-2026, 15:48 UTC — PRIMER DIAGNÓSTICO REAL EN PRODUCCIÓN

Con el fix ya desplegado (PR #113), el `?action=diag` en producción devolvió:

| Chequeo | Resultado |
|---|---|
| Cuentas cargadas | **2** (`full` 80460157 · `local` 46539072) |
| Token de las 2 cuentas | **OK** — refresca bien, `user_id` coincide con el del token |
| Nicknames | UNIPROVEEDORES / ARBETTER_BY_UNIPROVEEDORES |
| `GEMINI_API_KEY` | OK |
| `ML_AUTOANSWER` | on |
| Guardado de tokens | **memoria** (falta el KV) |
| Preguntas sin responder | `full`: 1 (¡del **29-may**!) · `local`: 0 |
| Último webhook de ML | **topic `payments`**, mismo segundo del diag |

**Lo que esto corrige de la hipótesis anterior:**
- ❌ El `refresh_token` **NO estaba quemado**: las 2 cuentas renuevan token sin problema.
- ✅ La **callback URL sigue viva**: ML nos estaba pegando en ese mismo momento (llegó un
  aviso de `payments`), así que no la dieron de baja por los 500.

**Lo que quedó como sospecha principal:** el único webhook registrado era de **`payments`**.
Como `markWebhook` guardaba un solo registro, las notificaciones de pagos (que son muchísimas)
**pisaban** el dato y nunca se veía si llegaba alguna de `questions`. No se puede afirmar que
el topic `questions` esté caído, pero tampoco descartarlo.

Además, las últimas respuestas de las 2 cuentas **no llevaban la firma de Tatiana**
("Solo lo publicado...", ". Cualquier cosa que necesites..."), lo que apunta a que las
preguntas las está contestando **una persona a mano** y por eso `sin_responder` queda en 0.

**Cambios de este segundo pase (para cerrar la duda):**
1. `markWebhook` ahora guarda el último aviso **de cada topic** por separado → el diag muestra
   **`ultimo_webhook_de_preguntas`**. Si llegan avisos de `payments` pero nunca de `questions`,
   el diagnóstico lo marca con ❌ y apunta directo a DevCenter.
2. El diag cuenta **cuántas de las últimas 20 respuestas llevan la firma de Tatiana**. Si son 0,
   avisa que las está contestando una persona y que el bot no está entrando.
3. El diag consulta las 2 cuentas **en paralelo** (el plan es Hobby: la función corta a los 10s).

> ⚠️ Ojo: los dos registros de webhook **solo sirven con el KV configurado**. En memoria se
> pierden en cada arranque en frío, y ahí el diag no puede probar nada. El KV sigue siendo el
> paso 1.

---
## 🚨 22-ago-2026 — POR QUÉ DEJÓ DE RESPONDER (resuelto)

**Síntoma:** las preguntas de Mercado Libre quedaban sin responder.

**Causa raíz:** el `refresh_token` de Mercado Libre es **de un solo uso**. Cada vez que se
renueva el token, ML devuelve un `refresh_token` NUEVO e **invalida el anterior**. El agente
leía las cuentas de la variable de entorno `ML_ACCOUNTS` (que no se puede reescribir sola) y
**tiraba a la basura** el token nuevo → a partir de la 2ª renovación, ML contestaba
`invalid_grant` y el agente no podía ni leer la pregunta.

Encima, el webhook renovaba el token **dos veces por pregunta** (una en el handler y otra
dentro de `answerFlow`), así que se rompía en la PRIMERA pregunta después de la primera
renovación. Reproducido en un test con la API de ML simulada: 2 webhooks → 3 renovaciones →
los 2 devolvían **HTTP 500**.

Agravantes que lo hacían invisible y difícil de recuperar:
- **El 500 apagaba el webhook:** ML reintenta y, si el callback sigue fallando, deja de
  notificar. Por eso no volvía solo aunque se arreglara el token.
- **El conector MCP (#102, 12-ago) quema el mismo token:** `mcp-ml/server.mjs` renovaba con la
  misma copia de `ML_ACCOUNTS`, así que cada consulta desde Claude Code **invalidaba** el token
  de producción.
- **Los rechazos de ML pasaban en silencio:** `postAnswer` no miraba el status HTTP. Si ML
  rechazaba la respuesta (p. ej. por el link del catálogo), desde afuera parecía respondida.

**Arreglos (este cambio):**
1. `lib/ml/token-store.js` — guarda el `refresh_token` rotado + cachea el `access_token`
   (dura ~6 hs). Con `KV_REST_API_URL` + `KV_REST_API_TOKEN` (Vercel KV / Upstash) queda
   **persistente**; sin eso, solo memoria (avisa en el diagnóstico).
2. `getAccessToken()` reemplaza a `refreshAccessToken()` en el webhook y en el MCP: 1 sola
   renovación cada 6 hs en vez de 2 por pregunta, y si el token guardado falla reintenta
   con el de `ML_ACCOUNTS`.
3. El webhook **siempre devuelve 200** (con `ok:false` + el error adentro y en los logs), para
   que ML no dé de baja el callback.
4. `postAnswer` devuelve `ok/error` → los rechazos de ML se ven en la respuesta y en los logs.
5. **`?action=diag`** — botón "🩺 ¿Por qué no responde?" en `/conexiones`: token de cada
   cuenta, si el `user_id` coincide, preguntas pendientes, última respuesta y **cuándo fue el
   último aviso de ML**.
6. **`?action=sweep`** — botón "🚀 Responder pendientes" + `bridge/ml-sweep.sh` para cron en el
   VPS: contesta lo que quedó pendiente aunque el webhook no entre. Red de seguridad.

### ✅ Qué hacer para dejarlo andando otra vez
1. **Reautorizar las 2 cuentas** en `/conexiones` (el `refresh_token` viejo ya está quemado) y
   pegar el `ML_ACCOUNTS` nuevo en Vercel + Redeploy.
2. **Configurar el KV** en Vercel (`KV_REST_API_URL` + `KV_REST_API_TOKEN`, de Vercel KV o
   Upstash). Sin esto el token rotado se pierde en cada arranque en frío y el problema vuelve.
   Las mismas variables van en `mcp-ml/.env` para que el conector MCP no queme el token.
3. Abrir **🩺 ¿Por qué no responde?** → tiene que decir `✅ Todo en orden`.
4. **Revisar el webhook en DevCenter** (se pudo haber dado de baja por los 500): callback
   `https://socialflow-flax.vercel.app/api/ml/questions`, topic `questions`.
5. Tocar **🚀 Responder pendientes** para ponerse al día con lo acumulado.
6. (Recomendado) Cron en el VPS cada 5 min: `bridge/ml-sweep.sh` — así, aunque el webhook se
   caiga de nuevo, nunca queda una pregunta sin responder más de 5 minutos.

---
## 📌 Estado al 4-ago-2026 (última sesión)
- ✅ **Webhook de ML ACTIVO** en la app "Uniproveedores MCP": callback `https://socialflow-flax.vercel.app/api/ml/questions`, topic **Questions** (dentro del grupo **Items**). Probado con pregunta real → Tatiana respondió sola. **Ya está en vivo en las 2 cuentas.**
- ✅ El endpoint responde 200 a GET (health) y a POST sin acción (ping de ML).
- ✅ Ajustes finales del cerebro:
  - **Por cantidad/mayor:** menciona mejor precio por mayor y dirige SOLO a "Ver más datos de este vendedor" (perfil), sin mail/teléfono (compatible ML).
  - **Repreguntas:** 1ª con saludo; 2ª y 3ª SIN saludo; **4ª pregunta → no responde** (humano). `buyerContext` (escalate + isFollowup).
- ✅ **Bot de WhatsApp desplegado en el VPS** (git pull + pm2 restart wa-bridge). Corre con Tatiana + redes + código de agenda (dormido). Arranque limpio: HUMANO label id=18, follow-up, recordatorio, heartbeat OK.

### 🔧 5-ago: bot de WhatsApp caído por `@lid` — RESUELTO
- WhatsApp migró la cuenta al formato de ID `@lid`. `msg.getChat()` fallaba ("no se pudo abrir el chat") y tumbaba `handleIncoming` → el bot no respondía (el equipo contestaba a mano, silenciando todo 180min).
- **Fix:** se sacó `msg.getChat()` del camino de respuesta (grupos por sufijo `@g.us`). Confirmado en vivo: el bot recibe, procesa Y responde a chats `@lid` (`<- ...`). Enviar a `@lid` funciona OK.
- **Auto-deploy activado:** `bridge/auto-deploy.sh` + cron cada 2min → los cambios en main entran solos, sin entrar al servidor.
- Menor pendiente: `markChatForHuman`/etiquetas y `notifySupervisor` aún usan `getChat`/`@c.us` y fallan con `@lid` (están capturados, no rompen la respuesta). Se pueden blindar/actualizar librería más adelante.

### ⏳ PENDIENTE
1. **Google Contactos:** autorizar Google (OAuth client, scope contacts, ventas@uniproveedores.com.ar) → setear `GOOGLE_CONTACTS_CLIENT_ID/SECRET/REFRESH_TOKEN` + redeploy bridge.
2. **⚠️ Fix @lid:** WhatsApp ahora usa IDs `@lid` (no el teléfono). `bridge/wa-bridge.mjs` arma el phone con `from.split('@')[0]` → con `@lid` guardaría el LID, NO el teléfono real. Ajustar (resolver número real vía `client`/contacto) ANTES de activar la agenda.
3. **Vigilar** `aviso a supervisor fail: No LID` — si reaparece al marcar humano, arreglar `notifySupervisor` (resolver LID con `getNumberId`).
4. (Opcional) Bots de redes: Meta (IG+FB) primero, luego YouTube.

---
## 📌 Estado al 3-ago-2026

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
- ⚠️ Cargar también **`KV_REST_API_URL`** + **`KV_REST_API_TOKEN`** (Vercel KV o Upstash): ML
  rota el `refresh_token` en cada renovación y ahí es donde se guarda el nuevo. Sin eso, el
  agente se cae solo a las pocas horas (ver el bloque del 22-ago).
- Opcionales: `ML_AUTOANSWER=off` pausa el auto-respondido · `ML_SWEEP_KEY` protege el barrido
  por GET (para el cron del VPS).
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
