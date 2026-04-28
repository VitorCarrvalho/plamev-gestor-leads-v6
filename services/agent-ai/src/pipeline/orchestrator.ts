import { InternalMessage } from '@plamev/shared';
import { pool, searchKnowledge } from './rag';
import { checkInputGuard } from './guards/input-guard';
import { validateClaims } from './guards/output-guard';
import { generateResponse, ChatMessage } from '../clients/llm-client';
import { langfuse } from '../clients/langfuse-client';
import { sendResponse, persistInteraction } from './delivery';
import {
  resolverConfigRuntimeAgente,
  ResolvedAgentRuntimeConfig,
  buscarContextoConversaAtiva,
  buscarTabelaPlanos,
  buscarPrompts,
  atualizarConversa,
} from '../db';
import {
  buildDeterministicCatalogResponse,
  buildMariPrompt,
  chooseNonRepeatingFallback,
  detectCatalogIntent,
  formatConversationStatePrompt,
  formatProductCatalogPrompt,
  inferTargetStage,
} from './mari-runtime';

async function lf_flush() {
  try { await langfuse.flushAsync(); }
  catch (e: any) { console.error('[LANGFUSE] ❌ Flush falhou:', e?.message ?? e); }
}

const HISTORY_LIMIT       = 30;

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

  const [promptBundle, historico, conversaAtual, tabelaPlanos] = await Promise.all([
    buscarPrompts(Number(config.id)).catch(() => ({})),
    buscarHistorico(orgId, msg.phone, msg.canal),
    buscarContextoConversaAtiva(orgId, msg.phone, msg.canal),
    buscarTabelaPlanos().catch(() => []),
  ]);
  const targetStage = inferTargetStage(msg.texto || '', conversaAtual);
  const kb = await searchKnowledge(msg.texto || '', orgId, config.id, 5, {
    stage: targetStage,
  });

  ctxSpan.end({
    output: {
      soul_source:    promptBundle?.soul ? 'db' : 'fallback',
      history_count:  historico.length,
      target_stage:   targetStage,
      rag_mode:       kb.mode,
      rag_latency_ms: kb.latencyMs,
      rag_docs_count: kb.fontes.length,
      kb_chars:       kb.conteudo.length,
      rag_sources:    kb.fontes,
    },
    metadata: {
      soul_source:    promptBundle?.soul ? 'db' : 'fallback',
      history_count:  historico.length,
      target_stage:   targetStage,
      rag_mode:       kb.mode,
      rag_latency_ms: kb.latencyMs,
      rag_docs_count: kb.fontes.length,
      kb_chars:       kb.conteudo.length,
    },
  });

  console.log(
    `${tag} [2/7] Contexto | soul=${promptBundle?.soul ? 'DB' : 'fallback'} | etapa=${targetStage} | histórico=${historico.length}msgs` +
    ` | rag=${kb.mode} ${kb.fontes.length} docs (${kb.conteudo.length} chars, ${kb.latencyMs}ms)` +
    ` | ${Date.now() - t2}ms`,
  );
  if (kb.fontes.length) console.log(`${tag}     KB fontes: ${kb.fontes.join(', ')}`);

  // ── ETAPA 3: System prompt ────────────────────────────────
  const baseSoul = promptBundle?.soul ||
    `Você é ${config.nome || 'a assistente virtual da Plamev'}, assistente virtual da Plamev, plano de saúde para pets. Seja simpática, objetiva e natural em português. Não se apresente se já há histórico de conversa.`;

  const systemPrompt = buildMariPrompt({
    prompts: { ...promptBundle, soul: baseSoul },
    stage: targetStage,
    conversationState: formatConversationStatePrompt(conversaAtual),
    productCatalog: formatProductCatalogPrompt(tabelaPlanos),
    knowledgeBase: kb.conteudo,
    catalogIntent: detectCatalogIntent(msg.texto || ''),
  });

  const messages: ChatMessage[] = [
    ...historico,
    { role: 'user', content: msg.texto || '' },
  ];

  console.log(`${tag} [3/7] Prompt | ${messages.length} msgs (${systemPrompt.length} chars system)`);

  const catalogIntent = detectCatalogIntent(msg.texto || '');
  if (catalogIntent) {
    const deterministicCatalog = buildDeterministicCatalogResponse(tabelaPlanos, conversaAtual);
    if (deterministicCatalog) {
      if (conversaAtual?.id && targetStage !== conversaAtual?.etapa) {
        await atualizarConversa(orgId, conversaAtual.id, { etapa: targetStage }).catch(() => {});
      }
      console.log(`${tag} [3.5/7] Catálogo determinístico acionado`);
      await sendResponse(msg, deterministicCatalog);
      await persistInteraction(msg, deterministicCatalog);
      trace.update({
        output: deterministicCatalog,
        metadata: {
          total_latency_ms: Date.now() - start,
          deterministic_catalog: true,
          rag_mode: kb.mode,
          rag_sources: kb.fontes,
          target_stage: targetStage,
        },
      });
      trace.score({ name: 'deterministic_catalog', value: 1 });
      await lf_flush();
      console.log(`${tag} ✅ Pipeline completo em ${Date.now() - start}ms (catálogo determinístico)`);
      return;
    }
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

  // ── Scores Langfuse (alimentam dashboards customizados) ───
  trace.score({ name: 'rag_hit',        value: kb.fontes.length > 0 ? 1 : 0, comment: kb.fontes.join(', ') || 'none' });
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
      rag_mode:           kb.mode,
      rag_latency_ms:     kb.latencyMs,
      rag_docs_count:     kb.fontes.length,
      kb_chars_injected:  kb.conteudo.length,
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

  lf_flush(); // async, errors already logged inside lf_flush

  console.log(`${tag} ✅ Pipeline completo em ${totalLatency}ms`);
}
