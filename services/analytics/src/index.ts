import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import path from 'path';
import { pool, testar, query } from './config/db';
import { runMigrations } from '../../../infra/migrate';
import analisarRouter  from './routes/analisar';
import auditoriaRouter from './routes/auditoria';

config({ path: path.join(__dirname, '../../.env') });

const app = express();
app.use(cors());
app.use(express.json());

app.use((req, _res, next) => {
  console.log(`[ANALYTICS] 📥 ${req.method} ${req.url}`);
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'analytics' }));

app.get('/api/stats', async (_req, res) => {
  try {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const [leadsHoje, convs30d, mensagens30d, agentes] = await Promise.all([
      query<any>(`SELECT COUNT(*)::int AS n FROM conversas WHERE criado_em >= $1`, [hoje]),
      query<any>(`SELECT COUNT(*)::int AS n FROM conversas WHERE criado_em >= NOW() - INTERVAL '30 days'`),
      query<any>(`SELECT COUNT(*)::int AS n FROM mensagens WHERE timestamp >= NOW() - INTERVAL '30 days'`),
      query<any>(`SELECT COUNT(*)::int AS n FROM agentes WHERE ativo = true`),
    ]);

    const fechamentos = await query<any>(
      `SELECT COUNT(*)::int AS n FROM conversas WHERE etapa = 'fechamento' AND criado_em >= NOW() - INTERVAL '30 days'`
    );
    const latencia = await query<any>(
      `SELECT ROUND(AVG(total_latency_ms))::int AS media_ms FROM ai_interaction_logs WHERE criado_em >= NOW() - INTERVAL '7 days'`
    ).catch(() => [{ media_ms: 0 }]);

    res.json({
      leads_hoje:        leadsHoje[0]?.n ?? 0,
      conversas_30d:     convs30d[0]?.n ?? 0,
      mensagens_30d:     mensagens30d[0]?.n ?? 0,
      fechamentos_30d:   fechamentos[0]?.n ?? 0,
      agentes_ativos:    agentes[0]?.n ?? 0,
      latencia_media_ms: latencia[0]?.media_ms ?? 0,
    });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

app.use('/api/analisar',  analisarRouter);
app.use('/api/auditoria', auditoriaRouter);

const PORT = process.env.PORT || 8080;

async function bootstrap() {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ANALYTICS] 🚀 HTTP Server ready on port ${PORT}`);
  });
  try {
    await runMigrations(pool);
    await testar();
    console.log('[ANALYTICS] ✅ Banco de dados pronto.');
  } catch (err: any) {
    console.error('[ANALYTICS] ❌ Erro na inicialização:', err.message);
  }
}

bootstrap();
