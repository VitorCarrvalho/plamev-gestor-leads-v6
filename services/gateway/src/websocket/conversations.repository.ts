import { execute, query, queryOne } from '../config/db';

let cachedMessageLimit = 50;
let cachedMessageLimitTs = 0;

async function getMessageLimit(): Promise<number> {
  if (Date.now() - cachedMessageLimitTs > 60_000) {
    const row = await queryOne<any>(
      'SELECT valor FROM mari_config WHERE chave=$1',
      ['dashboard_msgs_limite'],
    ).catch(() => null);
    if (row?.valor) cachedMessageLimit = parseInt(String(row.valor), 10) || 50;
    cachedMessageLimitTs = Date.now();
  }
  return cachedMessageLimit;
}

export async function listarConversas(orgId: string): Promise<any[]> {
  return query(`
    SELECT
      c.id AS conversa_id,
      c.client_id,
      c.canal,
      c.numero_externo,
      c.numero_externo AS phone,
      c.sender_chip,
      c.instancia_whatsapp,
      c.numero_cotacao,
      c.etapa,
      c.status,
      c.ia_silenciada,
      c.score,
      c.ultima_interacao,
      c.ultima_interacao AS ultima_msg_ts,
      c.criado_em,
      c.temperatura_lead,
      c.objecao_principal,
      c.plano_recomendado,
      c.intensidade,
      c.negociacao_step,
      c.lead_quality_score,
      c.lead_quality_class,
      c.resumo_conversa,
      c.classificacao_rede,
      c.clinicas_20km,
      c.clinicas_40km,
      (SELECT COUNT(*) FROM mensagens m WHERE m.conversa_id = c.id)::int AS total_msgs,
      (SELECT conteudo FROM mensagens m WHERE m.conversa_id = c.id ORDER BY timestamp DESC LIMIT 1) AS ultima_msg_conteudo,
      cl.nome AS cliente_nome,
      cl.nome AS nome_cliente,
      a.slug AS agente_slug,
      a.nome AS agente_nome,
      pp.nome AS nome_pet,
      pp.especie,
      pp.raca,
      pp.idade_anos,
      pp.vinculo_emocional,
      CASE
        WHEN c.canal = 'telegram' THEN '💬 Telegram'
        WHEN c.instancia_whatsapp = 'mari-plamev-whatsapp' THEN '📱 Mari 011'
        WHEN c.instancia_whatsapp = 'mari-plamev-zap2' THEN '📱 Mari 031'
        WHEN c.instancia_whatsapp = 'plamev' THEN '📱 Bella 021'
        ELSE COALESCE('📱 ' || c.instancia_whatsapp, '📱 WhatsApp')
      END AS chip,
      fa.executar_em AT TIME ZONE 'America/Sao_Paulo' AS proximo_followup,
      fa.tipo AS followup_tipo,
      fa.mensagem AS followup_mensagem
    FROM conversas c
    JOIN clientes cl ON cl.id = c.client_id
    JOIN agentes a ON a.id = c.agent_id
    LEFT JOIN perfil_pet pp ON pp.client_id = c.client_id
    LEFT JOIN LATERAL (
      SELECT executar_em, tipo, mensagem
      FROM followup_agendado
      WHERE conversa_id = c.id AND status = 'pendente'
      ORDER BY executar_em ASC LIMIT 1
    ) fa ON true
    WHERE c.status = 'ativa' AND c.org_id = $1
    ORDER BY c.ultima_interacao DESC
    LIMIT 100
  `, [orgId]);
}

export async function buscarConversa(orgId: string, id: string): Promise<any | null> {
  return queryOne(`
    SELECT
      c.*,
      c.numero_externo AS phone,
      cl.nome AS cliente_nome,
      cl.nome AS nome_cliente,
      cl.origem AS cliente_origem,
      a.slug AS agente_slug,
      a.nome AS agente_nome,
      (SELECT COUNT(*) FROM mensagens m WHERE m.conversa_id = c.id)::int AS total_msgs,
      (SELECT COALESCE(SUM(custo_usd), 0)::numeric(10,6) FROM custos_ia ci WHERE ci.conversa_id = c.id) AS custo_ia_usd,
      (SELECT COALESCE(SUM(input_tokens + output_tokens), 0)::int FROM custos_ia ci WHERE ci.conversa_id = c.id) AS custo_ia_tokens,
      (SELECT COUNT(*)::int FROM custos_ia ci WHERE ci.conversa_id = c.id) AS custo_ia_chamadas,
      CASE
        WHEN c.canal = 'telegram' THEN '💬 Telegram'
        WHEN c.instancia_whatsapp = 'mari-plamev-whatsapp' THEN '📱 Mari 011'
        WHEN c.instancia_whatsapp = 'mari-plamev-zap2' THEN '📱 Mari 031'
        WHEN c.instancia_whatsapp = 'plamev' THEN '📱 Bella 021'
        ELSE COALESCE('📱 ' || c.instancia_whatsapp, '📱 WhatsApp')
      END AS chip
    FROM conversas c
    JOIN clientes cl ON cl.id = c.client_id
    JOIN agentes a ON a.id = c.agent_id
    WHERE c.id = $1 AND c.org_id = $2
  `, [id, orgId]);
}

export async function buscarPerfil(clientId: string): Promise<any | null> {
  const cliente = await queryOne<any>(
    'SELECT nome AS nome_cliente, origem FROM clientes WHERE id = $1',
    [clientId],
  );
  const pet = await queryOne<any>(
    `SELECT nome AS nome_pet, especie, raca, idade_anos, sexo, castrado,
            problema_saude, cep, cidade, estado, email, cpf, indicado_por
     FROM perfil_pet WHERE client_id = $1
     ORDER BY atualizado_em DESC NULLS LAST LIMIT 1`,
    [clientId],
  );
  return { ...(cliente || {}), ...(pet || {}) };
}

export async function buscarMensagens(orgId: string, conversaId: string, limite?: number, antesId?: string): Promise<any[]> {
  const messageLimit = limite || await getMessageLimit();
  if (antesId) {
    return query<any>(
      `SELECT m.* FROM mensagens m
       JOIN conversas c ON c.id = m.conversa_id
       WHERE m.conversa_id = $1 AND m.id < $2 AND c.org_id = $4
       ORDER BY timestamp DESC LIMIT $3`,
      [conversaId, antesId, messageLimit, orgId],
    ).then(rows => rows.reverse());
  }

  return query<any>(
    `SELECT m.* FROM mensagens m
     JOIN conversas c ON c.id = m.conversa_id
     WHERE m.conversa_id = $1 AND c.org_id = $3
     ORDER BY timestamp DESC LIMIT $2`,
    [conversaId, messageLimit, orgId],
  ).then(rows => rows.reverse());
}

export async function buscarStats(orgId: string): Promise<any> {
  const hoje = new Date().toISOString().slice(0, 10);
  const mes = new Date().toISOString().slice(0, 7);

  const [cl, ms, cu, cm, ca, clm, msm, fecReal, fecPago] = await Promise.all([
    queryOne<any>(`SELECT COUNT(DISTINCT c.client_id) AS n FROM conversas c WHERE DATE(c.criado_em) = $1 AND c.org_id = $2`, [hoje, orgId]),
    queryOne<any>(`SELECT COUNT(*) AS n FROM mensagens m JOIN conversas c ON c.id = m.conversa_id WHERE DATE(m.timestamp) = $1 AND c.org_id = $2`, [hoje, orgId]),
    queryOne<any>(`SELECT COALESCE(SUM(ci.custo_usd),0) AS n FROM custos_ia ci JOIN conversas c ON c.id = ci.conversa_id WHERE DATE(ci.timestamp) = $1 AND c.org_id = $2`, [hoje, orgId]),
    queryOne<any>(`SELECT COALESCE(SUM(ci.custo_usd),0) AS n FROM custos_ia ci JOIN conversas c ON c.id = ci.conversa_id WHERE TO_CHAR(ci.timestamp,'YYYY-MM') = $1 AND c.org_id = $2`, [mes, orgId]),
    queryOne<any>(`SELECT COUNT(*) AS n FROM conversas WHERE status = 'ativa' AND org_id = $1`, [orgId]),
    queryOne<any>(`SELECT COUNT(DISTINCT c.client_id) AS n FROM conversas c WHERE TO_CHAR(c.criado_em,'YYYY-MM') = $1 AND c.org_id = $2`, [mes, orgId]),
    queryOne<any>(`SELECT COUNT(*) AS n FROM mensagens m JOIN conversas c ON c.id = m.conversa_id WHERE TO_CHAR(m.timestamp,'YYYY-MM') = $1 AND c.org_id = $2`, [mes, orgId]),
    queryOne<any>(`SELECT COUNT(*) AS n FROM conversas WHERE etapa = 'venda_fechada' AND TO_CHAR(ultima_interacao,'YYYY-MM') = $1 AND org_id = $2`, [mes, orgId]).catch(() => ({ n: '0' })),
    queryOne<any>(`SELECT COUNT(*) AS n FROM conversas WHERE etapa = 'pago' AND TO_CHAR(ultima_interacao,'YYYY-MM') = $1 AND org_id = $2`, [mes, orgId]).catch(() => ({ n: '0' })),
  ]);

  const vendasFechadas = parseInt(fecReal?.n || '0', 10);
  const vendasPagas = parseInt(fecPago?.n || '0', 10);

  return {
    clientes_hoje: parseInt(cl?.n || '0', 10),
    msgs_hoje: parseInt(ms?.n || '0', 10),
    custo_hoje: parseFloat(cu?.n || '0').toFixed(4),
    custo_mes: parseFloat(cm?.n || '0').toFixed(2),
    conversas_ativas: parseInt(ca?.n || '0', 10),
    clientes_mes: parseInt(clm?.n || '0', 10),
    msgs_mes: parseInt(msm?.n || '0', 10),
    fechamentos_mes: vendasFechadas + vendasPagas,
    fechamentos_fonte: 'etapa_venda_fechada_pago',
  };
}

export async function buscarAgendamentos(conversaId: string): Promise<any[]> {
  return query(
    `SELECT * FROM agendamentos WHERE conversa_id = $1 AND status = 'pendente' ORDER BY executar_em ASC`,
    [conversaId],
  );
}

export async function toggleSilenciarIA(conversaId: string): Promise<boolean> {
  const atual = await queryOne<any>('SELECT ia_silenciada FROM conversas WHERE id = $1', [conversaId]);
  const novoEstado = !atual?.ia_silenciada;
  await execute('UPDATE conversas SET ia_silenciada = $1 WHERE id = $2', [novoEstado, conversaId]);
  return novoEstado;
}

export async function transferirConversa(conversaId: string, agentSlug: string): Promise<void> {
  const agente = await queryOne<any>('SELECT id FROM agentes WHERE slug = $1', [agentSlug]);
  if (!agente) throw new Error(`Agente não encontrado: ${agentSlug}`);
  await execute('UPDATE conversas SET agent_id = $1 WHERE id = $2', [agente.id, conversaId]);
}

export async function excluirContato(conversaId: string): Promise<void> {
  const conv = await queryOne<any>('SELECT client_id FROM conversas WHERE id = $1', [conversaId]);
  if (!conv) return;

  const clientId = conv.client_id;
  const convIds = await query<any>('SELECT id FROM conversas WHERE client_id = $1', [clientId]);
  for (const { id } of convIds) {
    await execute('DELETE FROM mensagens WHERE conversa_id = $1', [id]);
    await execute('DELETE FROM instrucoes_ativas WHERE conversa_id = $1', [id]);
    await execute('DELETE FROM agendamentos WHERE conversa_id = $1', [id]);
    await execute('DELETE FROM funil_conversao WHERE conversa_id = $1', [id]);
    await execute('DELETE FROM custos_ia WHERE conversa_id = $1', [id]);
    await execute('DELETE FROM acoes_supervisor WHERE conversa_id = $1', [id]).catch(() => {});
    await execute('DELETE FROM conversa_obsidian WHERE conversa_id = $1', [id]).catch(() => {});
    await execute('DELETE FROM conversas_salvas WHERE conversa_id = $1', [id]).catch(() => {});
    await execute('DELETE FROM decisoes_orquestrador WHERE conversa_id = $1', [id]).catch(() => {});
    await execute('DELETE FROM followup_agendado WHERE conversa_id = $1', [id]).catch(() => {});
    await execute('DELETE FROM transferencias WHERE conversa_id = $1', [id]).catch(() => {});
    await execute('DELETE FROM indicacoes WHERE conversa_indicador=$1 OR conversa_id_indicado=$1', [id]).catch(() => {});
    await execute('DELETE FROM perfil_pet WHERE conversa_id = $1', [id]).catch(() => {});
  }

  await execute('DELETE FROM conversas WHERE client_id = $1', [clientId]);
  await execute('DELETE FROM perfil_pet WHERE client_id = $1', [clientId]).catch(() => {});
  await execute('DELETE FROM indicacoes WHERE client_id_indicador=$1 OR client_id_indicado=$1', [clientId]).catch(() => {});
  await execute('DELETE FROM identificadores_cliente WHERE client_id = $1', [clientId]).catch(() => {});
  await execute('DELETE FROM clientes WHERE id = $1', [clientId]);
}

export async function resetarCliente(conversaId: string): Promise<void> {
  const conv = await queryOne<any>('SELECT client_id FROM conversas WHERE id = $1', [conversaId]);
  if (!conv) return;
  await execute('DELETE FROM mensagens WHERE conversa_id = $1', [conversaId]);
  await execute('DELETE FROM instrucoes_ativas WHERE conversa_id = $1', [conversaId]);
  await execute('DELETE FROM agendamentos WHERE conversa_id = $1', [conversaId]);
  await execute(`UPDATE conversas SET etapa = 'acolhimento', score = 0 WHERE id = $1`, [conversaId]);
}

export async function buscarEtapasVisitadas(conversaId: string): Promise<string[]> {
  const rows = await query<any>(
    `SELECT DISTINCT etapa FROM (
       SELECT etapa_origem AS etapa FROM funil_conversao WHERE conversa_id = $1
       UNION
       SELECT etapa_destino AS etapa FROM funil_conversao WHERE conversa_id = $1
     ) x WHERE etapa IS NOT NULL`,
    [conversaId],
  );
  return rows.map((row) => row.etapa);
}

export async function buscarObsidianAtivo(conversaId: string): Promise<string[]> {
  const row = await queryOne<any>(
    `SELECT obsidian_arquivos FROM decisoes_orquestrador
     WHERE conversa_id = $1 AND obsidian_arquivos IS NOT NULL
     ORDER BY timestamp DESC LIMIT 1`,
    [conversaId],
  );
  return row?.obsidian_arquivos || [];
}
