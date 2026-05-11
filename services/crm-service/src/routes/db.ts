/**
 * routes/db.ts — SQL Browser + edição de registros (somente admin).
 * - GET  /tables            → todas as tabelas do schema public
 * - GET  /tables/:name      → schema de uma tabela
 * - GET  /preview/:name     → primeiras linhas de uma tabela
 * - POST /query             → SELECT livre (somente SELECT)
 * - PATCH /record/:name     → UPDATE de um registro pelo PK (soAdmin)
 *
 * Proteção contra SQL injection: todos os nomes de tabela/coluna passam
 * por regex de identificador válido antes de serem interpolados.
 */
import { Router } from 'express';
import { autenticar, soAdmin } from '../middleware/auth';
import { query, queryOne } from '../config/db';

const router = Router();
router.use(autenticar);

// Tabelas que NUNCA aparecem na listagem (dados sensíveis de auth)
const TABELAS_BLOQUEADAS = new Set([
  'usuarios', 'dashv5_audit_log', 'sessions',
]);

function isIdentValido(nome: string): boolean {
  return /^[a-z_][a-z0-9_]*$/i.test(nome) && nome.length <= 64;
}

async function tabelaExisteNoSchema(nome: string): Promise<boolean> {
  if (!isIdentValido(nome)) return false;
  const row = await queryOne<any>(
    `SELECT 1 FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r' AND n.nspname = 'public' AND c.relname = $1`,
    [nome],
  );
  return !!row;
}

// ── Lista de tabelas ───────────────────────────────────────────────────────
router.get('/tables', async (_req, res) => {
  try {
    const rows = await query<any>(`
      SELECT
        c.relname                                              AS nome,
        pg_size_pretty(pg_total_relation_size(c.oid))         AS tamanho,
        (SELECT COUNT(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = c.relname)::int AS colunas
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname = 'public'
        AND c.relname <> ALL($1::text[])
      ORDER BY c.relname
    `, [[...TABELAS_BLOQUEADAS]]);
    res.json({ ok: true, tabelas: rows });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Schema de uma tabela ──────────────────────────────────────────────────
router.get('/tables/:name', async (req, res) => {
  const { name } = req.params;
  if (!isIdentValido(name) || TABELAS_BLOQUEADAS.has(name)) {
    res.status(400).json({ erro: 'Tabela não permitida' }); return;
  }
  if (!await tabelaExisteNoSchema(name)) {
    res.status(404).json({ erro: 'Tabela não encontrada' }); return;
  }
  try {
    const colunas = await query<any>(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `, [name]);
    const pks = await query<any>(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.table_name = tc.table_name
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = 'public' AND tc.table_name = $1
      ORDER BY kcu.ordinal_position
    `, [name]);
    const count = await queryOne<any>(`SELECT COUNT(*)::int AS n FROM "${name}"`);
    res.json({ ok: true, tabela: name, colunas, pks: pks.map((p: any) => p.column_name), total_linhas: count?.n });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Preview de linhas ──────────────────────────────────────────────────────
router.get('/preview/:name', async (req, res) => {
  const { name } = req.params;
  if (!isIdentValido(name) || TABELAS_BLOQUEADAS.has(name)) {
    res.status(400).json({ erro: 'Tabela não permitida' }); return;
  }
  if (!await tabelaExisteNoSchema(name)) {
    res.status(404).json({ erro: 'Tabela não encontrada' }); return;
  }
  const limit  = Math.min(parseInt((req.query.limit  as string) || '50'), 500);
  const offset = Math.max(parseInt((req.query.offset as string) || '0'), 0);
  try {
    const rows = await query<any>(
      `SELECT * FROM "${name}" LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    // Busca PK para o frontend saber qual coluna usar como chave de edição
    const pks = await query<any>(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.table_name = tc.table_name
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = 'public' AND tc.table_name = $1
      ORDER BY kcu.ordinal_position
    `, [name]);
    res.json({ ok: true, rows, limit, offset, pks: pks.map((p: any) => p.column_name) });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── SELECT livre ──────────────────────────────────────────────────────────
const BLOCKED = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|COPY|VACUUM)\b/i;

router.post('/query', async (req, res) => {
  const { sql } = req.body || {};
  if (!sql || typeof sql !== 'string') { res.status(400).json({ erro: 'sql obrigatório' }); return; }
  if (sql.length > 5000) { res.status(400).json({ erro: 'query muito longa (max 5000 chars)' }); return; }
  if (BLOCKED.test(sql)) { res.status(400).json({ erro: 'Apenas SELECT é permitido' }); return; }
  if (!/^\s*SELECT\b/i.test(sql.trim())) { res.status(400).json({ erro: 'Query deve começar com SELECT' }); return; }
  try {
    const limitado = /\bLIMIT\s+\d+/i.test(sql) ? sql : `${sql.replace(/;?\s*$/, '')} LIMIT 500`;
    const rows = await query<any>(limitado);
    res.json({ ok: true, rows, count: rows.length });
  } catch (e: any) { res.status(400).json({ erro: e.message }); }
});

// ── UPDATE de registro (soAdmin) ──────────────────────────────────────────
router.patch('/record/:name', soAdmin, async (req, res) => {
  const { name } = req.params;
  if (!isIdentValido(name) || TABELAS_BLOQUEADAS.has(name)) {
    res.status(400).json({ erro: 'Tabela não permitida' }); return;
  }
  if (!await tabelaExisteNoSchema(name)) {
    res.status(404).json({ erro: 'Tabela não encontrada' }); return;
  }

  // Espera: { pk: { col: val }, fields: { col: val, ... } }
  const { pk, fields } = req.body || {};
  if (!pk || typeof pk !== 'object' || !fields || typeof fields !== 'object') {
    res.status(400).json({ erro: 'pk e fields são obrigatórios' }); return;
  }
  const pkEntries = Object.entries(pk);
  const fieldEntries = Object.entries(fields);
  if (!pkEntries.length || !fieldEntries.length) {
    res.status(400).json({ erro: 'pk e fields não podem ser vazios' }); return;
  }

  // Valida todos os nomes de coluna
  const allCols = [...pkEntries.map(([k]) => k), ...fieldEntries.map(([k]) => k)];
  if (allCols.some(c => !isIdentValido(c))) {
    res.status(400).json({ erro: 'Nome de coluna inválido' }); return;
  }

  try {
    // Monta SET col1=$1, col2=$2, ... WHERE pk1=$n AND pk2=$m
    const params: any[] = [];
    const setClauses = fieldEntries.map(([col, val]) => {
      params.push(val);
      return `"${col}" = $${params.length}`;
    });
    const whereClauses = pkEntries.map(([col, val]) => {
      params.push(val);
      return `"${col}" = $${params.length}`;
    });

    const sql = `UPDATE "${name}" SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')}`;
    const result = await query<any>(sql + ' RETURNING *', params);

    res.json({ ok: true, updated: result[0] || null });
  } catch (e: any) { res.status(400).json({ erro: e.message }); }
});

export default router;
