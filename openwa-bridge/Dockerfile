FROM node:20-slim

# Dependencias de Chrome que necesita open-wa (lo bundlea con Puppeteer)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 \
    libatk1.0-0 libcups2 libdbus-1-3 libdrm2 libgbm1 libnspr4 libnss3 \
    libx11-xcb1 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libxss1 \
    libxtst6 wget xdg-utils \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY index.js ./

# Las sesiones se guardan en este volumen — montalo persistente en tu host
RUN mkdir -p /app/sessions
VOLUME /app/sessions

EXPOSE 3000
CMD ["node", "index.js"]
