FROM node:20-alpine

# Habilitar corepack para gerenciar npm/yarn
RUN corepack enable

WORKDIR /app

# Copiar manifesto raiz e configurações
COPY package.json package-lock.json ./
COPY tsconfig.json ./
COPY packages/shared ./packages/shared
COPY infra ./infra
COPY services/crm-service ./services/crm-service

# Instalar dependências de todos os workspaces referenciados
RUN npm install

# Fazer o build do pacote compartilhado
RUN npm run build -w packages/shared

# Fazer o build do crm-service
RUN npm run build -w services/crm-service

# Porta que o crm-service vai expor (Railway usa PORT via env, fallback 3002)
EXPOSE 3002

CMD ["npm", "start", "-w", "services/crm-service"]
