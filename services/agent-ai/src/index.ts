import { config } from 'dotenv';
import express from 'express';
import { Pool } from 'pg';
import { runMigrations } from '../../../infra/migrate';
import { startConsumer } from './pipeline/consumer';

config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const app = express();
app.use(express.json());

app.get('/health', async (_req, res) => {
  const checks: Record<string, any> = { service: 'agent-ai', ok: true };

  // DB conectividade
  try {
    await pool.query('SELECT 1');
    checks.db = 'ok';
  } catch (e: any) { checks.db = `erro: ${e.message}`; checks.ok = false; }

  // Tabelas RAG
  for (const table of ['knowledge_base_docs', 'knowledge_chunks']) {
    try {
      await pool.query(`SELECT 1 FROM ${table} LIMIT 1`);
      checks[table] = 'ok';
    } catch (e: any) {
      checks[table] = e.code === '42P01' ? 'tabela não existe' : `erro: ${e.message}`;
      checks.ok = false;
    }
  }

  // pgvector
  try {
    const { rows } = await pool.query(`SELECT extname FROM pg_extension WHERE extname='vector'`);
    checks.pgvector = rows.length > 0 ? 'ok' : 'não instalado';
    if (!rows.length) checks.ok = false;
  } catch (e: any) { checks.pgvector = `erro: ${e.message}`; }

  // Env vars críticas
  checks.env = {
    DATABASE_URL:     process.env.DATABASE_URL    ? 'definido' : '❌ FALTANDO',
    VAULT_SERVER_URL: process.env.VAULT_SERVER_URL ? 'definido' : 'usando default',
    VOYAGE_API_KEY:   process.env.VOYAGE_API_KEY  ? 'definido' : '⚠️ não definido (RAG vetorial desabilitado)',
    REDIS_URL:        process.env.REDIS_URL        ? 'definido' : '❌ FALTANDO',
  };

  // Vault reachability
  try {
    const vaultUrl = process.env.VAULT_SERVER_URL || 'http://plamev-gestor-leads-v6-fda4.railway.internal:8080';
    const r = await fetch(`${vaultUrl}/health`, { signal: AbortSignal.timeout(3000) });
    checks.vault_server = r.ok ? 'ok' : `HTTP ${r.status}`;
  } catch (e: any) { checks.vault_server = `inacessível: ${e.message}`; checks.ok = false; }

  res.status(checks.ok ? 200 : 503).json(checks);
});
app.get('/debug/pipeline', (_req, res) => {
  res.json({
    ok: true,
    service: 'agent-ai',
    runtime: {
      entrypoint: 'services/agent-ai/src/index.ts',
      consumer: 'services/agent-ai/src/pipeline/consumer.ts',
      unifiedRuntime: 'services/agent-ai/src/pipeline/runtime.ts',
      activeTextPipeline: 'services/agent-ai/src/pipeline/orchestrator.ts',
      queue: 'incoming-messages',
      debounceSource: 'Redis list debounce:msgs:{canal}:{phone}',
      multimodalHandlers: {
        audio: 'services/agent-ai/src/services/audio.ts',
        image: 'services/agent-ai/src/services/image.ts',
        document: 'services/agent-ai/src/services/document.ts',
      },
      runtimeConfigSource: 'services/agent-ai/src/db.ts::resolverConfigRuntimeAgente(agentes + llm_configs + organizations fallback)',
      inputGuard: 'services/agent-ai/src/pipeline/guards/input-guard.ts',
      rag: 'services/agent-ai/src/pipeline/rag.ts::searchKnowledge(vector+rerank on knowledge_chunks with automatic full-text fallback)',
      llm: 'services/agent-ai/src/clients/llm-client.ts',
      outputGuard: 'services/agent-ai/src/pipeline/guards/output-guard.ts',
      deliveryTarget: `${process.env.CHANNEL_SERVICE_URL || 'http://channel-service.railway.internal:8080'}/internal/send`,
      persistenceTarget: `${process.env.CRM_SERVICE_URL || 'http://crm-service.railway.internal:8080'}/api/internal/salvar-interacao`,
    },
    notes: [
      'Este endpoint descreve o caminho de execucao ativo sem alterar comportamento de negocio.',
      'Capacidades adicionais presentes no repositorio podem existir fora do caminho principal atual.',
    ],
  });
});

const INTERNAL_PORT = 8080;
const PORT = process.env.PORT || INTERNAL_PORT;

async function bootstrap() {
  // 1. Subir HTTP IMEDIATAMENTE (healthcheck Railway)
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[AGENT-AI] 🧠 HTTP Server ready on port ${PORT}`);
  });

  try {
    // 2. Migrations
    console.log('[AGENT-AI] 🔄 Iniciando migrations...');
    await runMigrations(pool);
    // 3. Subir consumer BullMQ
    await startConsumer();
    console.log('[AGENT-AI] ✅ Inicialização completa.');
  } catch (err: any) {
    console.error('[AGENT-AI] ❌ Erro na inicialização:', err.message);
  }
}

bootstrap();
