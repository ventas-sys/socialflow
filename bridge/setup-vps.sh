#!/usr/bin/env bash
# Setup del bridge open-wa en un VPS Ubuntu 24.04 (Hostinger KVM).
# Uso: bash setup-vps.sh
# Idempotente: lo podés correr de vuelta sin romper nada.

set -e

echo "==> Actualizando lista de paquetes..."
apt-get update -y

echo "==> Instalando Node 20 si no está..."
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "==> Instalando dependencias del sistema para Chromium (Ubuntu 24.04 t64)..."
apt-get install -y \
  git \
  ca-certificates fonts-liberation \
  libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libc6 libcairo2 \
  libcups2t64 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc-s1 \
  libglib2.0-0t64 libgtk-3-0t64 libnspr4 libnss3 libpango-1.0-0 \
  libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 \
  libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 \
  libxrandr2 libxrender1 libxtst6 lsb-release wget xdg-utils

echo "==> Instalando PM2 globalmente..."
npm install -g pm2

echo "==> Clonando repo (si no existe) y haciendo pull..."
cd /opt
if [ ! -d socialflow ]; then
  git clone https://github.com/ventas-sys/socialflow.git
fi
cd socialflow
git fetch --all
git checkout claude/wa-rules-engine
git pull
cd bridge

echo "==> Instalando dependencias del bridge (puede tardar, baja Chromium ~150MB)..."
npm install

echo ""
echo "================================================================"
echo "  ✅ Setup base listo en /opt/socialflow/bridge"
echo "================================================================"
echo ""
echo "Siguiente paso: configurar el .env"
echo ""
echo "  cd /opt/socialflow/bridge"
echo "  cp .env.example .env"
echo "  nano .env             # pegale el token de Vercel"
echo ""
echo "Y arrancar el bridge:"
echo ""
echo "  pm2 start wa-bridge.mjs --name wa-bridge"
echo "  pm2 logs wa-bridge    # vas a ver el QR; escanealo con WA Business"
echo "  pm2 save"
echo "  pm2 startup           # pegá el comando que imprime"
echo "================================================================"
