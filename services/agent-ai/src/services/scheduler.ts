/**
 * services/scheduler.js — Executa reengajamentos agendados
 * Roda a cada 1 minuto, verifica agendamentos pendentes
 */
const db     = require('../db');
const brain  = require('../brain');
const sender = require('./sender');
const ctx    = require('../orchestrator/contexto');
const fs     = require('fs');
const path   = require('path');

const OBSIDIAN = '/Users/geta/Documents/Mari-Knowledge-Base';

async function executarPendentes() {
  const pendentes = await db.query(
    `SELECT a.*, c.client_id, c.agent_id, c.canal, c.numero_externo, c.jid, c.etapa, c.score, c.instancia_whatsapp
     FROM agendamentos a
     JOIN conversas c ON c.id = a.conversa_id
     WHERE a.status = 'pendente'
       AND a.executar_em <= NOW()
       AND c.status = 'ativa'
     LIMIT 10`,
    []
  ).catch(() => []);

  for (const ag of pendentes) {
    try {
      await db.run(
        "UPDATE agendamentos SET status='executado', tentativas=tentativas+1 WHERE id=$1",
        [ag.id]
      );

      const agente  = await db.buscarAgente('mari');
      const cliente = await db.one('SELECT * FROM clientes WHERE id=$1', [ag.client_id]);
      const perfil  = await db.buscarOuCriarPerfil(ag.client_id);
      const historico = await db.buscarHistorico(ag.conversa_id);

      const conversa = { id: ag.conversa_id, etapa: ag.etapa, score: ag.score, numero_cotacao: null, ia_silenciada: false };

      // Instrução de reengajamento
      const instrucao = `REENGAJAMENTO AUTOMÁTICO: O cliente não respondeu.
Mande UMA mensagem calorosa e criativa para reativar o interesse.
${perfil?.nome ? 'Use o nome do pet: ' + perfil.nome : ''}
Seja natural, não pareça automático. Máx 2 frases.`;

      const contexto = await ctx.montar({
        conversa, cliente, perfil, historico,
        decisao: { modo: 'follow_up', consultar_bd: [], consultar_relacional: false, tags_relacional: [], sugestao_plano: null, nivel_urgencia: 5, proxima_acao: 'follow_up' },
        agente, mensagem: ''
      });

      const resultado = await brain.pensar('', historico, contexto + '\n\n# INSTRUÇÃO ESPECIAL\n' + instrucao, agente.modelo_negociacao);

      await sender.enviar({
        canal: ag.canal,
        phone: ag.numero_externo,
        jid: ag.jid,
        instancia: ag.instancia_whatsapp,
        chatId: ag.canal === 'telegram' ? ag.numero_externo : null
      }, resultado.resposta);

      await db.salvarMensagem(ag.conversa_id, 'agent', resultado.resposta, 'ia').catch(() => {});

      console.log(`[SCHED] ✅ Reengajamento ${ag.tipo} → ${ag.numero_externo}`);
    } catch(e) {
      console.error(`[SCHED] Erro agend ${ag.id}:`, e.message);
      await db.run("UPDATE agendamentos SET status='pendente' WHERE id=$1", [ag.id]).catch(() => {});
    }
  }
}

function iniciar() {
  setInterval(executarPendentes, 60 * 1000);
  console.log('[SCHED] ✅ Scheduler iniciado (1 min)');
}

module.exports = { iniciar };
