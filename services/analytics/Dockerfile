FROM node:20-alpine

RUN corepack enable
WORKDIR /app

COPY package.json package-lock.json ./
COPY tsconfig.json ./
COPY packages/shared ./packages/shared
COPY infra ./infra
COPY services/analytics ./services/analytics

RUN npm install
RUN npm run build -w packages/shared
RUN npm run build -w services/analytics

EXPOSE 3004

CMD ["npm", "start", "-w", "services/analytics"]
