/**
 * server/app.ts — Dashboard V5
 * Bootstrap: Express + Socket.IO + rotas placeholder.
 * Pilares vão sendo montados nas fases seguintes.
 */
// 21/04/2026 — override=true pra .env ganhar de vars do shell (ANTHROPIC antiga)
import * as dotenv from 'dotenv';
import * as pathMod from 'path';
dotenv.config({ path: pathMod.resolve(__dirname, '../../.env'), override: true });

import express from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import { testar } from './config/db';
import { logger } from './config/logger';
import { iniciarSocket } from './websocket/socket.server';
import rateLimit from 'express-rate-limit';
import authRouter from './routes/auth';
import conversationsRouter from './routes/conversations';
import dbRouter from './routes/db';
import agendaRouter from './routes/agenda';
import analisarRouter from './routes/analisar';
import auditoriaRouter from './routes/auditoria';
import templatesRouter from './routes/templates';
import buscaRouter from './routes/busca';
import sandboxRouter from './routes/sandbox';
import mensagensRouter from './routes/mensagens';
import { inicializarTabelasV5 } from './config/migrations';

const PORT = parseInt(process.env.DASH_V5_PORT || '3452');
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim());

const app = express();
const server = http.createServer(app);

// CORS whitelist (correção de segurança vs V4)
app.use(cors({
  origin: CORS_ORIGINS.includes('*') ? '*' : CORS_ORIGINS,
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));

// Logging de request
app.use((req, _res, next) => {
  if (!req.url.startsWith('/health') && !req.url.startsWith('/assets')) {
    logger.debug({ method: req.method, url: req.url }, 'req');
  }
  next();
});

// ── Rate limiting (Fase 7 · hardening) ─────────────────────────
const authLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { erro: 'Muitas tentativas. Aguarde 5 min.' } });
const dbLimiter   = rateLimit({ windowMs: 60 * 1000,     max: 30, standardHeaders: true, legacyHeaders: false, message: { erro: 'Rate limit: 30 req/min em /db' } });

// ── Auth ───────────────────────────────────────────────────────
app.use('/auth', authLimiter, authRouter);

// ── Pilar Monitorar ────────────────────────────────────────────
app.use('/api', conversationsRouter);

// ── Pilar Sistema (Fase 4) — com rate limit no SQL ─────────────
app.use('/db',          dbLimiter, dbRouter);
app.use('/api/agenda',  agendaRouter);

// ── Pilar Analisar (Fase 5) ────────────────────────────────────
app.use('/api/analisar', analisarRouter);

// ── Fase 6: novidades ─────────────────────────────────────────
app.use('/api/auditoria', auditoriaRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/busca',     buscaRouter);
app.use('/api/mensagens', mensagensRouter);

// ── Sandbox: proxy para Intelligence V1 (Chat Simulator) ──────
app.use('/api/sandbox', sandboxRouter);

// ── Pilares (adicionados nas fases seguintes) ─────────────────
// Fase 2: monitorar
// Fase 3: atender
// Fase 4: sistema
// Fase 5: analisar

// ── Webhook interno: pipeline Mari envia nova mensagem ─────────
app.post('/interno/nova-msg', (req, res) => {
  const payload = req.body || {};
  io.emit('nova_msg', payload);
  if (payload.conversa_id) io.emit('conversa_atualizada', { conversa_id: payload.conversa_id });
  res.json({ ok: true });
});

// ── Socket.IO — handlers do V4 reaproveitados ─────────────────
const io = iniciarSocket(server);

// ── Health ─────────────────────────────────────────────────────
app.get('/health', (_req, res) =>
  res.json({ ok: true, versao: 'dashboard-v5', porta: PORT, uptime: process.uptime() })
);

// ── Frontend ───────────────────────────────────────────────────
const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.use((_req, res) => res.sendFile(path.join(clientDist, 'index.html')));

// ── Start ──────────────────────────────────────────────────────
async function start() {
  await testar();
  await inicializarTabelasV5();
  server.listen(PORT, () => {
    logger.info(`📡 Dashboard V5 — http://localhost:${PORT}`);
    logger.info(`   CORS: ${CORS_ORIGINS.join(', ')}`);
  });
}

start().catch(e => { logger.fatal(e.message); process.exit(1); });

export { io };
