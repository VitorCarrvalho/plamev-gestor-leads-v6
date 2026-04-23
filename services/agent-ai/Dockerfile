FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY packages/shared/package*.json packages/shared/
COPY services/agent-ai/package*.json services/agent-ai/
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build -w packages/shared
RUN npm run build -w services/agent-ai

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/packages/shared/package*.json packages/shared/
COPY --from=builder /app/services/agent-ai/package*.json services/agent-ai/
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/services/agent-ai/dist services/agent-ai/dist
COPY --from=builder /app/infra ./infra
COPY --from=builder /app/node_modules ./node_modules
# Vault de prompts — copiado separadamente para sobreviver a builds sem conteúdo
RUN mkdir -p services/agent-ai/vault
COPY --from=builder /app/services/agent-ai/vault services/agent-ai/vault
EXPOSE 3001
CMD ["npm", "start", "-w", "services/agent-ai"]
