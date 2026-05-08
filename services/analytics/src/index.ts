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

app.get('/api/stats', async (req, res) => {
  try {
    const orgId = (req.headers['x-org-id'] as string) || '00000000-0000-0000-0000-000000000000';
    const hoje = new Date().toISOString().slice(0, 10);
    const mes  = new Date().toISOString().slice(0, 7);

    const [cl, ms, cu, cm, ca, clm, msm, fecReal, fecPago] = await Promise.all([
      query<any>(`SELECT COUNT(DISTINCT c.client_id) AS n FROM conversas c WHERE DATE(c.criado_em) = $1 AND c.org_id = $2`, [hoje, orgId]),
      query<any>(`SELECT COUNT(*) AS n FROM mensagens m JOIN conversas c ON c.id = m.conversa_id WHERE DATE(m.timestamp) = $1 AND c.org_id = $2`, [hoje, orgId]),
      query<any>(`SELECT COALESCE(SUM(ci.custo_usd),0) AS n FROM custos_ia ci JOIN conversas c ON c.id = ci.conversa_id WHERE DATE(ci.timestamp) = $1 AND c.org_id = $2`, [hoje, orgId]),
      query<any>(`SELECT COALESCE(SUM(ci.custo_usd),0) AS n FROM custos_ia ci JOIN conversas c ON c.id = ci.conversa_id WHERE TO_CHAR(ci.timestamp,'YYYY-MM') = $1 AND c.org_id = $2`, [mes, orgId]),
      query<any>(`SELECT COUNT(*) AS n FROM conversas WHERE status = 'ativa' AND org_id = $1`, [orgId]),
      query<any>(`SELECT COUNT(DISTINCT c.client_id) AS n FROM conversas c WHERE TO_CHAR(c.criado_em,'YYYY-MM') = $1 AND c.org_id = $2`, [mes, orgId]),
      query<any>(`SELECT COUNT(*) AS n FROM mensagens m JOIN conversas c ON c.id = m.conversa_id WHERE TO_CHAR(m.timestamp,'YYYY-MM') = $1 AND c.org_id = $2`, [mes, orgId]),
      query<any>(`SELECT COUNT(*) AS n FROM conversas WHERE etapa = 'venda_fechada' AND TO_CHAR(ultima_interacao,'YYYY-MM') = $1 AND org_id = $2`, [mes, orgId]).catch(() => [{ n: '0' }]),
      query<any>(`SELECT COUNT(*) AS n FROM conversas WHERE etapa = 'pago' AND TO_CHAR(ultima_interacao,'YYYY-MM') = $1 AND org_id = $2`, [mes, orgId]).catch(() => [{ n: '0' }]),
    ]);

    res.json({
      clientes_hoje:    parseInt(cl[0]?.n    || '0'),
      msgs_hoje:        parseInt(ms[0]?.n    || '0'),
      custo_hoje:       parseFloat(cu[0]?.n  || '0').toFixed(4),
      custo_mes:        parseFloat(cm[0]?.n  || '0').toFixed(2),
      conversas_ativas: parseInt(ca[0]?.n    || '0'),
      clientes_mes:     parseInt(clm[0]?.n   || '0'),
      msgs_mes:         parseInt(msm[0]?.n   || '0'),
      fechamentos_mes:  parseInt(fecReal[0]?.n || '0') + parseInt(fecPago[0]?.n || '0'),
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
