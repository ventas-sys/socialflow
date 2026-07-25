# 🤖 Agente IA de Preguntas de Mercado Libre — Uniproveedores

> Auto-respondedor de las **preguntas de las publicaciones de Mercado Libre**, con IA,
> multi-cuenta, orientado a **cerrar la venta**. Hermano del bot de WhatsApp (mismo patrón).
> Estado: **DISEÑO / a construir** (arranca cuando lleguen los tokens — lunes).

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

## ⚠️ Nota de cumplimiento
Todo lo público en ML respeta las políticas: precio igual dentro/fuera, sin venta externa,
sin pedir contacto por afuera. El retiro por local se ofrece **vía Mercado Libre**.
</content>
