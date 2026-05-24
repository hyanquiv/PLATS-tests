FROM node:20-bullseye-slim

# Instalar Chromium y todas sus dependencias de sistema
RUN apt-get update && apt-get install -y \
    chromium \
    libglib2.0-0 \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libx11-6 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgtk-3-0 \
    fonts-liberation \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Instalar @open-wa/wa-automate globalmente
RUN npm install -g @open-wa/wa-automate

WORKDIR /app
COPY config.json .

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

EXPOSE 8083

CMD ["wa-automate", \
     "--port", "8083", \
     "--session-id", "plats-session", \
     "--session-data-path", "/sessions", \
     "--webhook", "http://plats-bot:3001/webhook", \
     "--api-key", "plats_openwa_key", \
     "--headless", \
     "--in-docker", \
     "--disable-spins", \
     "--no-kill-on-logout", \
     "--qr-timeout", "0", \
     "--log-level", "verbose"]
