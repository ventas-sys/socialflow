#!/usr/bin/env bash
# Setup del bridge open-wa en un VPS Ubuntu/Debian (Hostinger KVM).
# Uso: bash setup-vps.sh
# Pide al final que pegues WA_WEBHOOK_URL y WA_BRIDGE_TOKEN.

set -e

echo "==> Actualizando paquetes del sistema..."
apt-get update -y
apt-get upgrade -y

echo "==> Instalando Node 20 + dependencias de Chromium..."
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

apt-get install -y \
  git \
  chromium-browser \
  ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
  libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 \
  libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
  libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
  libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 \
  libxss1 libxtst6 lsb-release wget xdg-utils

echo "==> Instalando PM2 globalmente..."
npm install -g pm2

echo "==> Clonando repo (si no existe)..."
cd /opt
if [ ! -d socialflow ]; then
  git clone https://github.com/ventas-sys/socialflow.git
fi
cd socialflow/bridge
git pull

echo "==> Instalando dependencias del bridge..."
npm install

echo ""
echo "================================================================"
echo "Setup base listo. Ahora configurá las variables de entorno:"
echo ""
echo "Edita /opt/socialflow/bridge/.env con:"
echo "  WA_WEBHOOK_URL=https://TU-PROYECTO.vercel.app/api/wa/webhook"
echo "  WA_BRIDGE_TOKEN=<el-token-secreto-que-puseste-en-Vercel>"
echo "  WA_SESSION=uniproveedores"
echo "  WA_HUMAN_LABEL=HUMANO"
echo ""
echo "Después arranca con:"
echo "  cd /opt/socialflow/bridge"
echo "  pm2 start wa-bridge.mjs --name wa-bridge --update-env"
echo "  pm2 logs wa-bridge   # vas a ver el QR. Escanealo con WhatsApp Business"
echo "  pm2 save && pm2 startup    # para que arranque solo al reiniciar VPS"
echo "================================================================"
