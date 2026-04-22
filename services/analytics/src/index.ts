import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import path from 'path';
import { pool, testar } from './config/db';
import { runMigrations } from '../../../infra/migrate';
import analisarRouter from './routes/analisar';

config({ path: path.join(__dirname, '../../.env') });

const app = express();
app.use(cors());
app.use(express.json());

// TODO: Auth Middleware (validar JWT e injetar x-org-id)
app.use((req, res, next) => {
  req.headers['x-org-id'] = req.headers['x-org-id'] || '00000000-0000-0000-0000-000000000000';
  next();
});

// Middleware para repassar orgId pro router local
app.use((req, res, next) => {
  (req as any).orgId = req.headers['x-org-id'];
  next();
});

app.use('/api/analisar', analisarRouter);

const PORT = process.env.PORT || 3004;

async function bootstrap() {
  try {
    await runMigrations(pool);
    await testar();
    app.listen(PORT, () => {
      console.log(`[ANALYTICS] 🚀 Iniciado na porta ${PORT}`);
    });
  } catch (err: any) {
    console.error('[ANALYTICS] ❌ Falha no bootstrap:', err.message);
    process.exit(1);
  }
}

bootstrap();
