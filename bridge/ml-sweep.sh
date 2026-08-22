#!/bin/bash
# Red de seguridad del Agente de Preguntas de Mercado Libre.
#
# Le pega cada X minutos al endpoint de barrido: responde las preguntas que
# quedaron pendientes aunque el webhook de ML no haya entrado (o haya fallado).
#
# Instalar en el VPS (al lado de auto-deploy.sh):
#   chmod +x /opt/socialflow/bridge/ml-sweep.sh
#   crontab -e   ->   */5 * * * * /opt/socialflow/bridge/ml-sweep.sh >> /var/log/ml-sweep.log 2>&1
#
# Si en Vercel configuraste ML_SWEEP_KEY, ponela acá también (o exportala en el cron).
BASE="${ML_SWEEP_BASE:-https://socialflow-flax.vercel.app}"
KEY="${ML_SWEEP_KEY:-}"
LIMIT="${ML_SWEEP_LIMIT:-5}"

URL="$BASE/api/ml/questions?action=sweep&limit=$LIMIT"
[ -n "$KEY" ] && URL="$URL&key=$KEY"

RES=$(curl -sS --max-time 120 "$URL")
echo "$(date '+%F %T') $RES"
