FROM node:20-alpine

RUN corepack enable
WORKDIR /app

COPY package.json package-lock.json ./
COPY tsconfig.json ./
COPY packages/shared ./packages/shared
COPY services/gateway ./services/gateway

RUN npm install
RUN npm run build -w packages/shared
RUN npm run build -w services/gateway

EXPOSE 8080

CMD ["npm", "start", "-w", "services/gateway"]
