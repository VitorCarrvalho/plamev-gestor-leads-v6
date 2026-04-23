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

app.use((req, res, next) => {
  console.log(`[ANALYTICS] 📥 ${req.method} ${req.url}`);
  next();
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'analytics' }));

app.use('/api/analisar', analisarRouter);

app.get('/api/stats', async (req, res) => {
  // TODO: Implementar busca real de estatísticas no DB
  res.json({
    leads_hoje: 0,
    conversoes: 0,
    tempo_medio: '0m',
    custo_ia: 0
  });
});

app.get(['/api/auditoria', '/api/auditoria/acoes'], async (req, res) => {
  // TODO: Implementar busca de logs de auditoria
  res.json([]);
});

const INTERNAL_PORT = 8080;
const PORT = process.env.PORT || INTERNAL_PORT;

async function bootstrap() {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ANALYTICS] 🚀 HTTP Server ready on port ${PORT}`);
  });

  try {
    console.log('[ANALYTICS] 🔄 Iniciando banco de dados...');
    await runMigrations(pool);
    await testar();
    console.log('[ANALYTICS] ✅ Banco de dados pronto.');
  } catch (err: any) {
    console.error('[ANALYTICS] ❌ Erro na inicialização:', err.message);
  }
}

bootstrap();
