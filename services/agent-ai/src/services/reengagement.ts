/**
 * services/reengajamento.js — Vácuo Contextual por Etapa v2
 * [COMPORTAMENTO MARI] Sistema de reengajamento baseado em estado da conversa — 16/04/2026 10:30
 * [COMPORTAMENTO MARI] 8 tentativas em 15 dias com progressão de ângulo — 16/04/2026 22:28
 *
 * PRINCÍPIO: A Mari retoma no ponto exato onde o cliente parou.
 * Máximo 8 tentativas totais. Máximo 3 por dia. Nunca rajada.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const db    = require('../db');
const https = require('https');
const KEY   = process.env.ANTHROPIC_API_KEY;

// ── 8 Estados do funil ────────────────────────────────────────────────────
const ESTADOS = {
  INICIO:               'inicio',
  QUALIFICACAO_INICIAL: 'qualificacao_inicial',
  POS_RECOMENDACAO:     'pos_recomendacao',
  POS_CEP:              'pos_cep',
  POS_PRECO:            'pos_preco',
  POS_OBJECAO:          'pos_objecao',
  POS_PROPOSTA:         'pos_proposta',
  SEM_COBERTURA:        'sem_cobertura',
};

// ── Intenções por estado (sem frases fixas) ──────────────────────────────
const INTENCOES = {
  inicio:               'reabrir conversa de forma leve, fazer 1 pergunta simples sobre o tipo de pet',
  qualificacao_inicial: 'avançar coleta mínima com naturalidade, pedir 1 dado específico que falta',
  pos_recomendacao:     'retomar interesse no plano apresentado, puxar próxima ação sem pressão',
  pos_cep:              'conduzir para decisão, aproximar fechamento com naturalidade',
  pos_preco:            'destravar decisão, reforçar valor brevemente sem explicar demais',
  pos_objecao:          'reduzir resistência, oferecer alternativa mais leve ou simplificar decisão',
  pos_proposta:         'fechar direto e limpo, sem explicação adicional',
  sem_cobertura:        'encerrar com elegância, oferecer lista de espera, não tentar vender',
};

// ── Progressão de ângulos por tentativa ──────────────────────────────────
// [COMPORTAMENTO MARI] Progressão de tom por sequência — 16/04/2026 22:28
const ANGULOS = [
  { chave: 'curioso',    instrucao: 'Tom leve e curioso. 1 pergunta simples. Sem pressão.' },
  { chave: 'humor',      instrucao: 'Leveza e um toque de humor sobre o pet. Energia boa.' },
  { chave: 'emocional',  instrucao: 'Urgência emocional sutil. Mencionar imprevistos com pets. Não ser dramático.' },
  { chave: 'condicao',   instrucao: 'Oferecer uma condição especial que pode aplicar nessa semana. Tom animado.' },
  { chave: 'energia',    instrucao: 'Energia renovada. Assume que a pessoa estava ocupada. Tom acolhedor.' },
  { chave: 'criativo',   instrucao: 'Ângulo completamente diferente. Curiosidade, dado interessante sobre saúde pet.' },
  { chave: 'serio',      instrucao: 'Última tentativa séria. Direto. Sem enrolação. 1 frase + CTA.' },
  { chave: 'despedida',  instrucao: 'Despedida calorosa. Deixa a porta aberta. Sem venda. Tom de cuidado genuíno.' },
];

// ── Tempos por estado (minutos) — 8 posições cobrindo 15 dias ────────────
// [COMPORTAMENTO MARI] Expandido de 3 para 8 tentativas — 16/04/2026 22:28
// Tentativas 0-2: contextuais por estado | 3-7: sequência longa fixa
const TAIL = [
  Math.random() < 0.5 ? 480 : 1080, // tentativa 3: 8h ou 18h (aleatório)
  1440,   // tentativa 4: 1 dia
  4320,   // tentativa 5: 3 dias
  10080,  // tentativa 6: 7 dias
  21600,  // tentativa 7: 15 dias
];

const TEMPOS = {
  inicio:               [30,   1440,  1440,  ...TAIL],
  qualificacao_inicial: [20,   240,   240,   ...TAIL],
  pos_recomendacao:     [20,   360,   1440,  ...TAIL],
  pos_cep:              [15,   240,   1440,  ...TAIL],
  pos_preco:            [20,   240,   1440,  ...TAIL],
  pos_objecao:          [60,   1440,  1440,  ...TAIL],
  pos_proposta:         [15,   180,   1440,  ...TAIL],
  sem_cobertura:        [0],   // envio único — nunca repete
};

// ── Identificar estado pela conversa ─────────────────────────────────────
async function identificarEstado(conversaId) {
  const conv = await db.one('SELECT * FROM conversas WHERE id=$1', [conversaId]).catch(() => null);
  if (!conv) return ESTADOS.INICIO;

  if (['sem_cobertura', 'sem_credenciamento'].includes(conv.classificacao_rede)) return ESTADOS.SEM_COBERTURA;

  const naEspera = await db.one(
    `SELECT id FROM lista_espera WHERE phone=(
      SELECT valor FROM identificadores_cliente WHERE client_id=$1 AND tipo='phone' LIMIT 1
    ) AND status='aguardando' LIMIT 1`,
    [conv.client_id]
  ).catch(() => null);
  if (naEspera) return ESTADOS.SEM_COBERTURA;

  const etapa = conv.etapa || 'acolhimento';
  if (['pre_fechamento', 'fechamento'].includes(etapa))                    return ESTADOS.POS_PROPOSTA;
  if (etapa === 'negociacao' || conv.objecao_principal)                    return ESTADOS.POS_OBJECAO;
  if (etapa === 'apresentacao_planos' || etapa === 'recomendacao')         return ESTADOS.POS_RECOMENDACAO;
  if (etapa === 'validacao_cep' || conv.classificacao_rede)                return ESTADOS.POS_CEP;

  const ultimas = await db.query(
    `SELECT conteudo FROM mensagens WHERE conversa_id=$1 ORDER BY timestamp DESC LIMIT 5`,
    [conversaId]
  ).catch(() => []);
  const textos = ultimas.map(m => m.conteudo.toLowerCase()).join(' ');
  if (/r\$|preço|valor|custa|119|189|359|59/.test(textos))                 return ESTADOS.POS_PRECO;

  const perfil = await db.one(
    'SELECT * FROM perfil_pet WHERE conversa_id=$1 LIMIT 1', [conversaId]
  ).catch(() => null);
  if (perfil?.especie || perfil?.idade_anos)                               return ESTADOS.QUALIFICACAO_INICIAL;

  return ESTADOS.INICIO;
}

// ── Verificar limites ─────────────────────────────────────────────────────
// [COMPORTAMENTO MARI] Limite aumentado: 8 total, 3 por dia — 16/04/2026 22:28
async function verificarLimites(conversaId) {
  await db.run(
    `UPDATE conversas SET reengajamentos_hoje=0, reeng_dia_ref=CURRENT_DATE
     WHERE id=$1 AND (reeng_dia_ref IS NULL OR reeng_dia_ref < CURRENT_DATE)`,
    [conversaId]
  ).catch(() => {});

  const conv = await db.one(
    'SELECT total_reengajamentos, reengajamentos_hoje FROM conversas WHERE id=$1',
    [conversaId]
  ).catch(() => ({ total_reengajamentos: 0, reengajamentos_hoje: 0 }));

  if (conv.total_reengajamentos >= 8) return { pode: false, motivo: 'maximo_total' };
  if (conv.reengajamentos_hoje   >= 3) return { pode: false, motivo: 'maximo_dia'   };
  return { pode: true };
}

// ── Próximo horário comercial ─────────────────────────────────────────────
function proximoHorarioComercial(dataAlvo) {
  const brt  = new Date(dataAlvo.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const hora = brt.getHours();
  if (hora >= 8 && hora < 22) return dataAlvo;

  const proxima = new Date(dataAlvo);
  if (hora >= 22) proxima.setDate(proxima.getDate() + 1);
  proxima.setHours(8, 10 + Math.floor(Math.random() * 30), 0, 0);
  return proxima;
}

// ── Gerar mensagem via Haiku com ângulo e sequência ───────────────────────
// [COMPORTAMENTO MARI] Recebe sequencia e angulo para progressão de tom — 16/04/2026 22:28
async function gerarMensagemVazio(estado, conversaId, sequencia, angulo) {
  const intencao      = INTENCOES[estado] || INTENCOES.inicio;
  const anguloObj     = angulo || ANGULOS[Math.min(sequencia || 0, ANGULOS.length - 1)];
  const instrucaoTom  = anguloObj.instrucao;

  const conv    = await db.one('SELECT * FROM conversas WHERE id=$1', [conversaId]).catch(() => null);
  const cliente = conv ? await db.one('SELECT * FROM clientes WHERE id=$1', [conv.client_id]).catch(() => null) : null;
  const perfil  = conv
    ? await (db.buscarOuCriarPerfil?.(conv.client_id) ?? Promise.resolve(null)).catch(() => null)
    : null;

  const nome    = cliente?.nome?.split(' ')[0] || '';
  const nomePet = perfil?.nome  || '';
  const plano   = conv?.plano_recomendado || '';
  const objecao = conv?.objecao_principal || '';
  const resumo  = conv?.resumo_conversa?.slice(0, 150) || '';
  const hora    = parseInt(new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }));

  const prompt = `Você é a Mari, consultora Plamev. Escreva UMA mensagem de retomada.

Contexto:
${nome    ? '- Tutor: '          + nome    : ''}${nomePet ? ' | Pet: ' + nomePet : ''}
${plano   ? '- Plano discutido: ' + plano   : ''}
${objecao ? '- Objeção anterior: '+ objecao : ''}
${resumo  ? '- Resumo: '          + resumo  : ''}
- Tentativa número: ${(sequencia || 0) + 1} de 8

Intenção desta mensagem: ${intencao}

Tom obrigatório para esta tentativa: ${instrucaoTom}

Regras:
- Máximo 2 frases
- 1 CTA claro no final
- Tom casual, WhatsApp, sem travessão
- NÃO soar automático ou script
- NÃO mencionar que tentou contato antes
- Variar abertura e estrutura
- Horário: ${hora < 12 ? 'manhã' : hora < 18 ? 'tarde' : 'noite'}`;

  const modelo = await (db.getConfig?.('modelo_reengajamento', 'claude-haiku-4-5') ?? Promise.resolve('claude-haiku-4-5')).catch(() => 'claude-haiku-4-5') || 'claude-haiku-4-5';

  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: modelo, max_tokens: 120,
      system: 'Você é a Mari. Gere apenas a mensagem, sem aspas nem explicações.',
      messages: [{ role: 'user', content: prompt }]
    });
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'x-api-key': KEY, 'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let d = ''; res.on('data', chunk => d += chunk);
      res.on('end', () => { try { resolve(JSON.parse(d).content?.[0]?.text || null); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.write(body); req.end();
  });
}

// ── Agendar próximo vácuo ─────────────────────────────────────────────────
async function agendarVacuo(conversaId, sequenciaAtual = 0) {
  const estado = await identificarEstado(conversaId);
  const tempos = TEMPOS[estado] || TEMPOS.inicio;

  // Sem cobertura: envio único — nunca avança
  if (estado === ESTADOS.SEM_COBERTURA && sequenciaAtual > 0) {
    console.log(`[REENG] 🏁 ${conversaId.slice(0,8)} [sem_cobertura] encerrado — único envio`);
    return;
  }

  if (sequenciaAtual >= tempos.length) {
    console.log(`[REENG] 🏁 ${conversaId.slice(0,8)} [${estado}] encerrado após ${sequenciaAtual} tentativas`);
    return;
  }

  // [COMPORTAMENTO MARI] Verificar limites ANTES de gerar mensagem — 16/04/2026 22:28
  const lim = await verificarLimites(conversaId);
  if (!lim.pode) {
    console.log(`[REENG] ⛔ ${conversaId.slice(0,8)} — ${lim.motivo}, não agendar`);
    return;
  }

  // Cancelar pendentes anteriores
  await db.run(
    `UPDATE followup_agendado SET status='cancelado' WHERE conversa_id=$1 AND status='pendente' AND tipo='vacuo'`,
    [conversaId]
  ).catch(() => {});

  const minutos    = tempos[sequenciaAtual];
  const alvo       = new Date(Date.now() + minutos * 60 * 1000);
  const executarEm = proximoHorarioComercial(alvo);

  // [COMPORTAMENTO MARI] Ângulo por sequência para progressão de tom — 16/04/2026 22:28
  const anguloObj = ANGULOS[Math.min(sequenciaAtual, ANGULOS.length - 1)];

  // Gerar mensagem APÓS verificar limites (Problema 6)
  const mensagem = await gerarMensagemVazio(estado, conversaId, sequenciaAtual, anguloObj);
  if (!mensagem) {
    console.log(`[REENG] ⚠️ Falha ao gerar mensagem para ${conversaId.slice(0,8)}`);
    return;
  }

  // [COMPORTAMENTO MARI] Salvar angulo no BD para análise de conversão — 16/04/2026 22:28
  await db.run(
    `INSERT INTO followup_agendado (conversa_id, tipo, mensagem, motivo, executar_em, sequencia, angulo)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [conversaId, 'vacuo', mensagem, estado, executarEm.toISOString(), sequenciaAtual, anguloObj.chave]
  );

  const label = minutos >= 1440 ? `${Math.floor(minutos/1440)}d` : minutos >= 60 ? `${Math.floor(minutos/60)}h` : `${minutos}min`;
  console.log(`[REENG] 📅 ${conversaId.slice(0,8)} [${estado}] seq${sequenciaAtual+1}/8 ângulo:${anguloObj.chave} em ${label}`);
}

// ── Agendar retorno combinado ─────────────────────────────────────────────
async function agendarCombinado(conversaId, dataHora, contexto = '') {
  await db.run(
    `UPDATE followup_agendado SET status='cancelado' WHERE conversa_id=$1 AND status='pendente'`,
    [conversaId]
  ).catch(() => {});

  const estado    = await identificarEstado(conversaId);
  const anguloObj = ANGULOS[0]; // combinado sempre começa pelo ângulo curioso

  const mensagem = await gerarMensagemVazio(estado, conversaId, 0, anguloObj).catch(() => null);
  if (!mensagem) {
    console.log(`[REENG] ⚠️ Falha ao gerar mensagem combinado ${conversaId.slice(0,8)}`);
    return;
  }

  await db.run(
    `INSERT INTO followup_agendado (conversa_id, tipo, mensagem, motivo, executar_em, sequencia, motivo_cliente, angulo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [conversaId, 'combinado', mensagem, 'combinado', dataHora, 0, contexto || 'vai pensar', anguloObj.chave]
  );
}

// ── Cliente respondeu ─────────────────────────────────────────────────────
async function clienteRespondeu(conversaId) {
  const r = await db.run(
    `UPDATE followup_agendado SET status='cancelado'
     WHERE conversa_id=$1 AND status='pendente' AND tipo != 'manual'
     RETURNING tipo`,
    [conversaId]
  ).catch(() => ({ rowCount: 0 }));
  if (r.rowCount > 0) console.log(`[REENG] ✅ ${conversaId.slice(0,8)} — ${r.rowCount} cancelado(s)`);
}

// ── Executar pendentes (1x/min) ───────────────────────────────────────────
let enviandoAgora = 0;

async function executarPendentes() {
  const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const hora  = agora.getHours();
  if (hora < 8 || hora >= 22) return;

  const pendentes = await db.query(`
    SELECT fa.*, c.numero_externo, c.jid, c.instancia_whatsapp,
           c.ultima_interacao, c.ia_silenciada, c.canal, c.client_id,
           c.total_reengajamentos, c.reengajamentos_hoje, c.reeng_dia_ref
    FROM followup_agendado fa
    JOIN conversas c ON c.id = fa.conversa_id
    WHERE fa.status = 'pendente'
      AND fa.executar_em <= NOW()
      AND c.ia_silenciada = false
      AND c.status = 'ativa'
    ORDER BY fa.executar_em ASC
    LIMIT 3
  `).catch(() => []);

  for (const row of pendentes) {
    // Cliente respondeu nos últimos 15 min — cancelar
    if ((Date.now() - new Date(row.ultima_interacao).getTime()) / 60000 < 15) {
      await db.run('UPDATE followup_agendado SET status=$1 WHERE id=$2', ['cancelado', row.id]);
      continue;
    }

    // [COMPORTAMENTO MARI] Limite aumentado: 8 total, 3 por dia — 16/04/2026 22:28
    const totalReeng = row.total_reengajamentos || 0;
    const hoje = row.reeng_dia_ref?.toISOString().slice(0,10) === new Date().toISOString().slice(0,10)
      ? (row.reengajamentos_hoje || 0) : 0;

    if (totalReeng >= 8 || hoje >= 3) {
      await db.run('UPDATE followup_agendado SET status=$1 WHERE id=$2', ['cancelado', row.id]);
      console.log(`[REENG] ⛔ ${row.numero_externo} — limite atingido (${totalReeng}/8 total, ${hoje}/3 hoje)`);
      continue;
    }

    if (enviandoAgora >= 2) break;
    enviandoAgora++;

    await db.run('UPDATE followup_agendado SET tentativas=tentativas+1 WHERE id=$1', [row.id]);

    const sender  = require('./sender');
    const http_v4 = require('http');

    sender.enviarDireto(
      row.instancia_whatsapp,
      row.jid || (row.numero_externo + '@s.whatsapp.net'),
      row.mensagem,
      row.numero_externo
    )
    .then(async ok => {
      await db.run(
        'UPDATE followup_agendado SET status=$1, executado_em=NOW() WHERE id=$2',
        [ok ? 'enviado' : 'ignorado', row.id]
      );
      console.log(`[REENG] ${ok ? '✅' : '❌'} ${row.numero_externo} [${row.motivo}] ângulo:${row.angulo || '-'} — "${row.mensagem?.slice(0, 50)}"`);

      if (ok) {
        // Atualizar contadores
        await db.run(
          `UPDATE conversas SET
             total_reengajamentos = COALESCE(total_reengajamentos,0) + 1,
             reengajamentos_hoje  = CASE WHEN reeng_dia_ref = CURRENT_DATE THEN COALESCE(reengajamentos_hoje,0)+1 ELSE 1 END,
             reeng_dia_ref        = CURRENT_DATE
           WHERE id=$1`,
          [row.conversa_id]
        ).catch(() => {});

        await db.salvarMensagem(row.conversa_id, 'agent', row.mensagem, 'ia_reengajamento').catch(() => {});

        // Notificar dashboard
        const body = JSON.stringify({
          conversa_id: row.conversa_id, phone: row.numero_externo,
          nome: '', msg_cliente: null, msg_mari: row.mensagem
        });
        const req = http_v4.request({
          hostname: 'localhost', port: 3450, path: '/interno/nova-msg', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        });
        req.on('error', () => {}); req.write(body); req.end();

        // Próxima da sequência (sem_cobertura não avança)
        if (row.tipo === 'vacuo') await agendarVacuo(row.conversa_id, row.sequencia + 1);
      }
    })
    .catch(async e => {
      console.error('[REENG] Erro:', e.message);
      await db.run('UPDATE followup_agendado SET status=$1 WHERE id=$2', ['ignorado', row.id]);
    })
    .finally(() => { enviandoAgora--; });

    // 30s entre envios — nunca rajada
    await new Promise(r => setTimeout(r, 30000));
  }
}

setInterval(() => { enviandoAgora = 0; }, 60000);

module.exports = { agendarVacuo, agendarCombinado, clienteRespondeu, executarPendentes, identificarEstado };
