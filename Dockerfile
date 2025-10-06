# Multi-stage build for production
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run client:build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Copy only what we need at runtime
COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/index.html ./index.html
# Default port is provided by platform; server reads PORT or falls back to 4322
ENV PORT=4322
EXPOSE 4322
CMD ["node", "server/index.js"]
