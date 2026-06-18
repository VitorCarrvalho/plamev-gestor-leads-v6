import express from 'express';
import http from 'http';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { config } from 'dotenv';
import path from 'path';
import { Client } from 'pg';
import { iniciarSocket, notificarDashboard } from './websocket/socket.server';

config({ path: path.join(__dirname, '../../.env') });

const PORT = process.env.PORT || 8080;
const CRM_SERVICE_URL = process.env.CRM_SERVICE_URL || 'http://crm-service.railway.internal:8080';
const CHANNEL_SERVICE_URL = process.env.CHANNEL_SERVICE_URL || 'http://channel-service.railway.internal:8080';
const AGENT_AI_URL = process.env.AGENT_AI_URL || 'http://agent-ai.railway.internal:8080';
const ANALYTICS_SERVICE_URL = process.env.ANALYTICS_SERVICE_URL || 'http://analytics.railway.internal:8080';

const app = express();
const server = http.createServer(app);

app.use(cors({
  origin: [
    'https://hub.plamevbrasil.com.br',
    'http://localhost:5173',
    'http://localhost:3000'
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-internal-secret'],
  credentials: true
}));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'gateway' }));
app.get('/debug/runtime', (_req, res) => {
  res.json({
    ok: true,
    service: 'gateway',
    runtime: {
      proxies: {
        channelService: CHANNEL_SERVICE_URL,
        agentAi: AGENT_AI_URL,
        analytics: ANALYTICS_SERVICE_URL,
        crm: CRM_SERVICE_URL,
      },
      websocketBootstrap: 'operational-socket-server',
      websocketCodeInUse: 'services/gateway/src/websocket/socket.server.ts',
      frontendSocketPath: '/socket.io',
      internalNotifyEndpoints: ['/interno/nova-msg', '/internal/nova-msg'],
    },
    notes: [
      'O gateway agora sobe o servidor operacional de Socket.IO usado pelo frontend.',
      'Notificacoes internas do pipeline podem atualizar o dashboard via rotas HTTP internas.',
    ],
  });
});

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

const makeProxy = (target: string, pathFilter: (p: string) => boolean, pathRewrite?: Record<string, string>) =>
  createProxyMiddleware({
    target,
    changeOrigin: true,
    pathFilter,
    ...(pathRewrite ? { pathRewrite } : {}),
    timeout: 10_000,
    proxyTimeout: 10_000,
    on: {
      error: (err: any, _req: any, res: any) => {
        console.error(`[GATEWAY] ❌ Proxy Error to ${target}:`, err.message);
        if (!res.headersSent) res.status(504).json({ error: 'Gateway Timeout', detail: err.message });
      },
    },
  });

// Channel service
app.use(makeProxy(CHANNEL_SERVICE_URL, (p) => p.startsWith('/webhooks')));

// Agent AI
app.use(makeProxy(AGENT_AI_URL, (p) => p.startsWith('/ai')));

// Analytics — apenas /api/auditoria/*
// /api/analisar/* foi movido para o CRM (implementação correta com DB configurado)
const analyticsPathFilter = (p: string) => p.startsWith('/api/auditoria');
app.use(makeProxy(ANALYTICS_SERVICE_URL, analyticsPathFilter));

// CRM — /auth, /api/* restante e /db/*
app.use(makeProxy(
  CRM_SERVICE_URL,
  (p) => p.startsWith('/auth') || p.startsWith('/api') || p.startsWith('/db'),
  { '^/db': '/api/db' },
));

// ── Notificações internas para o dashboard ───────────────────
// IMPORTANTE: o parser JSON fica abaixo dos proxies para não consumir o body
// de webhooks e requests proxied antes do encaminhamento ao serviço correto.
app.use(express.json());

app.post(['/interno/nova-msg', '/internal/nova-msg'], (req, res) => {
  const { conversa_id, phone, nome, msg_cliente, msg_mari } = req.body || {};
  if (!conversa_id) {
    res.status(400).json({ ok: false, erro: 'conversa_id obrigatório' });
    return;
  }
  notificarDashboard(
    String(conversa_id),
    String(phone || ''),
    String(nome || ''),
    msg_cliente ? String(msg_cliente) : null,
    msg_mari ? String(msg_mari) : null,
  );
  res.json({ ok: true });
});

// ── WebSocket Server ─────────────────────────────────────────
iniciarSocket(server);

// ── PostgreSQL LISTEN para notificações em tempo real ────────
// Mecanismo: CRM chama pg_notify('chat_nova_mensagem', payload) ao salvar
// mensagem → esta conexão dedicada recebe instantaneamente → emite socket.
// Elimina o hop HTTP CRM→gateway que era a causa de falhas silenciosas.
async function initPgListen(): Promise<void> {
  const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://geta@localhost:5432/mariv3';
  const client = new Client({ connectionString: DATABASE_URL });

  client.on('error', (err: Error) => {
    console.error('[GATEWAY] PG LISTEN error:', err.message);
  });

  try {
    await client.connect();
    await client.query("LISTEN chat_nova_mensagem");
    console.log('[GATEWAY] 🎧 PG LISTEN ativo em chat_nova_mensagem');

    client.on('notification', (msg: any) => {
      try {
        const p = JSON.parse(msg.payload || '{}');
        notificarDashboard(
          String(p.conversa_id || ''),
          String(p.phone || ''),
          String(p.nome || ''),
          p.msg_cliente ? String(p.msg_cliente) : null,
          p.msg_mari   ? String(p.msg_mari)    : null,
        );
      } catch (e: any) {
        console.warn('[GATEWAY] PG notify parse error:', e.message);
      }
    });

    client.on('end', () => {
      console.warn('[GATEWAY] PG LISTEN desconectado — reconectando em 5s');
      setTimeout(initPgListen, 5000);
    });

  } catch (e: any) {
    console.error('[GATEWAY] PG LISTEN falha ao conectar:', e.message);
    await client.end().catch(() => {});
    setTimeout(initPgListen, 5000);
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[GATEWAY] 🚀 Rodando na porta ${PORT}`);
  console.log(`[GATEWAY] 🔗 CRM -> ${CRM_SERVICE_URL}`);
  console.log(`[GATEWAY] 🔗 Channels -> ${CHANNEL_SERVICE_URL}`);
  initPgListen().catch(e => console.error('[GATEWAY] PG LISTEN init:', e.message));
});
