FROM node:20-alpine

RUN apk add --no-cache \
    chromium nss freetype harfbuzz ca-certificates ttf-freefont \
    python3 make g++

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROMIUM_PATH=/usr/bin/chromium-browser

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src/ ./src/

RUN mkdir -p /app/sessions /app/credentials /app/logs

EXPOSE 3001
CMD ["node", "src/index.js"]
