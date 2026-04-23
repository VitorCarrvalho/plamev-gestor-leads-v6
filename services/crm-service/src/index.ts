import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import path from 'path';
import { pool, testar } from './config/db';
import { runMigrations } from '../../../infra/migrate';
import { listarConversas, buscarConversa, buscarMensagens, buscarStats } from './repositories/conversations.repository';

config({ path: path.join(__dirname, '../../.env') });

const app = express();
app.use(cors());
app.use(express.json());

// Logger de requisições para debug
app.use((req, res, next) => {
  console.log(`[CRM-SERVICE] 📥 ${req.method} ${req.url}`);
  next();
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'crm-service' }));

// TODO: Middleware de Autenticação/Multi-tenancy
// Simulação de orgId que virá do Gateway
app.use((req, res, next) => {
  req.headers['x-org-id'] = '00000000-0000-0000-0000-000000000000';
  next();
});

// ── Rotas de Conversas ──────────────────────────────────────────
app.get(['/api/conversations', '/api/conversas'], async (req, res) => {
  try {
    const orgId = req.headers['x-org-id'] as string;
    const items = await listarConversas(orgId);
    res.json(items);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/conversations/stats', async (req, res) => {
  try {
    const orgId = req.headers['x-org-id'] as string;
    const stats = await buscarStats(orgId);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/conversations/:id', async (req, res) => {
  try {
    const orgId = req.headers['x-org-id'] as string;
    const item = await buscarConversa(orgId, req.params.id);
    if (!item) return res.status(404).json({ error: 'Conversa não encontrada' });
    res.json(item);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get(['/api/conversations/:id/messages', '/api/conversas/:id/mensagens'], async (req, res) => {
  try {
    const orgId = req.headers['x-org-id'] as string;
    const { limit, before } = req.query;
    const messages = await buscarMensagens(
      orgId,
      req.params.id, 
      limit ? parseInt(limit as string, 10) : undefined, 
      before as string | undefined
    );
    res.json(messages);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Outras Rotas CRM (Agenda, Templates, Auditoria, DB) ────────
app.get('/api/agenda', async (req, res) => {
  // Mock ou implementação real da agenda
  res.json([]);
});

app.get('/api/templates', async (req, res) => {
  // Mock ou implementação real de templates
  res.json([]);
});

app.get('/api/db/tables', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    res.json(result.rows.map(r => r.table_name));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// No Railway, a variável PORT é dinâmica para o tráfego externo.
// Para comunicação interna entre microserviços, usamos uma porta fixa previsível.
const INTERNAL_PORT = 8080;
const PORT = process.env.PORT || INTERNAL_PORT;

async function bootstrap() {
  // 1. Subir o servidor HTTP IMEDIATAMENTE (Evita 504 Gateway Timeout)
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[CRM-SERVICE] 🚀 HTTP Server ready on port ${PORT}`);
  });

  try {
    // 2. Rodar migrations e testes em background
    console.log('[CRM-SERVICE] 🔄 Iniciando banco de dados...');
    await runMigrations(pool);
    await testar();
    console.log('[CRM-SERVICE] ✅ Banco de dados pronto.');
  } catch (err: any) {
    console.error('[CRM-SERVICE] ❌ Erro na inicialização (DB):', err.message);
    // Não paramos o processo para não causar looping de restart no Railway
  }
}

bootstrap();
