# Memoria — Unificación de cuentas Meta (Uniproveedores)

> **Última sesión**: 2026-06-13 (sábado PM)
> **Próxima sesión**: 2026-06-16 (martes)
> **Estado**: 🟡 Pausa hasta martes. Lunes 2026-06-15: escribir al diseñador.

---

## Objetivo final

Unificar TODOS los activos digitales de Uniproveedores bajo:
- 📧 Mail principal único: `redes@uniproveedores.com.ar` (Google Workspace)
- 📞 Teléfono principal único: `+541135510715` (WhatsApp empresa)
- 🔐 2FA activa en todas las cuentas
- 🚫 Sin contactos ni admins de terceros (ex-diseñador) con acceso

---

## Inventario relevado

### Activos Meta (todos bajo el mismo Centro de cuentas ✅)
| Activo | Perfil/handle | Estado |
|---|---|---|
| Facebook personal | Uni Proveedores | ✅ Acceso operativo, **2FA activa** |
| Página Facebook | Uniproveedores | ✅ Administrada por Uni Proveedores |
| Instagram | @uniproveedoresok | ✅ Password cambiado, **2FA pendiente** |
| Threads (1) | uniproveedoresok | ✅ |
| Threads (2) | uni.proveedores | ✅ |
| WhatsApp Business app | +541135510715 | ✅ Tilde azul "Cuenta empresa" |
| Business Portfolio | Uniproveedores (ID 307771705609080) | ⚠️ Verificación RECHAZADA |
| Google Workspace | `redes@uniproveedores.com.ar` | ✅ **2FA activa** + Authenticator + códigos respaldo |

### Contactos del Centro de cuentas
| Contacto | Quién | Acción |
|---|---|---|
| `redes@uniproveedores.com.ar` | Mail empresa | 🟢 Mantener (principal) |
| `ventaxml2020@gmail.com` | Gmail viejo de la usuaria | 🟡 Backup 30 días, luego eliminar. **2FA pendiente** |
| `+541135510715` | WhatsApp empresa | 🟢 Mantener |
| `davincidigitalediciones@gmail.com` | **Ex-diseñador externo** | 🔴 Pendiente eliminar (requiere su código) |
| `+5491122523624` | **Diseñador (confirmado por usuaria)** | 🔴 Pendiente eliminar |

### Permisos del diseñador en Business Manager (CRÍTICO)
| Activo | Acceso | Estado |
|---|---|---|
| Portfolio Uniproveedores | Era "Control total" | ✅ Reducido a **Acceso parcial Básico** (2026-06-13) |
| Página FB Uniproveedores | Acceso parcial (Contenido, Mensajes, Anuncios, Estadísticas) | 🔴 Pendiente bajar (bloqueado por IG) |
| Instagram @uniproveedoresok | **CONTROL TOTAL como CREADOR** | 🔴 **NO se puede cambiar desde la consola** — requiere acción del diseñador |
| Threads | Heredado | 🔴 Pendiente |

> ⚠️ **Hallazgo crítico 2026-06-13**: Meta considera al diseñador "creador" del IG `@uniproveedoresok` (lo conectó él al Business Portfolio originalmente). Su control total sobre el IG **no se puede revocar** desde la consola — solo él puede renunciar desde su propia cuenta de Facebook.

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
8. **2FA activada en `redes@uniproveedores.com.ar`** (Google Workspace):
   - Notificación de Google ✅
   - Google Authenticator ✅
   - SMS al 011 3551-0715 ✅
   - 1 llave de acceso (passkey) ✅
   - Códigos de respaldo descargados ✅
9. **Intento de 2FA en IG** → 🟡 bloqueado por Meta ("dispositivo no habitual")

### 🟡 BLOQUEOS ACTIVOS

**A) Mail/teléfono del diseñador en Centro de cuentas**
Meta pide código que llega al gmail del diseñador para eliminarlo. **Requiere su colaboración.**

**B) Control total del diseñador sobre IG**
Meta lo considera "creador" del IG y no permite revocar desde la consola. **Requiere que él renuncie voluntariamente desde su FB.**

**C) 2FA en Instagram**
Meta bloqueó el cambio por "dispositivo no habitual" (probable porque acabamos de cambiar password ayer). Workaround: hacerlo desde el cel donde habitualmente se usa IG, o esperar 24-48h y reintentar desde PC.

---

## 📅 Plan inmediato

### Lunes 2026-06-15 — Mensaje al diseñador
Escribirle en horario razonable. Borrador actualizado (incluye ambos pedidos):

> Hola [Nombre], cómo andás. Te escribo porque estamos haciendo un orden general de las cuentas digitales de Uniproveedores y necesito tu ayuda con 2 cosas (15 minutos en total):
>
> 1) **Códigos de verificación**: El IG y Threads siguen vinculados a tu mail (davincidigitalediciones@gmail.com). Para pasarlos al mail empresarial (redes@uniproveedores.com.ar), Meta te va a mandar un código de verificación a vos. ¿Te puedo coordinar un momento esta semana para que me pases el código cuando llegue?
>
> 2) **Renunciar al control total del IG en Business Manager**: cuando creaste @uniproveedoresok, Meta te dejó como "creador" con control total irrevocable. Solo vos podés liberarlo desde business.facebook.com → buscarte en Personas → "Eliminar acceso" o transferir control. ¿Lo hacemos juntos por video llamada?
>
> Te agradezco un montón la mano de siempre 🙏

### Martes 2026-06-16 — Retomar sesión
Decir "leé la memoria y seguimos". Dependiendo de la respuesta del diseñador, los pasos son distintos:

**Si el diseñador respondió y coopera**:
1. Sesión coordinada (videollamada o mensajes): él renuncia a creator del IG + manda código de verificación de mail
2. Limpiamos Centro de cuentas (eliminar gmail + teléfono del diseñador)
3. Eliminamos al diseñador del Business Manager (Personas → 🗑️)
4. Continuar con 2FA IG, mail WA Business app

**Si el diseñador no respondió aún**:
1. Avanzar con tareas independientes: 2FA IG (desde cel), mail WA Business app, 2FA ventaxml2020
2. Esperar respuesta y volver al plan A

---

## Próximos pasos pendientes (en orden, completo)

### Etapa 1 — Cerrar la unificación de contactos (requiere diseñador)
- ⏳ Click "Siguiente" en pantalla pendiente del Centro de cuentas (reemplaza mail del diseñador en IG y Threads)
- ⏳ Confirmar eliminación de `davincidigitalediciones@gmail.com`
- ⏳ Eliminar `+5491122523624` (confirmado del diseñador)

### Etapa 2 — Eliminar diseñador del Business Manager
- ⏳ Pedirle que renuncie a "Control total como creador" del IG desde SU FB
- ⏳ Confirmar Página FB libera permisos
- ⏳ Eliminar usuario Da Vinci DIGITAL del Portfolio (🗑️)

### Etapa 3 — 2FA en Instagram (independiente)
- ⏳ Probar desde el cel (workaround del bloqueo de "dispositivo no habitual")
- ⏳ Si falla en cel también: esperar 24-48h y reintentar PC
- ⏳ Guardar códigos de respaldo

### Etapa 4 — 2FA en `ventaxml2020@gmail.com` (backup importante)
- ⏳ Mismo proceso que `redes@`: Authenticator + códigos de respaldo
- ⏳ Lo necesitamos blindado mientras siga siendo backup

### Etapa 5 — WhatsApp Business app
- ⏳ Cambiar mail del perfil empresa a `redes@uniproveedores.com.ar`
- ⏳ Verificar 2FA del WhatsApp (PIN de 6 dígitos)

### Etapa 6 — Verificación del negocio (RECHAZADA actualmente)
- ⏳ Revisar motivos del rechazo en Business Manager → Información del negocio
- ⏳ Reaplicar con documentación correcta:
  - CUIT 30-71532771-2
  - Razón social que matchee
  - Factura de servicio reciente del domicilio Bacacay 4726
  - Web https://uniproveedores.com.ar/

### Etapa 7 — Limpieza final (30 días después)
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

## Trabajo paralelo no-Meta (también hecho en estas sesiones)

### Fix bot WhatsApp (sábado 2026-06-13)
- **Bug**: el bot mandaba "¿algo más?" follow-up incluso después de que la asesora cerrara con "gracias por escribirnos"
- **Fix**: detección de ~10 patrones de cierre en español rioplatense en `bridge/wa-bridge.mjs`
- **PR #22**: mergeado a main
- **Deploy**: VPS Hostinger, `pm2 restart wa-bridge` ejecutado ✅
- **Bridge corriendo**: ✅ verificado en logs

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
