import { Router } from 'express';
import { autenticar } from '../middleware/auth';
import { query, execute } from '../config/db';

const router = Router();
router.use(autenticar);

// ── Salvas ─────────────────────────────────────────────────────
router.get('/salvas', async (_req, res) => {
  try {
    const rows = await query<any>(`
      SELECT cs.id, cs.conversa_id, cs.titulo, cs.motivo, cs.tags,
             cs.criado_em,
             c.canal, cli.nome AS nome_cliente, pp.nome AS nome_pet
      FROM conversas_salvas cs
      LEFT JOIN conversas c ON c.id = cs.conversa_id
      LEFT JOIN clientes cli ON cli.id = c.client_id
      LEFT JOIN perfil_pet pp ON pp.client_id = c.client_id
      ORDER BY cs.criado_em DESC
      LIMIT 200
    `);
    res.json({ ok: true, conversas: rows });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

router.get('/salvas/:id', async (req, res) => {
  try {
    const rows = await query<any>(`SELECT * FROM conversas_salvas WHERE id=$1`, [req.params.id]);
    if (!rows[0]) { res.status(404).json({ erro: 'Não encontrada' }); return; }
    res.json({ ok: true, conversa: rows[0] });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

router.delete('/salvas/:id', async (req, res) => {
  try {
    await execute(`DELETE FROM conversas_salvas WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

router.post('/enviar-intel-v1/:conversaId', async (req, res) => {
  try {
    const { conversaId } = req.params;
    const motivo: string = (req.body?.motivo || '').toString().slice(0, 2000);

    const conv = await query<any>(
      `SELECT c.id, c.canal, c.etapa, c.score, c.plano_recomendado, c.objecao_principal,
              cli.nome AS nome_cliente, c.numero_externo
       FROM conversas c
       LEFT JOIN clientes cli ON cli.id = c.client_id
       WHERE c.id = $1`, [conversaId]
    );
    if (!conv[0]) { res.status(404).json({ erro: 'Conversa não encontrada' }); return; }

    const mensagens = await query<any>(
      `SELECT role, enviado_por, conteudo, timestamp, obsidian_arquivos
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
         (conversa_id, titulo, motivo, tags, snapshot_msgs, snapshot_perfil, analise_status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pendente')
       RETURNING id`,
      [conversaId, titulo, motivo || null, ['intel_v1_analise'],
       JSON.stringify(mensagens), JSON.stringify(perfil[0] || {})]
    );
    res.json({ ok: true, id: r[0].id, titulo });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Funil de conversão ─────────────────────────────────────────
router.get('/funil', async (_req, res) => {
  try {
    const ETAPAS_ORDEM = ['acolhimento', 'qualificacao', 'apresentacao_planos', 'negociacao', 'objecao', 'pre_fechamento', 'fechamento'];
    const rows = await query<any>(`
      SELECT etapa, COUNT(*)::int AS n FROM conversas
      WHERE etapa IS NOT NULL GROUP BY etapa
    `);
    const map: Record<string, number> = {};
    for (const r of rows) map[r.etapa] = r.n;
    const funil = ETAPAS_ORDEM.map(e => ({ etapa: e, total: map[e] || 0 }));
    res.json({ ok: true, funil, total: funil.reduce((s, f) => s + f.total, 0) });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Performance por agente ─────────────────────────────────────
router.get('/agentes', async (_req, res) => {
  try {
    const rows = await query<any>(`
      SELECT
        a.slug, a.nome, a.ativo,
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
