/**
 * routes/analisar.ts — Pilar Analisar
 * - Salvas (conversas_salvas) + análise IA
 * - Funil (funil_conversao agregado)
 * - Performance (por agente)
 */
import { Router } from 'express';
import { autenticar } from '../middleware/auth';
import { query, execute } from '../config/db';
import { runAnalise } from '../services/analise-ia';

const router = Router();
router.use(autenticar);

// ── Salvas ─────────────────────────────────────────────────────
// Prefixos de ID: 'r_<n>' = conversas_salvas, 's_<n>' = sandbox_cenarios
router.get('/salvas', async (_req, res) => {
  try {
    const rows = await query<any>(`
      SELECT 'r_' || cs.id::text AS id, cs.conversa_id, cs.titulo, cs.motivo, cs.tags,
             cs.criado_em, 'real'::text AS tipo,
             c.canal, cli.nome AS nome_cliente, pp.nome AS nome_pet,
             cs.tipo_resultado,
             (cs.analise_resultado IS NOT NULL) AS tem_analise
      FROM conversas_salvas cs
      LEFT JOIN conversas c ON c.id = cs.conversa_id
      LEFT JOIN clientes cli ON cli.id = c.client_id
      LEFT JOIN perfil_pet pp ON pp.client_id = c.client_id

      UNION ALL

      SELECT 's_' || sc.id::text AS id, NULL AS conversa_id,
             sc.nome AS titulo, sc.descricao AS motivo,
             ARRAY['simulator']::text[] AS tags,
             sc.criado_em, 'sandbox'::text AS tipo,
             sc.canal,
             NULL AS nome_cliente,
             sc.perfil_lead->>'nome' AS nome_pet,
             'analise'::text AS tipo_resultado,
             false AS tem_analise
      FROM sandbox_cenarios sc

      ORDER BY criado_em DESC
      LIMIT 200
    `);
    res.json({ ok: true, conversas: rows });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

router.get('/salvas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (id.startsWith('s_')) {
      const rows = await query<any>(`SELECT * FROM sandbox_cenarios WHERE id=$1`, [id.slice(2)]);
      if (!rows[0]) { res.status(404).json({ erro: 'Não encontrada' }); return; }
      const sc = rows[0];
      res.json({ ok: true, conversa: {
        id, tipo: 'sandbox',
        titulo: sc.nome, motivo: sc.descricao,
        tags: ['simulator'], canal: sc.canal, criado_em: sc.criado_em,
        snapshot_msgs: sc.mensagens, snapshot_perfil: sc.perfil_lead,
        tipo_resultado: 'analise', tem_analise: false,
      }});
    } else {
      const numId = id.startsWith('r_') ? id.slice(2) : id;
      const rows = await query<any>(`SELECT * FROM conversas_salvas WHERE id=$1`, [numId]);
      if (!rows[0]) { res.status(404).json({ erro: 'Não encontrada' }); return; }
      res.json({ ok: true, conversa: { ...rows[0], tipo: 'real' } });
    }
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

router.delete('/salvas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (id.startsWith('s_')) {
      await execute(`DELETE FROM sandbox_cenarios WHERE id=$1`, [id.slice(2)]);
    } else {
      const numId = id.startsWith('r_') ? id.slice(2) : id;
      await execute(`DELETE FROM conversas_salvas WHERE id=$1`, [numId]);
    }
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Análise IA ──────────────────────────────────────────────────
// POST /api/analisar/salvas/r_123/analisar
// Se já existe análise, retorna do cache (usa ?forcar=true para re-rodar)
router.post('/salvas/:id/analisar', async (req, res) => {
  try {
    const { id } = req.params;
    const forcar = req.query.forcar === 'true';

    if (!id.startsWith('r_')) {
      res.status(400).json({ erro: 'Análise disponível apenas para conversas reais (prefixo r_)' });
      return;
    }

    const numId = parseInt(id.slice(2), 10);

    // Verificar se já existe análise
    if (!forcar) {
      const rows = await query<any>(
        `SELECT analise_resultado FROM conversas_salvas WHERE id = $1`, [numId]
      );
      if (rows[0]?.analise_resultado) {
        res.json({ ok: true, analise: rows[0].analise_resultado, cached: true });
        return;
      }
    }

    const analise = await runAnalise(numId);
    res.json({ ok: true, analise, cached: false });
  } catch (e: any) {
    console.error('[ANALISE-IA]', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// ── Enviar conversa para análise no Intelligence V1 ────────────────────────
router.post('/enviar-intel-v1/:conversaId', async (req, res) => {
  try {
    const { conversaId } = req.params;
    const motivo: string = (req.body?.motivo || '').toString().slice(0, 2000);
    const tipoResultado = ['sucesso', 'falha', 'analise'].includes(req.body?.tipo_resultado)
      ? req.body.tipo_resultado
      : 'analise';

    const conv = await query<any>(
      `SELECT c.id, c.canal, c.etapa, c.score, c.plano_recomendado, c.objecao_principal,
              cli.nome AS nome_cliente, c.numero_externo
       FROM conversas c
       LEFT JOIN clientes cli ON cli.id = c.client_id
       WHERE c.id = $1`, [conversaId]
    );
    if (!conv[0]) { res.status(404).json({ erro: 'Conversa não encontrada' }); return; }

    const mensagens = await query<any>(
      `SELECT role, enviado_por, conteudo, timestamp
       FROM mensagens WHERE conversa_id = $1 ORDER BY timestamp ASC`, [conversaId]
    );
    const perfil = await query<any>(
      `SELECT pp.* FROM perfil_pet pp
       JOIN conversas c ON c.client_id = pp.client_id
       WHERE c.id = $1 LIMIT 1`, [conversaId]
    );

    const titulo = `${conv[0].nome_cliente || conv[0].numero_externo || 'Conversa'} · ${conv[0].etapa || '—'}`;

    const r = await query<any>(
      `INSERT INTO conversas_salvas
         (conversa_id, titulo, motivo, tags, snapshot_msgs, snapshot_perfil, analise_status, tipo_resultado)
       VALUES ($1, $2, $3, $4, $5, $6, 'pendente', $7)
       RETURNING id`,
      [conversaId, titulo, motivo || null, ['intel_v1_analise'],
       JSON.stringify(mensagens), JSON.stringify(perfil[0] || {}), tipoResultado]
    );
    res.json({ ok: true, id: r[0].id, titulo });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Funil de conversão ─────────────────────────────────────────
router.get('/funil', async (_req, res) => {
  try {
    const ETAPAS_ORDEM = ['acolhimento', 'qualificacao', 'apresentacao_planos', 'negociacao', 'objecao', 'pre_fechamento', 'fechamento'];
    const rows = await query<any>(`
      SELECT etapa, COUNT(*)::int AS n
      FROM conversas
      WHERE etapa IS NOT NULL
      GROUP BY etapa
    `);
    const map: Record<string, number> = {};
    for (const r of rows) map[r.etapa] = r.n;

    const funil = ETAPAS_ORDEM.map(e => ({ etapa: e, total: map[e] || 0 }));
    const total = funil.reduce((s, f) => s + f.total, 0);
    res.json({ ok: true, funil, total });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Performance por agente ─────────────────────────────────────
router.get('/agentes', async (_req, res) => {
  try {
    const rows = await query<any>(`
      SELECT
        a.slug,
        a.nome,
        a.ativo,
        COUNT(DISTINCT c.id)::int AS total_conversas,
        COUNT(DISTINCT c.id) FILTER (WHERE c.etapa = 'fechamento')::int AS fechamentos,
        COUNT(DISTINCT c.id) FILTER (WHERE c.criado_em >= NOW() - INTERVAL '30 days')::int AS conv_30d,
        COALESCE(ROUND(AVG(c.score)::numeric, 1), 0)::float AS score_medio,
        (SELECT COALESCE(SUM(custo_usd), 0)::float FROM custos_ia WHERE agent_id = a.id AND timestamp >= NOW() - INTERVAL '30 days') AS custo_30d_usd
      FROM agentes a
      LEFT JOIN conversas c ON c.agent_id = a.id
      GROUP BY a.id, a.slug, a.nome, a.ativo
      ORDER BY total_conversas DESC
    `);
    res.json({ ok: true, agentes: rows });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

export default router;
