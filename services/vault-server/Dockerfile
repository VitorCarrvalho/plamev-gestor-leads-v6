FROM node:22-alpine
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-package-lock

COPY src ./src
COPY vault ./vault

EXPOSE 8080
CMD ["node", "src/index.js"]
