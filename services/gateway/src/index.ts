import express from 'express';
import http from 'http';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { Server } from 'socket.io';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.join(__dirname, '../../.env') });

const PORT = process.env.PORT || 3000;
// No Railway, a porta interna padrão é 8080 para todos os containers
const CRM_SERVICE_URL = process.env.CRM_SERVICE_URL || 'http://crm-service.railway.internal:8080';
const CHANNEL_SERVICE_URL = process.env.CHANNEL_SERVICE_URL || 'http://channel-service.railway.internal:8080';
const AGENT_AI_URL = process.env.AGENT_AI_URL || 'http://agent-ai.railway.internal:8080';
const ANALYTICS_SERVICE_URL = process.env.ANALYTICS_SERVICE_URL || 'http://analytics.railway.internal:8080';

const app = express();
const server = http.createServer(app);

app.use(cors());

// TODO: Auth Middleware (validar JWT e injetar x-org-id nos headers pro proxy)

// ── Debug Network ─────────────────────────────────────────────
app.get('/debug-network', async (req, res) => {
  const targets = {
    crm: CRM_SERVICE_URL,
    analytics: ANALYTICS_SERVICE_URL,
    agent: AGENT_AI_URL,
    channels: CHANNEL_SERVICE_URL
  };
  
  const results: any = {};
  
  for (const [name, url] of Object.entries(targets)) {
    try {
      const start = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      
      const response = await fetch(`${url}/health`, { signal: controller.signal });
      const status = response.status;
      const duration = Date.now() - start;
      results[name] = { status, duration: `${duration}ms`, ok: true };
      clearTimeout(timeoutId);
    } catch (err: any) {
      results[name] = { error: err.message, ok: false, tried_url: url };
    }
  }
  
  res.json({
    message: "Network Diagnostic",
    timestamp: new Date().toISOString(),
    results
  });
});

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

// 1. Prioridade: Analytics (Rotas específicas)
app.use(['/api/stats', '/api/analisar', '/api/auditoria'], createProxyMiddleware({
  ...proxyOptions(ANALYTICS_SERVICE_URL),
  // Não faz rewrite, envia o path completo /api/stats -> /api/stats
}));

// 2. Webhooks
app.use('/webhooks', createProxyMiddleware({
  ...proxyOptions(CHANNEL_SERVICE_URL),
}));

// 3. IA
app.use('/ai', createProxyMiddleware({
  ...proxyOptions(AGENT_AI_URL),
}));

// 4. Geral CRM (Conversas, DB, etc) - Deve vir por último
app.use(['/api', '/db'], createProxyMiddleware({
  ...proxyOptions(CRM_SERVICE_URL),
  pathRewrite: { '^/db': '/api/db' } // Transforma /db/tables em /api/db/tables
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
