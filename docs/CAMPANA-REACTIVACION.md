# Memoria: Google Contactos + pendientes (últ. act. 12/8/2026)

## ✅ FUNCIONANDO — Agenda automática en Google Contactos
El bot (Tatiana) agenda solo clientes/mayoristas/proveedores en la cuenta **ventas@uniproveedores.com.ar** (PRs #107–#110, mergeados y deployados el 12/8).

**Datos clave:**
- Cuenta de la agenda: `ventas@uniproveedores.com.ar` (decisión final; se descartó redes@ porque la autorización ya quedó andando con ventas@).
- Credenciales Google Cloud: proyecto "Gemini openclaw" (`gen-lang-client-0998208090`), People API habilitada, OAuth client "SocialFlow Web", redirect `https://socialflow-flax.vercel.app/google-callback`. Las 3 vars `GOOGLE_CONTACTS_*` están en `/opt/socialflow/bridge/.env` del VPS.
- VPS: Hostinger, repo en `/opt/socialflow`, proceso PM2 `wa-bridge`. Auto-deploy por cron baja `main` solo (por eso `git pull` suele decir "Already up to date"); tras cambios de código del bot igual conviene `pm2 restart wa-bridge`.
- Para ver los contactos en un celular: agregar la cuenta Google ventas@uniproveedores.com.ar en Ajustes → Cuentas con sincronización de Contactos.

**Limitación conocida (@lid):** WhatsApp migró TODOS los chats al formato `@lid` (12/8: 560 chats `@lid`, 0 `@c.us` en `.state.json`). El número real queda oculto para el bot (diagnóstico `[DIAG-LID]` → `hasStore:false`; whatsapp-web.js 1.27 no lo resuelve). Comportamiento actual: esos contactos se agendan **sin número** (nombre + etiqueta + nota "número oculto, completalo desde el celular") y con **dedup persistente** por chatId (`agendadosGoogle` en `bridge/.state.json`) — antes se duplicaban ("Cliente 28..32"). En el celular WhatsApp sí muestra el número real: agendado manual siempre posible (chat → nombre → Agregar a contactos).

**Historial de errores ya corregidos (no repetir):**
- Primera autorización se hizo con la cuenta equivocada (varias sesiones de Google abiertas) → ahora `oauthGoogle()` usa `prompt=select_account consent`.
- Se agendaban números falsos tipo `+185229138464948` (eran el @lid) → corregido, nunca guardar el @lid como teléfono.

## ⏳ PENDIENTES para el 1/9/2026 (evento en Google Calendar de ventas@distribuidorauniverso.com con recordatorio)

### 1) Campaña de reactivación de ex-clientes
Mensajes a contactos viejos que hace mucho no compran. Acordado:
- **NO usar el número del bot** (011-3551-0715): riesgo de ban = perder el canal con 480+ clientes. El ban depende de reportes/bloqueos, no solo de la velocidad.
- Número APARTE (chip secundario), calentado unos días. Tandas de 30–50 **por día**, personalizado, con opt-out ("respondé NO y listo"), solo ex-clientes reales, sin insistir a quien no responde.
- Alternativa recurrente/segura: WhatsApp Business API con plantillas.
- Falta: confirmar número aparte + lista de contactos (CSV/Excel) + texto base.

### 2) Guardar en el celular los números de WhatsApp sin agendar
- Agendado masivo desde la memoria del bot: imposible hoy (todo @lid).
- Ideas a explorar: revisar histórico `bridge/new-clients.csv` por números reales viejos (filas cuyo teléfono empieza en 549); actualizar whatsapp-web.js a última versión que maneja mejor @lid (riesgo: re-escanear QR, probar en horario tranquilo).

## Otros detalles menores detectados (no urgentes)
- `aviso a supervisor fail: No LID for user` en logs: los avisos al supervisor a veces no salen (relacionado con @lid y `WA_SUPERVISOR_NUMBER`).
- Google Contactos sugiere fusionar ~12 duplicados viejos (de antes del dedup): usar "Combinar y corregir".
- Contactos "Cliente 01..32" con números falsos (@lid) quedaron en la agenda: se pueden borrar a mano.
