# SocialFlow · Bridge open-wa

Pequeño servicio Node que conecta tu WhatsApp Web con los webhooks de SocialFlow corriendo en Vercel. Es **temporal** mientras Meta verifica tu cuenta para Cloud API — apenas tengas el token oficial, switcheás `WA_PROVIDER=meta` y este bridge se puede apagar.

## Arquitectura

```
[Cliente WhatsApp]
       │
       ▼
[WhatsApp Web] ◄──► [Bridge open-wa]  (este servicio, en VPS/Railway)
                          │  POST /api/wa/webhook (con secret)
                          ▼
                   [Vercel / SocialFlow]
                          │  POST /send  (con secret)
                          ▼
                   [Bridge open-wa]
                          │
                          ▼
                  [Cliente WhatsApp]
```

## Variables de entorno

| Var | Requerido | Descripción |
|---|---|---|
| `VERCEL_WEBHOOK_URL` | sí | URL completa del webhook, ej. `https://socialflow-flax.vercel.app/api/wa/webhook` |
| `BRIDGE_SECRET` | sí | String aleatorio (mismo valor en Vercel: `WA_BRIDGE_SECRET`) |
| `PORT` | no | Default 3000 |
| `SESSION_ID` | no | Nombre de la sesión open-wa. Default `uniproveedores` |

## Deploy rápido — Railway ($5/mes hobby)

1. Crear cuenta en [Railway](https://railway.app)
2. New Project → "Deploy from GitHub" → seleccionar el repo `ventas-sys/socialflow`
3. En el menú "Settings" → "Root Directory" poné `openwa-bridge`
4. En "Variables" agregá:
   - `VERCEL_WEBHOOK_URL=https://TU-DOMINIO-VERCEL/api/wa/webhook`
   - `BRIDGE_SECRET=algo-random-largo-y-secreto`
5. Deploy. Cuando termine, abrí `https://TU-APP.railway.app/qr` y escaneá el QR con el celu del número de empresa.
6. En Vercel, en Settings → Environment Variables agregá:
   - `WA_PROVIDER=openwa`
   - `WA_BRIDGE_URL=https://TU-APP.railway.app`
   - `WA_BRIDGE_SECRET=` (el mismo del paso 4)
7. Redeploy Vercel.

## Deploy alternativo — Fly.io (gratis con tarjeta)

```bash
cd openwa-bridge
fly launch  # detecta el Dockerfile y te genera fly.toml
fly secrets set VERCEL_WEBHOOK_URL=https://... BRIDGE_SECRET=...
fly deploy
fly open /qr
```

## Limitaciones de open-wa

- ⚠️ **No oficial**: WhatsApp puede banear el número (riesgo bajo con cuenta de empresa exclusiva)
- Si el bridge se reinicia podés perder la sesión y haber que rescanear QR (por eso usamos volumen persistente)
- Solo mensajes de texto en este MVP — media (audios, fotos) no se procesan
- Mensajes de grupos se ignoran

## Cuando llegue Meta Cloud API

Apenas tengas las credenciales de Meta:

1. En Vercel cambiá `WA_PROVIDER=meta` y agregá `WA_META_PHONE_NUMBER_ID`, `WA_META_ACCESS_TOKEN`, `WA_META_VERIFY_TOKEN`
2. En el panel de Meta apuntá el webhook a `https://TU-DOMINIO-VERCEL/api/wa/webhook`
3. Apagá Railway (o dejalo de backup unos días)

Listo: la misma lógica del bot sigue funcionando, solo cambió el transporte.
