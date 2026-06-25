# Memoria — Unificación de cuentas Meta (Uniproveedores)

> **Última sesión**: 2026-06-25 (jueves) — **GRAN AVANCE**
> **Próxima sesión**: 2026-06-26 (viernes) — chequear respuesta del diseñador
> **Estado**: 🟢 Cuentas blindadas. Solo queda 1 acción del diseñador (renunciar al IG creator).

---

## Objetivo final

Unificar TODOS los activos digitales de Uniproveedores bajo:
- 📧 Mail principal único: `redes@uniproveedores.com.ar` (Google Workspace)
- 📞 Teléfono principal único: `+541135510715` (WhatsApp empresa)
- 🔐 2FA activa en todas las cuentas
- 🚫 Sin contactos ni admins de terceros (ex-diseñador) con acceso

---

## Estado actual (2026-06-25)

### 🟢 Activos Meta — todos BLINDADOS

| Activo | Perfil/handle | Password | 2FA | Mail diseñador | Estado |
|---|---|---|---|---|---|
| Facebook personal | Uni Proveedores | ✅ Tuya | ✅ SMS+Auth | ✅ Eliminado | 🟢 BLINDADO |
| Página Facebook | Uniproveedores | N/A | Heredada | N/A | 🟢 BLINDADO |
| Instagram | @uniproveedoresok | ✅ Cambiada (12-jun) | ✅ SMS al +15 + códigos guardados | ✅ Eliminado (25-jun) | 🟢 BLINDADO |
| Threads (1) | uniproveedoresok | Heredado IG | Heredado | ✅ Eliminado (25-jun) | 🟢 BLINDADO |
| Threads (2) | uni.proveedores | Heredado IG | Heredado | ✅ Eliminado | 🟢 BLINDADO |
| WhatsApp Business app | +541135510715 | ✅ "Cuenta empresa" verificada | ⏳ Pendiente PIN | N/A | 🟡 OK pero falta PIN |
| Business Portfolio | Uniproveedores (ID 307771705609080) | N/A | N/A | N/A | ⚠️ Verificación RECHAZADA, reaplicar |
| Google Workspace | `redes@uniproveedores.com.ar` | ✅ Tuya | ✅ Authenticator + SMS + Passkey + códigos | N/A | 🟢 BLINDADO |

### 🟢 Centro de cuentas — Información de contacto limpia

Estado final 2026-06-25:
- ✅ `redes@uniproveedores.com.ar` (principal)
- 🟡 `ventaxml2020@gmail.com` (backup, mantener 30 días más, 2FA pendiente)
- ✅ `+541135510715` (WA empresa)
- ✅ ~~`davincidigitalediciones@gmail.com`~~ **ELIMINADO 25-jun**
- ✅ ~~`+5491122523624`~~ **ELIMINADO** (en algún momento entre 13-jun y 25-jun, ya no aparecía)

### 🔴 Único pendiente del lado del diseñador

| Activo | Acceso | Estado |
|---|---|---|
| Portfolio Uniproveedores | Era "Control total" | ✅ Reducido a "Acceso parcial básico" (13-jun) |
| Página FB Uniproveedores | Acceso parcial heredado | 🟡 Sin urgencia (su mail ya está fuera, no recibe notificaciones) |
| Instagram @uniproveedoresok | **CONTROL TOTAL como CREADOR** | 🔴 **Mensaje WhatsApp enviado 25-jun, esperando respuesta** |

> ⚠️ **Nota técnica**: aunque siga figurando como "creador" del IG, **no puede entrar** a la cuenta. Las defensas activas (password cambiada + 2FA) lo bloquean. El rol "creador" solo le da presencia en BM, no acceso operativo.

---

## Progreso

### ✅ Sesión 2026-06-12 (viernes)
1. **2FA activada en Facebook** (SMS al -15 + Google Authenticator)
2. **Códigos de recuperación FB** generados, leakeados accidentalmente, regenerados y guardados
3. **Password de Instagram cambiada** (la usuaria controla el login)
4. **Mapeo completo** del Centro de cuentas y contactos

### ✅ Sesión 2026-06-13 (sábado)
5. **Da Vinci DIGITAL bajado a "Acceso parcial básico"** en Portfolio (era Control total)
6. **Confirmado**: `+5491122523624` es del diseñador → eliminar
7. **Descubierto**: el diseñador tiene "Control total como creador" del IG — irreversible desde nuestro lado
8. **2FA activada en `redes@uniproveedores.com.ar`** (Google Workspace) con full stack
9. **Intento de 2FA en IG** → 🟡 bloqueado por Meta ("dispositivo no habitual")

### ✅ Sesión 2026-06-24 (miércoles)
10. **Migración Imagen 4 → Gemini 3.1 Flash Image** (commit 465429a)
11. **GitHub 2FA bloqueado** — plan jueves: usar passkey o buscar códigos respaldo

### ✅ Sesión 2026-06-25 (jueves) — **GRAN AVANCE** 🎉
12. **Mail `davincidigitalediciones@gmail.com` ELIMINADO** del Centro de cuentas
    - Primer intento desde PC: bloqueado por "única información de contacto del IG"
    - Solución: agregar `redes@` al IG primero
    - Reemplazo de mail bloqueado en PC por "dispositivo no habitual"
    - **Solución final**: la usuaria avanzó (probablemente desde el cel o reintentando) y eliminó el mail con éxito
    - Threads quedó limpio en el primer intento
13. **Teléfono `+5491122523624` confirmado eliminado** (ya no aparecía en la lista del 25-jun)
14. **2FA en Instagram ACTIVADA** ✅
    - Método: SMS/WhatsApp al `+541135510715` (cel empresa)
    - Bonus: códigos de respaldo guardados
    - App de autenticación queda como mejora futura opcional
15. **Mensaje al diseñador ENVIADO** pidiendo que renuncie al "control total como creador" del IG desde `business.facebook.com`. **Esperando respuesta para sesión del 26-jun.**

---

## 🛡️ Análisis de seguridad — estado actual

**Para que un atacante (incluido el ex-diseñador) entre al IG `@uniproveedoresok`, necesita TODO esto simultáneamente:**

1. La password nueva (solo la usuaria la tiene)
2. **Y** acceso físico al cel `+541135510715` (para recibir SMS de 2FA)
3. **O** uno de los 5 códigos de respaldo (guardados en lugar seguro)

**Para FB:** mismo esquema + Google Authenticator activo.

**Para mail redes@:** Authenticator + SMS + passkey + códigos respaldo.

> 🟢 **Conclusión**: cuentas blindadas. El diseñador, aunque siga figurando como "creador" en BM, no tiene capacidad operativa de entrar. El rol "creador" sin acceso es decorativo a efectos de riesgo.

---

## 📅 Plan inmediato — Sesión 2026-06-26 (viernes)

### Escenario A — Diseñador respondió y va a renunciar
1. Confirmar que entró a `business.facebook.com`
2. Si se traba: pedirle screenshot y guiarlo
3. Si quiere, video llamada de 5 min
4. **Verificar en BM Personas** que ya no aparece (o queda sin permisos)
5. Si queda residuo: click 🗑️ "Eliminar usuario" del Business Manager
6. ✅ Caso cerrado

### Escenario B — Diseñador no respondió aún
1. Segundo mensaje más corto: *"Hola! ¿pudiste mirar lo del IG? Si necesitás que lo hagamos juntos te conecto en 5 min cuando puedas"*
2. Avanzar con pendientes independientes (Etapa 4-6 abajo)

### Escenario C — Diseñador dice "más adelante / no puedo"
1. Aceptar, dejar pendiente
2. **No es urgente porque las defensas activas lo bloquean igualmente**
3. Avanzar con pendientes independientes

---

## Próximos pasos pendientes (en orden, completo)

### Etapa 1 — Cerrar diseñador (requiere su acción) — EN CURSO 🟡
- ⏳ Esperar respuesta WhatsApp del 25-jun
- ⏳ Si coopera: renuncia al IG creator → verificar en BM Personas → ✅
- ⏳ Eliminar usuario Da Vinci DIGITAL del Portfolio (🗑️)

### Etapa 2 — 2FA en `ventaxml2020@gmail.com` (backup importante)
- ⏳ Mismo proceso que `redes@`: Authenticator + códigos de respaldo
- ⏳ Lo necesitamos blindado mientras siga siendo backup

### Etapa 3 — WhatsApp Business app
- ⏳ Cambiar mail del perfil empresa a `redes@uniproveedores.com.ar`
- ⏳ Verificar 2FA del WhatsApp (PIN de 6 dígitos)

### Etapa 4 — Verificación del negocio (RECHAZADA actualmente)
- ⏳ Revisar motivos del rechazo en Business Manager → Información del negocio
- ⏳ Reaplicar con documentación correcta:
  - CUIT 30-71532771-2
  - Razón social que matchee
  - Factura de servicio reciente del domicilio Bacacay 4726
  - Web https://uniproveedores.com.ar/

### Etapa 5 — Mejora opcional: Authenticator en IG
- ⏳ Agregar Google Authenticator como método de respaldo del 2FA de IG (ya activo por SMS)
- ⏳ Beneficio: independiente de señal de cel + resistente a SIM swap

### Etapa 6 — Limpieza final (30 días después)
- ⏳ Eliminar `ventaxml2020@gmail.com` del Centro de cuentas
- ⏳ Mantener acceso a esa casilla 6 meses más por seguridad

---

## Reglas de seguridad acordadas

- 🚫 NUNCA compartir códigos de recuperación, passwords, códigos 2FA, ni claves de Authenticator en chat
- ✅ Capturas de pantallas de configuración OK
- ✅ Nombres de mails, IDs públicos OK
- 🚫 Passwords, códigos secretos NO
- 🚫 Si un screenshot tiene un código sensible → taparlo con el editor de fotos antes de mandar

---

## Trabajo paralelo no-Meta (en sesiones recientes)

### Fix bot WhatsApp (sábado 2026-06-13)
- **Bug**: el bot mandaba "¿algo más?" follow-up incluso después de que la asesora cerrara con "gracias por escribirnos"
- **Fix**: detección de ~10 patrones de cierre en español rioplatense en `bridge/wa-bridge.mjs`
- **PR #22**: mergeado a main
- **Deploy**: VPS Hostinger, `pm2 restart wa-bridge` ejecutado ✅

### Migración Imagen 4 → Gemini 3.1 Flash Image (miércoles 2026-06-24)
- **Razón**: Google retira `imagen-4.0-*-generate-001` el 17 ago 2026
- **Migración**: `api/image.js` ahora usa `gemini-3.1-flash-image:generateContent`
- **Estado**: ✅ Commit `465429a` pusheado a branch `claude/sales-agency-setup-GuexB`
- **Preview Vercel**: deployado en https://socialflow-git-claude-sales-ag-ab2aef-ventas-sys-2783s-projects.vercel.app
- ⏳ **Pendiente**: probar el preview en vivo, después mergear a main
- ⏳ **Plan B si rompe**: el endpoint viejo todavía funciona hasta 17 ago

### GitHub 2FA bloqueado (miércoles 2026-06-24)
- 🔴 No pudo entrar a GitHub: pantalla de 2FA recovery rechaza códigos
- **Plan**:
  1. Probar "Use a passkey instead"
  2. Buscar los códigos reales de respaldo de GitHub (Gmail, gestor, descargas)
  3. Último recurso: https://github.com/account-recovery (3-7 días)
- ⚠️ NO seguir tipeando códigos al azar

### Charla de arquitectura: n8n para escalar el bot (2026-06-25)
- La usuaria mira shorts sobre automatización con n8n
- Planteamos 4 escenarios (mejor capa de IA, follow-ups automáticos, integraciones cross-system, reemplazo total del bot)
- **Decisiones tomadas**:
  - Ella describe los temas de los shorts (pendiente)
  - Mostrar opciones primero antes de decidir scope
  - Claude mantiene el sistema (no n8n editor visual del lado del usuario)
- 🟡 **Pausado**: la conversación se cortó cuando aparecieron los temas Meta urgentes. Retomar cuando ella tenga ganas.

---

## Notas técnicas

- Centro de cuentas IG/FB unificado: https://accountscenter.facebook.com
- Centro de cuentas (IG side): https://accountscenter.instagram.com/profiles/
- Business Manager: https://business.facebook.com
- BM Personas (directo): https://business.facebook.com/settings/people?business_id=307771705609080
- Google Workspace 2FA: https://myaccount.google.com/signinoptions/two-step-verification
- Portfolio ID: 307771705609080
- CUIT registrado: 30-71532771-2
- Página principal: uniproveedoresok
- Web: https://uniproveedores.com.ar/
- VPS bridge WA: `/opt/socialflow` (rama `main`)

---

## 🎯 Resumen ultracorto del estado al 25-jun

- 🟢 **Cuentas blindadas**: el diseñador no puede entrar a ninguna
- 🟡 **Único pendiente**: que él renuncie voluntariamente al rol "creador" del IG en BM (mensaje WhatsApp enviado, esperando respuesta)
- 🛡️ **Riesgo real**: muy bajo, las defensas activas son suficientes aunque el rol "creador" siga
- 📅 **Próxima sesión**: viernes 26-jun, chequear si respondió
