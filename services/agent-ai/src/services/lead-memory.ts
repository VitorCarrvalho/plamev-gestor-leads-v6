/**
 * lead-memory.js — Camada de memória operacional estruturada
 * Substitui dependência excessiva do histórico bruto de mensagens.
 *
 * Funções:
 * - registrarEvento()   → salva evento na jornada comercial
 * - salvarCEP()         → snapshot de rede credenciada
 * - recuperarContexto() → monta contexto compacto para o Brain (economiza tokens)
 * - gerarResumoPendente()→ gera resumo via Haiku após 5min de inatividade
 */

const db = require('../db');

// ── Classificação da rede credenciada ─────────────────────────────────────
function classificarRede(qtd40km) {
  if (qtd40km >= 20) return 'excelente_cobertura';
  if (qtd40km >= 10) return 'boa_cobertura';
  if (qtd40km >= 5)  return 'cobertura_regular';
  if (qtd40km >= 1)  return 'cobertura_limitada';
  return 'sem_cobertura';
}

// ── Registrar evento na jornada ───────────────────────────────────────────
async function registrarEvento(conversaId, tipo, payload = {}) {
  await db.run(
    'INSERT INTO lead_events (conversa_id, tipo, payload) VALUES ($1, $2, $3)',
    [conversaId, tipo, JSON.stringify(payload)]
  ).catch(e => console.error('[MEMORY] Evento erro:', e.message));
}

// ── Salvar snapshot de rede credenciada ───────────────────────────────────
async function salvarCEP(conversaId, cep, resultado) {
  const qtd40 = resultado.total || 0;
  const qtd20 = (resultado.todas || resultado.top3 || [])
    .filter(c => parseFloat((c.distancia||'99').replace('km','')) <= 20).length;
  const classificacao = classificarRede(qtd40);

  await db.run(
    `INSERT INTO lead_network_snapshot (conversa_id, cep_consultado, classificacao, qtd_20km, qtd_40km, cidade, estado)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [conversaId, cep, classificacao, qtd20, qtd40, resultado.cidade || null, resultado.estado || null]
  ).catch(e => console.error('[MEMORY] CEP snapshot erro:', e.message));

  // Atualizar campos rápidos na conversa
  await db.run(
    `UPDATE conversas SET classificacao_rede=$1, clinicas_20km=$2, clinicas_40km=$3 WHERE id=$4`,
    [classificacao, qtd20, qtd40, conversaId]
  ).catch(() => {});

  await registrarEvento(conversaId, 'rede_classificada', {
    cep, classificacao, qtd_20km: qtd20, qtd_40km: qtd40, cidade: resultado.cidade
  });

  console.log(`[MEMORY] 📍 CEP ${cep}: ${classificacao} (${qtd40} clínicas em 40km)`);
  return classificacao;
}

// ── Recuperar contexto compacto para o Brain ──────────────────────────────
// Substitui carregar 20 mensagens brutas — economiza ~60% dos tokens de contexto
async function recuperarContexto(conversaId) {
  const [conv, perfil, eventos, proposta, pagamento, followups] = await Promise.all([
    db.one(`
      SELECT cv.*, cl.nome as tutor_nome,
             ic.valor as tutor_telefone
      FROM conversas cv
      LEFT JOIN clientes cl ON cl.id = cv.client_id
      LEFT JOIN identificadores_cliente ic ON ic.client_id = cv.client_id AND ic.tipo = 'phone'
      WHERE cv.id = $1`, [conversaId]).catch(() => null),
    db.one('SELECT * FROM perfil_pet WHERE conversa_id=$1 LIMIT 1', [conversaId]).catch(() => null),
    db.query(
      `SELECT tipo, payload, criado_em FROM lead_events
       WHERE conversa_id=$1 ORDER BY criado_em DESC LIMIT 10`, [conversaId]
    ).catch(() => []),
    db.one(
      `SELECT * FROM lead_proposals WHERE conversa_id=$1 ORDER BY gerada_em DESC LIMIT 1`,
      [conversaId]
    ).catch(() => null),
    db.one(
      `SELECT * FROM lead_payments WHERE conversa_id=$1 ORDER BY criado_em DESC LIMIT 1`,
      [conversaId]
    ).catch(() => null),
    db.query(
      `SELECT fa.sequencia, fa.mensagem, fa.executar_em, fa.status FROM followup_agendado fa
       WHERE fa.conversa_id=$1 ORDER BY fa.criado_em DESC LIMIT 5`,
      [conversaId]
    ).catch(() => []),
  ]);

  if (!conv) return '';

  const linhas = [`## ESTADO ATUAL DO ATENDIMENTO`];
  linhas.push(`Tutor: ${conv.tutor_nome || 'não informado'} | Tel: ${conv.tutor_telefone || '-'}`);
  linhas.push(`Etapa: ${conv.etapa} | Score: ${conv.score} | Status: ${conv.status}`);

  if (perfil) {
    const pet = [
      perfil.nome, perfil.especie, perfil.raca,
      perfil.idade_anos ? `${perfil.idade_anos} anos` : null,
      perfil.sexo
    ].filter(Boolean).join(', ');
    linhas.push(`Pet: ${pet || 'não informado'}`);
    if (perfil.cep) linhas.push(`CEP: ${perfil.cep} (${perfil.cidade || ''}${perfil.estado ? '/' + perfil.estado : ''})`);
    if (perfil.email) linhas.push(`Email: ${perfil.email}`);
    if (perfil.cpf) linhas.push(`CPF: ${perfil.cpf}`);
    if (perfil.problema_saude) linhas.push(`Problema de saúde: ${perfil.problema_saude}`);
  }

  if (conv.classificacao_rede) {
    linhas.push(`Rede credenciada: ${conv.classificacao_rede} | 20km: ${conv.clinicas_20km || 0} | 40km: ${conv.clinicas_40km || 0}`);
  }

  if (conv.plano_recomendado) linhas.push(`Plano discutido: ${conv.plano_recomendado}`);
  if (conv.objecao_principal) linhas.push(`Objeção principal: ${conv.objecao_principal}`);

  if (proposta) {
    linhas.push(`Proposta: ${proposta.numero_proposta} | ${proposta.plano_ofertado} | R$${proposta.valor_final} | Status: ${proposta.status}`);
  }

  if (pagamento) {
    linhas.push(`Pagamento: ${pagamento.status_pagamento} | Método: ${pagamento.metodo_pagamento || '-'}`);
  }

  if (conv.resumo_conversa) {
    // RESUMO INTERNO — para Mari continuar conversa, nunca enviar ao cliente
    linhas.push(`\n## RESUMO INTERNO (não enviar ao cliente)\n${conv.resumo_conversa}`);
  }

  if (eventos.length > 0) {
    linhas.push(`\n## ÚLTIMOS EVENTOS`);
    eventos.slice(0, 5).forEach(e => {
      const dt = new Date(e.criado_em).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'});
      linhas.push(`${dt} | ${e.tipo}`);
    });
  }

  if (conv.proximo_passo) linhas.push(`\nPróximo passo: ${conv.proximo_passo}`);

  // Followups enviados
  if (followups.length > 0) {
    const enviados = followups.filter(f => f.status === 'enviado').length;
    const pendentes = followups.filter(f => f.status === 'pendente').length;
    if (enviados > 0 || pendentes > 0) {
      linhas.push(`Reengajamento: ${enviados}x enviado${pendentes > 0 ? ` · ${pendentes} pendente` : ''}`);
    }
  }

  return linhas.join('\n');
}

// ── Resumo automático após 5 minutos de inatividade ──────────────────────
const INATIVIDADE_MS = 5 * 60 * 1000; // 5 minutos
const resumosEmAndamento = new Set();

async function gerarResumoPendente(conversaId) {
  if (resumosEmAndamento.has(conversaId)) return;

  const conv = await db.one(
    `SELECT cv.*, cl.nome as tutor_nome
     FROM conversas cv
     LEFT JOIN clientes cl ON cl.id = cv.client_id
     WHERE cv.id = $1`, [conversaId]
  ).catch(() => null);

  if (!conv) return;

  // Verificar se passou 5 min desde última interação
  const desde = Date.now() - new Date(conv.ultima_interacao).getTime();
  if (desde < INATIVIDADE_MS) return;

  // Verificar se resumo já foi gerado após última interação
  if (conv.resumo_gerado_em && new Date(conv.resumo_gerado_em) >= new Date(conv.ultima_interacao)) return;

  resumosEmAndamento.add(conversaId);

  try {
    const contexto = await recuperarContexto(conversaId);
    const historico = await db.buscarHistorico(conversaId, 10);
    const ultimasMsgs = historico
      .map(h => `${h.role === 'user' ? 'Cliente' : 'Mari'}: ${h.conteudo.slice(0, 150)}`)
      .join('\n');

    // Usar HTTPS direto (igual ao brain/index.js) — sem SDK
    const KEY = process.env.ANTHROPIC_API_KEY;
    const body_resumo = JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 120,
      system: 'Gere resumo operacional INTERNO (≤300 chars) com abreviações. Formato: [tutor/pet(raça,idade)/etapa] [CEP/cli] [plano] [obs] [followup:Nx] [prx:acao]. Próximos passos: mandar msg, aguardar, oferta especial, encerrar.',
      messages: [{ role: 'user', content: `${contexto}\nMsgs:\n${ultimasMsgs}\nResumo:` }]
    });

    const https_mem = require('https');
    const resumo = await new Promise((resolve) => {
      const req = https_mem.request({
        hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
        headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body_resumo) }
      }, res => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d).content?.[0]?.text?.trim() || null); } catch { resolve(null); } });
      });
      req.on('error', () => resolve(null));
      req.write(body_resumo); req.end();
    });
    if (!resumo) return;

    await db.run(
      `UPDATE conversas SET resumo_conversa=$1, resumo_gerado_em=NOW(), resumo_atualizado_em=NOW() WHERE id=$2`,
      [resumo, conversaId]
    );

    await registrarEvento(conversaId, 'resumo_automatico_gerado', { chars: resumo.length });
    console.log(`[MEMORY] 📝 Resumo gerado para ${conversaId.slice(0,8)}`);
  } catch(e) {
    console.error('[MEMORY] Resumo erro:', e.message);
  } finally {
    resumosEmAndamento.delete(conversaId);
  }
}

// ── Iniciar loop de resumos (verificar a cada 1 min) ─────────────────────
function iniciarLoopResumos() {
  setInterval(async () => {
    const conversas = await db.query(
      `SELECT id FROM conversas
       WHERE status = 'ativa'
         AND ultima_interacao <= NOW() - INTERVAL '5 minutes'
         AND (resumo_gerado_em IS NULL OR resumo_gerado_em < ultima_interacao)
       LIMIT 5`
    ).catch(() => []);

    for (const c of conversas) {
      gerarResumoPendente(c.id).catch(() => {});
    }
  }, 60 * 1000);

  console.log('[MEMORY] ✅ Loop de resumos automáticos iniciado (1min)');
}

// ── Corrigir etapa com base em eventos ────────────────────────────────────
async function corrigirEtapa(conversaId) {
  const eventos = await db.query(
    `SELECT tipo FROM lead_events WHERE conversa_id=$1 ORDER BY criado_em ASC`,
    [conversaId]
  ).catch(() => []);

  const tipos = new Set(eventos.map(e => e.tipo));
  let etapaNova = null;

  if (tipos.has('pagamento_confirmado'))         etapaNova = 'pos_venda';
  else if (tipos.has('link_pagamento_enviado'))  etapaNova = 'fechamento';
  else if (tipos.has('proposta_enviada'))        etapaNova = 'negociacao';
  else if (tipos.has('proposta_gerada'))         etapaNova = 'negociacao';
  else if (tipos.has('questionamento_preco'))    etapaNova = 'negociacao';
  else if (tipos.has('rede_classificada'))       etapaNova = 'apresentacao_produto';
  else if (tipos.has('cep_consultado'))          etapaNova = 'qualificacao';

  if (!etapaNova) return;

  const conv = await db.one('SELECT etapa FROM conversas WHERE id=$1', [conversaId]).catch(() => null);
  if (!conv || conv.etapa === etapaNova) return;

  await db.run('UPDATE conversas SET etapa=$1 WHERE id=$2', [etapaNova, conversaId]);
  await registrarEvento(conversaId, 'etapa_corrigida', { de: conv.etapa, para: etapaNova, motivo: 'evidencia_evento' });
  console.log(`[MEMORY] 🔄 Etapa corrigida: ${conv.etapa} → ${etapaNova}`);
}


// ── Calcular temperatura do lead ─────────────────────────────────────────────
// 21/04/2026 — Getúlio: regras reescritas. Score agora é 0-10 (não 0-100 como
// o código antigo assumia). Thresholds ajustados + etapa e plano_recomendado
// passam a influenciar diretamente.
//
//   quente   = score ≥ 7 OU etapa avançada (apresentacao+/negociacao/pre-fech/fechamento)
//              E cliente ativo (última msg < 2h) — quem tá pronto pra fechar
//   morno    = score 4-6 OU última msg 2h-24h — interessado, em ritmo normal
//   frio     = score < 4 OU última msg 24h-72h sem avanço — engajamento baixo
//   perdido  = 6+ followups enviados sem resposta OU última msg > 72h
//   vendido  = etapa=venda_fechada OU pago — venda concluída (informativo)
async function atualizarTemperatura(conversaId) {
  const conv = await db.one(
    `SELECT score, etapa, plano_recomendado, ultima_interacao,
            (SELECT COUNT(*) FROM followup_agendado fa
             WHERE fa.conversa_id=$1 AND fa.status='enviado') AS followups
     FROM conversas WHERE id=$1`, [conversaId]
  ).catch(() => null);
  if (!conv) return;

  const horasSemResposta = (Date.now() - new Date(conv.ultima_interacao).getTime()) / 3_600_000;
  const followups = parseInt(conv.followups || 0);
  const score     = parseFloat(conv.score || 0);
  const etapasAvancadas = ['apresentacao_planos', 'validacao_cep', 'negociacao', 'objecao', 'pre_fechamento', 'fechamento'];
  const etapasVendidas  = ['venda_fechada', 'pago'];

  let temp;
  if (etapasVendidas.includes(conv.etapa)) {
    temp = 'vendido';
  } else if (followups >= 6 || horasSemResposta > 72) {
    temp = 'perdido';
  } else if ((score >= 7 || etapasAvancadas.includes(conv.etapa) || conv.plano_recomendado) && horasSemResposta <= 2) {
    temp = 'quente';
  } else if (score >= 4 || horasSemResposta <= 24) {
    temp = 'morno';
  } else {
    temp = 'frio';
  }

  await db.run('UPDATE conversas SET temperatura_lead=$1 WHERE id=$2', [temp, conversaId]);
  return temp;
}

// ── Registrar oferta feita ────────────────────────────────────────────────────
async function registrarOferta(conversaId, plano, valorBase, desconto, valorFinal) {
  const conv = await db.one('SELECT historico_ofertas FROM conversas WHERE id=$1', [conversaId]).catch(() => null);
  const hist = conv?.historico_ofertas || [];
  hist.push({
    plano, valor_base: valorBase, desconto_pct: desconto,
    valor_final: valorFinal, feita_em: new Date().toISOString()
  });
  await db.run('UPDATE conversas SET historico_ofertas=$1 WHERE id=$2', [JSON.stringify(hist), conversaId]);
  console.log(`[MEMORY] 💰 Oferta registrada: ${plano} R$${valorFinal} (${desconto}% off)`);
}

// ── Salvar vínculo emocional detectado ───────────────────────────────────────
async function salvarVinculo(conversaId, vinculo) {
  await db.run(
    'UPDATE perfil_pet SET vinculo_emocional=$1 WHERE conversa_id=$2',
    [vinculo, conversaId]
  ).catch(() => {});
  await registrarEvento(conversaId, 'vinculo_emocional_detectado', { vinculo });
  console.log(`[MEMORY] 💛 Vínculo emocional salvo: ${vinculo}`);
}

// ── Registrar aniversário do pet ──────────────────────────────────────────────
async function salvarAniversarioPet(conversaId, clientId, nomePet, dataNasc) {
  const d = new Date(dataNasc);
  const diaMes = `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  await db.run(
    `INSERT INTO pet_aniversarios (conversa_id, client_id, nome_pet, data_nasc, dia_mes)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [conversaId, clientId, nomePet, dataNasc, diaMes]
  ).catch(() => {});
  console.log(`[MEMORY] 🎂 Aniversário do pet salvo: ${nomePet} em ${diaMes}`);
}

// ── Verificar aniversários do dia e disparar mensagens ───────────────────────
async function verificarAniversarios() {
  const hoje = new Date();
  const diaMes = `${String(hoje.getMonth()+1).padStart(2,'0')}-${String(hoje.getDate()).padStart(2,'0')}`;

  const aniversariantes = await db.query(
    `SELECT pa.*, cv.instancia_whatsapp, cv.numero_externo, cv.jid, cv.canal,
            cl.nome as tutor_nome
     FROM pet_aniversarios pa
     JOIN conversas cv ON cv.id = pa.conversa_id
     JOIN clientes cl ON cl.id = pa.client_id
     WHERE pa.dia_mes = $1
       AND (pa.ultimo_aviso IS NULL OR pa.ultimo_aviso < CURRENT_DATE)
       AND cv.status = 'ativa'`,
    [diaMes]
  ).catch(() => []);

  for (const pet of aniversariantes) {
    const sender = require('./sender');
    const msg = `🎂 Hoje é o aniversário do ${pet.nome_pet}! 🐾 Que ele tenha muita saúde e felicidade ao lado de vocês! Aproveita o dia especial! 💛`;
    await sender.enviarDireto(pet.instancia_whatsapp, pet.jid || (pet.numero_externo + '@s.whatsapp.net'), msg, pet.numero_externo).catch(() => {});
    await db.run('UPDATE pet_aniversarios SET ultimo_aviso=CURRENT_DATE WHERE id=$1', [pet.id]).catch(() => {});
    await registrarEvento(pet.conversa_id, 'aniversario_pet_enviado', { nome_pet: pet.nome_pet });
    console.log(`[MEMORY] 🎂 Aniversário enviado: ${pet.nome_pet} para ${pet.numero_externo}`);
  }
}

module.exports = {
  registrarEvento,
  salvarCEP,
  recuperarContexto,
  gerarResumoPendente,
  iniciarLoopResumos,
  corrigirEtapa,
  classificarRede,
  atualizarTemperatura,
  registrarOferta,
  salvarVinculo,
  salvarAniversarioPet,
  verificarAniversarios,
};
