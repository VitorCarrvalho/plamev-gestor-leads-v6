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
const proxyOptions = (target: string) => ({
  target,
  changeOrigin: true,
  timeout: 10000,
  proxyTimeout: 10000,
  onError: (err: any, req: any, res: any) => {
    console.error(`[GATEWAY] ❌ Proxy Error to ${target}:`, err.message);
    res.status(504).json({ error: 'Gateway Timeout', detail: err.message });
  }
});

// Analytics (Alta prioridade para rotas específicas)
app.use('/api/stats', createProxyMiddleware(proxyOptions(ANALYTICS_SERVICE_URL)));
app.use('/api/analisar', createProxyMiddleware(proxyOptions(ANALYTICS_SERVICE_URL)));
app.use('/api/auditoria', createProxyMiddleware(proxyOptions(ANALYTICS_SERVICE_URL)));

// Auth (proxeia para o CRM que gerencia login/JWT)
app.use('/auth', createProxyMiddleware(proxyOptions(CRM_SERVICE_URL)));

// Webhooks
app.use('/webhooks', createProxyMiddleware(proxyOptions(CHANNEL_SERVICE_URL)));

// AI
app.use('/ai', createProxyMiddleware(proxyOptions(AGENT_AI_URL)));

// CRM (Geral /api e /db)
app.use('/api', createProxyMiddleware(proxyOptions(CRM_SERVICE_URL)));
app.use('/db', createProxyMiddleware({
  ...proxyOptions(CRM_SERVICE_URL),
  pathRewrite: { '^/db': '/api/db' }
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[GATEWAY] 🚀 Rodando na porta ${PORT}`);
  console.log(`[GATEWAY] 🔗 CRM -> ${CRM_SERVICE_URL}`);
  console.log(`[GATEWAY] 🔗 Channels -> ${CHANNEL_SERVICE_URL}`);
});
