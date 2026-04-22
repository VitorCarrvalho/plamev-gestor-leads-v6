/**
 * orchestrator/processor.js — Processador de Mensagem
 * Responsabilidade ÚNICA: Orquestrar o fluxo completo de uma mensagem
 * 
 * Injeção de dependências:
 * ├─ decisor (motor de decisão)
 * ├─ contexto (montador de prompt)
 * ├─ brain (Claude)
 * ├─ actions (executor)
 * ├─ sender (envio)
 * ├─ db (banco de dados)
 * ├─ audioSvc (transcrição)
 * ├─ imagemSvc (análise imagem)
 * └─ notificador (dashboards)
 */

const reeng   = require('../services/reengajamento');
const docSvc  = require('../services/documento');
const decisorMod = require('./decisor');
const supervisorNotifier = require('../services/supervisor-notifier');

class ProcessadorMensagem {
  constructor(deps) {
    this.decisor = deps.decisor;
    this.contexto = deps.contexto;
    this.brain = deps.brain;
    this.actions = deps.actions;
    this.sender = deps.sender;
    this.db = deps.db;
    this.audioSvc = deps.audioSvc;
    this.imagemSvc = deps.imagemSvc; // deve exportar processarImagem e analisarImagem
    this.notificador = deps.notificador;
  }

  /**
   * Processa uma mensagem completa do início ao fim
   * Fluxo: identificar → transcrever/analisar → decidir → contexto → brain → ações → envio → notificação
   */
  async processar(msg) {
    let texto = msg.texto;

    try {
      // ── 0a. Transcrever áudio se necessário ───────────────
      if (!texto && msg.audio && msg.instancia) {
        console.log(`[PROCESSOR] 🎤 Áudio recebido de ${msg.phone} — transcrevendo...`);
        const transcricao = await this.audioSvc.transcreverAudio(msg.instancia, msg.id, msg.audioType);
        if (transcricao) {
          texto = transcricao;
          console.log(`[PROCESSOR] 🎤 Transcrição: "${texto.slice(0, 80)}"`);
        } else {
          const fallback = 'Oi! Não consegui ouvir seu áudio, pode me enviar em texto? 😊';
          if (msg.instancia) await this.sender.enviar(msg, fallback);
          return;
        }
      }

      // ── 0b. Processar imagem com contexto completo ──────────
      if (!texto && msg.imagem && msg.instancia) {
        console.log(`[PROCESSOR] 📸 Imagem de ${msg.phone} — processando com contexto...`);

        const clienteTmp = await this.db.buscarOuCriarCliente(msg.phone, 'phone', msg.nome);
        const perfilTmp  = await this.db.buscarOuCriarPerfil(clienteTmp.id);
        const agenteImg  = await this.db.buscarAgente('mari');
        const convTmp    = await this.db.buscarOuCriarConversa(clienteTmp.id, agenteImg.id, msg.canal, msg.phone, msg.jid, msg.instancia);
        const histTmp    = await this.db.buscarHistorico(convTmp.id).catch(() => []);

        // Contexto rico para análise
        const ctxImg = {
          phone:       msg.phone,
          clienteId:   clienteTmp.id,
          conversaId:  convTmp.id,
          nomeCliente: clienteTmp.nome,
          nomePet:     perfilTmp?.nome,
          especie:     perfilTmp?.especie,
          raca:        perfilTmp?.raca,
          etapa:       convTmp.etapa,
          historico:   histTmp,
          captionCliente: msg.imagem?.caption || '',
        };

        const resposta = await this.imagemSvc.processarImagem(msg.instancia, msg.id, ctxImg, this.db);

        if (resposta) {
          await this.sender.enviar(msg, resposta);
          await this.db.salvarMensagem(convTmp.id, 'user', '[📸 foto enviada]', 'humano', `${msg.canal}:${msg.id}`).catch(() => {});
          await this.db.salvarMensagem(convTmp.id, 'agent', resposta, 'ia').catch(() => {});
          console.log(`[PROCESSOR] 📸 Imagem processada para ${msg.phone}`);
        } else {
          await this.sender.enviar(msg, 'Que foto linda! 😊 Me conta mais sobre seu pet?');
        }
        return;
      }


      // ── 0c. Processar documento (PDF, Word, Excel, etc.) ────────
      if (!texto && msg.documento && msg.instancia) {
        const doc = msg.documento;
        console.log(`[PROCESSOR] 📄 Documento recebido de ${msg.phone}: ${doc.fileName}`);

        // Contexto do pet para personalizar resposta
        const clienteTmp = await this.db.buscarOuCriarCliente(msg.phone, 'phone', msg.nome);
        const perfilTmp  = await this.db.buscarOuCriarPerfil(clienteTmp.id);
        const histTmp    = await this.db.buscarHistorico(
          (await this.db.buscarOuCriarConversa(clienteTmp.id, (await this.db.buscarAgente('mari')).id, msg.canal, msg.phone, msg.jid, msg.instancia)).id
        ).catch(() => []);

        const ctxPet = perfilTmp?.nome
          ? `Pet: ${perfilTmp.nome}${perfilTmp.especie ? ' (' + perfilTmp.especie + ')' : ''}`
          : null;

        const resposta = await docSvc.processarDocumento(
          msg.instancia, msg.id, doc._type, doc.fileName, ctxPet, histTmp
        );

        if (resposta) {
          await this.sender.enviar(msg, resposta);
          // Salvar no BD
          const conversaTmp = await this.db.buscarOuCriarConversa(clienteTmp.id, (await this.db.buscarAgente('mari')).id, msg.canal, msg.phone, msg.jid, msg.instancia);
          await this.db.salvarMensagem(conversaTmp.id, 'user', `[📄 ${doc.fileName}]`, 'humano', `${msg.canal}:${msg.id}`).catch(() => {});
          await this.db.salvarMensagem(conversaTmp.id, 'agent', resposta, 'ia').catch(() => {});
          console.log(`[PROCESSOR] 📄 Documento processado para ${msg.phone}`);
        } else {
          const fallback = `Recebi seu arquivo ${doc.fileName}! 😊 Estou verificando o conteúdo.`;
          await this.sender.enviar(msg, fallback);
        }
        return;
      }

      // Se não tem texto, ignorar
      if (!texto) return;

      // Serviços declarados no topo do bloco
      const leadMemory = require('../services/lead-memory');
      const consistencia = require('../services/consistencia');

      // ── 1. Identificar agente ──────────────────────────────
      const agente = await this.db.buscarAgente(msg.agentSlug || 'mari');
      if (!agente) throw new Error(`Agente não encontrado: ${msg.agentSlug}`);

      // ── 2. Identificar/criar cliente ───────────────────────
      const cliente = await this.db.buscarOuCriarCliente(msg.phone, 'phone', msg.nome);

      // ── 3. Identificar/criar conversa ──────────────────────
      const conversa = await this.db.buscarOuCriarConversa(
        cliente.id, agente.id, msg.canal, msg.phone, msg.jid, msg.instancia
      );

      // Salvar sender_chip na conversa
      if (msg.senderChip && conversa.sender_chip !== msg.senderChip) {
        await this.db.run('UPDATE conversas SET sender_chip=$1 WHERE id=$2', [msg.senderChip, conversa.id]).catch(() => {});
      }

      // ── 4. Verificar se IA está silenciada ─────────────────
      if (conversa.ia_silenciada) {
        console.log(`[PROCESSOR] IA silenciada para ${msg.phone} — ignorando`);
        return;
      }

      // ── 5. Salvar mensagem do cliente ──────────────────────
      const conteudoSalvar = msg.audio && !msg.texto ? `🎤 ${texto}` : texto;
      await this.db.salvarMensagem(conversa.id, 'user', conteudoSalvar, 'humano', `${msg.canal}:${msg.id}`);

      // ── 5a. Detectar vínculos emocionais e objeções no texto ────────────────
      const textoLower = (texto || '').toLowerCase();

      // Vínculo emocional
      const vinculoDetectado =
        /meu filho|minha filha|é tudo pra mim|é da família|família|resgatei|resgatou|da rua|de rua/.test(textoLower) ? 'pet=familia' :
        /tem ansiedade|muito ansioso|muito medroso|trauma/.test(textoLower) ? 'comportamento=ansioso' :
        /único pet|única pet|só tenho ele|só tenho ela/.test(textoLower) ? 'unico_pet' : null;
      if (vinculoDetectado) {
        leadMemory.salvarVinculo(conversa.id, vinculoDetectado).catch(() => {});
      }

      // Objeção
      const objecaoDetectada =
        /vou pensar|deixa eu pensar/.test(textoLower) ? 'vai pensar' :
        /falar com (meu|minha|o|a) (marido|esposa|esposo|esposo|mãe|pai|filho|filha|sócio)/.test(textoLower) ? 'consultar familiar' :
        /tá caro|muito caro|não tenho esse dinheiro|não cabe no orçamento/.test(textoLower) ? 'preço alto' :
        /não preciso|já tenho|tenho outro plano/.test(textoLower) ? 'já tem plano' :
        /não quero|não tenho interesse|obrigado não/.test(textoLower) ? 'sem interesse' : null;
      if (objecaoDetectada) {
        await this.db.run('UPDATE conversas SET objecao_principal=$1 WHERE id=$2', [objecaoDetectada, conversa.id]).catch(() => {});
      }

      // ── 5a.1. Cliente pediu retorno por telefone → alerta p/ supervisor ─────
      // Gatilhos: "me liga", "pode ligar", "quero falar por telefone", "alguém me liga",
      //           "prefiro ligação", "consegue me ligar", "atendente humano", "falar com atendente"
      const pediuLigacao =
        /\b(me\s+liga|pode\s+(me\s+)?ligar|consegue\s+(me\s+)?ligar|prefiro\s+liga[çc][ãa]o|quero\s+(uma\s+)?liga[çc][ãa]o|falar\s+por\s+telefone|retornar\s+por\s+telefone)\b/i.test(textoLower) ||
        /\b(falar\s+com\s+(um\s+)?(atendente|humano|pessoa|supervisor|algu[eé]m))\b/i.test(textoLower) ||
        /\batendimento\s+humano\b/i.test(textoLower);
      if (pediuLigacao) {
        const perfilAlert = await this.db.buscarOuCriarPerfil(cliente.id).catch(() => null);
        supervisorNotifier.notificarPedidoTelefone({
          cliente, perfil: perfilAlert, conversa,
        }).catch(e => console.warn('[PROCESSOR] supervisor notify erro:', e.message));
      }

      // ── 5b. Confirmar nome do cliente (HARDCODE) ──────────────────────────────
      // Se é a 1ª mensagem E o pushName parece um nome real (não número/desconhecido):
      //   - Injetar no contexto a orientação para a Mari confirmar o nome
      // Se o cliente já confirmou ou negou em mensagem anterior: não perguntar de novo
      const ehPrimeiraMensagem = (await this.db.buscarHistorico(conversa.id, 3)).length === 1; // só precisa checar se existe msg anterior
      const nomePushName = msg.nome || '';
      const nomePareceReal = nomePushName.length > 2 && !/^\d+$/.test(nomePushName) && nomePushName !== 'Cliente';
      const jaConfirmouNome = cliente.nome && cliente.nome !== 'Cliente' && cliente.nome !== nomePushName;
      let confirmarNomeCtx = '';

      if (ehPrimeiraMensagem && nomePareceReal && !jaConfirmouNome) {
        confirmarNomeCtx = `\n\n# INSTRUÇÃO ESPECIAL (PRIMEIRA MENSAGEM)\nO WhatsApp informou que o nome do contato é "${nomePushName}". Isso pode ser o nome salvo no celular de outra pessoa, não necessariamente o nome real do cliente.\nSe ainda não perguntou o nome: confirme naturalmente, por exemplo: "Vi aqui que seu nome é ${nomePushName}, é isso mesmo? 😊" \nSe o cliente confirmar: ótimo, use esse nome.\nSe o cliente disser que não é esse nome: peça o nome correto com educação e atualize.\nSe já perguntou o nome antes nessa conversa: NÃO pergunte de novo.`;
      }


      // ── 5c. CEP detectado no texto — consultar IMEDIATAMENTE antes do Brain ──────
      // [COMPORTAMENTO MARI] Consultar CEP ao receber e responder antes dos outros pedidos — 14/04/2026 15:51
      //
      // ⚠️ Lock 20/04/2026 (caso Getulio): regex STRICT pra não confundir CEP com CPF.
      // Antes: /\d{8}/ capturava os 8 primeiros dígitos de um CPF (11 dígitos) e disparava skill.
      // Agora: word boundary E não colado em mais dígitos. Só standalone ou com hífen 5+3.
      let cepNoTexto = null;
      // Formato 5+3 com hífen ou sem: "22793-249" ou "22793 249"
      const matchHifen = texto.match(/\b(\d{5})[\s-](\d{3})\b/);
      if (matchHifen) {
        cepNoTexto = matchHifen[1] + matchHifen[2];
      } else {
        // Formato 8 dígitos puros, mas NÃO parte de um número maior (ex: CPF 11 dígitos)
        const matchPuro = texto.match(/(?<!\d)(\d{8})(?!\d)/);
        if (matchPuro) cepNoTexto = matchPuro[1];
      }
      if (cepNoTexto && cepNoTexto.length === 8) {
        try {
          const cepSvc  = require('../services/cep');
          const cepImg  = require('../services/cep-imagem');
          const sender  = require('../services/sender');

          // Helper: envia + persiste no DB (fix 20/04 pós-caso Nelina/Vanda —
          // mensagens do CEP estavam indo pro WhatsApp mas não pro DB,
          // fazendo dashboard parecer que a Mari ignorou o cliente).
          const saveDb = this.db;
          const enviarEPersistir = async (texto) => {
            await sender.enviar(msg, texto).catch(() => {});
            await saveDb.salvarMensagem(conversa.id, 'agent', texto, 'ia').catch(() => {});
          };

          // 1. Avisar que está verificando
          await enviarEPersistir('Deixa eu checar a cobertura na sua região! Um segundo 🔍');

          // 2. Consultar via skill oficial plamev-rede-credenciada — ÚNICA fonte permitida
          // [COMPORTAMENTO MARI] 3 retornos possíveis: ok / sem_cobertura / erro_servico — 16/04/2026 15:59
          const resCep = await cepSvc.buscarClinicas(cepNoTexto).catch(() => ({ status: 'erro_servico' }));
          leadMemory.registrarEvento(conversa.id, 'cep_consultado', { cep: cepNoTexto, status: resCep.status }).catch(() => {});

          // Salvar CEP bruto no perfil sempre
          await this.db.atualizarPerfil(cliente.id, { cep: cepNoTexto }, conversa.id).catch(() => {});
          await consistencia.marcarFeito(conversa.id, 'cep').catch(() => {});

          // ── CASO 1: Erro de serviço (5xx, timeout) ──────────────────────
          if (resCep.status === 'erro_servico') {
            await enviarEPersistir(
              'Nosso serviço de verificação está instável agora 😕\n\nVocê pode consultar as clínicas credenciadas diretamente em:\n*https://plamev.com.br/rede-credenciada*\n\nAssim que normalizar, verifico pra você aqui!'
            );
            conversa._cepJaRespondido = cepNoTexto;
            console.log(`[PROCESSOR] ⚠️ CEP ${cepNoTexto}: erro de serviço — link site enviado`);
          }

          // ── CASO 2: Sem cobertura na região ─────────────────────────────
          // 21/04/2026 — Getúlio: citar bairro+cidade+UF quando a API retornar,
          // pra confirmar que a Mari CONSULTOU e conhece o local do cliente.
          else if (resCep.status === 'sem_cobertura') {
            // Monta descrição do local o mais específica possível
            const bairro = resCep.bairro || null;
            const cidade = resCep.cidade || null;
            const uf     = resCep.uf     || resCep.estado || null;

            let descLocal;
            if (bairro && cidade && uf) {
              descLocal = `no bairro *${bairro}* em *${cidade}/${uf}*`;
            } else if (cidade && uf) {
              descLocal = `em *${cidade}/${uf}*`;
            } else if (cidade) {
              descLocal = `em *${cidade}*`;
            } else {
              descLocal = `na sua região`;
            }

            await enviarEPersistir(
              `Confirmei aqui ${descLocal} — infelizmente *por enquanto ainda não temos rede credenciada nesse local* 😕\n\nMas estamos expandindo rápido! Te cadastrei na lista de espera e assim que chegarmos aí, você é uma das primeiras a saber 💛`
            );

            // Cadastrar na lista de espera e marcar sem cobertura
            await this.db.run(
              `INSERT INTO lista_espera (phone, nome, cep, canal, instancia) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
              [msg.phone, cliente.nome || null, cepNoTexto, msg.canal || 'whatsapp', msg.instancia || null]
            ).catch(() => {});
            await this.db.atualizarConversa(conversa.id, { classificacao_rede: 'sem_cobertura', etapa: 'sem_cobertura' }).catch(() => {});
            if (cidade) {
              await this.db.atualizarPerfil(cliente.id, { cidade, estado: uf || null }, conversa.id).catch(() => {});
            }
            conversa._cepJaRespondido = cepNoTexto;
            console.log(`[PROCESSOR] 📍 CEP ${cepNoTexto}: sem cobertura ${descLocal.replace(/\*/g, '')} — lista de espera`);
          }

          // ── CASO 3: Tem clínicas — saudação positiva + lista + pedido de venda ──
          else if (resCep.status === 'ok') {
            await this.db.atualizarPerfil(cliente.id, { cep: cepNoTexto }, conversa.id).catch(() => {});
            leadMemory.registrarEvento(conversa.id, 'cep_ok', { cep: cepNoTexto }).catch(() => {});

            // 1. Mensagem de celebração ANTES da lista de clínicas (abertura calorosa)
            await enviarEPersistir(`Que legal! 🎉 Temos cobertura sim na sua região!\n\nVou te mandar as 3 clínicas credenciadas mais próximas de você 👇`);

            // 2. Lista oficial da skill
            await enviarEPersistir(resCep.texto);

            // 3. Pedido de venda logo em seguida — CTA direto pro link de pagamento
            // [COMPORTAMENTO MARI] perfil declarado antes da step 6 — fix bug caso Getulio 21/04/2026
            const perfilCep = await this.db.buscarOuCriarPerfil(cliente.id).catch(() => null);
            const nomePet = perfilCep?.nome && perfilCep.nome !== '?' ? perfilCep.nome : 'seu pet';
            await enviarEPersistir(`E aí, posso já te enviar o link pra garantir a proteção do ${nomePet}? 💛`);

            if (conversa.etapa === 'acolhimento' || conversa.etapa === 'qualificacao') {
              await this.db.atualizarConversa(conversa.id, { etapa: 'validacao_cep' }).catch(() => {});
              conversa.etapa = 'validacao_cep';
              conversa._cepConfirmado = true;
            }
            conversa._cepJaRespondido = cepNoTexto;
            console.log(`[PROCESSOR] 📍 CEP ${cepNoTexto}: celebração + clínicas + CTA enviados`);
          }
        } catch(eCep) { console.error('[PROCESSOR] CEP proativo erro:', eCep.message); }

        // CEP já foi respondido pela API oficial — encerrar turno aqui.
        // Evita o Brain gerar texto paralelo (alucinação de cidade/cobertura)
        // contradizendo o que a skill já enviou. O cliente recebe APENAS a
        // resposta oficial da rede credenciada.
        if (conversa._cepJaRespondido) {
          await this.db.run(
            `UPDATE agendamentos SET status='cancelado' WHERE conversa_id=$1 AND status='pendente'`,
            [conversa.id]
          ).catch(() => {});
          return;
        }
      }

      // ── 5d. Envio de manual em PDF ───────────────────────────────────────────
      // [COMPORTAMENTO MARI] Enviar PDF quando cliente pedir manual/cobertura — ORIGINAL 16/04/2026 + expansão 20/04/2026 (caso Getulio)
      //
      // Dois gatilhos:
      //  (a) Mari já ofereceu → cliente responde "sim/quero/manda"
      //  (b) Cliente pede DIRETO ("me manda o manual", "vc pode mandar o pdf")
      //      → envia na hora, sem depender do pdf_oferecido
      const pediuManualAceite = conversa.pdf_oferecido &&
        /\b(sim|quero|manda|mande|pode|claro|por favor|vai|bora|ótimo|boa|show)\b/i.test(texto);
      const pediuManualDireto =
        /(?:manda|envia|pass[ae]|quero|pode\s+(?:me\s+)?mandar)\s+(?:o\s+|a\s+|um\s+|uma\s+)?(manual|pdf|cobertura\s+completa|detalh(?:es|amento)\s+da\s+cobertura)/i.test(texto) ||
        /\b(me\s+envia|me\s+manda|me\s+passa)\s+(?:o\s+)?(manual|pdf)/i.test(texto);

      if (pediuManualAceite || pediuManualDireto) {
        const planoSlug = conversa.plano_recomendado || 'advance';
        const pdfRow = await this.db.one('SELECT * FROM planos_pdfs WHERE plano_slug=$1', [planoSlug]).catch(() => null);
        if (pdfRow) {
          const sender = require('../services/sender');
          const saveDb2 = this.db;
          const enviarEPersistir2 = async (texto) => {
            await sender.enviar(msg, texto).catch(() => {});
            await saveDb2.salvarMensagem(conversa.id, 'agent', texto, 'ia').catch(() => {});
          };

          // 1. Fala primeiro (calorosa, sem alucinar email)
          await enviarEPersistir2(
            `Claro! 😊 Te mando aqui agora o manual completo do *${planoSlug.replace('_plus',' Plus').replace('_',' ')}* — tudo sobre coberturas, carências e rede credenciada.`
          );

          // 2. Envia o PDF
          await sender.enviarDocumento(msg, pdfRow.caminho, pdfRow.nome_arquivo).catch(e =>
            console.error('[PROCESSOR] PDF erro:', e.message)
          );
          await this.db.salvarMensagem(conversa.id, 'agent', `[📋 PDF ${planoSlug} enviado]`, 'ia').catch(() => {});

          // 3. Fechamento — abre porta pra tirar dúvidas + push pra venda
          const nomePetPdf = (await this.db.buscarOuCriarPerfil(cliente.id))?.nome;
          const petRef = nomePetPdf && nomePetPdf !== '?' ? nomePetPdf : 'seu pet';
          await enviarEPersistir2(
            `Qualquer dúvida que bater aí, pode me chamar que eu esclareço na hora 💛\n\nJá posso gerar o link pra garantir a proteção do ${petRef}?`
          );

          await this.db.run('UPDATE conversas SET pdf_oferecido=false WHERE id=$1', [conversa.id]).catch(() => {});
          console.log(`[PROCESSOR] 📋 PDF ${planoSlug} enviado para ${msg.phone} (${pediuManualDireto ? 'direto' : 'aceite'})`);
          return;
        } else {
          console.warn(`[PROCESSOR] ⚠️ PDF não cadastrado pra plano ${planoSlug}`);
        }
      }

      // ── 5e. Recuperar contexto compacto da memória operacional ──────────────
      const contextoMemoria = await leadMemory.recuperarContexto(conversa.id).catch(() => '');

      // ── 6. Buscar histórico completo (sem limite)
      // A Mari lê toda a conversa — contexto completo = respostas mais inteligentes
      const historico = await this.db.buscarHistorico(conversa.id, 20); // últimas 20 msgs — brain já aplica janela de 10
      const perfil = await this.db.buscarOuCriarPerfil(cliente.id);

      // ── 7. Motor de decisão (Haiku leve) ───────────────────
      const historico_resumo = historico
        .slice(-4)
        .map(h => `${h.role === 'user' ? (cliente.nome || 'Cliente') : 'Mari'}: ${h.conteudo.substring(0, 60)}`)
        .join(' | ');

      const decisao = await this.decisor.decidir({
        mensagem: texto,
        etapa: conversa.etapa,
        score: conversa.score,
        perfil,
        historico_resumo
      });

      console.log(`[PROCESSOR] ${msg.phone} | modo:${decisao.modo} | ação:${decisao.proxima_acao} | urgência:${decisao.nivel_urgencia}`);

      // ── 7b. PERSISTIR DECISÃO DO ORQUESTRADOR ─────────────────────────────
      // Corrige bug identificado em 17/04/2026: tabela decisoes_orquestrador
      // nunca recebia INSERTs. Agora toda decisão é gravada para rastreamento
      // e auditoria de por que a Mari escolheu cada caminho.
      const _decisaoRow = await this.db.one(
        `INSERT INTO decisoes_orquestrador
         (conversa_id, input_json, output_json, modelo)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [
          conversa.id,
          JSON.stringify({
            mensagem: String(texto).slice(0, 200),
            etapa_atual: conversa.etapa,
            score: conversa.score,
            perfil: perfil ? { nome: perfil.nome, especie: perfil.especie, raca: perfil.raca, idade_anos: perfil.idade_anos } : null,
            historico_resumo: historico_resumo.slice(0, 400),
          }),
          JSON.stringify(decisao),
          'claude-haiku-4-5',
        ]
      ).catch(e => { console.warn('[PROCESSOR] decisoes_orquestrador erro:', e.message); return null; });
      const idDecisao = _decisaoRow?.id || null;

      // ── 7c. Avançar etapa via decisor quando Brain não move ──────────────
      // Se o decisor indica ação de avanço (apresentar_plano, negociar, fechar) e
      // a etapa atual está atrás, avança antes de chamar o Brain. Garante que
      // conversas travadas em "acolhimento" evoluam conforme o decisor detecta.
      const ETAPAS_ORDEM = ['acolhimento','qualificacao','apresentacao_planos','validacao_cep','negociacao','objecao','pre_fechamento','fechamento','venda_fechada','pago'];
      const ACAO_PARA_ETAPA = {
        apresentar_plano: 'apresentacao_planos',
        negociar:         'negociacao',
        escalar:          'negociacao',
        fechar:           'fechamento',
      };
      const etapaSugerida = ACAO_PARA_ETAPA[decisao.proxima_acao];
      if (etapaSugerida) {
        const idxAtual    = ETAPAS_ORDEM.indexOf(conversa.etapa || 'acolhimento');
        const idxSugerida = ETAPAS_ORDEM.indexOf(etapaSugerida);
        if (idxSugerida > idxAtual) {
          await this.db.atualizarConversa(conversa.id, { etapa: etapaSugerida }).catch(() => {});
          await this.db.run(
            `INSERT INTO funil_conversao (conversa_id, etapa_origem, etapa_destino) VALUES ($1,$2,$3)`,
            [conversa.id, conversa.etapa, etapaSugerida]
          ).catch(() => {});
          console.log(`[PROCESSOR] 🎯 Etapa avançada via decisor: ${conversa.etapa} → ${etapaSugerida}`);
          conversa.etapa = etapaSugerida;
          if (['pre_fechamento','fechamento'].includes(etapaSugerida)) {
            supervisorNotifier.notificarEtapa(etapaSugerida, { cliente, perfil, conversa })
              .catch(e => console.warn('[PROCESSOR] supervisor notify erro:', e.message));
          }
        }
      }

      // [COMPORTAMENTO MARI] Cliente autoriza geração do link → pre_fechamento (lock 21/04/2026)
      // Sinal explícito de intenção: cliente fala "pode gerar/mandar o link", "bora fechar".
      // pre_fechamento = coletando dados finais (nome/cpf/email/cep). Só vai pra 'fechamento'
      // depois que Mari realmente enviar o link com dados completos.
      const autorizouLink = /\b(pode|manda|envia|vamos|bora|quero)\b.*\b(gerar|mandar|enviar|passar|receber)?\s*(o\s+)?link\b/i.test(texto) ||
                            /\bbora\s+(fechar|pagar)\b/i.test(texto) ||
                            /\bmanda\s+(o\s+)?pagamento\b/i.test(texto);
      if (autorizouLink) {
        const idxAtualLink = ETAPAS_ORDEM.indexOf(conversa.etapa || 'acolhimento');
        const idxPreFech   = ETAPAS_ORDEM.indexOf('pre_fechamento');
        if (idxAtualLink < idxPreFech) {
          await this.db.atualizarConversa(conversa.id, { etapa: 'pre_fechamento' }).catch(() => {});
          await this.db.run(
            `INSERT INTO funil_conversao (conversa_id, etapa_origem, etapa_destino) VALUES ($1,$2,$3)`,
            [conversa.id, conversa.etapa, 'pre_fechamento']
          ).catch(() => {});
          console.log(`[PROCESSOR] 🎯 Cliente autorizou link → pre_fechamento (era ${conversa.etapa})`);
          conversa.etapa = 'pre_fechamento';
          supervisorNotifier.notificarEtapa('pre_fechamento', { cliente, perfil, conversa })
            .catch(e => console.warn('[PROCESSOR] supervisor notify erro:', e.message));
        }
      }

      // [COMPORTAMENTO MARI] Templates hardcoded REMOVIDOS — Brain faz tudo — 16/04/2026 13:21
      // O Brain gera abertura, recomendação e CTA. Nunca enviar ficha técnica de plano.

      // ── 8. Montar contexto ─────────────────────────────────
      const ctxResult = await this.contexto.montar({
        conversa, cliente, perfil, historico, decisao, agente, mensagem: texto
      });
      // Adicionar instrução de confirmação de nome se aplicável
      // Injetar memória operacional antes do contexto (economiza tokens do histórico)
      const memoriaCtx = contextoMemoria ? `\n\n${contextoMemoria}` : '';
      const contextoPrompt = ctxResult.contexto + memoriaCtx + (confirmarNomeCtx || '');
      const obsidianArquivos = ctxResult.arquivos || [];
      console.log(`[PROCESSOR] Obsidian carregado: ${obsidianArquivos.length} arquivos`);

      // ── 9. Brain — chamar Claude (com retry se resposta vazia) ────────────────
      // [COMPORTAMENTO MARI] Retry automático quando Brain não retorna resposta válida — fix bug caso Getulio 21/04/2026
      let resultado = await this.brain.pensar(texto, historico, contextoPrompt, agente.modelo_negociacao);
      if (!resultado?.resposta || resultado.resposta.trim().length < 5) {
        console.warn('[PROCESSOR] ⚠️ Brain resposta vazia — tentativa 2/3');
        resultado = await this.brain.pensar(texto, historico, contextoPrompt, agente.modelo_negociacao);
      }
      if (!resultado?.resposta || resultado.resposta.trim().length < 5) {
        console.warn('[PROCESSOR] ⚠️ Brain resposta vazia — tentativa 3/3');
        resultado = await this.brain.pensar(texto, historico, contextoPrompt, agente.modelo_negociacao);
      }
      if (!resultado?.resposta || resultado.resposta.trim().length < 5) {
        console.error('[PROCESSOR] ❌ Brain falhou 3x — usando fallback seguro');
        resultado = resultado || {};
        resultado.resposta = 'Desculpa, tive uma instabilidade aqui! 😅 Pode repetir sua mensagem?';
      }

      // ── 9b. Extrair campo r se Brain retornou JSON bruto ─────────────────────
      // [COMPORTAMENTO MARI] Guard na origem — 18/04/2026 17:41
      if (resultado.resposta && typeof resultado.resposta === 'string' && resultado.resposta.trim().match(/^\{\s*"r"\s*:/)) {
        try {
          const parsed = JSON.parse(resultado.resposta.trim().match(/\{[\s\S]*\}/)?.[0] || '{}');
          const extraido = parsed.r || parsed.resposta;
          if (extraido) {
            console.warn('[PROCESSOR] ⚠️ JSON bruto no resultado.resposta — extraindo campo r');
            resultado.resposta = extraido;
            if (parsed.e && !resultado.etapa) resultado.etapa = parsed.e;
            if (parsed.d && !resultado.dados_extraidos?.nome_cliente) {
              resultado.dados_extraidos = resultado.dados_extraidos || {};
              const d = parsed.d;
              resultado.dados_extraidos.nome_cliente = d.nc || resultado.dados_extraidos.nome_cliente;
              resultado.dados_extraidos.nome_pet     = d.np || resultado.dados_extraidos.nome_pet;
              resultado.dados_extraidos.especie_pet  = d.ep || resultado.dados_extraidos.especie_pet;
              resultado.dados_extraidos.raca_pet     = d.rp || resultado.dados_extraidos.raca_pet;
              resultado.dados_extraidos.idade_pet    = d.ip || resultado.dados_extraidos.idade_pet;
              resultado.dados_extraidos.cep          = d.cp || resultado.dados_extraidos.cep;
              resultado.dados_extraidos.email        = d.em || resultado.dados_extraidos.email;
              resultado.dados_extraidos.cpf          = d.cf || resultado.dados_extraidos.cpf;
            }
          }
        } catch(eJson) { console.error('[PROCESSOR] ❌ Falha ao parsear JSON bruto:', eJson.message); }
      }

      // ── 10. Registrar custo ────────────────────────────────
      if (resultado._uso) {
        await this.db.registrarCusto(
          conversa.id, agente.id, agente.modelo_negociacao,
          resultado._uso.input_tokens, resultado._uso.output_tokens
        );
      }

      // ── 10b. GUARDA DE CEP (lock 21/04/2026 — caso Aline "2000 clínicas") ───
      // CEP é OBRIGATÓRIO antes de Mari falar de cobertura/clínicas ou oferecer link.
      // Se a resposta menciona números de clínicas/cobertura ou pede pra gerar link,
      // e o perfil NÃO tem CEP confirmado → sobrescrevemos a resposta pedindo CEP.
      // Nada de "próximas de você" sem confirmar local real via skill.
      if (resultado.resposta && typeof resultado.resposta === 'string') {
        const cepConfirmado = !!(perfil?.cep);
        const texto_resp = resultado.resposta;
        const mencionaClinicas  = /\bcobertura\b|\d{2,}\s*cl[ií]nicas|clínicas?\s+credenciadas?|rede\s+credenciada|temos\s+cl[ií]nicas?|credenciados?\s+na\s+(sua\s+)?regi[aã]o|plamev\s+em\s+sua/i.test(texto_resp);
        const mencionaLink      = /gerar\s+(o\s+)?link|te\s+(envio|mando)\s+(o\s+)?link|link\s+(de\s+)?pagamento|finaliza(r|ndo)\s+(o\s+)?(contrato|ades[aã]o)/i.test(texto_resp);
        const mencionaFechar    = /\b(pode\s+mandar|bora\s+fechar|quero\s+fechar)\b/i.test(texto_resp);

        // [COMPORTAMENTO MARI] Guarda CEP também bloqueia proposta/email sem CEP confirmado — fix bug caso Getulio 21/04/2026
        const mencionaProposta = /proposta.*email|sua proposta.*no email|proposta.*gerada|enviei.*proposta/i.test(texto_resp);
        if (!cepConfirmado && (mencionaClinicas || mencionaLink || mencionaFechar || mencionaProposta)) {
          const nomePet = perfil?.nome && perfil.nome !== '?' ? perfil.nome : 'seu pet';
          const motivo  = mencionaClinicas  ? 'cobertura/clínicas'
                       : mencionaLink       ? 'link de pagamento'
                       : mencionaProposta   ? 'proposta sem CEP'
                                           : 'fechamento';
          console.warn(`[PROCESSOR] 🛑 CEP obrigatório — resposta mencionava ${motivo} sem CEP. Reescrevendo.`);
          resultado.resposta =
            `Antes de seguir, preciso do seu CEP pra confirmar a rede credenciada e gerar a proposta do ${nomePet} 😊\n\nMe passa ele aqui?`;
          // Etapa permanece em qualificação/validacao_cep — não avançar
          if (!['acolhimento', 'qualificacao', 'validacao_cep'].includes(conversa.etapa)) {
            resultado.etapa = 'validacao_cep';
          }
        }
      }

      // ── 11. Executar ações ─────────────────────────────────
      await this.actions.executar(resultado, { conversa, cliente, perfil, msg });

      // ── 11b. Validar resposta — guard rails pós-Brain ────────────────────
      // [COMPORTAMENTO MARI] Guard rails: remove travessão, clínicas fictícias, perguntas repetidas — 15/04/2026 00:17
      try {
        const validador = require('../services/validador');
        const respostaOriginal = resultado.resposta;
        resultado.resposta = validador.validar(resultado.resposta, {
          perfil,
          conversa: { tutor_nome: cliente?.nome },
          historico,
          clinicasReais: conversa._cepJaRespondido ? [] : null, // null = não verificar
        });
        if (resultado.resposta !== respostaOriginal) {
          // Salvar versão corrigida no histórico
          console.log('[PROCESSOR] 🛡️ Guard rails aplicados');
        }
      } catch(eVal) { console.error('[PROCESSOR] Validador erro:', eVal.message); }

      // ── 12. Enviar resposta pelo chip correto ─────────────
      // [COMPORTAMENTO MARI] Consultar supervisor: avisa que volta, espera 1.5min, retorna — 14/04/2026 16:22
      const msgFinal = { ...msg, instancia: msg.instancia };
      console.log("[PROCESSOR] instancia:", msgFinal.instancia);

      const respostaNorm = (resultado.resposta || '').toLowerCase();
      const vaiConsultarSupervisor = /supervisor|supervisora|minha chefe|deixa eu ver|vou verificar com|vou falar com|vou checar com|um momento|já volto/.test(respostaNorm)
        && /desconto|carência|condição|reduç|especial/.test(respostaNorm);

      if (vaiConsultarSupervisor) {
        // 1. Enviar a mensagem da Mari dizendo que vai consultar
        await this.sender.enviar(msgFinal, resultado.resposta);
        await this.db.salvarMensagem(conversa.id, 'agent', resultado.resposta, 'ia').catch(() => {});

        // 2. Aguardar 1.5 minuto simulando consulta ao supervisor
        console.log(`[PROCESSOR] 👔 Consultando supervisor — aguardando 90s...`);
        await new Promise(r => setTimeout(r, 90000));

        // 3. Gerar resposta do supervisor via Brain
        const instrucaoSupervisor = `RETORNO DO SUPERVISOR: A supervisora Li aprovou uma condição especial.
Você voltou da consulta com a supervisora. Traga a resposta de forma animada e natural, como se realmente tivesse acabado de confirmar com ela.
Se era sobre desconto: confirme que conseguiu e qual valor.
Se era sobre carência: confirme a redução.
Seja entusiasmada — isso é uma vitória para o cliente.
Máximo 2 frases.`;

        const histAtual = await this.db.buscarHistorico(conversa.id, 10);
        const ctxSup = await this.contexto.montar({ conversa, cliente, perfil, historico: histAtual, decisao: resultado._decisao, agente, mensagem: '' });
        const retornoSup = await this.brain.pensar('', histAtual, ctxSup.contexto + '\n\n# INSTRUÇÃO ESPECIAL\n' + instrucaoSupervisor, agente.modelo_negociacao);

        await this.sender.enviar(msgFinal, retornoSup.resposta);
        await this.db.salvarMensagem(conversa.id, 'agent', retornoSup.resposta, 'ia_supervisor').catch(() => {});
        console.log(`[PROCESSOR] 👔 Supervisor respondeu: "${retornoSup.resposta?.slice(0,60)}"`);
        // Pular o envio padrão abaixo
        resultado._supervisorJaRespondeu = true;
      }

      // Atualizar flags de consistência após resposta
      await consistencia.atualizarFlags(conversa.id, resultado, resultado.resposta).catch(() => {});

      // ── 11d. Detectar promessa de envio de PDF feita pela Mari ─────────────
      // [BUG CASO GETULIO 21/04/2026] Mari disse "vou te enviar o manual" + colou
      // placeholder *[PDF sendo enviado]* como texto, mas o PDF não foi enviado
      // de fato porque os triggers 5d (pediuManualAceite/Direto) só reagem ao
      // texto do cliente. Aqui checamos a resposta DA MARI: se ela prometeu
      // enviar o manual, limpamos o placeholder e disparamos o envio real.
      let promessaManualEnviar = null;
      if (resultado.resposta && !resultado._supervisorJaRespondeu && !resultado._apresentacaoPlanosTriggerada) {
        const prometeuManual =
          /\b(vou\s+(te\s+)?(enviar|mandar)|te\s+(envio|mando|passo)|deixa\s+eu\s+(te\s+)?(enviar|mandar)|estou\s+(te\s+)?(enviando|mandando)|segue\s+(o\s+|abaixo\s+|aí\s+)?(o\s+)?manual|enviando\s+(o\s+|agora\s+)?(o\s+)?manual|mando\s+(o\s+|agora\s+)?(o\s+)?manual)\b.*\b(manual|pdf)\b/i.test(resultado.resposta) ||
          /\b(manual|pdf)\b.*\b(aqui\s+no\s+chat|pra\s+vc|pra\s+voc[eê]|agora)\b/i.test(resultado.resposta) ||
          /\[(?:📋|📄)?\s*PDF[^\]]*(?:sendo\s+enviado|envi(?:o|ado))/i.test(resultado.resposta);
        if (prometeuManual) {
          const planoSlugMan = conversa.plano_recomendado || 'advance';
          const pdfManRow = await this.db.one('SELECT * FROM planos_pdfs WHERE plano_slug=$1', [planoSlugMan]).catch(() => null);
          if (pdfManRow) {
            // Limpa placeholders hallucinados (*[PDF do ... sendo enviado]*, [📋 PDF ...]) da resposta
            resultado.resposta = resultado.resposta
              .replace(/\*?\[(?:📋|📄)?\s*PDF[^\]]*(?:sendo\s+enviado|envi(?:o|ado))[^\]]*\]\*?/gi, '')
              .replace(/\n{3,}/g, '\n\n')
              .trim();
            promessaManualEnviar = pdfManRow;
            console.log(`[PROCESSOR] 📋 Mari prometeu enviar manual — disparando envio real (${planoSlugMan})`);
          }
        }
      }

      if (!resultado._supervisorJaRespondeu && !resultado._apresentacaoPlanosTriggerada) {
        await this.sender.enviar(msgFinal, resultado.resposta);
      } else if (resultado._apresentacaoPlanosTriggerada) {
        // Apresentação de planos já em andamento — não enviar resposta do brain
        console.log('[PROCESSOR] 📋 Resposta suprimida — apresentação de planos em andamento');
      }

      // Depois de enviar o texto da Mari, dispara o PDF prometido
      if (promessaManualEnviar) {
        const senderMod = require('../services/sender');
        try {
          await senderMod.enviarDocumento(msgFinal, promessaManualEnviar.caminho, promessaManualEnviar.nome_arquivo);
          await this.db.salvarMensagem(conversa.id, 'agent', `[📋 PDF ${conversa.plano_recomendado || 'advance'} enviado]`, 'ia').catch(() => {});
          await this.db.run('UPDATE conversas SET pdf_oferecido=false WHERE id=$1', [conversa.id]).catch(() => {});
          console.log(`[PROCESSOR] ✅ PDF enviado (gatilho: promessa na resposta)`);
        } catch (e) {
          console.error('[PROCESSOR] ❌ Falha ao enviar PDF prometido:', e.message);
        }
      }

      // ── 13. Salvar rastreamento Obsidian ──────────────────
      // Usa idDecisao gravado em 7b — antes esse UPDATE rodava sobre tabela vazia
      // e falhava silenciosamente porque nunca houvera INSERT.
      if (obsidianArquivos.length && idDecisao) {
        await this.db.run(
          `UPDATE decisoes_orquestrador SET obsidian_arquivos=$1 WHERE id=$2`,
          [obsidianArquivos, idDecisao]
        ).catch(e => console.warn('[PROCESSOR] obsidian_arquivos UPDATE erro:', e.message));

        for (const arquivo of obsidianArquivos) {
          await this.db.run(
            `INSERT INTO conversa_obsidian (conversa_id, arquivo)
             VALUES ($1, $2)
             ON CONFLICT (conversa_id, arquivo)
             DO UPDATE SET vezes_usado = conversa_obsidian.vezes_usado + 1, ultima_vez = NOW()`,
            [conversa.id, arquivo]
          ).catch(() => {});
        }
        console.log(`[PROCESSOR] Obsidian: ${obsidianArquivos.length} arquivos registrados`);
      }

      // ── 14. Notificar dashboards ─────────────────────────
      await this.notificador.notificar(conversa.id, {
        conversa_id: conversa.id,
        phone: msgFinal.phone,
        nome: msg.nome,
        msg_cliente: texto,
        msg_mari: resultado.resposta
      });

      // ── 14a. Juiz-LLM — avaliação de alucinação em background ─────────────
      // Fire-and-forget: não bloqueia a resposta da Mari. Grava em mari_intelligence.
      if (resultado.resposta && !resultado._apresentacaoPlanosTriggerada) {
        try {
          const juiz = require('../services/juiz');
          const precosOficiais = {
            slim:     'R$59,99',
            advance:  'R$119,99',
            platinum: 'R$189,99',
            diamond:  'R$359,99',
            plus:     '+R$59/mês',
          };
          juiz.avaliarEmBackground({
            conversaId: conversa.id,
            mensagemId: null,
            phone: msgFinal.phone,
            nomeCliente: cliente.nome,
            mensagemCliente: texto,
            contextoEnviado: contextoPrompt,
            respostaMari: resultado.resposta,
            precosOficiais,
          }).catch(e => console.error('[JUIZ] bg erro:', e.message));
        } catch (e) { console.error('[JUIZ] import erro:', e.message); }
      }

      // ── 14b. Salvar dados extraídos pelo Brain no BD ──────────────────────────
      // [COMPORTAMENTO MARI] Persistir email, CPF, nome, raça, idade extraídos pelo Brain — 16/04/2026 16:18
      const de = resultado.dados_extraidos || {};

      // Atualizar nome do cliente
      if (de.nome_cliente && de.nome_cliente !== cliente.nome) {
        await this.db.run('UPDATE clientes SET nome=$1 WHERE id=$2', [de.nome_cliente, cliente.id]).catch(() => {});
        console.log(`[PROCESSOR] 💾 nome_cliente salvo: ${de.nome_cliente}`);
      }

      // Montar patch do perfil com todos os campos extraídos
      const patchPerfil = {};
      if (de.nome_pet)   patchPerfil.nome         = de.nome_pet;
      if (de.especie_pet) patchPerfil.especie      = de.especie_pet;
      if (de.raca_pet)   patchPerfil.raca          = de.raca_pet;
      if (de.idade_pet)  patchPerfil.idade_anos    = parseFloat(de.idade_pet) || de.idade_pet;
      if (de.email)      patchPerfil.email         = de.email;
      if (de.cpf)        patchPerfil.cpf           = de.cpf.replace(/\D/g,'');
      if (de.cep && !de.cep.includes('?')) patchPerfil.cep = de.cep.replace(/\D/g,'');
      if (de.plano_interesse) await this.db.atualizarConversa(conversa.id, { plano_recomendado: de.plano_interesse }).catch(() => {});

      if (Object.keys(patchPerfil).length > 0) {
        await this.db.atualizarPerfil(cliente.id, patchPerfil, conversa.id).catch(() => {});
        console.log(`[PROCESSOR] 💾 perfil atualizado:`, Object.keys(patchPerfil).join(', '));
      }

      // Atualizar etapa se Brain indicou mudança — valida contra lista canônica
      // ⚠️ Lock 20/04/2026 (caso Getulio): Brain inventou "proposta_gerada" como etapa.
      // Agora rejeitamos qualquer etapa fora de ETAPAS_ORDEM ou auxiliares conhecidas.
      const ETAPAS_VALIDAS = new Set([
        ...ETAPAS_ORDEM,
        'sem_cobertura', 'encerrado',
      ]);
      if (resultado.etapa && resultado.etapa !== conversa.etapa) {
        if (ETAPAS_VALIDAS.has(resultado.etapa)) {
          await this.db.atualizarConversa(conversa.id, { etapa: resultado.etapa }).catch(() => {});
        } else {
          console.warn(`[PROCESSOR] ⚠️ Brain retornou etapa inválida '${resultado.etapa}' — ignorada (mantém ${conversa.etapa})`);
          resultado.etapa = conversa.etapa;
        }
      }

      // ── 14c. Detectar venda_fechada automaticamente ──────────────────────────
      // Quando temos o kit completo de dados (nome, CPF, e-mail, CEP) + cliente
      // confirmou interesse ("quero", "fechar", "assinar"), avançamos pra
      // venda_fechada e registramos no funil. 'pago' continua sendo manual
      // (marcado via dashboard quando a adesão é confirmada no ERP).
      const etapaAtualPosBrain = resultado.etapa || conversa.etapa;
      if (etapaAtualPosBrain !== 'venda_fechada' && etapaAtualPosBrain !== 'pago') {
        const perfilAtualizado = await this.db.buscarOuCriarPerfil(cliente.id).catch(() => perfil);
        const nomeOk    = cliente.nome || de.nome_cliente;
        const nomePetOk = (perfilAtualizado?.nome && perfilAtualizado.nome !== '?') || de.nome_pet;
        const cpfOk     = perfilAtualizado?.cpf   || de.cpf;
        const emailOk   = perfilAtualizado?.email || de.email;
        const cepOk     = perfilAtualizado?.cep   || de.cep;
        const dadosCompletos = nomeOk && nomePetOk && cpfOk && emailOk && cepOk;
        const confirmouCompra = /\b(quero|vou querer|fechar|assinar|pode|faz|faça|manda|me\s+cadastra)\b/i.test(texto);
        if (dadosCompletos && (confirmouCompra || ['pre_fechamento','fechamento'].includes(etapaAtualPosBrain))) {
          await this.db.atualizarConversa(conversa.id, { etapa: 'venda_fechada' }).catch(() => {});
          await this.db.run(
            `INSERT INTO funil_conversao (conversa_id, etapa_origem, etapa_destino) VALUES ($1,$2,$3)`,
            [conversa.id, etapaAtualPosBrain, 'venda_fechada']
          ).catch(() => {});
          resultado.etapa = 'venda_fechada';
          conversa.etapa  = 'venda_fechada';
          console.log(`[PROCESSOR] 🎉 Venda fechada: ${msg.phone} (nome+CPF+email+CEP confirmados)`);
          supervisorNotifier.notificarEtapa('venda_fechada', { cliente, perfil: perfilAtualizado, conversa })
            .catch(e => console.warn('[PROCESSOR] supervisor notify erro:', e.message));
        }
      }

      // Atualizar score real baseado no perfil coletado
      const scoreNovo = decisorMod.calcularScore ? decisorMod.calcularScore(perfil, resultado.etapa || conversa.etapa, historico_resumo) : conversa.score;
      if (scoreNovo !== conversa.score) {
        await this.db.atualizarConversa(conversa.id, { score: scoreNovo }).catch(()=>{});
      }

      console.log(`[PROCESSOR] ✅ ${msg.phone} | etapa:${resultado.etapa} | score:${scoreNovo}`);

      // ── 15. Reengajamento: cancelar vácuo + agendar próximo ─────
      setTimeout(async () => {
        try {
          // Cliente respondeu = cancelar vácuo automático
          await reeng.clienteRespondeu(conversa.id);

          // Detectar "vai pensar" / data combinada
          const textoLower = (texto||'').toLowerCase();
          const vaiPensar = /vou pensar|deixa eu pensar|depois|amanhã|amanha|semana que vem|vou ver|mais tarde|tô ocupado|to ocupado/i.test(textoLower);

          if (vaiPensar) {
            const dt = new Date();
            if (/amanhã|amanha/i.test(textoLower)) { dt.setDate(dt.getDate()+1); dt.setHours(9,0,0,0); }
            else if (/semana/i.test(textoLower)) { dt.setDate(dt.getDate()+7); dt.setHours(9,0,0,0); }
            else { dt.setHours(dt.getHours()+3); }
            await reeng.agendarCombinado(conversa.id, dt.toISOString(), texto.slice(0,100));
            console.log(`[PROCESSOR] 📅 ${msg.phone} — combinado agendado`);
          } else {
            // Iniciar sequência de vácuo
            await reeng.agendarVacuo(conversa.id, 0);
          }
        } catch(e) { console.error('[PROCESSOR] Reeng erro:', e.message); }
      }, 5000);

      // Agendar geração de resumo após 5min de inatividade
      setTimeout(() => leadMemory.gerarResumoPendente(conversa.id).catch(() => {}), 5 * 60 * 1000);
      // Atualizar temperatura do lead
      leadMemory.atualizarTemperatura(conversa.id).catch(() => {});

    } catch (e) {
      console.error(`[PROCESSOR] Erro ${msg.phone}:`, e.message);
      console.error('[PROCESSOR] Stack:', e.stack?.split('\n').slice(0,5).join(' | '));
    }
  }
}

module.exports = ProcessadorMensagem;
