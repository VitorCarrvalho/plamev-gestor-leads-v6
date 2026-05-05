/**
 * routes/planos.ts — CRUD de planos, preços e coberturas da API Plamev.
 * Montado em /api/config/planos
 */
import { Router } from 'express';
import { autenticar, soAdmin } from '../middleware/auth';
import { query, queryOne, execute } from '../config/db';

export const planosRouter = Router();

// ── Lista planos com preços vigentes ────────────────────────────────────────
planosRouter.get('/', autenticar, async (_req, res) => {
  try {
    const planos = await query<any>(`
      SELECT
        p.id, p.slug, p.nome, p.descricao, p.ativo,
        json_agg(
          json_build_object(
            'id', pr.id,
            'modalidade', pr.modalidade,
            'valor',      pr.valor,
            'valor_tabela', pr.valor_tabela,
            'valor_promocional', pr.valor_promocional,
            'valor_oferta', pr.valor_oferta,
            'valor_limite', pr.valor_limite,
            'ativo', pr.ativo,
            'vigencia_inicio', pr.vigencia_inicio
          ) ORDER BY pr.modalidade
        ) FILTER (WHERE pr.id IS NOT NULL) AS precos
      FROM planos p
      LEFT JOIN (
        SELECT DISTINCT ON (plano_id, modalidade) *
        FROM precos
        WHERE ativo = true
        ORDER BY plano_id, modalidade, vigencia_inicio DESC
      ) pr ON pr.plano_id = p.id
      GROUP BY p.id
      ORDER BY p.id
    `);
    res.json({ ok: true, planos });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Detalhe de um plano ───────────────────────────────────────────────────
planosRouter.get('/:slug', autenticar, async (req, res) => {
  try {
    const plano = await queryOne<any>('SELECT * FROM planos WHERE slug=$1', [req.params.slug]);
    if (!plano) { res.status(404).json({ erro: 'Plano não encontrado' }); return; }
    const precos = await query<any>('SELECT * FROM precos WHERE plano_id=$1 ORDER BY modalidade, vigencia_inicio DESC', [plano.id]);
    res.json({ ok: true, plano: { ...plano, precos } });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Criar plano ───────────────────────────────────────────────────────────
planosRouter.post('/', soAdmin, async (req, res) => {
  const { slug, nome, descricao, ativo = true } = req.body || {};
  if (!slug || !nome) { res.status(400).json({ erro: 'slug e nome são obrigatórios' }); return; }
  try {
    const row = await queryOne<any>(
      `INSERT INTO planos (slug, nome, descricao, ativo)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (slug) DO UPDATE SET nome=EXCLUDED.nome, descricao=EXCLUDED.descricao, ativo=EXCLUDED.ativo
       RETURNING *`,
      [slug, nome, descricao || null, ativo],
    );
    res.json({ ok: true, plano: row });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Atualizar plano ───────────────────────────────────────────────────────
planosRouter.patch('/:slug', soAdmin, async (req, res) => {
  const allowed = ['nome', 'descricao', 'ativo'];
  const sets: string[] = [];
  const vals: any[] = [];
  for (const k of allowed) {
    if (req.body[k] !== undefined) { sets.push(`${k}=$${vals.length + 1}`); vals.push(req.body[k]); }
  }
  if (!sets.length) { res.status(400).json({ erro: 'Nada para atualizar' }); return; }
  vals.push(req.params.slug);
  try {
    await execute(`UPDATE planos SET ${sets.join(',')} WHERE slug=$${vals.length}`, vals);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Upsert preço de um plano ─────────────────────────────────────────────
planosRouter.post('/:slug/preco', soAdmin, async (req, res) => {
  const { modalidade, valor, valor_tabela, valor_promocional, valor_limite } = req.body || {};
  if (!modalidade || valor === undefined) { res.status(400).json({ erro: 'modalidade e valor obrigatórios' }); return; }
  try {
    const plano = await queryOne<any>('SELECT id FROM planos WHERE slug=$1', [req.params.slug]);
    if (!plano) { res.status(404).json({ erro: 'Plano não encontrado' }); return; }
    await execute(
      `INSERT INTO precos (plano_id, modalidade, valor, valor_tabela, valor_promocional, valor_limite, vigencia_inicio, ativo)
       VALUES ($1,$2,$3,$4,$5,$6,CURRENT_DATE,true)
       ON CONFLICT (plano_id, modalidade, vigencia_inicio)
       DO UPDATE SET valor=EXCLUDED.valor, valor_tabela=EXCLUDED.valor_tabela,
                     valor_promocional=EXCLUDED.valor_promocional, valor_limite=EXCLUDED.valor_limite, ativo=true`,
      [plano.id, modalidade, valor, valor_tabela || null, valor_promocional || null, valor_limite || null],
    );
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Editar preço pelo id ─────────────────────────────────────────────────
planosRouter.patch('/preco/:id', soAdmin, async (req, res) => {
  const { valor, valor_tabela, valor_promocional, valor_limite } = req.body || {};
  if (valor === undefined) { res.status(400).json({ erro: 'valor obrigatório' }); return; }
  try {
    await execute(
      `UPDATE precos SET valor=$1, valor_tabela=$2, valor_promocional=$3, valor_limite=$4 WHERE id=$5`,
      [valor, valor_tabela ?? null, valor_promocional ?? null, valor_limite ?? null, req.params.id],
    );
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Remover preço pelo id ────────────────────────────────────────────────
planosRouter.delete('/preco/:id', soAdmin, async (req, res) => {
  try {
    await execute('DELETE FROM precos WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Lista coberturas da API cacheadas localmente ──────────────────────────
planosRouter.get('/coberturas-api/lista', autenticar, async (_req, res) => {
  try {
    const rows = await query<any>(`
      SELECT pca.id, pca.plano_nome, pca.plano_slug, pca.uf, pca.cobertura_uuid, pca.valor, pca.sincronizado_em,
             p.nome AS plano_nome_local
      FROM planos_coberturas_api pca
      LEFT JOIN planos p ON p.slug = pca.plano_slug
      ORDER BY pca.uf, pca.plano_nome
    `);
    res.json({ ok: true, coberturas: rows });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Adiciona / atualiza mapeamento manual (nome → UUID) ──────────────────
planosRouter.post('/coberturas-api', soAdmin, async (req, res) => {
  const { plano_nome, plano_slug, uf, cobertura_uuid, valor } = req.body || {};
  if (!plano_nome || !uf || !cobertura_uuid) {
    res.status(400).json({ erro: 'plano_nome, uf e cobertura_uuid são obrigatórios' }); return;
  }
  try {
    await execute(
      `INSERT INTO planos_coberturas_api (plano_nome, plano_slug, uf, cobertura_uuid, valor, sincronizado_em)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (plano_nome, uf)
       DO UPDATE SET plano_slug=EXCLUDED.plano_slug, cobertura_uuid=EXCLUDED.cobertura_uuid,
                     valor=EXCLUDED.valor, sincronizado_em=NOW()`,
      [plano_nome, plano_slug || null, uf.toUpperCase(), cobertura_uuid, valor || null],
    );
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Remove mapeamento ────────────────────────────────────────────────────
planosRouter.delete('/coberturas-api/:id', soAdmin, async (req, res) => {
  try {
    await execute('DELETE FROM planos_coberturas_api WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Sincroniza coberturas da API para uma UF (proxy para o agent-ai) ─────
planosRouter.post('/coberturas-api/sincronizar', soAdmin, async (req, res) => {
  const { uf } = req.body || {};
  if (!uf || !/^[A-Z]{2}$/i.test(uf)) {
    res.status(400).json({ erro: 'uf inválida (ex: MG, SP)' }); return;
  }
  try {
    const AGENT_AI_URL = process.env.AGENT_AI_URL || 'http://agent-ai.railway.internal:8080';
    const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'plamev-internal';
    const resp = await fetch(`${AGENT_AI_URL}/internal/cotacao/coberturas?uf=${uf.toUpperCase()}`, {
      headers: { 'x-internal-secret': INTERNAL_SECRET },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`agent-ai retornou HTTP ${resp.status}`);
    const data = await resp.json() as any;
    const coberturas: { id: string; nome: string; valor: number }[] = data.coberturas || [];

    for (const c of coberturas) {
      const slug = c.nome.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
      await execute(
        `INSERT INTO planos_coberturas_api (plano_nome, plano_slug, uf, cobertura_uuid, valor, sincronizado_em)
         VALUES ($1,$2,$3,$4,$5,NOW())
         ON CONFLICT (plano_nome, uf)
         DO UPDATE SET plano_slug=EXCLUDED.plano_slug, cobertura_uuid=EXCLUDED.cobertura_uuid,
                       valor=EXCLUDED.valor, sincronizado_em=NOW()`,
        [c.nome, slug, uf.toUpperCase(), c.id, c.valor || null],
      );
    }
    res.json({ ok: true, uf: uf.toUpperCase(), sincronizados: coberturas.length, coberturas });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});
