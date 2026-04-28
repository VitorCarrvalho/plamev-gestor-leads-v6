import { config } from 'dotenv';
import express from 'express';
import { Pool } from 'pg';
import { runMigrations } from '../../../infra/migrate';
import { startConsumer } from './pipeline/consumer';

config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true, service: 'agent-ai' }));
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
