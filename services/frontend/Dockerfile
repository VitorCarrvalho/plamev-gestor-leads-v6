FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY tsconfig.json ./
COPY packages/shared ./packages/shared
COPY services/frontend ./services/frontend

# Aceitar VITE_API_URL como build-arg (Railway passa na hora do build)
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}

RUN npm install
RUN npm run build -w packages/shared
RUN npm run build -w services/frontend

FROM node:20-alpine AS runner
WORKDIR /app

RUN npm install -g serve
COPY --from=builder /app/services/frontend/dist ./dist

EXPOSE 3000

# --single: redireciona qualquer rota desconhecida para index.html (SPA fallback)
# O Railway injeta $PORT automaticamente em runtime
CMD sh -c "serve -s dist -l tcp://0.0.0.0:${PORT:-3000}"
