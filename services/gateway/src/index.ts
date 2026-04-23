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
const ANALYTICS_SERVICE_URL = process.env.ANALYTICS_SERVICE_URL || 'http://localhost:3004';

const app = express();
const server = http.createServer(app);

app.use(cors());

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'gateway' }));

// TODO: Auth Middleware (validar JWT e injetar x-org-id nos headers pro proxy)

// ── Reverse Proxies ──────────────────────────────────────────
const proxyLogger = (req: any, res: any, next: any) => {
  console.log(`[GATEWAY] ➡️  Proxying ${req.method} ${req.url}`);
  next();
};

const proxyOptions = (target: string) => ({
  target,
  changeOrigin: true,
  timeout: 5000, // 5 segundos de timeout interno
  proxyTimeout: 5000,
  onError: (err: any, req: any, res: any) => {
    console.error(`[GATEWAY] ❌ Proxy Error (${target}):`, err.message);
    res.status(504).json({ error: 'Gateway Timeout (Internal)', detail: err.message, target });
  },
  onProxyReq: (proxyReq: any, req: any) => {
    console.log(`[GATEWAY] 🚢 Sending request to: ${target}${req.url}`);
  }
});

app.use(proxyLogger);

// Proxy para Analytics (Stats, Auditoria, Análise)
app.use(['/api/stats', '/api/analisar', '/api/auditoria'], createProxyMiddleware({
  ...proxyOptions(ANALYTICS_SERVICE_URL),
  pathRewrite: { '^/api': '/api' }
}));

// Proxy para o CRM Service (Conversas, Agenda, Templates, DB)
app.use(['/api', '/db'], createProxyMiddleware({
  ...proxyOptions(CRM_SERVICE_URL),
  pathRewrite: { '^/api': '/api', '^/db': '/api/db' }
}));

// Proxy para Webhooks e canais (Evolution API / Telegram)
app.use('/webhooks', createProxyMiddleware({
  target: CHANNEL_SERVICE_URL,
  changeOrigin: true,
  pathRewrite: { '^/webhooks': '/webhooks' }
}));

// Proxy para comandos diretos à IA
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
