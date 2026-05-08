import { Router } from 'express';
import { autenticar } from '../middleware/auth';
import { query, queryOne } from '../config/db';

const router = Router();
router.use(autenticar);

const ORG = '00000000-0000-0000-0000-000000000000';

// GET /api/dashboard — payload completo para o DashboardPage
router.get('/', async (_req, res) => {
  try {
    const hoje = new Date().toISOString().slice(0, 10);
    const mes  = new Date().toISOString().slice(0, 7);

    const [
      kpisHoje, kpisMes,
      series30d, custos7d,
      funil,
      canais,
      qualidade,
      humanos,
    ] = await Promise.all([

      // ── KPIs do dia ───────────────────────────────────────────
      queryOne<any>(`
        SELECT
          COUNT(DISTINCT c.client_id)::int                                      AS clientes,
          COUNT(m.id)::int                                                       AS msgs,
          COALESCE(SUM(ci.custo_usd), 0)::float                                 AS custo,
          (SELECT COUNT(*) FROM conversas WHERE status='ativa' AND org_id=$2)::int AS ativas
        FROM conversas c
        LEFT JOIN mensagens m  ON m.conversa_id = c.id AND DATE(m.timestamp) = $1
        LEFT JOIN custos_ia ci ON ci.conversa_id = c.id AND DATE(ci.timestamp) = $1
        WHERE DATE(c.criado_em) = $1 AND c.org_id = $2
      `, [hoje, ORG]),

      // ── KPIs do mês ──────────────────────────────────────────
      queryOne<any>(`
        SELECT
          COUNT(DISTINCT c.client_id)::int                                        AS clientes,
          COUNT(m.id)::int                                                         AS msgs,
          COALESCE(SUM(ci.custo_usd), 0)::float                                   AS custo,
          COUNT(c.id) FILTER (WHERE c.etapa IN ('venda_fechada','pago'))::int      AS fechamentos
        FROM conversas c
        LEFT JOIN mensagens m  ON m.conversa_id = c.id AND TO_CHAR(m.timestamp,'YYYY-MM') = $1
        LEFT JOIN custos_ia ci ON ci.conversa_id = c.id AND TO_CHAR(ci.timestamp,'YYYY-MM') = $1
        WHERE TO_CHAR(c.criado_em,'YYYY-MM') = $1 AND c.org_id = $2
      `, [mes, ORG]),

      // ── Série: novos clientes/msgs por dia (30d) ─────────────
      query<any>(`
        SELECT
          DATE(c.criado_em)::text           AS dia,
          COUNT(DISTINCT c.client_id)::int  AS clientes,
          COUNT(m.id)::int                  AS msgs
        FROM conversas c
        LEFT JOIN mensagens m ON m.conversa_id = c.id
          AND m.timestamp >= NOW() - INTERVAL '30 days'
        WHERE c.criado_em >= NOW() - INTERVAL '30 days'
          AND c.org_id = $1
        GROUP BY DATE(c.criado_em)
        ORDER BY dia
      `, [ORG]),

      // ── Série: custo por dia (últimos 7d) ────────────────────
      query<any>(`
        SELECT
          DATE(ci.timestamp)::text         AS dia,
          ROUND(SUM(ci.custo_usd)::numeric, 4)::float AS custo
        FROM custos_ia ci
        JOIN conversas c ON c.id = ci.conversa_id
        WHERE ci.timestamp >= NOW() - INTERVAL '7 days'
          AND c.org_id = $1
        GROUP BY DATE(ci.timestamp)
        ORDER BY dia
      `, [ORG]),

      // ── Funil por etapa ───────────────────────────────────────
      query<any>(`
        SELECT etapa, COUNT(*)::int AS total
        FROM conversas
        WHERE etapa IS NOT NULL AND org_id = $1
        GROUP BY etapa
      `, [ORG]),

      // ── Distribuição por canal ────────────────────────────────
      query<any>(`
        SELECT canal, COUNT(*)::int AS total
        FROM conversas
        WHERE org_id = $1 AND status = 'ativa'
        GROUP BY canal
      `, [ORG]),

      // ── Qualidade da IA ───────────────────────────────────────
      queryOne<any>(`
        SELECT
          COUNT(*) FILTER (WHERE etapa IN ('venda_fechada','pago'))::int   AS sucesso,
          COUNT(*)::int                                                      AS total,
          COUNT(*) FILTER (WHERE ia_silenciada = true)::int                AS silenciadas
        FROM conversas
        WHERE org_id = $1
          AND criado_em >= NOW() - INTERVAL '30 days'
      `, [ORG]),

      // ── Conversas aguardando atendimento humano ───────────────
      query<any>(`
        SELECT
          c.id, c.etapa, c.canal, c.numero_externo,
          cl.nome AS nome_cliente,
          MAX(m.timestamp) AS ultima_msg,
          COUNT(m.id) FILTER (WHERE m.role = 'user')::int AS msgs_pendentes
        FROM conversas c
        JOIN clientes cl ON cl.id = c.client_id
        JOIN mensagens m ON m.conversa_id = c.id
        WHERE c.org_id = $1
          AND c.ia_silenciada = true
          AND m.timestamp > NOW() - INTERVAL '4 hours'
          AND NOT EXISTS (
            SELECT 1 FROM mensagens m2
            WHERE m2.conversa_id = c.id
              AND m2.enviado_por = 'humano'
              AND m2.timestamp > NOW() - INTERVAL '30 minutes'
          )
        GROUP BY c.id, c.etapa, c.canal, c.numero_externo, cl.nome
        HAVING MAX(m.timestamp) > NOW() - INTERVAL '2 hours'
        ORDER BY ultima_msg ASC
        LIMIT 20
      `, [ORG]),
    ]);

    const ETAPAS_FUNIL = [
      'acolhimento', 'qualificacao', 'apresentacao_planos', 'validacao_cep',
      'negociacao', 'objecao', 'pre_fechamento', 'fechamento', 'venda_fechada', 'pago',
    ];
    const ETAPA_LABELS: Record<string, string> = {
      acolhimento: 'Acolhimento', qualificacao: 'Qualificação',
      apresentacao_planos: 'Apresentação', validacao_cep: 'CEP',
      negociacao: 'Negociação', objecao: 'Objeção',
      pre_fechamento: 'Pré-Fech.', fechamento: 'Fechamento',
      venda_fechada: 'Venda', pago: 'Pago',
    };

    const funilMap: Record<string, number> = {};
    for (const r of funil) funilMap[r.etapa] = r.total;
    const funilOrdenado = ETAPAS_FUNIL.map(e => ({
      etapa: e, label: ETAPA_LABELS[e] ?? e, total: funilMap[e] ?? 0,
    }));

    const totalConversas = qualidade?.total ?? 1;
    const taxaSucesso    = totalConversas > 0
      ? Math.round((qualidade?.sucesso ?? 0) / totalConversas * 100)
      : 0;
    const taxaSilenciada = totalConversas > 0
      ? Math.round((qualidade?.silenciadas ?? 0) / totalConversas * 100)
      : 0;

    res.json({
      kpis_hoje: {
        clientes: kpisHoje?.clientes ?? 0,
        msgs:     kpisHoje?.msgs ?? 0,
        custo:    parseFloat((kpisHoje?.custo ?? 0).toFixed(4)),
        ativas:   kpisHoje?.ativas ?? 0,
      },
      kpis_mes: {
        clientes:    kpisMes?.clientes ?? 0,
        msgs:        kpisMes?.msgs ?? 0,
        custo:       parseFloat((kpisMes?.custo ?? 0).toFixed(2)),
        fechamentos: kpisMes?.fechamentos ?? 0,
      },
      series_30d:  series30d,
      custos_7d:   custos7d,
      funil:       funilOrdenado,
      canais,
      qualidade: {
        taxa_sucesso:    taxaSucesso,
        taxa_silenciada: taxaSilenciada,
        total_30d:       totalConversas,
      },
      humanos,
    });
  } catch (e: any) {
    console.error('[dashboard] ❌', e);
    res.status(500).json({ erro: e.message });
  }
});

export default router;
