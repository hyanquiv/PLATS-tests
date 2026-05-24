FROM node:20-alpine

RUN apk add --no-cache git python3 make g++

WORKDIR /app
COPY package.json ./
RUN npm install
COPY server.js ./

RUN mkdir -p /sessions

EXPOSE 8083
CMD ["node", "server.js"]
