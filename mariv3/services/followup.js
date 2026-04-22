/**
 * services/followup.js
 * Sistema de follow-up inteligente da Mari.
 *
 * Fluxo:
 *   1. Após cada resposta enviada, 5s depois gera avaliação
 *   2. Claude decide: encerrar | agendar amanhã cedo | agendar semana | reengajar agora
 *   3. Grava agendamento no BD
 *   4. Scheduler executa respeitando:
 *      - Horário comercial: 8h-22h BRT
 *      - Máx 3 envios/min
 *      - Cliente respondeu nos últimos 15min = não provocar
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const db    = require('../db');
const https = require('https');

const KEY    = process.env.ANTHROPIC_API_KEY;
// Modelo lido da BD em runtime (não hardcoded)

// ── Horário BRT ───────────────────────────────────────────────
function agora() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
}

function horarioComercial(dt) {
  const h = dt.getHours();
  return h >= 8 && h < 22;
}

function proximoComercial(base = agora()) {
  const dt = new Date(base);
  // Se já é horário comercial, manter
  if (horarioComercial(dt)) return dt;
  // Ir para o próximo 08:00
  dt.setDate(dt.getDate() + 1);
  dt.setHours(8, 0, 0, 0);
  return dt;
}

function amanha8h() {
  const dt = agora();
  dt.setDate(dt.getDate() + 1);
  dt.setHours(8, 0, 0, 0);
  return dt;
}

function semanaQueVem() {
  const dt = agora();
  dt.setDate(dt.getDate() + 7);
  dt.setHours(9, 0, 0, 0);
  return dt;
}

// ── Claude decide o follow-up ─────────────────────────────────
async function avaliarConversa(conversa, historico, perfil, cliente) {
  const nomeCliente = cliente?.nome || 'Cliente';
  const nomePet     = perfil?.nome || '';
  const etapa       = conversa.etapa || 'acolhimento';

  const ultimas = historico.slice(-6)
    .map(h => `${h.role === 'user' ? nomeCliente : 'Mari'}: ${h.conteudo.slice(0, 100)}`)
    .join('\n');

  const prompt = `Analise esta conversa de venda de plano de saúde pet e decida o próximo passo.

Cliente: ${nomeCliente}${nomePet ? ` | Pet: ${nomePet}` : ''}
Etapa: ${etapa}
Últimas mensagens:
${ultimas || '(sem histórico)'}

Retorne APENAS um JSON:
{
  "acao": "encerrar|provocar_hoje|provocar_amanha|provocar_semana",
  "motivo": "1 linha explicando",
  "mensagem": "mensagem exata que a Mari vai enviar (se acao != encerrar)",
  "urgencia": 1-10
}

Critérios:
- encerrar: cliente disse não claramente, ou 5+ tentativas sem resposta
- provocar_hoje: cliente mostrou interesse mas ficou em silêncio < 2h
- provocar_amanha: cliente ficou em silêncio > 2h ou pediu para falar depois
- provocar_semana: cliente disse que vai pensar ou voltará em breve
- Mensagem deve ser natural, mencionar o pet pelo nome se souber`;

  const cfgF  = await db.getConfig('modelo_agente', 'claude-haiku-4-5').catch(() => 'claude-haiku-4-5');
  return new Promise((resolve) => {
    const fallback = { acao: 'encerrar', motivo: 'fallback', mensagem: null, urgencia: 1 };
    const body = JSON.stringify({
      model: cfgF, max_tokens: 300,
      system: 'Você é o avaliador de conversas de vendas. Retorne APENAS JSON válido.',
      messages: [{ role: 'user', content: prompt }]
    });
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const texto = JSON.parse(d).content?.[0]?.text || '';
          const match = texto.match(/\{[\s\S]*\}/);
          if (match) resolve({ ...fallback, ...JSON.parse(match[0]) });
          else resolve(fallback);
        } catch { resolve(fallback); }
      });
    });
    req.on('error', () => resolve(fallback));
    req.write(body); req.end();
  });
}

// ── Registrar agendamento no BD ───────────────────────────────
async function registrarFollowup(conversaId, avaliacao) {
  const { acao, mensagem, motivo } = avaliacao;
  if (acao === 'encerrar') {
    console.log(`[FOLLOWUP] ✋ ${conversaId.slice(0,8)} — encerrar conversa (${motivo})`);
    return null;
  }

  let executarEm;
  if (acao === 'provocar_hoje') {
    // Entre 15min e 2h a partir de agora, em horário comercial
    const base = new Date(Date.now() + 15 * 60 * 1000 + Math.random() * 105 * 60 * 1000);
    executarEm = horarioComercial(new Date(base.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })))
      ? base : proximoComercial(base);
  } else if (acao === 'provocar_amanha') {
    executarEm = amanha8h();
  } else {
    executarEm = semanaQueVem();
  }

  const row = await db.one(
    `INSERT INTO followup_agendado (conversa_id, tipo, mensagem, motivo, executar_em)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [conversaId, acao, mensagem || null, motivo, executarEm.toISOString()]
  );
  console.log(`[FOLLOWUP] 📅 ${conversaId.slice(0,8)} — ${acao} em ${executarEm.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (${motivo})`);
  return row;
}

// ── Avaliar e agendar (chamado após envio, com delay de 5s) ───
async function avaliarEAgendar(conversaId) {
  try {
    const conv    = await db.one('SELECT * FROM conversas WHERE id=$1', [conversaId]);
    if (!conv || conv.ia_silenciada) return;

    const cliente = await db.one('SELECT * FROM clientes WHERE id=$1', [conv.client_id]);
    const perfil  = await db.buscarOuCriarPerfil(conv.client_id);
    const hist    = await db.buscarHistorico(conversaId);

    const avaliacao = await avaliarConversa(conv, hist, perfil, cliente);
    await registrarFollowup(conversaId, avaliacao);
  } catch (e) {
    console.error('[FOLLOWUP] Erro ao avaliar:', e.message);
  }
}

// ── Executar followups pendentes (chamado pelo scheduler) ─────
let enviandoAgora = 0;
const MAX_POR_MINUTO = 3;

async function executarPendentes() {
  const agoraBRT = agora();

  // Respeitar horário comercial
  if (!horarioComercial(agoraBRT)) return;

  // Buscar pendentes vencidos
  const pendentes = await db.query(`
    SELECT fa.*, c.numero_externo, c.jid, c.instancia_whatsapp, c.sender_chip,
           c.ultima_interacao, c.ia_silenciada, c.canal
    FROM followup_agendado fa
    JOIN conversas c ON c.id = fa.conversa_id
    WHERE fa.status = 'pendente'
      AND fa.executar_em <= NOW()
      AND c.ia_silenciada = false
      AND c.status = 'ativa'
    ORDER BY fa.executar_em ASC
    LIMIT 5
  `).catch(() => []);

  for (const row of pendentes) {
    // Verificar se cliente respondeu nos últimos 15min
    const ultimaInteracao = new Date(row.ultima_interacao);
    const minutosSemResposta = (Date.now() - ultimaInteracao.getTime()) / 60000;
    if (minutosSemResposta < 15) {
      await db.run('UPDATE followup_agendado SET status=$1 WHERE id=$2', ['cancelado', row.id]);
      console.log(`[FOLLOWUP] ↩️  ${row.numero_externo} respondeu recentemente — cancelado`);
      continue;
    }

    // Limitar taxa: 3/min
    if (enviandoAgora >= MAX_POR_MINUTO) {
      console.log('[FOLLOWUP] ⏸️  Limite 3/min atingido, aguardando...');
      break;
    }

    // Marcar como em processamento
    await db.run('UPDATE followup_agendado SET tentativas=tentativas+1 WHERE id=$1', [row.id]);
    enviandoAgora++;

    // Enviar
    const sender = require('./sender');
    const msg    = row.mensagem;
    if (!msg) {
      await db.run('UPDATE followup_agendado SET status=$1, executado_em=NOW() WHERE id=$2', ['ignorado', row.id]);
      enviandoAgora--;
      continue;
    }

    const msgObj = {
      canal: row.canal, phone: row.numero_externo,
      jid: row.jid, instancia: row.instancia_whatsapp, senderChip: row.sender_chip,
    };

    sender.enviar(msgObj, msg).then(async ok => {
      const status = ok ? 'enviado' : 'ignorado';
      await db.run('UPDATE followup_agendado SET status=$1, executado_em=NOW() WHERE id=$2', [status, row.id]);
      console.log(`[FOLLOWUP] ${ok ? '✅' : '❌'} ${row.numero_externo} — "${msg.slice(0,50)}"`);
    }).catch(async () => {
      await db.run('UPDATE followup_agendado SET status=$1 WHERE id=$2', ['ignorado', row.id]);
    }).finally(() => { enviandoAgora--; });

    // 1 envio a cada 20s para respeitar 3/min
    await new Promise(r => setTimeout(r, 20000));
  }
}

// Resetar contador a cada minuto
setInterval(() => { enviandoAgora = 0; }, 60000);

module.exports = { avaliarEAgendar, executarPendentes };
