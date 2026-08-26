# 🤖 Agente IA de Preguntas de Mercado Libre — Uniproveedores

> Auto-respondedor de las **preguntas de las publicaciones de Mercado Libre**, con IA,
> multi-cuenta, orientado a **cerrar la venta**. Hermano del bot de WhatsApp (mismo patrón).
> Estado: **EN VIVO — "Tatiana" 100% automática** (webhook activo, probado con pregunta real).

## 🔑 Keys de Gemini separadas: que el contenido no calle a los bots

Después del incidente del 24/8, el repo dejó de usar **una sola** `GEMINI_API_KEY`
(ver `lib/gemini-keys.js`):

| Variable | La usan | Costo |
|---|---|---|
| **`GEMINI_API_KEY_TEXTO`** | Tatiana (`lib/ml/qa-brain.js`), bot de WhatsApp (`lib/wa/ia-guide.js`, `api/wa/webhook.js`), copys de redes (`api/generate.js`), `api/agent.js`, `api/contabilium.js` | centavos |
| **`GEMINI_API_KEY_MEDIA`** | Imágenes y video (`api/image.js`: `imagen-4.0`, `gemini-2.5-flash-image`, Veo) | **caro** |
| `GEMINI_API_KEY` | Respaldo de las dos, para no romper nada | — |

**Nada se rompe si no se configuran las nuevas:** las dos funciones caen a
`GEMINI_API_KEY` y todo sigue como antes. La separación se activa recién cuando se cargan
`GEMINI_API_KEY_TEXTO` y `GEMINI_API_KEY_MEDIA` (dos proyectos distintos de AI Studio, cada
uno con su propio tope de gasto).

Con eso, quemar el presupuesto generando contenido para las redes **ya no puede dejar sin
atención a los clientes de Mercado Libre y WhatsApp**. El diag muestra en
`keys_de_gemini` si están separadas o si siguen compartiendo, y lo avisa mientras compartan.

---
## 🔴 24-ago-2026 — LA CAUSA REAL: se acabó el crédito de Gemini

El `?action=sweep` en producción devolvió el error exacto, en las 3 preguntas pendientes
de las 2 cuentas:

```
"error": "IA sin respuesta: {"error":{"code":429,"message":"Your project has exceeded
its monthly spending cap. Please go to AI Studio at https://ai.studio/spend to manage
your project spend cap."}}"
```

**El proyecto de Google AI Studio llegó al tope de gasto mensual.** Gemini devuelve 429 y
Tatiana no puede redactar NINGUNA respuesta. Todo lo demás estaba bien: tokens OK, cuentas OK,
webhook llegando, `ML_AUTOANSWER=on`.

### Por qué tardamos tanto en verlo
1. El diag decía **`gemini: "OK"`** cuando en realidad solo miraba si **existía** la variable
   `GEMINI_API_KEY` — nunca probaba que Gemini contestara. **Corregido:** ahora el diag hace una
   llamada real y mínima (`probarIA()` en `qa-brain.js`) y muestra el error de Gemini tal cual.
2. El error moría en `console.error` y los logs de Vercel no eran accesibles. **Corregido** en el
   commit anterior: cada webhook de `questions` deja registrado qué pasó (`que_paso_con_esa_pregunta`).

### ⚠️ La misma API key la usan endpoints MUCHO más caros
`GEMINI_API_KEY` es compartida por todo el repo:

| Endpoint | Modelo | Costo |
|---|---|---|
| `api/ml/questions.js` (Tatiana) | `gemini-2.5-flash` (texto) | centavos |
| `api/wa/webhook.js`, `api/agent.js`, `api/generate.js` | `gemini-2.5-flash` (texto) | centavos |
| **`api/image.js`** | **`gemini-2.5-flash-image`, `imagen-4.0-fast`, Veo (video)** | **caro** |

Generar imágenes y videos para las redes es lo que consume el presupuesto, y cuando se agota
**se lleva puesto al agente de preguntas**, que gasta monedas. Conviene:
- Subir o sacar el tope en https://ai.studio/spend, y/o
- **Separar la key**: una `GEMINI_API_KEY` para texto (bot de ML y WhatsApp) y otra para
  imagen/video, así el contenido de redes no puede dejar muda a Tatiana.

---
## 🏷️ WhatsApp: la etiqueta HUMANO equivocada (y cómo limpiar lo marcado)

En la cuenta hay **dos etiquetas que dicen HUMANO**, del mismo color amarillo, y solo se
distinguen por el emoji:

```
"HUMANO ☹️" [U+2639 U+FE0F] → id=18   ← la que usaba el bot (el equipo NO la ve en Listas)
"HUMANO 🧐" [U+1F9D0]       → id=19   ← la que el equipo tiene
```

El bot marcaba con la 18. Desde la lista de chats se ve un punto amarillo igual, pero al abrir
"Selecciona una lista" **no hay nada tildado**: la lista que puso el punto no aparece en el menú.
O sea que la marca de "este chat necesita una persona" **no la veía nadie**.

- **Qué marca de ahora en más:** `pickHumanLabel()` elige por el **emoji**
  (`WA_HUMAN_LABEL_EMOJI`, default `🧐`). Para forzar un id puntual sigue estando
  `WA_HUMAN_LABEL_ID`.
- **Cómo limpiar lo ya marcado:** los chats marcados antes conservan la etiqueta vieja, y como
  no aparece en el menú **no se puede destildar a mano**. Para eso está `WA_LIMPIAR_HUMANO`:

  | Valor | Qué hace |
  |---|---|
  | `contar` | Recorre los chats y dice cuántos tienen la etiqueta vieja. **No toca nada.** |
  | `si` | Se la saca de verdad, conservando el resto de las etiquetas del chat. |

  Corre una sola vez al arranque, después de resolver la etiqueta. Los chats que ya tienen la
  etiqueta correcta no se tocan; los que tienen las dos quedan solo con la buena. Cuando
  termina, sacar la variable del `.env`.

> ⚠️ Los chats migrados a `@lid` pueden no dejarse leer (la librería no los abre): la limpieza
> los cuenta aparte y sigue con el resto.

---
## ⏳ WhatsApp: el hueco del silencio de 3 horas

Cuando alguien del equipo escribe a mano en un chat, el bot se calla **3 horas**
(`WA_HUMAN_TAKEOVER_HOURS`) para no hablarle encima. Es correcto, pero tenía un agujero:
si después el asesor se olvida del chat, **el cliente escribe y no le contesta nadie** — ni el
bot (silenciado) ni la persona.

Caso real del 24/8:

| Hora | Qué pasó |
|---|---|
| 11:41 | Cliente: *"Buenos dias"* → el bot contestó *"no te llegué a entender bien"* (Gemini sin crédito) |
| 11:57 | Alguien del equipo escribió a mano *"hola que paso?"* → **bot silenciado hasta las 14:57** |
| 14:21 | Cliente: *"Que saber si venden este producto"* → **silencio total** |

El bot no estaba roto: hacía exactamente lo que se le pidió. Pero se perdió una consulta de venta.

**Arreglo:** si llega un mensaje mientras el bot está en silencio y **el asesor no escribe hace
más de `WA_AVISO_SIN_ATENDER_MIN` minutos (20 por defecto)**, se le avisa al supervisor con el
teléfono, el motivo y el último mensaje. **El bot sigue sin hablar** — no se mete en la
conversación, solo levanta la mano.

Los 20 minutos evitan el ruido: si el asesor está charlando en vivo (respondió hace 5 min), no
avisa nada. Y `notifySupervisor` ya trae un tope de 1 aviso por chat cada 6 h.

> Requiere **`WA_SUPERVISOR_NUMBER`** en el `.env` del VPS. Sin esa variable, la función sale
> sin hacer nada y el agujero sigue abierto. El `+` y los espacios del número no molestan: se
> limpian antes de usarlo. El arranque del bridge ahora dice si los avisos están activos o no.

**El aviso ya no depende de `@c.us`.** `notifySupervisor` armaba el destino a mano como
`<numero>@c.us`, y con las cuentas migradas a `@lid` eso falla ("no se pudo abrir el chat" —
error que aparece en `wa-bridge-error.log`). Ahora resuelve el chat con `client.getNumberId()`,
que devuelve el ID que WhatsApp usa de verdad, lo cachea, y si falla vuelve al `@c.us` de antes.
Era el pendiente anotado el 5-ago ("vigilar `aviso a supervisor fail: No LID`"), y había que
resolverlo sí o sí: sin eso, el aviso nuevo se escribía en el vacío.

---
## 📲 El mismo cupo de Gemini dejó mal al bot de WhatsApp

El bot de WhatsApp (`lib/wa/ia-guide.js`, en el VPS) usa **la misma `GEMINI_API_KEY` y el mismo
`gemini-2.5-flash`**. Con el proyecto pasado de tope, Gemini devuelve 429, `data.candidates`
viene vacío y el bot caía siempre en la misma rama:

> "Uy, perdón, no te llegué a entender bien 🙈 ¿Me lo repetís de otra forma?"

O sea: **contestaba, pero eso mismo a todo el mundo**, y el cliente entraba en un loop (repite →
mismo mensaje). No se caía, se degradaba, que es peor porque no se nota.

**Arreglo:** si el que falló es la **API** (hay `data.error`: sin crédito, sin cupo, caída),
pedirle al cliente que repita no sirve — va a fallar igual. Ahora **deriva a un humano**:

> "Uy, disculpame, se me colgó el sistema un segundo 🙈 Ya le aviso a mi supervisor así te
> responde él. ¡Perdón!" · `needsHuman: true` → etiqueta HUMANO + aviso al supervisor.

Si en cambio Gemini contestó algo que no era JSON (error de formato, no de API), se mantiene el
"no te entendí", que ahí sí tiene sentido.

**Para confirmarlo en el VPS:**
```
pm2 logs wa-bridge --lines 200 | grep ia-guide
```
Si aparece `apiError=...monthly spending cap...`, es exactamente esto.

> 💡 Este caso es el mejor argumento para **separar las API keys**: una para texto (ML +
> WhatsApp, gasta centavos) y otra para imagen/video (`api/image.js`, que es lo caro). Hoy
> generar contenido para redes puede dejar mudos a los dos bots que venden.

---
## 💬 Mensaje post-entrega ("¿llegó todo bien?")

`GET/POST /api/ml/questions?action=postventa` · botón **"💬 Mensajes post-entrega"** en
`/conexiones`. Interruptor: **`ML_POSTVENTA=on`** (arranca APAGADO a propósito).

**Cómo funciona:**
1. ML avisa por webhook (topic **`shipments`**) que cambió un envío.
2. Si el envío quedó en **`delivered`**, se busca la orden y se **agenda** el mensaje para
   **5 minutos después** (cola en el KV).
3. Un cron cada 5 min (`bridge/ml-sweep.sh`) llama a `?action=postventa` y manda los que ya
   cumplieron la demora, por la **mensajería post-venta de ML**
   (`POST /messages/packs/{pack}/sellers/{seller}?tag=post_sale`).

**El mensaje** (editable en `lib/ml/qa-config.js` → `MENSAJE_POSTVENTA`):

> ¡Hola! Soy Tatiana de Uniproveedores. Vi que ya te llegó "{producto}". ¿Llegó todo bien? Si algo
> no salió como esperabas, escribime por acá y lo resolvemos enseguida. Cuando puedas, dejá tu
> opinión en la publicación: nos ayuda a mejorar y a que otros compradores se decidan. ¡Gracias
> por elegirnos!

### ⚠️ Lo que este mensaje NO hace, y por qué
- **No pide una calificación positiva** ni sugiere qué puntaje poner.
- **No ofrece plata, descuentos ni premios** a cambio de una reseña. Las **reseñas incentivadas
  están prohibidas por Mercado Libre** (y son engañosas para el que compra después): es la vía
  rápida a que caiga la reputación de la cuenta.
- **No manda links ni invita a las redes.** ML bloquea los links externos en la mensajería y usar
  los datos del comprador para promoción va contra sus términos.
  👉 Las redes van en el **folleto con QR adentro del paquete** (canal propio, sin riesgo) y por el
  bot de WhatsApp. Y si se quiere premiar, que sea por **contenido** (el premio de $15.000 por
  video que ya existe) o un **sorteo entre clientes**, nunca atado a dejar una reseña.

El efecto buscado igual se consigue: el que quedó conforme califica, y el que tuvo un problema
**escribe en vez de dejar 1 estrella**, que es lo que más cuida la reputación.

### 🔕 Por qué NO deja la conversación "leída"

Preocupación del cliente: *que el mensaje del bot no marque la conversación como leída, para no
hacer lío cuando el comprador escriba por otra consulta.*

Según la documentación de ML, **el único recurso que marca los mensajes como leídos es
`GET /messages/packs/{pack}/sellers/{seller}`** — el resto no toca el estado de lectura.
Y el bot **nunca hace ese GET**: solo hace el POST para mandar el mensaje, que no marca nada.
Así que lo que el comprador escriba queda **sin leer**, esperando al equipo, como debe ser.

Dos resguardos para que siga siendo así:
- `getPackMessages()` (por si algún día hace falta leer la conversación) lleva
  **`mark_as_read=false` fijo en el código**, no como parámetro opcional que alguien pueda olvidar.
- Antes de mandar, el bot consulta `GET /messages/unread/packs/{pack}/sellers/{seller}` — que
  **tampoco marca como leído**. Si el comprador ya escribió algo que nadie leyó, **no manda nada**:
  el mensaje se queda en la cola, y si el equipo le contesta sale en la próxima pasada; si no,
  caduca solo a las 24 h. Un "¿llegó todo bien?" encima de una consulta real la entierra, que es
  justo el lío que había que evitar.

### Recaudos que ya están en el código
- **Arranca apagado** (`ML_POSTVENTA` sin setear = no manda nada, ni siquiera agenda).
- **Una sola vez por orden**: lleva registro de encolados y enviados.
- **Caduca a las 24 h**: si un mensaje quedó colgado en la cola, no se manda. Así, al prender el
  interruptor, no sale una andanada de mensajes viejos a clientes de hace semanas.
- **Necesita el KV**: sin `KV_REST_API_URL`/`KV_REST_API_TOKEN` la cola se pierde en cada arranque
  en frío. El panel lo avisa en rojo.

### Para activarlo
1. KV configurado (ver más arriba).
2. En **DevCenter** → app "Uniproveedores MCP" → Notificaciones → tildar el topic **`shipments`**.
3. En Vercel: **`ML_POSTVENTA=on`** + Redeploy.
4. Cron en el VPS cada 5 min: `bridge/ml-sweep.sh` (ya llama a `postventa` además de a `sweep`).
5. Mirar el botón 💬 en `/conexiones` para ver la cola y lo enviado.

---
## 📊 24-ago-2026 — Análisis de 2.025 preguntas reales (jun-jul)

El cliente exportó de Mercado Libre **2.025 preguntas de las 2 cuentas** (1-jun a 31-jul) con
el texto, la respuesta y la columna **"Efectuó compra"**. Resultados:

**Conversión general: 11,7%** (236 ventas). Full 12,7% · Local 8,8%.

| Tema | Preguntas | Conversión |
|---|---|---|
| Factura / CUIT | 35 | **31,4%** ✅ (3× el promedio: es un negocio que ya decidió) |
| Cantidad / por mayor | 59 | **16,9%** ✅ |
| Compatibilidad | 413 | 12,3% |
| Medidas | 410 | 10,7% |
| **¿Tenés este otro?** | **422** | **8,5%** ⚠️ el tema más grande y debajo del promedio |
| Retiro por el local | 108 | 8,3% |
| Precio / cuotas | 37 | 5,4% ⚠️ |
| Repuestos | 22 | 4,5% ⚠️ |
| **Marca / modelo** | 81 | **3,7%** ⚠️ el peor de todos |

**Otras palancas medidas:**
- **Tiempo de respuesta:** dentro de los 15 min → 12-13%. Pasadas 3 h → **6,5%, la mitad**.
- **Tatiana 12,4% vs personas 11,5%**: el bot convierte igual o mejor (muestra chica, pero
  descarta que venda menos).
- **Largo de la respuesta:** 150-300 caracteres → 12,1%; más de 300 → 10,9%. El límite de 250
  de Tatiana está bien calibrado, no tocarlo.

**El patrón que explica casi todo:** los repuestos donde el comprador necesita saber *"¿entra
en el mío?"* juntan preguntas y no venden. Tapón Cebador Stanley: **13 preguntas, 0 ventas**.
Tapón termo 1L: 20 preguntas, 5%. Tapa de arranque Gamma: 24 preguntas, 8%. Y el disco flap
por grano (32 preguntas, 6%) es distinto: **piden un pack surtido y no existe la publicación**.

### Lo que se cambió en el código
`ETIQUETAS` en `lib/ml/conversion.js` estaba armada a ojo y dejaba el **46% de las preguntas
sin clasificar**. Releyendo esas 933, salieron categorías que no existían y términos que
faltaban. Ahora quedan **25%** sin clasificar. Categorías nuevas:
`foto_publicacion` (¿coincide con la foto?), `link_cantidad` (piden un link por X cantidad),
`repuestos`, `marca_modelo`, `posventa`. Y se ampliaron `medidas` (rosca, encastre, 1/2",
amp, volt, grano), `compatibilidad` (sirve/funciona/apto/entra en), `retiro` (estación, cerca,
horarios) y `otro_producto` (tenés/tienen/tendrán/venden).

> Informe completo para el cliente: artifact "Preguntas que no venden".

---
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

## 26-ago-2026 — Tatiana muda otra vez: cambió el modelo de Gemini

El diagnóstico mostró:

```
"gemini": "FALLA: This model models/gemini-2.5-flash is no longer available
           to new users. Please update your code to use models/gemini-3.6-flash"
```

Efecto colateral de separar las keys (24/8): la key nueva vive en un proyecto
NUEVO de Google, y a los proyectos nuevos ya no les habilitan `gemini-2.5-flash`.
La key vieja lo seguía usando solo porque su proyecto era anterior al corte.

Cambiar el nombre del modelo NO alcanzaba. Gemini 3 no deja apagar el
"pensamiento":

- `thinkingConfig: { thinkingBudget: 0 }` devuelve **400** en un modelo 3.x.
- Los tokens que el modelo "piensa" se descuentan de `maxOutputTokens`, así que
  con los 512 que teníamos la respuesta volvía **vacía** (el mismo síntoma que
  ya nos había pasado con 2.5 y por el que habíamos puesto el presupuesto en 0).
- El razonamiento puede volver como una parte más de la respuesta, marcada con
  `thought: true`. Sin filtrarla, Tatiana le publicaría al cliente lo que estuvo
  pensando en vez de la respuesta.

**Arreglo:** `lib/gemini-texto.js`, una sola puerta de entrada a Gemini para
texto que decide modelo, pensamiento y reintentos:

- Modelos en orden: `gemini-3.6-flash` → `gemini-flash-latest` → `gemini-2.5-flash`.
  El del medio es el alias que Google mantiene apuntando al flash vigente: es la
  red de seguridad para la próxima vez que cambien los nombres.
- Se puede forzar uno con `GEMINI_MODEL_TEXTO` sin tocar código.
- Si el modelo no existe, prueba el siguiente. Si se queja del `thinkingConfig`,
  reintenta sin él. Si es cuota o key inválida, corta y lo reporta (no tiene
  sentido quemar 3 modelos con el mismo 429).
- Recuerda el modelo que funcionó mientras la función sigue caliente.
- El diagnóstico ahora dice con qué modelo respondió: `modelo_de_ia`.

El flujo de preguntas de ML (prompt, validaciones, publicación) no se tocó.

## 26-ago-2026 (cierre del día) — estado del sistema y pendientes

### Segundo bug del día: thoughtSignature (#126)

Con el modelo nuevo andando, Tatiana seguía muda: Gemini 3 le pega
`thoughtSignature` TAMBIÉN a la parte que trae la respuesta buena (es una firma
para conversaciones multi-turno, no una marca de razonamiento). El filtro
anti-pensamiento la usaba como criterio y tiraba la respuesta entera — el sweep
mostraba la respuesta perfecta adentro del error "IA sin respuesta".
Arreglo: `textoDe()` filtra SOLO por `thought: true`. Verificado con el body
exacto de producción y después con preguntas reales: **respondió y posteó**.

### Estado final confirmado (todo verde)

- **Tatiana responde en ML** con `gemini-3.6-flash`; respaldo automático
  `gemini-flash-latest` → `gemini-2.5-flash`, forzable con `GEMINI_MODEL_TEXTO`.
- **Cron del barrido instalado en el VPS** (verificado en `crontab -l`):
  `*/5 * * * * /opt/socialflow/bridge/ml-sweep.sh >> /var/log/ml-sweep.log 2>&1`
  Corre sweep + postventa cada 5 min. Es la red de seguridad: ninguna pregunta
  espera más de 5 min aunque el webhook o Gemini fallen un rato.
- **Keys de Gemini separadas** (texto vs media) en Vercel y en el VPS.
- **Etiqueta HUMANO se saca sola** cuando contesta un asesor (#125).
  `WA_DESMARCAR_ATENDIDO=no` lo apaga; `WA_LIMPIAR_HUMANO=todo` vacía la lista.
- **Avisos al supervisor** activos (+54 11 5834-9893), incluido el de cliente
  sin atender a los 20 min.

### Reglas que explican "no responde" SIN que haya nada roto

- **Escalada a humano**: 4ta pregunta del mismo comprador en la misma
  publicación, o pregunta repetida textual → `escalated: true`, el bot no la
  toca nunca. La responde una persona desde ML.
- Publicación pausada/finalizada → se omite antes de llamar a la IA.
- El aviso de ML llega UNA vez: si el bot falla en ese momento, la pregunta
  queda para el barrido (máx. 5 min).

### Pendientes de Rodo (recordatorio agendado para el 27-ago 11:00 ART)

1. **Acciones de negocio del reporte de conversión** (las que dan plata):
   - Publicar el pack surtido de discos flap (demanda mayorista sin publicación).
   - Escribir compatibilidades de los 3 repuestos con preguntas sin conversión.
   - Agregar la marca en las fichas técnicas que la omiten.
   - El reporte se regenera desde el panel: 📈 "Control de conversión (Excel)".
2. Contestar a mano la escalada "que medida es mas grande???" (MLA1506247473).
3. Vaciar la lista HUMANO (`WA_LIMPIAR_HUMANO=todo` + reinicio + sacar la var),
   o desmarcar los 8 chats viejos desde el celular.

### Opcional sin fecha

- Activar mensaje post-entrega: topic `shipments` en DevCenter + `ML_POSTVENTA=on`
  + probar con una venta real. El código ya está desplegado.
