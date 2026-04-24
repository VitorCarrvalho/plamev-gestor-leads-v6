import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import path from 'path';
import { pool, testar, queryOne, execute } from './config/db';
import { runMigrations } from '../../../infra/migrate';
import { listarConversas, buscarConversa, buscarMensagens, buscarStats } from './repositories/conversations.repository';
import { autenticar } from './middleware/auth';
import authRouter     from './routes/auth';
import mensagensRouter from './routes/mensagens';
import templatesRouter from './routes/templates';
import agendaRouter    from './routes/agenda';
import buscaRouter     from './routes/busca';
import sandboxRouter   from './routes/sandbox';
import analisarRouter  from './routes/analisar';
import auditoriaRouter from './routes/auditoria';
import dbRouter        from './routes/db';
import { agenteRouter, internalRouter } from './routes/config-agentes';

config({ path: path.join(__dirname, '../../.env') });

const app = express();
app.use(cors());
app.use(express.json());

app.use((req, _res, next) => {
  console.log(`[CRM-SERVICE] 📥 ${req.method} ${req.url}`);
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'crm-service' }));

// Auth
app.use('/auth', authRouter);

// Injeta orgId default (multi-tenancy virá do Gateway JWT futuramente)
app.use((req, _res, next) => {
  req.headers['x-org-id'] = req.headers['x-org-id'] || '00000000-0000-0000-0000-000000000000';
  next();
});

// ── Conversas (inline — precisam de orgId) ──────────────────────
app.get(['/api/conversations', '/api/conversas'], async (req, res) => {
  try {
    const orgId = req.headers['x-org-id'] as string;
    const items = await listarConversas(orgId);
    res.json(items);
  } catch (e: any) {
    console.error('[CRM-SERVICE] ❌ Erro em /api/conversas:', e);
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

app.get(['/api/conversations/stats', '/api/stats'], async (req, res) => {
  try {
    const orgId = req.headers['x-org-id'] as string;
    res.json(await buscarStats(orgId));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get('/api/conversations/:id', async (req, res) => {
  try {
    const orgId = req.headers['x-org-id'] as string;
    const item = await buscarConversa(orgId, req.params.id);
    if (!item) return res.status(404).json({ error: 'Conversa não encontrada' });
    res.json(item);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get(['/api/conversations/:id/messages', '/api/conversas/:id/mensagens'], async (req, res) => {
  try {
    const orgId = req.headers['x-org-id'] as string;
    const { limit, before } = req.query;
    const messages = await buscarMensagens(
      orgId, req.params.id,
      limit ? parseInt(limit as string, 10) : undefined,
      before as string | undefined,
    );
    res.json(messages);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Etapa do Kanban ─────────────────────────────────────────────
const ETAPAS_VALIDAS = [
  'acolhimento', 'qualificacao', 'apresentacao_planos', 'validacao_cep',
  'negociacao', 'objecao', 'pre_fechamento', 'fechamento',
  'venda_fechada', 'pago', 'sem_cobertura', 'encerrado',
];

app.patch('/api/conversa/:id/etapa', autenticar, async (req, res) => {
  try {
    const { id } = req.params;
    const etapa: string = (req.body?.etapa || '').toString();
    if (!ETAPAS_VALIDAS.includes(etapa)) {
      res.status(400).json({ erro: `etapa inválida: ${etapa}` }); return;
    }
    const atual = await queryOne<any>('SELECT etapa FROM conversas WHERE id=$1', [id]);
    if (!atual) { res.status(404).json({ erro: 'Conversa não encontrada' }); return; }
    await execute('UPDATE conversas SET etapa=$1 WHERE id=$2', [etapa, id]);
    await execute(
      'INSERT INTO funil_conversao (conversa_id, etapa_origem, etapa_destino) VALUES ($1,$2,$3)',
      [id, atual.etapa, etapa],
    ).catch(() => {});
    res.json({ ok: true, etapa });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Routers ─────────────────────────────────────────────────────
app.use('/api/mensagens',  mensagensRouter);
app.use('/api/templates',  templatesRouter);
app.use('/api/agenda',     agendaRouter);
app.use('/api/busca',      buscaRouter);
app.use('/api/sandbox',    sandboxRouter);
app.use('/api/analisar',   analisarRouter);
app.use('/api/auditoria',  auditoriaRouter);
app.use('/api/db',              dbRouter);
app.use('/api/config/agentes',  agenteRouter);
app.use('/api/internal',        internalRouter);

// ── Boot ────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;

async function bootstrap() {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[CRM-SERVICE] 🚀 HTTP Server ready on port ${PORT}`);
  });
  try {
    await runMigrations(pool);
    await testar();
    console.log('[CRM-SERVICE] ✅ Banco de dados pronto.');
  } catch (err: any) {
    console.error('[CRM-SERVICE] ❌ Erro na inicialização (DB):', err.message);
  }
}

bootstrap();
