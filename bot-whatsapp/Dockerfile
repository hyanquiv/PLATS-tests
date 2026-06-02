FROM node:20-alpine

RUN apk add --no-cache \
    git python3 make g++ \
    cairo-dev pango-dev libjpeg-turbo-dev giflib-dev librsvg-dev \
    ttf-freefont font-noto fontconfig

RUN fc-cache -fv

WORKDIR /app
COPY package.json ./
RUN npm install
COPY src/ ./src/

RUN mkdir -p /app/sessions /app/credentials /app/logs

EXPOSE 3001
CMD ["node", "src/index.js"]
