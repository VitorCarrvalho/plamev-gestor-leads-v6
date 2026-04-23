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

const INTERNAL_PORT = 3001;
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
