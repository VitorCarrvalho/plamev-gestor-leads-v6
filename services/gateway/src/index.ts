import express from 'express';
import http from 'http';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { Server } from 'socket.io';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.join(__dirname, '../../.env') });

const PORT = process.env.PORT || 3000;
const CRM_SERVICE_URL = process.env.CRM_SERVICE_URL || 'http://localhost:3002';
const CHANNEL_SERVICE_URL = process.env.CHANNEL_SERVICE_URL || 'http://localhost:3003';
const AGENT_AI_URL = process.env.AGENT_AI_URL || 'http://localhost:3001';

const app = express();
const server = http.createServer(app);

app.use(cors());

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'gateway' }));

// TODO: Auth Middleware (validar JWT e injetar x-org-id nos headers pro proxy)

// ── Reverse Proxies ──────────────────────────────────────────
// Proxy para o CRM Service (Painel / API de dados)
app.use('/api', createProxyMiddleware({
  target: CRM_SERVICE_URL,
  changeOrigin: true,
  pathRewrite: { '^/api': '/api' }
}));

// Proxy para Webhooks e canais (Evolution API / Telegram)
app.use('/webhooks', createProxyMiddleware({
  target: CHANNEL_SERVICE_URL,
  changeOrigin: true,
  pathRewrite: { '^/webhooks': '/webhooks' }
}));

// Proxy para comandos diretos à IA (se houver)
app.use('/ai', createProxyMiddleware({
  target: AGENT_AI_URL,
  changeOrigin: true,
  pathRewrite: { '^/ai': '/ai' }
}));

// ── WebSocket Server ─────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: '*' }
});

io.on('connection', (socket) => {
  console.log(`[SOCKET] 🟢 Cliente conectado: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`[SOCKET] 🔴 Cliente desconectado: ${socket.id}`);
  });

  // TODO: Implementar handlers de eventos (substituir server/websocket/socket.server.ts)
});

server.listen(PORT, () => {
  console.log(`[GATEWAY] 🚀 Rodando na porta ${PORT}`);
  console.log(`[GATEWAY] 🔗 CRM -> ${CRM_SERVICE_URL}`);
  console.log(`[GATEWAY] 🔗 Channels -> ${CHANNEL_SERVICE_URL}`);
});
