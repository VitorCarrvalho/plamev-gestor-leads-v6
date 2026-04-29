import { InternalMessage } from '@plamev/shared';
import { pool, searchKnowledge } from './rag';
import { checkInputGuard } from './guards/input-guard';
import { validateClaims } from './guards/output-guard';
import { generateResponse, ChatMessage } from '../clients/llm-client';
import { langfuse } from '../clients/langfuse-client';
import { sendResponse, persistInteraction, sendDocument } from './delivery';
import { carregar as vaultCarregar } from '../services/vault';
import { buscarRedeCredenciada, normalizarCep, validarCep, type RedeResult } from '../services/rede-credenciada';
import {
  buscarEnderecoPorCep,
  buscarCoberturasParaUF,
  formatarCoberturasParaPrompt,
  encontrarRacaPorNome,
  submeterCotacao,
  extrairDdd,
  formatarDataNascimento,
  normalizarCidade,
  type CotacaoPayload,
} from '../services/cotacao';
import { gerarCotacaoPdf } from '../services/cotacao-pdf';
import {
  resolverConfigRuntimeAgente,
  ResolvedAgentRuntimeConfig,
  buscarContextoConversaAtiva,
  buscarTabelaPlanos,
  buscarPrompts,
  atualizarConversa,
} from '../db';
import {
  buildGreetingResponse,
  buildMariPrompt,
  chooseNonRepeatingFallback,
  detectCatalogIntent,
  detectGreetingOnly,
  detectPriceIntent,
  formatConversationStatePrompt,
  formatProductCatalogPrompt,
  inferTargetStage,
} from './mari-runtime';

function detectarCepNoTexto(texto: string): string | null {
  const semEspacos = texto.replace(/\s/g, '');
  const matchHifen = texto.match(/\b(\d{5})-(\d{3})\b/);
  if (matchHifen) return matchHifen[1] + matchHifen[2];
  const matchPuro = semEspacos.match(/\b(\d{8})\b/);
  if (matchPuro) return validarCep(matchPuro[1]) ? matchPuro[1] : null;
  return null;
}

function formatarSecaoRede(result: RedeResult, cep: string): string {
  if (result.status === 'cep_invalido') {
    return `CEP "${cep}" é inválido. Instrua o cliente a enviar um CEP com 8 números.`;
  }
  if (result.status === 'erro_servico') {
    return 'Serviço de rede credenciada indisponível agora. Informe ao cliente de forma amigável e sugira tentar novamente em instantes.';
  }
  if (result.status === 'sem_cobertura') {
    return `CEP ${cep} consultado agora — sem clínicas credenciadas em até 40 km. Informe com empatia e ofereça cadastro na lista de espera.`;
  }
  return `Dados REAIS de rede credenciada consultados agora para o CEP ${cep}. Use EXATAMENTE as clínicas abaixo, sem inventar outras:\n\n${result.texto}`;
}

async function lf_flush() {
  try { await langfuse.flushAsync(); }
  catch (e: any) { console.error('[LANGFUSE] ❌ Flush falhou:', e?.message ?? e); }
}

const HISTORY_LIMIT = 30;

// ── Cotação: disparo não-bloqueante ───────────────────────────
async function dispararCotacao(
  msg: InternalMessage,
  dados: Record<string, any>,
  conversaAtual: any,
) {
  const tag = `[COTACAO] ${msg.phone}`;
  try {
    // Extrai dados do lead dos dados_extraidos + conversa
    // Suporta chaves abreviadas (nc/np/ep/rp/cp/em/dn/sx/ci) e chaves completas
    const nomeCliente = dados.nome || dados.nc || dados.tutor_nome || conversaAtual?.tutor_nome || msg.nome || '';
    const email       = dados.email || dados.em || '';
    const telefone    = dados.telefone || msg.phone || '';
    const cepRaw      = dados.cep || dados.cp || '';
    const petNome     = dados.pet_nome || dados.nome_pet || dados.np || conversaAtual?.nome_pet || '';
    const petNasc     = formatarDataNascimento(dados.pet_nascimento || dados.data_nascimento || dados.dn || '') || '';
    const petSexo     = dados.pet_sexo || dados.sexo || dados.sx || 'Macho';
    const petEspecie  = (dados.pet_especie || dados.especie || dados.ep || '2') as '1' | '2';
    const petRacaNome = dados.pet_raca || dados.raca || dados.rp || conversaAtual?.raca || '';
    const coberturaId = dados.cobertura_id || dados.coberturasId || dados.ci || '';

    if (!nomeCliente || !email || !coberturaId || !cepRaw) {
      console.warn(`${tag} ⚠️ Dados insuficientes para cotação (nome=${!!nomeCliente} email=${!!email} cobertura=${!!coberturaId} cep=${!!cepRaw})`);
      return;
    }

    // Endereço via ViaCEP
    const endereco = await buscarEnderecoPorCep(cepRaw);
    if (!endereco) {
      console.warn(`${tag} ⚠️ CEP inválido ou não encontrado: ${cepRaw}`);
      return;
    }

    // Raça → UUID (normaliza para lowercase)
    let racaId = (dados.racas_id || dados.racasId || '').toLowerCase();
    if (!racaId && petRacaNome) {
      const raca = await encontrarRacaPorNome(petRacaNome, petEspecie);
      racaId = raca?.id?.toLowerCase() || (petEspecie === '2' ? 'SEMRACA2' : 'SEMRACA1');
    }
    if (!racaId) racaId = petEspecie === '2' ? 'SEMRACA2' : 'SEMRACA1';

    // Cobertura → UUID: se a LLM enviou nome/slug em vez de UUID, resolve pelo nome
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let coberturaIdResolvido = coberturaId;
    if (coberturaId && !uuidPattern.test(coberturaId)) {
      console.log(`${tag} 🔍 ci="${coberturaId}" não é UUID — buscando pelo nome em coberturas de ${endereco.uf}…`);
      try {
        const coberturas = await buscarCoberturasParaUF(endereco.uf);
        const slug = coberturaId.toLowerCase().replace(/[-_]/g, ' ');
        const match = coberturas.find(c =>
          c.nome.toLowerCase().includes(slug) ||
          slug.includes(c.nome.toLowerCase().split(' ')[0])
        );
        if (match) {
          coberturaIdResolvido = match.id;
          console.log(`${tag} ✅ cobertura resolvida: "${coberturaId}" → ${match.id} (${match.nome})`);
        } else {
          console.warn(`${tag} ⚠️ Plano "${coberturaId}" não encontrado em ${endereco.uf} — usando o primeiro disponível`);
          coberturaIdResolvido = coberturas[0]?.id || coberturaId;
        }
      } catch (e: any) {
        console.warn(`${tag} ⚠️ Falha ao resolver cobertura por nome: ${e.message}`);
      }
    }

    // DDD + número — strip código de país 55 se presente
    let telefoneBruto = telefone.replace(/\D/g, '');
    if (telefoneBruto.startsWith('55') && telefoneBruto.length > 11) {
      telefoneBruto = telefoneBruto.slice(2);
    }
    const { ddd, numero } = extrairDdd(telefoneBruto);

    const payload: CotacaoPayload = {
      nome: nomeCliente,
      email,
      ddd,
      telefone: numero,
      cep: endereco.cep,
      logradouro: endereco.logradouro,
      numero: dados.numero_endereco || 'S/N',
      complemento: dados.complemento || '',
      bairro: endereco.bairro,
      estadosId: endereco.uf,
      cidadesId: normalizarCidade(endereco.cidade),
      formaPagamento: 1,
      cupomDesconto: '',
      pets: [{
        nome: petNome || 'Pet',
        dataNascimento: petNasc || '01/01/2022',
        sexo: ['Macho', 'Fêmea'].includes(petSexo) ? petSexo as 'Macho' | 'Fêmea' : 'Macho',
        especie: petEspecie,
        racasId: racaId,
        coberturasId: coberturaIdResolvido,
      }],
    };

    console.log(`${tag} 🔄 Submetendo cotação para ${nomeCliente} (pet: ${petNome}) | ddd=${ddd} tel=${numero} cep=${endereco.cep} uf=${endereco.uf} ci=${coberturaIdResolvido} especie=${petEspecie} raca=${racaId}`);
    const resultado = await submeterCotacao(payload);
    console.log(`${tag} ✅ Cotação ${resultado.numeroCotacao} gerada — ${resultado.valorTotalMensalidade}/mês`);

    // Gera PDF
    const pdfBuffer = await gerarCotacaoPdf(resultado, payload);
    const fileName = `cotacao-plamev-${resultado.numeroCotacao.replace(/[^a-zA-Z0-9]/g, '-')}.pdf`;
    console.log(`${tag} 📄 PDF gerado (${Math.round(pdfBuffer.length / 1024)}KB)`);

    // Envia via WhatsApp
    await sendDocument(msg, pdfBuffer, fileName, `Aqui está sua cotação Plamev! Nº ${resultado.numeroCotacao} 🐾`);
    console.log(`${tag} 📤 PDF enviado via WhatsApp`);
  } catch (e: any) {
    console.error(`${tag} ❌ Falha ao disparar cotação:`, e.message);
    if (e.erros) console.error(`${tag}   Erros de validação:`, JSON.stringify(e.erros));
  }
}

// ── 1. Histórico de mensagens ─────────────────────────────────
async function buscarHistorico(orgId: string, phone: string, canal: string): Promise<ChatMessage[]> {
  try {
    const { rows } = await pool.query(`
      SELECT m.role, m.conteudo
      FROM mensagens m
      JOIN conversas c ON c.id = m.conversa_id
      WHERE c.numero_externo = $1
        AND c.org_id = $2
        AND c.canal = $3
        AND c.status = 'ativa'
        AND m.role IN ('user', 'agent')
      ORDER BY m.timestamp DESC
      LIMIT $4
    `, [phone, orgId, canal, HISTORY_LIMIT]);
    return rows.reverse().map((r: any) => ({
      role: r.role === 'agent' ? 'assistant' : 'user',
      content: r.conteudo,
    } as ChatMessage));
  } catch (e: any) {
    console.warn(`[PIPELINE] ⚠️ Histórico indisponível: ${e.message}`);
    return [];
  }
}

export interface PipelineRuntimeContext {
  orgId: string;
  agentConfig: ResolvedAgentRuntimeConfig;
}

// ── PIPELINE PRINCIPAL ────────────────────────────────────────
export async function processMessage(msg: InternalMessage, runtimeContext?: PipelineRuntimeContext) {
  const start = Date.now();
  const agentSlug = msg.agentSlug || 'mari';
  const fallbackConfig = runtimeContext ? null : await resolverConfigRuntimeAgente(agentSlug);
  const resolvedContext = runtimeContext || {
    agentConfig: fallbackConfig!,
    orgId: fallbackConfig!.org_id,
  };
  const config = resolvedContext.agentConfig;
  const orgId = resolvedContext.orgId || config.org_id;
  const tag = `[PIPELINE] ${orgId}:${msg.canal}:${msg.phone}`;
  console.log(`${tag} ▶ Início | texto="${(msg.texto || '').substring(0, 60)}"`);

  // Langfuse: inicia trace para esta mensagem
  const trace = langfuse.trace({
    name:      'message-pipeline',
    userId:    msg.phone,
    sessionId: `${msg.canal}:${msg.phone}`,
    tags:      [msg.canal, agentSlug, orgId, 'production'],
    input:     msg.texto || '',
    metadata:  {
      orgId,
      canal:     msg.canal,
      phone:     msg.phone,
      agentSlug,
      agentId:   config.id,
      instancia: msg.instancia,
      nome:      msg.nome,
    },
  });

  // ── ETAPA 1: Input Guard ──────────────────────────────────
  const t1 = Date.now();
  const guardSpan = trace.span({
    name:  '1-input-guard',
    input: { texto: msg.texto, canal: msg.canal, phone: msg.phone },
  });

  const guardResult = await checkInputGuard(msg);

  guardSpan.end({
    output:   {
      action: guardResult.action,
      intent: guardResult.intent,
      reason: guardResult.reason ?? null,
      matchedRules: guardResult.matchedRules ?? [],
      failOpen: guardResult.failOpen ?? false,
      latencyMs: guardResult.latencyMs,
    },
    level:    guardResult.action === 'escalate' ? 'WARNING' : guardResult.action === 'drop' ? 'ERROR' : 'DEFAULT',
    metadata: {
      action: guardResult.action,
      intent: guardResult.intent,
      reason: guardResult.reason ?? null,
      matched_rules: guardResult.matchedRules ?? [],
      fail_open: guardResult.failOpen ?? false,
    },
  });

  console.log(
    `${tag} [1/7] InputGuard → action=${guardResult.action} intent=${guardResult.intent}` +
    `${guardResult.reason ? ` reason="${guardResult.reason}"` : ''}` +
    `${guardResult.failOpen ? ' failOpen=true' : ''}` +
    ` (${Date.now() - t1}ms)`,
  );

  if (guardResult.action === 'drop') {
    console.log(`${tag} 🛑 Descartada pelo guard`);
    trace.update({
      output: 'dropped',
      metadata: {
        reason: 'input_guard_drop',
        input_guard_reason: guardResult.reason ?? null,
        input_guard_rules: guardResult.matchedRules ?? [],
        input_guard_fail_open: guardResult.failOpen ?? false,
      },
    });
    await lf_flush();
    return;
  }
  if (guardResult.action === 'escalate') {
    console.log(`${tag} 🚨 Escalando para humano`);
    trace.update({
      output: 'escalated',
      metadata: {
        reason: 'pedido_humano',
        input_guard_reason: guardResult.reason ?? null,
        input_guard_rules: guardResult.matchedRules ?? [],
        input_guard_fail_open: guardResult.failOpen ?? false,
      },
    });
    await lf_flush();
    return;
  }

  // ── ETAPA 2: Contexto em paralelo ────────────────────────
  const t2 = Date.now();
  const ctxSpan = trace.span({
    name:  '2-context-load',
    input: { agentSlug, orgId, phone: msg.phone, canal: msg.canal },
  });

  // Detecta CEP na mensagem antes do Promise.all para inclusão condicional
  const cepDetectado = detectarCepNoTexto(msg.texto || '');

  // Carrega prompts em paralelo: vault (primário) + banco (fallback) + contexto
  // Tom-e-Fluxo.md removido — conteúdo absorvido pelo Identidade.md
  const [vaultSoul, vaultRegras, vaultAntiRep, vaultPensamentos, vaultModoRapido,
         promptBundle, historico, conversaAtual, tabelaPlanos, redeResult] = await Promise.all([
    vaultCarregar('Mari/Identidade.md'),
    vaultCarregar('Mari/Regras-Absolutas.md'),
    vaultCarregar('Mari/Anti-Repeticao.md'),
    vaultCarregar('Mari/Personalidade-Vendas.md'),
    vaultCarregar('Mari/Modo-Rapido.md'),
    buscarPrompts(Number(config.id)).catch(() => ({})),
    buscarHistorico(orgId, msg.phone, msg.canal),
    buscarContextoConversaAtiva(orgId, msg.phone, msg.canal),
    buscarTabelaPlanos().catch(() => []),
    cepDetectado
      ? buscarRedeCredenciada(cepDetectado).catch(() => ({ status: 'erro_servico' } as RedeResult))
      : Promise.resolve(null as RedeResult | null),
  ]);

  // Vault tem prioridade; banco serve de fallback quando arquivo ainda não existe
  const promptsResolvidos = {
    soul:           vaultSoul           || (promptBundle as any)?.soul           || '',
    tom:            (promptBundle as any)?.tom            || '',
    regras:         vaultRegras         || (promptBundle as any)?.regras         || '',
    anti_repeticao: vaultAntiRep        || (promptBundle as any)?.anti_repeticao || '',
    pensamentos:    vaultPensamentos    || (promptBundle as any)?.pensamentos    || '',
    modo_rapido:    vaultModoRapido     || (promptBundle as any)?.modo_rapido    || '',
  };
  const vaultAtivo = !!(vaultSoul || vaultRegras);
  const targetStage = inferTargetStage(msg.texto || '', conversaAtual);
  const greetingOnly = detectGreetingOnly(msg.texto || '');
  const catalogIntent = detectCatalogIntent(msg.texto || '');
  const priceIntent = detectPriceIntent(msg.texto || '');
  const topicalPlanMessage = /(plano|planos|pre[cç]o|valor|cobertura|car[eê]ncia|rede|consulta|exame|cirurgia|manual|pdf)/i.test(msg.texto || '');
  const CATALOG_STAGES = ['apresentacao_planos', 'qualificacao', 'negociacao', 'pre_fechamento', 'fechamento'];
  const stageRequiresCatalog = CATALOG_STAGES.includes(conversaAtual?.etapa || '');
  const includePlanContext = !greetingOnly && (catalogIntent || priceIntent || topicalPlanMessage || stageRequiresCatalog);
  const isFirstContact = historico.length === 0 && !conversaAtual?.tutor_nome;

  // Endereço via ViaCEP (lightweight — ~200ms)
  const enderecoPromise = cepDetectado
    ? buscarEnderecoPorCep(cepDetectado).catch(() => null)
    : Promise.resolve(null);

  const [endereco] = await Promise.all([enderecoPromise]);
  const ufDetectada = endereco?.uf || null;

  // Coberturas da API Plamev: só carrega quando há intenção de plano E temos UF
  const coberturasApiSection = await (async () => {
    if (!includePlanContext || !ufDetectada) return '';
    try {
      const coberturas = await buscarCoberturasParaUF(ufDetectada);
      return formatarCoberturasParaPrompt(coberturas, ufDetectada);
    } catch {
      return '';
    }
  })();

  // KB via RAG — conteúdo migrado do vault para knowledge_chunks via vault-sync
  const kb = await searchKnowledge(msg.texto || '', orgId, config.id, 5, { stage: targetStage });
  const knowledgeBase = kb.conteudo;

  // Rede credenciada: seção de prompt ou null se não havia CEP na mensagem
  const redeSection = redeResult ? formatarSecaoRede(redeResult, cepDetectado!) : '';

  const soulSource = vaultAtivo ? 'vault' : promptsResolvidos.soul ? 'db' : 'fallback';

  ctxSpan.end({
    output: {
      soul_source:       soulSource,
      history_count:     historico.length,
      target_stage:      targetStage,
      rag_mode:          kb.mode,
      rag_latency_ms:    kb.latencyMs,
      rag_docs_count:    kb.fontes.length,
      kb_chars:          knowledgeBase.length,
      rag_sources:       kb.fontes,
    },
    metadata: {
      soul_source:       soulSource,
      history_count:     historico.length,
      target_stage:      targetStage,
      rag_mode:          kb.mode,
      rag_latency_ms:    kb.latencyMs,
      rag_docs_count:    kb.fontes.length,
      kb_chars:          knowledgeBase.length,
    },
  });

  console.log(
    `${tag} [2/7] Contexto | soul=${soulSource} | etapa=${targetStage} | histórico=${historico.length}msgs` +
    ` | rag=${kb.mode} ${kb.fontes.length} docs (${kb.conteudo.length} chars, ${kb.latencyMs}ms)` +
    (cepDetectado ? ` | cep=${cepDetectado} status=${redeResult?.status}` : '') +
    ` | ${Date.now() - t2}ms`,
  );
  if (kb.fontes.length) console.log(`${tag}     KB fontes: ${kb.fontes.join(', ')}`);
  if (cepDetectado) console.log(`${tag}     Rede credenciada: CEP=${cepDetectado} status=${redeResult?.status} total=${redeResult?.total ?? 0}`);

  // ── ETAPA 3: System prompt ────────────────────────────────
  if (!promptsResolvidos.soul) {
    console.error(
      `${tag} ❌ Mari/Soul.md NÃO carregado do vault — ` +
      `VAULT_SERVER_URL=${process.env.VAULT_SERVER_URL || 'não definido'} | ` +
      `vault_ativo=${vaultAtivo} | soul_db=${!!(promptBundle as any)?.soul}`
    );
  }
  // Fallback mínimo: só o nome — sem instruções de comportamento, para evidenciar falha no vault
  const baseSoul = promptsResolvidos.soul || `Você é ${config.nome || 'Mari'}, assistente da Plamev.`;

  const systemPrompt = buildMariPrompt({
    prompts: { ...promptsResolvidos, soul: baseSoul },
    stage: targetStage,
    conversationState: formatConversationStatePrompt(conversaAtual),
    productCatalog: includePlanContext ? formatProductCatalogPrompt(tabelaPlanos) : '',
    knowledgeBase,
    redeCredenciada: redeSection || undefined,
    cotacaoPlanos: coberturasApiSection || undefined,
    catalogIntent,
    includePlanContext,
  });

  const messages: ChatMessage[] = [
    ...historico,
    { role: 'user', content: msg.texto || '' },
  ];

  console.log(`${tag} [3/7] Prompt | ${messages.length} msgs (${systemPrompt.length} chars system)`);

  if (greetingOnly) {
    const greetingResponse = buildGreetingResponse(conversaAtual, isFirstContact);
    console.log(`${tag} [3.2/7] Saudação determinística acionada`);
    await sendResponse(msg, greetingResponse);
    await persistInteraction(msg, greetingResponse);
    trace.update({
      output: greetingResponse,
      metadata: {
        total_latency_ms: Date.now() - start,
        deterministic_greeting: true,
        rag_mode: kb.mode,
        rag_sources: kb.fontes,
        target_stage: targetStage,
      },
    });
    trace.score({ name: 'deterministic_greeting', value: 1 });
    await lf_flush();
    console.log(`${tag} ✅ Pipeline completo em ${Date.now() - start}ms (saudação determinística)`);
    return;
  }

  // ── ETAPA 4: Geração LLM ──────────────────────────────────
  // Preços Claude Haiku 4.5 (USD por token)
  const PRICE_INPUT  = 0.80  / 1_000_000;
  const PRICE_OUTPUT = 4.00  / 1_000_000;

  const t4 = Date.now();
  const llmStartTime = new Date();

  // Langfuse: input no formato OpenAI (system + messages) para que
  // Cost e Latency dashboards calculem corretamente
  const llmGenSpan = trace.generation({
    name:            '4-llm-generation',
    model:           config.model,
    startTime:       llmStartTime,
    input:           [{ role: 'system', content: systemPrompt }, ...messages],
    modelParameters: { provider: config.provider, temperature: config.temperature },
    metadata:        { agentSlug, agentId: config.id, orgId, canal: msg.canal, llmConfigId: config.llmConfigId, configSources: config.sources },
  });

  const generation = await generateResponse(systemPrompt, messages, config);
  const llmLatency = Date.now() - t4;

  const tokensIn  = generation?._uso?.input_tokens  ?? 0;
  const tokensOut = generation?._uso?.output_tokens ?? 0;

  llmGenSpan.end({
    endTime: new Date(),
    output:  generation?.resposta ?? null,
    usage: {
      input:      tokensIn,
      output:     tokensOut,
      total:      tokensIn + tokensOut,
      unit:       'TOKENS',
      inputCost:  tokensIn  * PRICE_INPUT,
      outputCost: tokensOut * PRICE_OUTPUT,
      totalCost:  (tokensIn * PRICE_INPUT) + (tokensOut * PRICE_OUTPUT),
    },
    level: generation ? 'DEFAULT' : 'ERROR',
  });

  console.log(`${tag} [4/7] LLM ${llmLatency}ms | tokens_in=${generation?._uso?.input_tokens} out=${generation?._uso?.output_tokens}`);

  if (!generation) {
    console.warn(`${tag} ⚠️ Geração retornou null`);
    trace.update({ output: 'llm_null', level: 'ERROR' });
    await lf_flush();
    return;
  }

  // ── ETAPA 5: Output Guard ─────────────────────────────────
  const t5 = Date.now();
  const outGuardSpan = trace.span({
    name:  '5-output-guard',
    input: { resposta: generation.resposta },
  });

  const validation = await validateClaims(generation, systemPrompt, config.guard_model, {
    historico,
    conversa: conversaAtual,
    ragSources: kb.fontes,
    ragMode: kb.mode,
  });
  const wasBlocked = !validation.isValid;
  const wasRewritten = Boolean(validation.rewrittenText && validation.rewrittenText !== generation.resposta);

  outGuardSpan.end({
    output:   {
      isValid: validation.isValid,
      reason: validation.reason ?? null,
      matchedRules: validation.matchedRules ?? [],
      severity: validation.severity ?? null,
      wasBlocked,
      wasRewritten,
    },
    level:    wasBlocked ? 'ERROR' : wasRewritten ? 'WARNING' : 'DEFAULT',
    metadata: {
      is_valid: validation.isValid,
      was_blocked: wasBlocked,
      was_rewritten: wasRewritten,
      reason: validation.reason ?? null,
      matched_rules: validation.matchedRules ?? [],
      severity: validation.severity ?? null,
    },
  });

  console.log(
    `${tag} [5/7] OutputGuard → válido=${validation.isValid}` +
    `${wasBlocked ? ' blocked=true' : ''}` +
    `${wasRewritten ? ' rewritten=true' : ''}` +
    ` (${Date.now() - t5}ms)` +
    `${validation.reason ? ' | ' + validation.reason : ''}`,
  );

  if (validation.rewrittenText) {
    generation.resposta = validation.rewrittenText;
  } else if (wasBlocked) {
    generation.resposta = chooseNonRepeatingFallback(validation.reason, historico);
  }

  const resposta = generation.resposta;
  if (!resposta) {
    console.warn(`${tag} ⚠️ Resposta vazia`);
    trace.update({ output: 'empty_response', level: 'ERROR' });
    await lf_flush();
    return;
  }

  // ── ETAPA 6: Enviar resposta ──────────────────────────────
  const t6 = Date.now();
  console.log(`${tag} [6/7] Enviando: "${resposta.substring(0, 80)}..."`);
  const sendSpan = trace.span({ name: '6-send-response', input: { canal: msg.canal, phone: msg.phone } });
  try {
    await sendResponse(msg, resposta);
    sendSpan.end({ output: { ok: true }, metadata: { latency_ms: Date.now() - t6 } });
    console.log(`${tag} ✅ Resposta entregue`);
  } catch (e: any) {
    sendSpan.end({ output: { ok: false, error: e.message }, level: 'ERROR' });
    console.error(`${tag} ❌ Falha ao entregar resposta: ${e.message}`);
  }

  // ── ETAPA 7: Persistir no CRM ─────────────────────────────
  const t7 = Date.now();
  const crmSpan = trace.span({ name: '7-persist-crm', input: { phone: msg.phone, canal: msg.canal } });
  try {
    await persistInteraction(msg, resposta);
    crmSpan.end({ output: { ok: true }, metadata: { latency_ms: Date.now() - t7 } });
    console.log(`${tag} [7/7] Persistido no CRM`);
  } catch (e: any) {
    crmSpan.end({ output: { ok: false, error: e.message }, level: 'WARNING' });
    console.error(`${tag} ❌ Falha ao salvar no CRM: ${e.message}`);
  }

  const totalLatency = Date.now() - start;

  // ── KB source summary (log + score) ──────────────────────
  const kbSource = kb.conteudo.length > 0 ? 'rag' : 'none';
  console.log(
    `${tag} KB injetado: source=${kbSource} | rag=${kb.conteudo.length} chars (${kb.fontes.length} docs, mode=${kb.mode})`
  );

  // ── Scores Langfuse (alimentam dashboards customizados) ───
  trace.score({ name: 'rag_hit',        value: kb.fontes.length > 0 ? 1 : 0, comment: kb.fontes.join(', ') || 'none' });
  if (cepDetectado) trace.score({ name: 'rede_credenciada_hit', value: redeResult?.status === 'ok' ? 1 : 0, comment: `CEP=${cepDetectado} status=${redeResult?.status} total=${redeResult?.total ?? 0}` });
  trace.score({ name: 'rag_vector_hit', value: kb.mode === 'vector_rerank' ? 1 : 0, comment: kb.mode });
  trace.score({ name: 'output_blocked', value: wasBlocked ? 1 : 0, comment: validation.reason || 'none' });
  trace.score({ name: 'was_rewritten',  value: wasRewritten ? 1 : 0 });
  trace.score({ name: 'guard_passed',   value: guardResult.action === 'process' ? 1 : 0 });
  trace.score({ name: 'has_history',    value: historico.length > 0 ? 1 : 0, comment: `${historico.length} msgs` });
  trace.score({ name: 'total_latency_s', value: parseFloat((totalLatency / 1000).toFixed(2)) });

  // Finaliza trace com output e metadados globais
  trace.update({
    output: resposta,
    metadata: {
      total_latency_ms:   totalLatency,
      llm_latency_ms:     llmLatency,
      kb_source:          kbSource,
      rag_mode:           kb.mode,
      rag_latency_ms:     kb.latencyMs,
      rag_docs_count:     kb.fontes.length,
      kb_chars_injected:  knowledgeBase.length,
      rag_sources:        kb.fontes,
      target_stage:       targetStage,
      history_msgs_count: historico.length,
      guard_intent:       guardResult.intent,
      guard_action:       guardResult.action,
      guard_reason:       guardResult.reason ?? null,
      guard_rules:        guardResult.matchedRules ?? [],
      guard_fail_open:    guardResult.failOpen ?? false,
      output_guard_reason: validation.reason ?? null,
      output_guard_rules: validation.matchedRules ?? [],
      output_guard_severity: validation.severity ?? null,
      output_guard_blocked: wasBlocked,
      was_rewritten:      wasRewritten,
      tokens_in:          generation._uso?.input_tokens  ?? 0,
      tokens_out:         generation._uso?.output_tokens ?? 0,
      model:              config.model,
      provider:           config.provider,
    },
  });

  // ── Cotação: disparo não-bloqueante após pipeline ─────────────
  if (generation.acoes?.includes('solicitar_cotacao')) {
    console.log(`${tag} 🧾 Ação solicitar_cotacao detectada — disparando cotação`);
    dispararCotacao(msg, generation.dados_extraidos ?? {}, conversaAtual).catch(() => {});
  }

  lf_flush(); // async, errors already logged inside lf_flush

  console.log(`${tag} ✅ Pipeline completo em ${totalLatency}ms`);
}
