#!/usr/bin/env bash
# Auto-deploy del bridge de WhatsApp.
# Si hay cambios nuevos en la rama main, actualiza el código y reinicia el bot.
# Pensado para correr por cron cada pocos minutos (entorno mínimo).

# Cargar node/pm2 (nvm) — cron no trae el PATH del login.
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1

REPO="${SOCIALFLOW_DIR:-/opt/socialflow}"
cd "$REPO" 2>/dev/null || exit 0

BEFORE="$(git rev-parse HEAD 2>/dev/null)"
git fetch origin main --quiet 2>/dev/null || exit 0
AFTER="$(git rev-parse origin/main 2>/dev/null)"

# Sin cambios: no hacemos nada.
[ "$BEFORE" = "$AFTER" ] && exit 0

# ¿Cambió código que usa el bot? (bridge o librerías del bot). Si solo cambió
# documentación (docs/, *.md) NO reiniciamos: reiniciar corta la sesión de WhatsApp.
CHANGED="$(git diff --name-only "$BEFORE" "$AFTER" 2>/dev/null)"

git pull origin main --quiet 2>/dev/null

if echo "$CHANGED" | grep -qE '^(bridge/|lib/wa/|lib/google/)'; then
  pm2 restart wa-bridge >/dev/null 2>&1
  echo "$(date '+%Y-%m-%d %H:%M:%S') auto-deploy: ${BEFORE:0:7} -> ${AFTER:0:7} (reinicio: cambió código del bot)"
else
  echo "$(date '+%Y-%m-%d %H:%M:%S') auto-deploy: ${BEFORE:0:7} -> ${AFTER:0:7} (solo docs/otros: sin reinicio)"
fi
