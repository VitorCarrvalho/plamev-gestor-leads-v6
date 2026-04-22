/**
 * consistencia.js — Memória de ações + bloqueio de repetição
 * [COMPORTAMENTO MARI] Consistência de conversa — 16/04/2026 10:50
 *
 * Garante que a Mari não repita ações já realizadas.
 */
const db = require('../db');

// ── Ler flags da conversa ─────────────────────────────────────────────────
async function lerFlags(conversaId) {
  const r = await db.one(`
    SELECT flag_plano_apresentado, flag_preco_enviado, flag_cep_recebido,
           flag_proposta_enviada, flag_objecao_respondida,
           etapa, plano_recomendado, classificacao_rede, objecao_principal
    FROM conversas WHERE id=$1`, [conversaId]
  ).catch(() => ({}));
  return r || {};
}

// ── Marcar ação como realizada ────────────────────────────────────────────
async function marcarFeito(conversaId, flag) {
  const mapa = {
    plano:    'flag_plano_apresentado',
    preco:    'flag_preco_enviado',
    cep:      'flag_cep_recebido',
    proposta: 'flag_proposta_enviada',
    objecao:  'flag_objecao_respondida',
  };
  const col = mapa[flag];
  if (!col) return;
  await db.run(`UPDATE conversas SET ${col}=true WHERE id=$1`, [conversaId]).catch(() => {});
}

// ── Validar antes de responder ────────────────────────────────────────────
// Retorna instruções de ajuste para injetar no contexto do Brain
async function validarAntesDeResponder(conversaId, decisao, texto) {
  const flags = await lerFlags(conversaId);
  const ajustes = [];

  // Plano já apresentado — não reapresentar completo
  if (flags.flag_plano_apresentado && decisao?.proxima_acao === 'apresentar_plano') {
    ajustes.push('O plano já foi apresentado nesta conversa. NÃO reapresentar do zero. Apenas complementar ou reforçar ponto específico se o cliente perguntou.');
  }

  // Preço já enviado — só repetir se cliente pediu
  if (flags.flag_preco_enviado) {
    const clientePediu = /quanto custa|preço|valor|custo/i.test(texto);
    if (!clientePediu) {
      ajustes.push('Preço já foi informado. NÃO repetir automaticamente. Se relevante, mencionar de forma resumida.');
    }
  }

  // CEP já recebido — nunca pedir de novo
  if (flags.flag_cep_recebido || flags.classificacao_rede) {
    ajustes.push(`CEP já consultado (${flags.classificacao_rede || 'verificado'}). NÃO pedir CEP novamente.`);
  }

  // Objeção já respondida — não dar mesma resposta
  if (flags.flag_objecao_respondida && flags.objecao_principal) {
    ajustes.push(`Objeção "${flags.objecao_principal}" já foi tratada. NÃO repetir a mesma resposta. Usar ângulo diferente ou avançar.`);
  }

  // Proposta enviada — reengajamento deve usar contexto diferente
  if (flags.flag_proposta_enviada) {
    ajustes.push('Proposta já foi enviada. NÃO reenviar ou reexplicar o plano. Foco em fechar ou entender bloqueio.');
  }

  // Regressão de estado — não voltar para etapas anteriores
  const hierarquia = ['acolhimento','qualificacao','apresentacao_planos','recomendacao','negociacao','pre_fechamento','fechamento','pos_venda'];
  const etapaAtual = flags.etapa || 'acolhimento';
  const etapaDecisao = decisao?.etapa;
  if (etapaDecisao) {
    const idxAtual   = hierarquia.indexOf(etapaAtual);
    const idxDecisao = hierarquia.indexOf(etapaDecisao);
    if (idxDecisao < idxAtual - 1) {
      ajustes.push(`Evitar regredir para "${etapaDecisao}". Cliente já está em "${etapaAtual}". Evoluir, não repetir.`);
    }
  }

  return ajustes;
}

// ── Atualizar flags automaticamente pelo resultado do Brain ──────────────
async function atualizarFlags(conversaId, resultado, texto_resposta) {
  const t = (texto_resposta || '').toLowerCase();

  // Detectar se apresentou plano
  if (/slim|advance|platinum|diamond/i.test(t) && /r\$|por mês|mensalidade/i.test(t)) {
    await marcarFeito(conversaId, 'plano');
    await marcarFeito(conversaId, 'preco');
  }

  // Detectar se mencionou proposta/link
  if (/link|proposta|ativar|contratar|cadastro/i.test(t)) {
    await marcarFeito(conversaId, 'proposta');
  }

  // Detectar se respondeu objeção
  if (resultado?.etapa === 'negociacao' || /entendo|entendi|faz sentido/i.test(t)) {
    await marcarFeito(conversaId, 'objecao');
  }

  // CEP já é marcado no processor quando chega — não precisamos detectar aqui
}


// ── Detectar estágio pelo ponto mais avançado validado ───────────────────
// [COMPORTAMENTO MARI] Detector de estágio — nunca regredir — 16/04/2026 10:57
async function detectarEstagio(conversaId) {
  const flags = await lerFlags(conversaId);

  // Sem cobertura — prioridade máxima
  if (['sem_cobertura','sem_credenciamento'].includes(flags.classificacao_rede)) return 'sem_cobertura';
  const naEspera = await db.one(
    `SELECT id FROM lista_espera WHERE phone=(SELECT valor FROM identificadores_cliente WHERE client_id=$1 AND tipo='phone' LIMIT 1) AND status='aguardando' LIMIT 1`,
    [(await db.one('SELECT client_id FROM conversas WHERE id=$1',[conversaId]).catch(()=>({client_id:null}))).client_id]
  ).catch(() => null);
  if (naEspera) return 'sem_cobertura';

  // Por ordem decrescente de avanço
  if (flags.etapa === 'pos_venda')                                  return 'encerrado';
  if (flags.flag_proposta_enviada || flags.etapa === 'fechamento')  return 'pos_proposta';
  if (flags.flag_objecao_respondida || flags.etapa === 'negociacao' || flags.objecao_principal) return 'pos_objecao';
  if (flags.flag_preco_enviado || flags.etapa === 'pre_fechamento') return 'pos_preco';
  if (flags.flag_plano_apresentado || flags.etapa === 'recomendacao' || flags.etapa === 'apresentacao_planos') return 'pos_recomendacao';
  if (flags.flag_cep_recebido || flags.classificacao_rede)          return 'pos_cep';
  if (flags.plano_recomendado)                                       return 'interesse_ativo';

  // Verificar dados mínimos no perfil
  const perfil = await db.one('SELECT especie, idade_anos FROM perfil_pet WHERE conversa_id=$1 LIMIT 1',[conversaId]).catch(()=>null);
  if (perfil?.especie || perfil?.idade_anos)                         return 'qualificacao_minima';

  return 'inicio';
}

module.exports = { lerFlags, marcarFeito, validarAntesDeResponder, atualizarFlags, detectarEstagio };
