# Setup YouTube Data API + MCP en Claude Code

> **Tiempo estimado**: 60-90 min
> **Para hacer**: mañana (2026-06-26)
> **Resultado**: Claude puede leer tus playlists, videos, comentarios y eventualmente publicar Shorts

---

## ✅ Lo que vas a lograr

Después de seguir esta guía:
- Yo (Claude) puedo leer tu **playlist "Watch Later"** y cualquier otra
- Puedo analizar **títulos, descripciones, transcripts** de los videos que mires
- Puedo **buscar videos** del canal de Uniproveedores
- (Opcional avanzado) Puedo **publicar Shorts** programáticamente desde el flujo de `social.html`

---

## 📋 Pre-requisitos

- ✅ Mail `redes@uniproveedores.com.ar` con login Google Workspace funcionando
- ✅ Acceso a Google Cloud Console con esa cuenta
- ✅ Claude Code instalado y configurado en tu PC (Windows/Mac/Linux)
- ✅ 2FA activa en `redes@` (ya lo tenés)
- 🟡 Tener identificado el **canal de YouTube de Uniproveedores** (si no existe canal de marca, lo creamos primero — paso 0 más abajo)

---

## 🔵 PASO 0 — Verificar/crear canal de YouTube de Uniproveedores

Antes de tocar APIs, asegurate de tener un **canal de marca** asociado a `redes@`.

1. Andá a https://www.youtube.com mientras estás logueada con `redes@uniproveedores.com.ar`
2. Click en tu avatar (esquina superior derecha) → **"Cambiar de cuenta"**
3. Si ves "Uniproveedores" en la lista → ✅ canal existe, elegilo
4. Si NO ves nada con marca → tenés que crear el canal:
   - Click en avatar → **"Crear un canal"**
   - Elegí **"Canal de marca"** (NO canal personal)
   - Nombre: `Uniproveedores` o `Uniproveedores ok`
   - Logo: usá el isotipo (engranaje con destello) que está en `index.html` o el que ya usás en FB/IG
   - Listo

> 💡 **¿Por qué canal de marca y no personal?** El de marca permite varios admins (futuro), tiene branding, y se puede vincular al Business Portfolio Meta para tracking cruzado.

---

## 🟢 PASO 1 — Crear proyecto en Google Cloud Console (5 min)

1. Andá a **https://console.cloud.google.com**
2. Logueate con `redes@uniproveedores.com.ar`
3. Arriba a la izquierda, click en el **selector de proyectos** (al lado de "Google Cloud")
4. **"NUEVO PROYECTO"** (botón arriba a la derecha)
5. Configurá:
   - **Nombre del proyecto**: `Uniproveedores Social Automation`
   - **Organización**: deja la default (o vacío si no hay)
   - **Ubicación**: deja la default
6. **"CREAR"**
7. Esperá 30 segundos a que se cree
8. **Importante**: al volver al dashboard, asegurate de tener el nuevo proyecto seleccionado en el selector

> 📸 Si no aparece seleccionado, click en el selector → buscá "Uniproveedores Social Automation" → seleccionalo

---

## 🟢 PASO 2 — Habilitar YouTube Data API v3 (3 min)

1. En la barra de búsqueda arriba de Google Cloud Console, tipeá: `YouTube Data API v3`
2. Click en **"YouTube Data API v3"** (con ícono rojo de YouTube)
3. **"HABILITAR"** (botón azul grande)
4. Espera unos segundos. Cuando termine, te lleva al panel de la API

✅ API habilitada.

---

## 🟢 PASO 3 — Configurar pantalla de consentimiento OAuth (10 min)

Esto es lo que YouTube te muestra cuando le das permisos a tu app.

1. Menú izquierdo → **"APIs y servicios"** → **"Pantalla de consentimiento de OAuth"**
2. Tipo de usuario: **"Externo"** → CREAR

   > 💡 Aunque solo lo usés vos, "Externo" es lo correcto si no tenés Google Workspace Enterprise.

3. Pantalla 1 — Información de la app:
   - **Nombre de la app**: `Uniproveedores Claude Bridge`
   - **Correo electrónico de asistencia**: `redes@uniproveedores.com.ar`
   - **Logotipo de la app**: opcional (podés subir el iso de Uniproveedores)
   - **Dominio de la aplicación**: dejá vacío
   - **Datos de contacto del desarrollador**: `redes@uniproveedores.com.ar`
   - GUARDAR Y CONTINUAR

4. Pantalla 2 — Permisos:
   - **AGREGAR O QUITAR PERMISOS**
   - En la lista de la derecha, buscá y marcá estos scopes:
     - `https://www.googleapis.com/auth/youtube.readonly` (leer playlists, videos, info)
     - `https://www.googleapis.com/auth/youtube.upload` (subir videos) ← opcional, agregar si querés que pueda publicar
     - `https://www.googleapis.com/auth/youtube.force-ssl` (manejar tu canal completo)
   - **ACTUALIZAR** → **GUARDAR Y CONTINUAR**

5. Pantalla 3 — Usuarios de prueba:
   - **AGREGAR USUARIOS**
   - Agregá `redes@uniproveedores.com.ar`
   - (Opcional) Agregá `ventaxml2020@gmail.com` como backup
   - GUARDAR Y CONTINUAR

6. Pantalla 4 — Resumen:
   - Revisá todo
   - **VOLVER AL PANEL**

> 💡 **¿Aparece advertencia "App no verificada"?** Normal mientras la app esté en modo de prueba. Como solo la usás vos como "usuario de prueba", funciona sin problemas. La verificación oficial es solo para apps que distribuyen a terceros.

---

## 🟢 PASO 4 — Crear credenciales OAuth Client ID (5 min)

1. Menú izquierdo → **"APIs y servicios"** → **"Credenciales"**
2. **"+ CREAR CREDENCIALES"** (arriba) → **"ID de cliente de OAuth"**
3. **Tipo de aplicación**: **"Aplicación de escritorio"** (importante, NO web)
4. **Nombre**: `Claude Code MCP - Uniproveedores`
5. **CREAR**
6. Se abre modal con `Client ID` y `Client Secret`:
   - 📋 **COPIÁ AMBOS** y pegalos en un lugar seguro (gestor de passwords o nota privada)
   - ⚠️ El Client Secret no lo vas a poder ver de nuevo, solo regenerar
   - **DESCARGAR JSON** (botón "Descargar JSON") → guardá ese archivo, lo vas a usar

✅ Credenciales OAuth generadas.

---

## 🟢 PASO 5 — Instalar MCP de YouTube en Claude Code (15 min)

Hay varios MCPs de YouTube disponibles. Recomiendo `youtube-data-mcp-server` por simpleza.

### Opción A — Usar un MCP existente de la comunidad

```bash
# En tu PC, terminal:
npm install -g @modelcontextprotocol/server-youtube-data
```

> 🟡 **Verificar el paquete primero**: el ecosistema MCP evoluciona rápido. Antes de instalar, buscá en https://github.com/modelcontextprotocol/servers o https://mcp.so el server más actualizado para YouTube. Si el oficial no existe, hay varios de la comunidad.

### Opción B — MCP custom (más control, lo armamos juntos mañana)

Si no encontramos un MCP estable, te armo uno custom en Node.js (1-2 horas):
- Lee tu OAuth credentials
- Expone tools: `youtube_list_playlists`, `youtube_get_video`, `youtube_search`, `youtube_upload_short`
- Vive en `bridge/youtube-mcp.mjs`

Mañana decidimos según lo que esté disponible.

### Configurar el MCP en Claude Code

Una vez instalado, agregalo a tu config:

```json
// ~/.config/claude/claude_desktop_config.json (Linux/Mac)
// %APPDATA%/Claude/claude_desktop_config.json (Windows)
{
  "mcpServers": {
    "youtube": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-youtube-data"],
      "env": {
        "YOUTUBE_CLIENT_ID": "TU_CLIENT_ID_DE_PASO_4",
        "YOUTUBE_CLIENT_SECRET": "TU_CLIENT_SECRET_DE_PASO_4",
        "YOUTUBE_REDIRECT_URI": "http://localhost:3000/oauth2callback"
      }
    }
  }
}
```

Reiniciá Claude Code (cerralo y abrilo de nuevo).

---

## 🟢 PASO 6 — Primera autenticación OAuth (5 min)

La primera vez que Claude use el MCP, te va a pedir autorizar:

1. Abrí Claude Code
2. Pedile algo simple tipo: *"Listame mis playlists de YouTube"*
3. El MCP va a abrir tu navegador automáticamente
4. Logueate con `redes@uniproveedores.com.ar`
5. Te muestra la pantalla de consentimiento con los permisos
6. **PERMITIR**
7. Te redirige a `localhost:3000/...` (puede mostrar página en blanco — normal)
8. Volvé a Claude Code → debería responder con tus playlists

✅ MCP autenticado y operativo.

---

## 🟢 PASO 7 — Test con tu playlist

En Claude Code, probá:

```
Listame los videos de mi playlist "Watch Later".
Quiero saber títulos, canales y temas dominantes.
```

Si responde bien → 🎉 todo conectado.

Si falla → mandame el error y vemos.

---

## 🆘 Troubleshooting

| Síntoma | Solución |
|---|---|
| "Access denied" en OAuth | Volvé al paso 3 y verificá que `redes@` esté en "Usuarios de prueba" |
| MCP no aparece en Claude | Verificá ruta del config + reinicio completo de Claude Code |
| "Quota exceeded" | La API gratuita tiene 10,000 unidades/día. Es muchísimo, no debería pasarte. Si pasa, esperá 24h |
| Token expirado después de un día | Normal en modo prueba. Re-autenticá cuando te lo pida |
| No me deja crear canal de marca en YouTube | Probá desde el cel con la app de YouTube, suele ser más fácil |

---

## 🔒 Seguridad — qué NO compartir

- 🚫 NUNCA pegues el `Client Secret` en chat con Claude, ni en GitHub, ni en mails
- 🚫 NUNCA subas el archivo JSON descargado a un repo público
- ✅ Guardalo en tu gestor de passwords o en `~/.config/uniproveedores/youtube-oauth.json` (fuera del repo)
- ✅ Si por error lo leakeas: regenerá el client secret desde Google Cloud Console → Credenciales → editar → "Restablecer secreto"

---

## 📅 Plan mañana

1. Empezás con paso 0 (verificar/crear canal)
2. Avanzás hasta paso 4 sola (todo es UI de Google)
3. Cuando llegues al paso 5, decime acá: te ayudo a elegir el MCP correcto y arrancamos el setup
4. Resolvemos juntos pasos 5-7
5. Test final + agregar módulo YouTube a `social.html`

**Total estimado mañana**: 2 horas si todo fluye, 4 si encontramos un MCP que requiere debug.

---

## 🔗 Referencias

- Google Cloud Console: https://console.cloud.google.com
- YouTube Data API v3 docs: https://developers.google.com/youtube/v3
- MCP servers oficial: https://github.com/modelcontextprotocol/servers
- MCP marketplace: https://mcp.so/
- Tutorial OAuth Desktop: https://developers.google.com/identity/protocols/oauth2/native-app
