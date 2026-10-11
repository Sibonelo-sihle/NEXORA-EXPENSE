FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY server ./server
RUN npm run build:server

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production SERVE_FRONTEND=false BIND_HOST=0.0.0.0 RELEASE_SANDBOX_ONLY=true PAYFAST_MODE=sandbox PAYFAST_LIVE_ENABLED=false
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist-server ./dist-server
USER node
EXPOSE 10000
CMD ["node", "dist-server/index.js"]
