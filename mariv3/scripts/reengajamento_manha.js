/**
 * scripts/reengajamento_manha.js
 * Envia mensagem de reengajamento para leads que não responderam.
 * Ritmo: 1 por minuto a partir de 08:30.
 * Executado via PM2 one-shot ou cron.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const db     = require('../db');
const sender = require('../services/sender');
const brain  = require('../brain');
const ctx    = require('../orchestrator/contexto');

// ── Leads a reengajar ─────────────────────────────────────────
async function buscarLeads() {
  return db.query(`
    SELECT 
      c.id AS conversa_id, c.numero_externo, c.instancia_whatsapp,
      c.sender_chip, c.etapa, c.jid, c.canal, c.agent_id,
      cl.nome, cl.id AS client_id
    FROM conversas c
    JOIN clientes cl ON cl.id = c.client_id
    WHERE c.status = 'ativa'
      AND c.ia_silenciada = false
      AND c.canal = 'whatsapp'
      AND c.instancia_whatsapp IS NOT NULL AND c.instancia_whatsapp != ''
      AND c.numero_externo ~ '^[0-9]{10,15}$'
      AND c.numero_externo NOT IN ('5511914956623','553199637605','552139553665','551152866086')
      AND c.criado_em >= NOW() - INTERVAL '30 hours'
      AND (SELECT COUNT(*) FROM mensagens m WHERE m.conversa_id = c.id AND m.role = 'user') <= 2
      AND cl.nome NOT ILIKE '%teste%'
      AND cl.nome NOT ILIKE '%getulio%'
      AND cl.nome NOT ILIKE '%atlas%'
    ORDER BY c.criado_em ASC
  `);
}

// ── Gerar mensagem de reengajamento via Claude ─────────────────
async function gerarMensagem(lead) {
  const agente = await db.buscarAgente('mari');
  if (!agente) return null;

  const conversa = { 
    id: lead.conversa_id, etapa: lead.etapa, 
    numero_cotacao: null, instancia_whatsapp: lead.instancia_whatsapp,
    ia_silenciada: false, sender_chip: lead.sender_chip,
  };
  const cliente = { id: lead.client_id, nome: lead.nome };
  const perfil  = await db.buscarOuCriarPerfil(lead.client_id);
  const historico = await db.buscarHistorico(lead.conversa_id);

  const decisao = {
    modo: 'acolhimento', proxima_acao: 'reengajar', nivel_urgencia: 7,
    consultar_bd: [], consultar_relacional: false, tags_relacional: [],
    sugestao_plano: null,
  };

  const ctxResult = await ctx.montar({ conversa, cliente, perfil, historico, decisao, agente, mensagem: '[reengajamento]' });

  const instrucao = `
Você está retomando contato com ${lead.nome || 'o cliente'} que entrou em contato ontem mas a conversa não avançou.
Crie UMA mensagem curta e calorosa de reengajamento — como se fosse a Mari verificando se a pessoa ainda tem interesse.
Não mencione que é um follow-up automático. Seja natural. Máximo 2 frases.
`;

  const resultado = await brain.pensar('[reengajamento matinal]', historico, ctxResult.contexto + '\n\n' + instrucao, agente.modelo_negociacao);
  return resultado?.resposta || null;
}

// ── Enviar para um lead ───────────────────────────────────────
async function enviarParaLead(lead) {
  try {
    const mensagem = await gerarMensagem(lead);
    if (!mensagem) {
      console.log(`[REENG] ⚠️  ${lead.nome} — mensagem vazia, pulando`);
      return;
    }

    const msg = {
      canal: 'whatsapp',
      phone: lead.numero_externo,
      jid: lead.jid,
      instancia: lead.instancia_whatsapp,
      senderChip: lead.sender_chip,
    };

    await sender.enviar(msg, mensagem);

    // Salvar no histórico
    await db.salvarMensagem(lead.conversa_id, 'agent', mensagem, 'ia_reengajamento');

    console.log(`[REENG] ✅ ${lead.nome} (${lead.numero_externo}) — "${mensagem.slice(0, 60)}..."`);
  } catch (e) {
    console.error(`[REENG] ❌ ${lead.nome}:`, e.message);
  }
}

// ── Main: aguarda 08:30 e dispara 1/min ──────────────────────
async function main() {
  console.log('[REENG] Iniciando script de reengajamento matinal');

  const leads = await buscarLeads();
  console.log(`[REENG] ${leads.length} leads encontradas para reengajar`);

  if (leads.length === 0) {
    console.log('[REENG] Nenhuma lead. Encerrando.');
    process.exit(0);
  }

  // Calcular delay até 08:30 BRT
  const agora    = new Date();
  const amanha   = new Date(agora);
  amanha.setDate(amanha.getDate() + 1);
  amanha.setHours(8, 30, 0, 0); // 08:30 BRT = 11:30 UTC
  // Ajuste para fuso -3 (BRT)
  const inicio   = new Date(amanha.getTime() - (0 * 60 * 60 * 1000)); // já está em horário local pelo server

  // Verificar se está no fuso correto
  const agoraBRT = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const amanhaBRT = new Date(agoraBRT);
  amanhaBRT.setDate(amanhaBRT.getDate() + 1);
  amanhaBRT.setHours(8, 30, 0, 0);

  // Converter 08:30 BRT para UTC para comparar
  const msAte830 = amanhaBRT.getTime() - agoraBRT.getTime();

  console.log(`[REENG] Aguardando até 08:30 BRT (${Math.round(msAte830 / 60000)} minutos)...`);
  console.log(`[REENG] Leads na fila:`);
  leads.forEach((l, i) => {
    const minuto = i; // 0min, 1min, 2min...
    console.log(`  ${i+1}. ${l.nome} (${l.numero_externo}) — disparo em 08:${(30+minuto).toString().padStart(2,'0')}`);
  });

  // Aguardar até 08:30
  await new Promise(r => setTimeout(r, Math.max(0, msAte830)));

  // Disparar 1 por minuto
  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const hora = `08:${(30 + i).toString().padStart(2, '0')}`;
    console.log(`\n[REENG] ⏰ ${hora} — Enviando para ${lead.nome}...`);
    await enviarParaLead(lead);

    if (i < leads.length - 1) {
      console.log('[REENG] Aguardando 60s...');
      await new Promise(r => setTimeout(r, 60_000));
    }
  }

  console.log('\n[REENG] ✅ Todas as leads foram contactadas.');
  process.exit(0);
}

main().catch(e => { console.error('[REENG] FATAL:', e); process.exit(1); });
