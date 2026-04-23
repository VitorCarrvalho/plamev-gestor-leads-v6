import express from 'express';
import http from 'http';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { Server } from 'socket.io';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.join(__dirname, '../../.env') });

const PORT = process.env.PORT || 8080;
const CRM_SERVICE_URL = process.env.CRM_SERVICE_URL || 'http://crm-service.railway.internal:8080';
const CHANNEL_SERVICE_URL = process.env.CHANNEL_SERVICE_URL || 'http://channel-service.railway.internal:8080';
const AGENT_AI_URL = process.env.AGENT_AI_URL || 'http://agent-ai.railway.internal:8080';
const ANALYTICS_SERVICE_URL = process.env.ANALYTICS_SERVICE_URL || 'http://analytics.railway.internal:8080';

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'gateway' }));

// ── Debug Network ─────────────────────────────────────────────
app.get('/debug-network', async (req, res) => {
  const targets = {
    crm_health: `${CRM_SERVICE_URL}/health`,
    crm_data: `${CRM_SERVICE_URL}/api/conversas`,
    analytics_health: `${ANALYTICS_SERVICE_URL}/health`,
    agent_health: `${AGENT_AI_URL}/health`,
    channels_health: `${CHANNEL_SERVICE_URL}/health`
  };

  const results: any = {};
  for (const [name, url] of Object.entries(targets)) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const resp = await fetch(url, { signal: controller.signal });
      results[name] = { status: resp.status, ok: resp.ok, url };
      clearTimeout(timeoutId);
    } catch (e: any) {
      results[name] = { error: e.message, ok: false, url };
    }
  }
  res.json(results);
});

// ── Reverse Proxies ──────────────────────────────────────────
// IMPORTANTE: montados em '/' para o Express NÃO remover o prefixo do path.
// Se usarmos app.use('/api', proxy), o Express strip '/api' antes de passar ao
// proxy middleware, e o CRM recebe '/conversas' em vez de '/api/conversas' → 404.
// Usamos pathFilter para filtrar quais requests cada proxy deve capturar.

const onError = (target: string) => (err: any, _req: any, res: any) => {
  console.error(`[GATEWAY] ❌ Proxy Error to ${target}:`, err.message);
  if (!res.headersSent) {
    res.status(504).json({ error: 'Gateway Timeout', detail: err.message });
  }
};

// Analytics — rotas específicas de /api antes do catch-all do CRM
app.use(createProxyMiddleware({
  target: ANALYTICS_SERVICE_URL,
  changeOrigin: true,
  pathFilter: (p) => p.startsWith('/api/stats') || p.startsWith('/api/analisar') || p.startsWith('/api/auditoria'),
  on: { error: onError(ANALYTICS_SERVICE_URL) },
}));

// Channel service
app.use(createProxyMiddleware({
  target: CHANNEL_SERVICE_URL,
  changeOrigin: true,
  pathFilter: (p) => p.startsWith('/webhooks'),
  on: { error: onError(CHANNEL_SERVICE_URL) },
}));

// Agent AI
app.use(createProxyMiddleware({
  target: AGENT_AI_URL,
  changeOrigin: true,
  pathFilter: (p) => p.startsWith('/ai'),
  on: { error: onError(AGENT_AI_URL) },
}));

// CRM — /auth, /api/* e /db/* (com rewrite de /db → /api/db)
app.use(createProxyMiddleware({
  target: CRM_SERVICE_URL,
  changeOrigin: true,
  pathFilter: (p) => p.startsWith('/auth') || p.startsWith('/api') || p.startsWith('/db'),
  pathRewrite: { '^/db': '/api/db' },
  on: { error: onError(CRM_SERVICE_URL) },
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
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[GATEWAY] 🚀 Rodando na porta ${PORT}`);
  console.log(`[GATEWAY] 🔗 CRM -> ${CRM_SERVICE_URL}`);
  console.log(`[GATEWAY] 🔗 Channels -> ${CHANNEL_SERVICE_URL}`);
});
