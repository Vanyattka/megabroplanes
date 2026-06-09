# Multi-stage: build the game with Vite, then run a single Node process that
# serves the static build AND the multiplayer WebSocket relay (server.js with
# STATIC_DIR set). One container hosts the whole game behind a reverse proxy.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY --from=build /app/dist ./dist
ENV PORT=3030 STATIC_DIR=/app/dist
EXPOSE 3030
CMD ["node", "server/server.js"]
