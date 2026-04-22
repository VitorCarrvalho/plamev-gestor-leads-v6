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

const PORT = process.env.PORT || 3001;

async function bootstrap() {
  try {
    // 1. Migrations antes de qualquer coisa
    await runMigrations(pool);
    // 2. Subir HTTP (healthcheck Railway)
    app.listen(PORT, () => {
      console.log(`[AGENT-AI] 🧠 Server running on port ${PORT}`);
    });
    // 3. Subir consumer BullMQ
    await startConsumer();
  } catch (err: any) {
    console.error('[AGENT-AI] ❌ Falha no bootstrap:', err.message);
    process.exit(1);
  }
}

bootstrap();
