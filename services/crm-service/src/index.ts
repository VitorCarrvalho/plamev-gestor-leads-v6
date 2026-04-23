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
const INTERNAL_PORT = 3002;
const PORT = process.env.PORT || INTERNAL_PORT;

async function bootstrap() {
  try {
    // 1. Rodar migrations automaticamente no startup
    await runMigrations(pool);
    // 2. Verificar conexão com o banco
    await testar();
    // 3. Subir o servidor HTTP
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[CRM-SERVICE] 🚀 Iniciado na porta ${PORT}`);
    });
  } catch (err: any) {
    console.error('[CRM-SERVICE] ❌ Falha no bootstrap:', err.message);
    process.exit(1); // Falha no deploy Railway = serviço não sobe
  }
}

bootstrap();
