FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY packages/shared/package*.json packages/shared/
COPY services/channel-service/package*.json services/channel-service/
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build -w packages/shared
RUN npm run build -w services/channel-service

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/packages/shared/package*.json packages/shared/
COPY --from=builder /app/services/channel-service/package*.json services/channel-service/
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/services/channel-service/dist services/channel-service/dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3002
CMD ["npm", "start", "-w", "services/channel-service"]
