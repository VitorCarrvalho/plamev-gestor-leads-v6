FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY tsconfig.json ./
COPY packages/shared ./packages/shared
COPY services/frontend ./services/frontend

# Railway passa env vars como build args automaticamente
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

# Serve the static files. Railway will provide the PORT env var, 
# but we default to 3000 as configured in Railway Custom Domain.
CMD ["sh", "-c", "serve -s dist -l ${PORT:-3000}"]
