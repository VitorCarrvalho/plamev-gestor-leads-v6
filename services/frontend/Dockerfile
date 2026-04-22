FROM node:20-alpine AS builder

RUN corepack enable
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

# Railway passará a variável de ambiente PORT, ou serve usa 3000
EXPOSE 3000

CMD ["serve", "-s", "dist", "-l", "tcp://0.0.0.0:3000"]
