/**
 * routes/db.ts — SQL Browser com WHITELIST (corrige SQL injection do V4).
 * V4 usava template string com `req.params.name` direto — vulnerável.
 * V5 valida contra lista explícita de tabelas permitidas.
 */
import { Router } from 'express';
import { autenticar } from '../middleware/auth';
import { query, queryOne } from '../config/db';

const router = Router();
router.use(autenticar);

// ── Whitelist de tabelas consultáveis ──────────────────────────
const TABELAS_PERMITIDAS = new Set([
  'clientes', 'agentes', 'conversas', 'mensagens', 'perfil_pet',
  'followup_agendado', 'agendamentos', 'custos_ia', 'decisoes_orquestrador',
  'instrucoes_ativas', 'funil_conversao', 'acoes_supervisor',
  'conversa_obsidian', 'conversas_salvas', 'indicacoes', 'transferencias',
  'identificadores_cliente', 'mari_config', 'planos', 'precos', 'coberturas',
  'procedimentos', 'categorias_procedimento', 'campanhas', 'lead_events',
  'perfil_analisado', 'lead_network_snapshot', 'lead_proposals', 'lead_payments',
]);

function isTabelaValida(nome: string): boolean {
  if (!/^[a-z_][a-z0-9_]*$/i.test(nome)) return false;
  return TABELAS_PERMITIDAS.has(nome);
}

router.get('/tables', async (_req, res) => {
  try {
    const rows = await query<any>(`
      SELECT
        c.relname AS nome,
        pg_size_pretty(pg_total_relation_size(c.oid)) AS tamanho,
        (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = c.relname)::int AS colunas
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname = 'public'
        AND c.relname = ANY($1::text[])
      ORDER BY c.relname
    `, [[...TABELAS_PERMITIDAS]]);
    res.json({ ok: true, tabelas: rows, total_whitelist: TABELAS_PERMITIDAS.size });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

router.get('/tables/:name', async (req, res) => {
  if (!isTabelaValida(req.params.name)) {
    res.status(400).json({ erro: 'Tabela não permitida' }); return;
  }
  try {
    const colunas = await query<any>(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = $1 ORDER BY ordinal_position
    `, [req.params.name]);
    const count = await queryOne<any>(`SELECT COUNT(*)::int AS n FROM ${req.params.name}`);
    res.json({ ok: true, tabela: req.params.name, colunas, total_linhas: count?.n });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

router.get('/preview/:name', async (req, res) => {
  if (!isTabelaValida(req.params.name)) {
    res.status(400).json({ erro: 'Tabela não permitida' }); return;
  }
  const limit  = Math.min(parseInt((req.query.limit  as string) || '50'), 500);
  const offset = Math.max(parseInt((req.query.offset as string) || '0'), 0);
  try {
    const rows = await query<any>(
      `SELECT * FROM ${req.params.name} LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json({ ok: true, rows, limit, offset });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// SELECT-only query — bloqueia comandos destrutivos por regex + usa role somente-leitura quando possível.
const BLOCKED = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|COPY|VACUUM)\b/i;

router.post('/query', async (req, res) => {
  const { sql } = req.body || {};
  if (!sql || typeof sql !== 'string') { res.status(400).json({ erro: 'sql obrigatório' }); return; }
  if (sql.length > 5000) { res.status(400).json({ erro: 'query muito longa (max 5000 chars)' }); return; }
  if (BLOCKED.test(sql)) { res.status(400).json({ erro: 'Apenas SELECT é permitido' }); return; }
  if (!/^\s*SELECT\b/i.test(sql.trim())) { res.status(400).json({ erro: 'Query deve começar com SELECT' }); return; }

  try {
    // Adiciona LIMIT 500 se não tiver
    const limitado = /\bLIMIT\s+\d+/i.test(sql) ? sql : `${sql.replace(/;?\s*$/, '')} LIMIT 500`;
    const rows = await query<any>(limitado);
    res.json({ ok: true, rows, count: rows.length });
  } catch (e: any) { res.status(400).json({ erro: e.message }); }
});

export default router;
