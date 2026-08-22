# Setup MCP de Mercado Libre en Claude Code

> **Tiempo estimado**: 10-15 min
> **Resultado**: Claude puede leer tus publicaciones, fotos, descripciones, reseñas, preguntas, ventas y visitas de Mercado Libre directamente desde el chat

---

## ✅ Lo que vas a lograr

Después de seguir esta guía:
- Yo (Claude) puedo **listar tus cuentas de Mercado Libre** conectadas (FULL y LOCAL)
- Puedo **mostrarte una publicación** con fotos, precio, stock y atributos
- Puedo **leer la descripción completa** de cualquier publicación
- Puedo **traer las reseñas** que dejaron los compradores
- Puedo **buscar entre tus publicaciones** por texto o estado
- Puedo **leer las preguntas** (respondidas y sin responder)
- Puedo **consultar tus órdenes/ventas** en un rango de fechas
- Puedo **ver las visitas** de una publicación o de la cuenta completa
- Puedo **consultar el estado de un envío**

Todo esto **sin crear ninguna app OAuth nueva**: el MCP reutiliza el mismo `ML_ACCOUNTS` que ya generás desde `conexiones.html` y ya tenés cargado en Vercel.

---

## 📋 Pre-requisitos

- ✅ Ya conectaste Mercado Libre desde `conexiones.html` y tenés el `ML_ACCOUNTS` (JSON) cargado en Vercel — es el mismo que usa `lib/ml/qa-config.js` para el Agente de Preguntas
- ✅ Node.js 20 o superior instalado en tu PC
- ✅ Claude Code instalado y funcionando
- ✅ El repo `socialflow` clonado en tu PC (esta carpeta)

> 💡 A diferencia del setup de YouTube, acá **no hay que crear ninguna app ni pantalla de consentimiento**: la app de Mercado Libre y los tokens (`refresh_token`) ya existen, este MCP solo los **lee** desde `mcp-ml/.env`.

---

## 🟢 PASO 1 — Conseguir tu `ML_ACCOUNTS` (2 min)

Tenés dos formas, usá la que te resulte más rápida:

### Opción A — Copiarlo desde Vercel (si ya lo tenés cargado ahí)

1. Andá a **https://vercel.com** → tu proyecto `socialflow`
2. **Settings** → **Environment Variables**
3. Buscá la variable **`ML_ACCOUNTS`**
4. Click en el ícono de "ojo" o "editar" para ver el valor → **copialo entero** (es un JSON que arranca con `[` y termina con `]`)

### Opción B — Re-exportarlo desde `conexiones.html`

1. Abrí `conexiones.html` en tu navegador (donde ya conectaste Mercado Libre)
2. Bajá hasta la tarjeta **🛒 Mercado Libre**
3. Si las cuentas ya están guardadas ahí, vas a ver el botón **"📋 Copiar ML_ACCOUNTS (todas las guardadas)"** — tocalo
4. Eso copia el JSON completo (con las 2 cuentas, FULL + LOCAL) a tu portapapeles

> ⚠️ El texto que se **muestra en pantalla** viene con `•••` a propósito (para que no se filtre en fotos/capturas). El botón copia el **valor real** al portapapeles, no lo que ves en el cuadro de texto.

---

## 🟢 PASO 2 — Crear `mcp-ml/.env` (2 min)

1. En la carpeta del repo, entrá a `mcp-ml/`
2. Copiá el archivo de ejemplo:
   ```bash
   cd mcp-ml
   cp .env.example .env
   ```
3. Abrí `mcp-ml/.env` con un editor de texto
4. Reemplazá el valor de `ML_ACCOUNTS` por el JSON que copiaste en el Paso 1, en **una sola línea**:
   ```
   ML_ACCOUNTS=[{"label":"full","mode":"full","user_id":80460157,"client_id":"...","client_secret":"...","refresh_token":"..."},{"label":"local","mode":"local","user_id":46539072,"client_id":"...","client_secret":"...","refresh_token":"..."}]
   ```
5. Guardá el archivo

✅ Ese archivo queda **solo en tu PC**, nunca se sube al repo (ver sección de seguridad más abajo).

---

## 🟢 PASO 3 — Instalar dependencias (2 min)

Desde la carpeta `mcp-ml/`:

```bash
npm install
```

Esto instala `@modelcontextprotocol/sdk` y `dotenv`, que son las únicas dependencias del servidor.

---

## 🟢 PASO 4 — Registrar el servidor MCP (3 min)

### Opción A — Claude Code (automático, recomendado)

En la raíz del repo ya existe el archivo **`.mcp.json`** (committeado, sin secretos — solo apunta al script):

```json
{
  "mcpServers": {
    "mercadolibre": {
      "command": "node",
      "args": ["mcp-ml/server.mjs"]
    }
  }
}
```

Claude Code lo **detecta solo** al abrir el proyecto en esta carpeta. No hace falta que hagas nada acá, solo confirmá cuando te pregunte si confiás en el proyecto/servidor MCP.

### Opción B — CLI manual (otros clientes MCP, ej. Claude Desktop)

Si querés registrarlo a mano (u otro cliente MCP que no lee `.mcp.json`, como Claude Desktop), usá el comando:

```bash
claude mcp add mercadolibre -- node /ruta/absoluta/a/socialflow/mcp-ml/server.mjs
```

O agregalo directo en el config de Claude Desktop:

```json
// ~/.config/Claude/claude_desktop_config.json (Linux)
// %APPDATA%/Claude/claude_desktop_config.json (Windows)
// ~/Library/Application Support/Claude/claude_desktop_config.json (Mac)
{
  "mcpServers": {
    "mercadolibre": {
      "command": "node",
      "args": ["/ruta/absoluta/a/socialflow/mcp-ml/server.mjs"]
    }
  }
}
```

> 💡 Usá la **ruta absoluta** al `server.mjs` (no relativa) en esta opción manual. El servidor carga `mcp-ml/.env` automáticamente, no hace falta poner las credenciales en el bloque `env` del config.

---

## 🟢 PASO 5 — Reiniciar / recargar el MCP (1 min)

1. Cerrá Claude Code por completo y volvé a abrirlo en la carpeta del repo
2. (Si usás Claude Desktop) cerralo y abrilo de nuevo
3. Verificá que el servidor `mercadolibre` aparezca conectado (comando `/mcp` en Claude Code, o el panel de MCP servers)

✅ MCP registrado y operativo.

---

## 🟢 PASO 6 — Probar con algunos prompts

En Claude Code, probá:

```
Listame mis cuentas de Mercado Libre.
```

```
Mostrame la publicación MLA123456789 con fotos y descripción.
```

```
Traeme las reseñas de MLA123456789.
```

```
¿Cuánto vendí este mes?
```

Si responde con datos reales de tus cuentas (FULL / LOCAL) → 🎉 todo conectado.

Si falla → revisá la tabla de troubleshooting abajo.

---

## 🧰 Herramientas (tools) disponibles

| Tool | Qué hace |
|---|---|
| `ml_list_accounts` | Lista las cuentas de ML configuradas (label, modo, user_id) sin exponer tokens |
| `ml_get_item` | Trae el detalle de una publicación: título, precio, stock, fotos, atributos |
| `ml_get_item_description` | Trae el texto completo de la descripción de una publicación |
| `ml_get_item_reviews` | Trae las reseñas y calificaciones que dejaron los compradores |
| `ml_search_my_items` | Busca entre tus publicaciones por texto o estado, en una sola cuenta por llamada (la indicada en `account`, o la única configurada). Para buscar en FULL y LOCAL hay que hacer dos llamadas |
| `ml_get_questions` | Trae las preguntas de una publicación (respondidas y sin responder) |
| `ml_get_orders` | Trae las órdenes/ventas en un rango de fechas |
| `ml_get_item_visits` | Trae las visitas de una publicación en un período |
| `ml_get_account_visits` | Trae las visitas totales de la cuenta/vendedor en un período |
| `ml_get_shipment` | Trae el estado y detalle de un envío asociado a una orden |

---

## 🆘 Troubleshooting

| Síntoma | Solución |
|---|---|
| El servidor `mercadolibre` no aparece en `/mcp` | Verificá que estás abriendo Claude Code desde la raíz del repo (donde está `.mcp.json`) y reiniciá completo |
| "Cannot find module '@modelcontextprotocol/sdk'" | Te faltó correr `npm install` dentro de `mcp-ml/` |
| El agente dice que no ve ninguna cuenta (0 cuentas) | Revisá que `mcp-ml/.env` tenga la variable `ML_ACCOUNTS` bien pegada, en una sola línea, con JSON válido |
| Error de JSON inválido al levantar el servidor | Probablemente copiaste el valor con los `•••` de la vista enmascarada en vez del valor real del portapapeles. Volvé al Paso 1 y usá el botón "Copiar" |
| Datos desactualizados o "token expirado" | Los `refresh_token` de ML se renuevan solos al usarse; si el error persiste, reconectá esa cuenta desde `conexiones.html` y volvé a copiar `ML_ACCOUNTS` |
| "El refresh_token ya no sirve (vencido o YA USADO)" | Falta el KV compartido (ver el aviso de abajo): reconectá la cuenta, actualizá `ML_ACCOUNTS` y cargá `KV_REST_API_URL` / `KV_REST_API_TOKEN` |
| Cambié `mcp-ml/.env` y no se aplica | Reiniciá Claude Code (o el cliente MCP) para que el proceso del servidor se relance y vuelva a leer el `.env` |

---

---

## ⚠️ IMPORTANTE — compartir el token con el Agente de Preguntas

El `refresh_token` de Mercado Libre es **de un solo uso**: cada renovación devuelve uno nuevo e
**invalida el anterior**. Si este MCP renueva por su cuenta, **rompe el token que usa el Agente
de Preguntas en Vercel** y Tatiana deja de responder (fue exactamente lo que pasó el 22-ago-2026).

Para que los dos compartan el mismo token guardado, agregá en `mcp-ml/.env` las **mismas**
variables de KV que tenés en Vercel:

```
KV_REST_API_URL=https://...
KV_REST_API_TOKEN=...
```

Sin esas variables, usá el MCP con cuidado: después de consultarlo, revisá el botón
**🩺 ¿Por qué no responde?** en `/conexiones`.

---

## 🔒 Seguridad — qué NO compartir

- 🚫 NUNCA subas `mcp-ml/.env` al repo (ya está en `mcp-ml/.gitignore`, pero revisá antes de cualquier commit)
- 🚫 NUNCA pegues el valor de `ML_ACCOUNTS` en un chat, ticket, mail o issue de GitHub — contiene `client_secret` y `refresh_token` de tus cuentas reales de Mercado Libre
- 🚫 NUNCA subas capturas de pantalla del `.env` o del textarea de `conexiones.html` sin verificar que los tokens estén tapados
- ✅ Si por error lo compartiste: reconectá esa cuenta desde `conexiones.html` (esto genera un `refresh_token` nuevo) y actualizá tanto Vercel como tu `mcp-ml/.env` local
- ✅ `mcp-ml/.env` vive **solo en tu PC**, no en Vercel — el `.mcp.json` del repo no tiene secretos, solo apunta al script del servidor

---

## 🔗 Referencias

- `lib/ml/qa-config.js` — mismo formato de `ML_ACCOUNTS` que usa el Agente de Preguntas
- `conexiones.html` — de donde se genera/copia `ML_ACCOUNTS`
- `mcp-ml/.env.example` — plantilla de configuración del servidor
- MCP servers oficial: https://github.com/modelcontextprotocol/servers
- Mercado Libre Developers: https://developers.mercadolibre.com.ar
