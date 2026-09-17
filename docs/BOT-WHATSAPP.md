# Bot WhatsApp de Uniproveedores — Memoria técnica

> **Última actualización**: 2026-07-03
> **Estado**: 🟢 En producción. Asistente IA-first con banco de memoria y personalidad.

---

## 🧭 Arquitectura

```
Cliente WhatsApp (011-3551-0715)
        │
        ▼
┌─────────────────────────┐     POST      ┌──────────────────────────────┐
│  bridge/wa-bridge.mjs   │ ────────────▶ │  api/wa/webhook.js (Vercel)  │
│  VPS Hostinger          │ ◀──────────── │  └─ lib/wa/brain.js          │
│  /opt/socialflow (main) │   messages[]  │      └─ lib/wa/ia-guide.js   │
│  pm2: wa-bridge         │               │          └─ Gemini 2.5 Flash │
└─────────────────────────┘               │  └─ lib/wa/business-config.js│
                                          └──────────────────────────────┘
```

- **Bridge (VPS)**: sesión de WhatsApp Web (whatsapp-web.js). Recibe mensajes, baja notas de voz, avisa de fotos, envía respuestas, maneja etiquetas/no-leído/avisos, follow-ups y recordatorios. Deploy: `cd /opt/socialflow && git pull origin main && pm2 restart wa-bridge`.
- **Cerebro (Vercel, prod `socialflow-flax.vercel.app`)**: clasifica la intención con Gemini y arma las respuestas. Auto-deploy al mergear a `main`.
- **Config del negocio**: `lib/wa/business-config.js` — ÚNICA fuente de verdad editable.

## 🧠 Cómo piensa (IA primero, sin menú)

Cada mensaje va a la IA con un **banco de memoria** (armado desde business-config): dirección, horarios, tienda ML, precios local = ML, mayorista (link+descuentos+mínimo), procedimiento de reclamos. La IA clasifica el **intent** y el sistema responde:

| Intent | Respuesta | ¿Humano? |
|---|---|---|
| `producto` (+keyword) | Link tienda filtrado `listado.mercadolibre.com.ar/<kw>_Tienda_arbetter-by-uniproveedores` + texto retiro Floresta | No |
| `horario_ubicacion` | La IA responde natural con los datos reales | No |
| `mayorista` | Drive lista + descuentos (-20%, -7% bulto, +10% factura, mín $50k) | flagHuman |
| `reclamo_ml` | Pide foto paquete + productos + usuario; a los 10s guía del apodo | flagHuman |
| `reclamo_datos` | Cliente mandó su usuario → "le paso todo a mi supervisor… billetitos por las molestias 🤑" | flagHuman |
| `answer` | Respuesta corta (1-3 líneas) con memoria; saludos, seguimiento, gracias | No |
| `human` | Deriva al supervisor con tono de aprendiz | escalated |

- **flagHuman**: marca el chat para el humano pero **el bot sigue respondiendo**.
- **escalated**: pidió persona/enojado → marca + **bot en pausa 3h** (`WA_HUMAN_TAKEOVER_HOURS`).
- **Audio**: el bridge baja la nota de voz → Gemini la transcribe → flujo normal.
- **Fotos/videos/archivos**: el bridge avisa con marcador "(el cliente mandó una foto 📸)" para que la IA responda en contexto.

## 🎭 Personalidad

"El pibe nuevo" de CABA en su primer laburo: porteño, buena onda, gracioso pero despistado/inocente, aprendiendo. Mensajes de 1-3 líneas. Sus errores se leen como de aprendiz. Nunca inventa precios/stock; si duda, deriva al supervisor.

## 🔔 Marcado para humano (post migración Etiquetas→Listas de WhatsApp)

1. 🔵 Chat marcado **NO LEÍDO** (siempre funciona)
2. 📣 **Aviso por WhatsApp al supervisor** si `WA_SUPERVISOR_NUMBER` está en `bridge/.env` (motivo + último mensaje + link wa.me; máx 1 cada 6h por chat)
3. 🟡 Etiqueta HUMANO best-effort (re-resolución lazy cada 10 min)

## ⏰ Automáticos del bridge

- **Follow-up "¿algo más?"**: a las 2h sin actividad, máx 1 por día por chat. Se suprime si hubo cierre ("gracias por escribirnos", "que tengas un hermoso día"…), lo mande el bot o el asesor.
- **Recordatorio 5 días** después del primer contacto: promo de estados/canal + incentivo calificación ($5k por calificar en ML/Google, x3 con video de 30s para IG). Solo contactos nuevos post-deploy.
- **Asesor humano responde desde el cel** → bot se calla 3h para ese chat.
- **Heartbeat** al panel cada 60s (se ve en `/index.html`).

## 🔧 Operación / mantenimiento

- **Lista mayorista (CADA MES)**: actualizar `MAYORISTA.driveUrl` y `vigencia` en `lib/wa/business-config.js` → mergear a main. La IA se entera sola.
- **Textos** (plantillas, recordatorio, datos del negocio): mismo archivo.
- **Gemini**: `GEMINI_API_KEY` en Vercel. ⚠️ El 2026-07-02 Google bloqueó la API por facturación ("Lightning dunning decision is deny", proyecto 154343840927) → el bot caía al fallback. Se resolvió pagando. Si reaparece: revisar https://console.cloud.google.com/billing. El webhook devuelve campo `debug` con el error exacto de Gemini (probar con `curl -d '{"simulate":true,"from":"t@c.us","text":"..."}' .../api/wa/webhook`).
- **Bridge .env** (`bridge/.env` en el VPS): `WA_WEBHOOK_URL` (prod), `WA_BRIDGE_TOKEN`, `WA_HUMAN_LABEL`, `WA_SUPERVISOR_NUMBER`, `WA_FOLLOWUP_MINUTES` (default 120), `WA_REMINDER_DAYS` (default 5).

## 🚪 Reglas de cierre de conversación (definidas con la usuaria)

- **El ASESOR cierra** ("gracias por escribirnos…") → el bot NO escribe nada más en ese chat (ni al "gracias" del cliente). Silencio 3h.
- **El CLIENTE cierra** ("Graciass", "listo", "dale, te aviso") → sin respuesta, sin follow-ups. "gracias pero me llegó roto" NO es cierre (va a reclamo).
- **Charla abierta sin respuesta** → a las 2h: "¿Te puedo ayudar en algo más? 🙂" (máx 1/día).
- **Link de producto sin respuesta** → a las 2h: "¿Pudiste comprarlo o te doy una mano?".
- **Cliente pasó nº de compra de ML** → vale igual que el usuario para el reclamo.

## 🐛 El bug del auto-silencio (histórico, RESUELTO en #37)

Síntoma: tras cada mensaje del bot con link, el chat quedaba mudo 3hs.
Causa (confirmada en logs del VPS): el evento `message_create` del mensaje
enviado se dispara ANTES de que `client.sendMessage()` resuelva → el registro
del ID/huella llegaba tarde → el bridge tomaba su propio 2º mensaje como
"asesor respondió a mano" → `markAsesorActive` 3hs. El 1º mensaje se salvaba
por la ventana de auto-reply (3s). Fix: `botSend()` pre-registra la huella
ANTES de enviar + candado `botSendingUntil` de 20s por chat.

## 📜 Historial de PRs del asistente (jul 2026)

#21 base · #24 cierres suprimen follow-up · #25 fix Gemini thinking budget · #26 IA primero (sin menú Sí/No) · #27 aceptar reply vacío (plantillas) · #28 banco de memoria + mensajes cortos · #29 sigue respondiendo tras mayorista/reclamo · #30 confirmación reclamo + ve fotos · #31 marcado humano robusto (Listas) · #33 follow-up post-producto · #34 cierres asesor/cliente respetados + relojes persistidos · #35 reconocimiento por ID · #36 nº de compra resuelve reclamo · #37 **fix definitivo carrera de eventos (auto-silencio)**.

## ✅ Estado 2026-07-03: EN PRUEBA con clientes reales por unos días

Probado OK: saludos, productos con link filtrado, mayorista + seguimiento, reclamos (fotos + usuario/nº de compra + billetitos), cierres, audio, avisos al supervisor (`WA_SUPERVISOR_NUMBER` configurado), etiqueta HUMANO + no-leído.

## ⏳ Pendientes

- [ ] Revisar comportamiento tras días de prueba real (logs: `pm2 logs wa-bridge`)
- [ ] Conector Meta: crear app en developers.facebook.com y autorizar en `/conexiones` (para publicar FB+IG desde el panel)
- [ ] Colores de marca en el panel (quedó el naranja por defecto)
- [ ] Hosting público de imágenes IA (para publicar fotos en IG vía API)
- [ ] YouTube Data API + MCP (guía en `docs/SETUP-YOUTUBE-MCP.md`)

---

## Llamadas de WhatsApp (17-sep-2026)

Pedido de Rodo: *"una respuesta automática para el que llama por teléfono al
mismo número de WhatsApp… que le diga que este número es para WhatsApp
escrito, que nos agende y nos escriba así le respondemos al toque"*.

Cuando entra una llamada **de WhatsApp**, el bot la corta y le manda al que
llamó un mensaje explicando que escriba por acá. Si está fuera del horario de
atención, el mensaje además le dice a qué hora abrimos.

**⚠️ Alcance: solo llamadas hechas DESDE WhatsApp.** Si alguien marca el
011-3551-0715 desde un teléfono común, eso es el chip sonando: el bot no se
entera y no hay nada que el código pueda hacer. Eso se resuelve con el
contestador de la compañía, configurado desde el teléfono.

**Cómo funciona** (`atenderLlamada` en `bridge/wa-bridge.mjs`):
- Un solo aviso por contacto cada `WA_AVISO_LLAMADA_HORAS` (6 por defecto): si
  insiste tres veces seguidas, la llamada se corta las tres pero el mensaje
  sale una sola vez.
- Si hay un asesor atendiendo ese chat, el bot corta pero **no escribe**: no
  se mete en una conversación que ya está tomando una persona.
- Llamadas de grupo y llamadas salientes se ignoran.
- El registro de avisos se limpia solo a los 30 días.

**⚠️ El evento se llama `'call'`, no `'incoming_call'`.** La documentación de
whatsapp-web.js dice `@event Client#incoming_call`, pero `Constants.js` tiene
`INCOMING_CALL: 'call'`. Registrado como `incoming_call` no pasa nada y las
llamadas siguen sonando (pasó el 17-sep-2026).

**Red de contención (18-sep-2026).** Cambiar el nombre del evento no alcanzó:
las llamadas seguían sin cortarse. La librería engancha las llamadas
**parcheando un `Map` interno de WhatsApp Web** (`WAWebCallCollection`), y si
WhatsApp le cambia la forma a ese módulo el parche no se instala **sin tirar
ningún error**.

Por eso al arrancar `asegurarHookLlamadas()` revisa si quedó enganchado y, si
no, lo engancha por su cuenta. El log de arranque dice cuál de estas pasó:

| Línea en el log | Qué significa |
|---|---|
| `enganchadas por la librería ✅` | Todo normal |
| `la librería NO las enganchó, lo hicimos nosotros ✅` | La librería falló, la red de contención funcionó |
| `no existe WAWebCallCollection…` | WhatsApp Web cambió: **el bot no va a ver las llamadas** |
| `WAWebCallCollection cambió de forma…` | Ídem |

Si aparece una de las dos últimas, no hay nada que configurar: hay que
actualizar `whatsapp-web.js` o rehacer el enganche.

**Variables:**

| Variable | Default | Para qué |
|---|---|---|
| `WA_LLAMADAS` | `cortar` | `cortar` corta y escribe · `avisar` no corta, solo escribe · `off` el bot no toca las llamadas |
| `WA_AVISO_LLAMADA_HORAS` | `6` | Cada cuánto se le puede repetir el mensaje al mismo contacto |

Un valor mal escrito en `WA_LLAMADAS` cae en `cortar` y el log de arranque lo
avisa, para que no prometa una cosa y haga otra.
