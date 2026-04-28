import { InternalMessage } from '@plamev/shared';
import { pool } from './rag';
import { checkInputGuard } from './guards/input-guard';
import { validateClaims } from './guards/output-guard';
import { generateResponse, ChatMessage } from '../clients/llm-client';
import { langfuse } from '../clients/langfuse-client';
import { sendResponse, persistInteraction } from './delivery';
import { resolverConfigRuntimeAgente, ResolvedAgentRuntimeConfig } from '../db';

async function lf_flush() {
  try { await langfuse.flushAsync(); }
  catch (e: any) { console.error('[LANGFUSE] ❌ Flush falhou:', e?.message ?? e); }
}

const HISTORY_LIMIT       = 30;
const KB_CHAR_LIMIT       = 8000;

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

// ── 2. Soul (system prompt) do agente ────────────────────────
async function buscarSoul(agentId: string): Promise<string | null> {
  try {
    const { rows } = await pool.query(`
      SELECT conteudo
      FROM agente_prompts
      WHERE agent_id = $1 AND tipo = 'soul' AND ativo = true
      LIMIT 1
    `, [agentId]);
    return rows[0]?.conteudo || null;
  } catch { return null; }
}

// ── 3. RAG: knowledge base via full-text search ───────────────
async function buscarKnowledge(agentId: string, texto: string): Promise<{ conteudo: string; fontes: string[] }> {
  try {
    const { rows: sempre } = await pool.query(`
      SELECT titulo, arquivo, conteudo FROM knowledge_base_docs
      WHERE agent_id=$1 AND sempre_ativo=true AND ativo=true ORDER BY ordem
    `, [agentId]);

    const { rows: relevantes } = await pool.query(`
      SELECT titulo, arquivo, conteudo FROM knowledge_base_docs
      WHERE agent_id=$1 AND ativo=true AND sempre_ativo=false
        AND to_tsvector('portuguese', coalesce(titulo,'') || ' ' || coalesce(conteudo,''))
            @@ plainto_tsquery('portuguese', $2)
      ORDER BY ordem LIMIT 8
    `, [agentId, texto.slice(0, 200)]).catch(() => ({ rows: [] }));

    const todos = [...sempre, ...relevantes];
    if (!todos.length) return { conteudo: '', fontes: [] };

    let totalChars = 0;
    const partes: string[] = [];
    const fontes: string[] = [];
    for (const doc of todos) {
      const bloco = `### ${doc.titulo || doc.arquivo}\n${doc.conteudo}`;
      if (totalChars + bloco.length > KB_CHAR_LIMIT) break;
      partes.push(bloco);
      fontes.push(doc.arquivo);
      totalChars += bloco.length;
    }
    return { conteudo: partes.join('\n\n'), fontes };
  } catch (e: any) {
    console.warn(`[PIPELINE] ⚠️ Knowledge base indisponível: ${e.message}`);
    return { conteudo: '', fontes: [] };
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
    output:   { action: guardResult.action, intent: guardResult.intent, latencyMs: guardResult.latencyMs },
    level:    guardResult.action === 'escalate' ? 'WARNING' : guardResult.action === 'drop' ? 'ERROR' : 'DEFAULT',
    metadata: { action: guardResult.action, intent: guardResult.intent },
  });

  console.log(`${tag} [1/7] InputGuard → action=${guardResult.action} intent=${guardResult.intent} (${Date.now() - t1}ms)`);

  if (guardResult.action === 'drop') {
    console.log(`${tag} 🛑 Descartada pelo guard`);
    trace.update({ output: 'dropped', metadata: { reason: 'input_guard_drop' } });
    await lf_flush();
    return;
  }
  if (guardResult.action === 'escalate') {
    console.log(`${tag} 🚨 Escalando para humano`);
    trace.update({ output: 'escalated', metadata: { reason: 'pedido_humano' } });
    await lf_flush();
    return;
  }

  // ── ETAPA 2: Contexto em paralelo ────────────────────────
  const t2 = Date.now();
  const ctxSpan = trace.span({
    name:  '2-context-load',
    input: { agentSlug, orgId, phone: msg.phone, canal: msg.canal },
  });

  const [soulPrompt, historico, kb] = await Promise.all([
    buscarSoul(config.id),
    buscarHistorico(orgId, msg.phone, msg.canal),
    buscarKnowledge(config.id, msg.texto || ''),
  ]);

  ctxSpan.end({
    output: {
      soul_source:    soulPrompt ? 'db' : 'fallback',
      history_count:  historico.length,
      rag_docs_count: kb.fontes.length,
      kb_chars:       kb.conteudo.length,
      rag_sources:    kb.fontes,
    },
    metadata: {
      soul_source:    soulPrompt ? 'db' : 'fallback',
      history_count:  historico.length,
      rag_docs_count: kb.fontes.length,
      kb_chars:       kb.conteudo.length,
    },
  });

  console.log(`${tag} [2/7] Contexto | soul=${soulPrompt ? 'DB' : 'fallback'} | histórico=${historico.length}msgs | kb=${kb.fontes.length} docs (${kb.conteudo.length} chars) | ${Date.now() - t2}ms`);
  if (kb.fontes.length) console.log(`${tag}     KB fontes: ${kb.fontes.join(', ')}`);

  // ── ETAPA 3: System prompt ────────────────────────────────
  const baseSoul = soulPrompt ||
    `Você é ${config.nome || 'a assistente virtual da Plamev'}, assistente virtual da Plamev, plano de saúde para pets. Seja simpática, objetiva e natural em português. Não se apresente se já há histórico de conversa.`;

  const systemPrompt = kb.conteudo
    ? `${baseSoul}\n\n# BASE DE CONHECIMENTO\n${kb.conteudo}`
    : baseSoul;

  const messages: ChatMessage[] = [
    ...historico,
    { role: 'user', content: msg.texto || '' },
  ];

  console.log(`${tag} [3/7] Prompt | ${messages.length} msgs (${systemPrompt.length} chars system)`);

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

  const validation = await validateClaims(generation, systemPrompt, config.guard_model);
  const wasRewritten = !validation.isValid;

  outGuardSpan.end({
    output:   { isValid: validation.isValid, reason: validation.reason ?? null },
    level:    wasRewritten ? 'WARNING' : 'DEFAULT',
    metadata: { is_valid: validation.isValid, was_rewritten: wasRewritten },
  });

  console.log(`${tag} [5/7] OutputGuard → válido=${validation.isValid} (${Date.now() - t5}ms)${!validation.isValid ? ' | ' + validation.reason : ''}`);

  if (wasRewritten) {
    generation.resposta = 'Deixa eu confirmar essa informação pra você, só um minutinho...';
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
      rag_docs_count:     kb.fontes.length,
      kb_chars_injected:  kb.conteudo.length,
      rag_sources:        kb.fontes,
      history_msgs_count: historico.length,
      guard_intent:       guardResult.intent,
      guard_action:       guardResult.action,
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
