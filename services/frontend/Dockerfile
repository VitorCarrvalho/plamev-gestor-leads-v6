FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY tsconfig.json ./
COPY packages/shared ./packages/shared
COPY services/frontend ./services/frontend

RUN npm install
RUN npm run build -w packages/shared
RUN npm run build -w services/frontend

FROM node:20-alpine AS runner
WORKDIR /app

RUN npm install -g serve

COPY --from=builder /app/services/frontend/dist ./dist
COPY services/frontend/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

EXPOSE 3000

# entrypoint.sh gera /app/dist/env-config.js com as env vars em runtime,
# depois sobe o serve com SPA fallback (-s)
CMD ["sh", "./entrypoint.sh"]
