/**
 * actions/index.js — Executa ações após resposta do Brain
 */
const db  = require('../db');
const cep = require('../services/cep');

async function executar(resultado, { conversa, cliente, perfil, msg }) {
  const { etapa, dados_extraidos, escalonar } = resultado;

  // ── 1. Atualizar etapa ───────────────────────────────────
  if (etapa && etapa !== conversa.etapa) {
    await db.atualizarConversa(conversa.id, { etapa });
    await db.run(
      'INSERT INTO funil_conversao (conversa_id, etapa_origem, etapa_destino) VALUES ($1,$2,$3)',
      [conversa.id, conversa.etapa, etapa]
    ).catch(() => {});
    conversa.etapa = etapa;
  }

  // ── 2. Salvar resposta da Mari (com arquivos Obsidian) ──────
  const obsArqs = resultado._obsidianArquivos || null;
  await db.salvarMensagem(conversa.id, 'agent', resultado.resposta, 'ia', null, obsArqs).catch(() => {});

  // ── 3. Salvar dados extraídos ────────────────────────────
  if (dados_extraidos && typeof dados_extraidos === 'object') {
    const dadosPet     = {};
    const dadosCliente = {};

    const mapaPet = {
      nome_pet:      'nome',
      especie_pet:   'especie',
      raca_pet:      'raca',
      idade_pet:     'idade_anos',
      sexo_pet:      'sexo',
      problema_saude:'problema_saude',
    };

    for (const [chave, valor] of Object.entries(dados_extraidos)) {
      if (!valor || valor === 'null') continue;
      if (chave === 'nome_cliente') dadosCliente.nome = valor;
      else if (mapaPet[chave])      dadosPet[mapaPet[chave]] = valor;
    }

    // Sanitizar idade — Claude pode retornar "3 anos", "3 anos e 5 meses", etc.
    if (dadosPet.idade_anos !== undefined) {
      const rawIdade = String(dadosPet.idade_anos);
      // Extrair só o primeiro número
      const match = rawIdade.match(/\d+(\.\d+)?/);
      dadosPet.idade_anos = match ? parseFloat(match[0]) : null;
      if (dadosPet.idade_anos === null) delete dadosPet.idade_anos;
    }

    if (Object.keys(dadosPet).length) {
      console.log('[ACTIONS] Salvando perfil pet:', JSON.stringify(dadosPet));
      await db.atualizarPerfil(cliente.id, dadosPet, conversa.id).catch(e => console.error('[ACTIONS] Erro perfil:', e.message));
    }
    if (dadosCliente.nome) {
      await db.run('UPDATE clientes SET nome=$1 WHERE id=$2', [dadosCliente.nome, cliente.id]).catch(() => {});
    }

    // ── 4. CEP: buscar clínicas quando extraído (só se ainda não foi respondido proativamente) ──
    const cepExtraido = conversa._cepJaRespondido ? null : dados_extraidos.cep;
    if (cepExtraido && String(cepExtraido).replace(/\D/g,'').length >= 8) {
      try {
        // Enviar aviso de espera ANTES da consulta (cria sensação humana de checagem)
        const sender = require('../services/sender');
        await sender.enviar(msg, 'Deixa eu checar a cobertura na sua região! Um segundo 🔍').catch(() => {});

        // Novo shape do cep.js: { status: 'ok'|'sem_cobertura'|'erro_servico'|'cep_invalido', texto? }
        const resultado_cep = await cep.buscarClinicas(cepExtraido, 40);

        if (resultado_cep?.status === 'ok' && resultado_cep.texto) {
          // Injetar texto oficial da skill diretamente na resposta
          if (!resultado.resposta.includes('clínica')) {
            resultado.resposta = resultado.resposta.trimEnd() + '\n\n' + resultado_cep.texto;
          }

          // Marca etapa como validação de CEP
          await db.run(
            'UPDATE conversas SET etapa=$1 WHERE id=$2',
            ['validacao_cep', conversa.id]
          ).catch(() => {});

          console.log(`[ACTIONS] CEP ${cepExtraido}: cobertura OK`);

        } else if (resultado_cep?.status === 'sem_cobertura') {
          // Sem cobertura — salvar na lista de espera e avisar o cliente
          await db.run(
            `INSERT INTO lista_espera (phone, nome, cep, canal, instancia)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT DO NOTHING`,
            [cliente.phone || msg.phone, cliente.nome || null, cepExtraido, msg.canal || 'whatsapp', msg.instancia || null]
          ).catch(() => {});

          resultado.resposta = resultado.resposta.trimEnd() +
            '\n\nAinda não chegamos na sua cidade, mas estamos expandindo rápido! 😊\n\nPosso te colocar na lista de espera pra ser uma das primeiras a saber quando chegarmos aí? É só me confirmar seu nome 💛🐾';

          console.log(`[ACTIONS] CEP ${cepExtraido}: SEM cobertura — cadastrado na lista de espera`);
        } else {
          console.warn(`[ACTIONS] CEP ${cepExtraido}: status=${resultado_cep?.status || 'desconhecido'} — sem ação`);
        }
      } catch(e) { console.error('[ACTIONS] CEP erro:', e.message); }
    }
  }


  // ── 4c. CPF: consultar e verificar nome quando extraído ──────────────
  if (dados_extraidos?.cpf) {
    const cpfLimpo = String(dados_extraidos.cpf).replace(/\D/g,'');
    if (cpfLimpo.length === 11) {
      try {
        const cpfSvc = require('../services/cpf');
        const dadosCpf = await cpfSvc.consultarCPF(cpfLimpo);

        if (dadosCpf && dadosCpf.nome) {
          // Salvar CPF e nome confirmado no BD
          await db.run('UPDATE clientes SET cpf=$1 WHERE id=$2', [cpfLimpo, cliente.id]).catch(() => {});

          const nomeCliente = cliente.nome || '';
          const nomeCpf     = dadosCpf.nome;
          const nascimento  = dadosCpf.nascimento || '';

          // Verificar divergência de nome
          const nomesSimilares = nomeCliente && nomeCpf.toLowerCase().includes(nomeCliente.toLowerCase().split(' ')[0]);

          if (!nomeCliente || nomesSimilares) {
            // Nome bate ou não tinha nome — confirmar e salvar
            await db.run('UPDATE clientes SET nome=$1 WHERE id=$2', [nomeCpf, cliente.id]).catch(() => {});
            // Injetar confirmação na resposta
            resultado.resposta = resultado.resposta.trimEnd() +
              `\n\nConfirmei aqui: *${nomeCpf}*${nascimento ? ', nascido(a) em ' + nascimento : ''}. Tá certinho? 😊`;
          } else {
            // Nome diverge — perguntar de quem é o CPF
            resultado.resposta = resultado.resposta.trimEnd() +
              `\n\nHm, o CPF que você me passou está no nome de *${nomeCpf}*. É seu CPF ou é de outra pessoa? 😊`;
          }

          console.log(`[ACTIONS] CPF consultado: ${nomeCpf} (${cpfLimpo})`);
        } else {
          console.log(`[ACTIONS] CPF não encontrado: ${cpfLimpo}`);
        }
      } catch(e) { console.error('[ACTIONS] CPF erro:', e.message); }
    }
  }


  // ── 4b. Apresentação de planos — envia cada plano em mensagem separada ──
  // [COMPORTAMENTO MARI] Apresentar planos separados: intro + 10s + slim + advance + platinum + diamond(highticket) — 14/04/2026 18:31
  const etapaApresentacao = etapa === 'apresentacao_planos' ||
    (etapa !== conversa.etapa && etapa === 'apresentacao_planos');
  const primeiraApresentacao = etapaApresentacao && conversa.etapa !== 'apresentacao_planos';

  if (primeiraApresentacao) {
    try {
      const apPlanos = require('../services/apresentacao-planos');
      // Enviar em paralelo para não bloquear o fluxo principal
      apPlanos.apresentarPlanos(msg, conversa.score || 0, conversa.id).catch(e =>
        console.error('[ACTIONS] Apresentacao planos erro:', e.message)
      );
      // Suprimir a resposta do brain — os templates já são a resposta
      resultado._apresentacaoPlanosTriggerada = true;
      console.log('[ACTIONS] 📋 Apresentação de planos iniciada');
    } catch(e) { console.error('[ACTIONS] Apresentacao erro:', e.message); }
  } else if (etapa === 'apresentacao_planos' || conversa.etapa === 'apresentacao_planos') {
    // Já foi apresentado — injetar plano específico se pedido
    const planoInteresse = dados_extraidos?.plano_interesse || resultado._planoSugerido;
    if (planoInteresse) {
      try {
        const slug = planoInteresse.toLowerCase().replace(/\s+/g,'_');
        const apres = await db.buscarApresentacaoPlano(slug).catch(() => null);
        if (apres) {
          resultado.resposta = resultado.resposta.trimEnd() + '\n\n' + apres;
        }
      } catch(e) { console.error('[ACTIONS] Template erro:', e.message); }
    }
  }


  // ── 4d. Formulário de cadastro em bloco (etapa pre_fechamento/fechamento) ──
  // Quando a etapa mudar para pre_fechamento ou fechamento e o perfil estiver incompleto,
  // injetar o formulário em bloco na resposta para o cliente preencher de uma vez
  const etapaAtualFechamento = etapa === 'pre_fechamento' || etapa === 'fechamento' ||
                               conversa.etapa === 'pre_fechamento' || conversa.etapa === 'fechamento';

  if (etapaAtualFechamento) {
    const p = perfil || {};
    const faltaNome  = !cliente.nome || cliente.nome === 'Cliente';
    const faltaEmail = !p.email;
    const faltaCPF   = !cliente.cpf;
    const faltaCEP   = !p.cep;
    const faltaPet   = !p.nome_pet;

    // Só injeta se tiver mais de 2 dados faltando (não atrapalha se já quase completo)
    const totalFaltando = [faltaNome, faltaEmail, faltaCPF, faltaCEP, faltaPet].filter(Boolean).length;

    if (totalFaltando >= 3 && !resultado.resposta.includes('DADOS DO RESPONSÁVEL') && !resultado.resposta.includes('CPF:')) {
      const nomePet = p.nome_pet || 'seu pet';
      const formularioBloco = `\n\nPra finalizar, me passa esses dados que já faço o cadastro do ${nomePet} 😊\n\n*DADOS DO RESPONSÁVEL:*\n👤 Nome completo:\n📧 Email:\n🎂 Data de nascimento:\n📋 CPF:\n📍 CEP:\n🏠 Rua e número:\n\n*DADOS DO PET:*\n🐾 Nome:\n🎂 Data de nascimento:\n🐕 Cão ou gato:\n🦴 Raça:`;
      resultado.resposta = resultado.resposta.trimEnd() + formularioBloco;
      console.log('[ACTIONS] 📋 Formulário de cadastro injetado');
    }
  }

  // ── 5. Escalar ────────────────────────────────────────────
  if (escalonar) {
    await db.run(
      `INSERT INTO instrucoes_ativas (conversa_id, instrucao, ativa)
       VALUES ($1, $2, true)`,
      [conversa.id, 'ESCALONADO: cliente precisa de atenção humana']
    ).catch(() => {});
    console.log(`[ACTIONS] 🚨 Escalonado: ${msg.phone}`);
  }

  // ── 6. Cancelar reengajamentos pendentes (cliente respondeu) ──
  await db.run(
    `UPDATE agendamentos SET status='cancelado'
     WHERE conversa_id=$1 AND status='pendente'`,
    [conversa.id]
  ).catch(() => {});

  // ── 7. Agendar reengajamento se cliente não responder ────
  await agendarReengajamento(conversa.id, etapa);
}

async function agendarReengajamento(conversaId, etapa) {
  // Não agendar em fechamento ou encerrado
  if (['fechamento', 'encerrado'].includes(etapa)) return;

  const regras = await db.query(
    "SELECT chave, valor FROM regras_comerciais WHERE chave LIKE 'reengajamento_%'",
    []
  ).catch(() => []);

  const minutos = {};
  regras.forEach(r => { minutos[r.chave] = parseInt(r.valor); });

  const sequencia = [
    minutos.reengajamento_1_min  || 5,
    minutos.reengajamento_2_min  || 10,
    minutos.reengajamento_3_min  || 30,
    minutos.reengajamento_dia1   || 1440,
    minutos.reengajamento_semanal|| 10080,
  ];

  // Verificar quantos reengajamentos já foram feitos
  const feitos = await db.one(
    "SELECT COUNT(*) as n FROM agendamentos WHERE conversa_id=$1 AND tipo LIKE 'reengajamento%'",
    [conversaId]
  ).catch(() => ({ n: 0 }));

  const idx = parseInt(feitos?.n || 0);
  if (idx >= sequencia.length) return; // sequência esgotada

  const mins = sequencia[idx];
  const executar_em = new Date(Date.now() + mins * 60000).toISOString();

  await db.run(
    `INSERT INTO agendamentos (conversa_id, tipo, executar_em, status)
     VALUES ($1, $2, $3, 'pendente')`,
    [conversaId, `reengajamento_${idx+1}`, executar_em]
  ).catch(() => {});
}

module.exports = { executar };
