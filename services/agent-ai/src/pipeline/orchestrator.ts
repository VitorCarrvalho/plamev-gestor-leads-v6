import https from 'https';
import http from 'http';
import { InternalMessage } from '@plamev/shared';
import { pool } from './rag';
import { checkInputGuard } from './guards/input-guard';
import { validateClaims } from './guards/output-guard';
import { generateResponse, ChatMessage } from '../clients/llm-client';
import { langfuse } from '../clients/langfuse-client';

const CHANNEL_SERVICE_URL = process.env.CHANNEL_SERVICE_URL || 'http://channel-service.railway.internal:8080';
const CRM_SERVICE_URL     = process.env.CRM_SERVICE_URL     || 'http://crm-service.railway.internal:8080';
const INTERNAL_SECRET     = process.env.INTERNAL_SECRET     || 'plamev-internal';
const HISTORY_LIMIT       = 30;
const KB_CHAR_LIMIT       = 8000;

// ── Utilitário HTTP ───────────────────────────────────────────
function postJson(url: string, body: any, headers: Record<string, string> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try { parsed = new URL(url); } catch { return reject(new Error(`URL inválida: ${url}`)); }
    const lib = parsed.protocol === 'https:' ? https : http;
    const b = JSON.stringify(body);
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port) : undefined,
      path: parsed.pathname + (parsed.search || ''),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b), ...headers },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(b);
    req.end();
  });
}

// ── 1. Histórico de mensagens ─────────────────────────────────
async function buscarHistorico(phone: string, canal: string): Promise<ChatMessage[]> {
  try {
    const { rows } = await pool.query(`
      SELECT m.role, m.conteudo
      FROM mensagens m
      JOIN conversas c ON c.id = m.conversa_id
      WHERE c.numero_externo = $1
        AND c.canal = $2
        AND c.status = 'ativa'
        AND m.role IN ('user', 'agent')
      ORDER BY m.timestamp DESC
      LIMIT $3
    `, [phone, canal, HISTORY_LIMIT]);
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
async function buscarSoul(agentSlug: string): Promise<string | null> {
  try {
    const { rows } = await pool.query(`
      SELECT ap.conteudo
      FROM agente_prompts ap
      JOIN agentes a ON a.id = ap.agent_id
      WHERE a.slug = $1 AND ap.tipo = 'soul' AND ap.ativo = true
      LIMIT 1
    `, [agentSlug]);
    return rows[0]?.conteudo || null;
  } catch { return null; }
}

// ── 3. RAG: knowledge base via full-text search ───────────────
async function buscarKnowledge(agentSlug: string, texto: string): Promise<{ conteudo: string; fontes: string[] }> {
  try {
    const { rows: ag } = await pool.query(
      'SELECT id FROM agentes WHERE slug=$1 LIMIT 1', [agentSlug]
    );
    if (!ag[0]) return { conteudo: '', fontes: [] };
    const agentId = ag[0].id;

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

// ── PIPELINE PRINCIPAL ────────────────────────────────────────
export async function processMessage(msg: InternalMessage) {
  const start = Date.now();
  const tag = `[PIPELINE] ${msg.canal}:${msg.phone}`;
  console.log(`${tag} ▶ Início | texto="${(msg.texto || '').substring(0, 60)}"`);

  const agentSlug = msg.agentSlug || 'mari';

  // Langfuse: inicia trace para esta mensagem
  const trace = langfuse.trace({
    name:      'message-pipeline',
    userId:    msg.phone,
    sessionId: `${msg.canal}:${msg.phone}`,
    tags:      [msg.canal, agentSlug, 'production'],
    input:     msg.texto || '',
    metadata:  {
      canal:     msg.canal,
      phone:     msg.phone,
      agentSlug,
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
    await langfuse.flushAsync();
    return;
  }
  if (guardResult.action === 'escalate') {
    console.log(`${tag} 🚨 Escalando para humano`);
    trace.update({ output: 'escalated', metadata: { reason: 'pedido_humano' } });
    await langfuse.flushAsync();
    return;
  }

  // ── ETAPA 2: Contexto em paralelo ────────────────────────
  const t2 = Date.now();
  const ctxSpan = trace.span({
    name:  '2-context-load',
    input: { agentSlug, phone: msg.phone, canal: msg.canal },
  });

  const [soulPrompt, historico, kb] = await Promise.all([
    buscarSoul(agentSlug),
    buscarHistorico(msg.phone, msg.canal),
    buscarKnowledge(agentSlug, msg.texto || ''),
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
    `Você é a Mari, assistente virtual da Plamev, plano de saúde para pets. Seja simpática, objetiva e natural em português. Não se apresente se já há histórico de conversa.`;

  const systemPrompt = kb.conteudo
    ? `${baseSoul}\n\n# BASE DE CONHECIMENTO\n${kb.conteudo}`
    : baseSoul;

  const messages: ChatMessage[] = [
    ...historico,
    { role: 'user', content: msg.texto || '' },
  ];

  console.log(`${tag} [3/7] Prompt | ${messages.length} msgs (${systemPrompt.length} chars system)`);

  // ── ETAPA 4: Geração LLM ──────────────────────────────────
  const config = {
    id:          'agent123',
    org_id:      'org123',
    slug:        agentSlug,
    nome:        'Mari',
    provider:    'anthropic',
    model:       'claude-haiku-4-5-20251001',
    guard_model: 'claude-haiku-4-5-20251001',
  };

  const t4 = Date.now();

  // Langfuse: generation span para a chamada LLM
  const llmGenSpan = trace.generation({
    name:            '4-llm-generation',
    model:           config.model,
    input:           messages,
    systemPrompt,
    modelParameters: { provider: config.provider, temperature: 0.7 },
    metadata:        { agentSlug, canal: msg.canal },
  });

  const generation = await generateResponse(systemPrompt, messages, config);
  const llmLatency = Date.now() - t4;

  llmGenSpan.end({
    output: generation?.resposta ?? null,
    usage: {
      input:  generation?._uso?.input_tokens  ?? 0,
      output: generation?._uso?.output_tokens ?? 0,
    },
    metadata: { latency_ms: llmLatency },
    level:    generation ? 'DEFAULT' : 'ERROR',
  });

  console.log(`${tag} [4/7] LLM ${llmLatency}ms | tokens_in=${generation?._uso?.input_tokens} out=${generation?._uso?.output_tokens}`);

  if (!generation) {
    console.warn(`${tag} ⚠️ Geração retornou null`);
    trace.update({ output: 'llm_null', level: 'ERROR' });
    await langfuse.flushAsync();
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
    await langfuse.flushAsync();
    return;
  }

  // ── ETAPA 6: Enviar resposta ──────────────────────────────
  const t6 = Date.now();
  console.log(`${tag} [6/7] Enviando: "${resposta.substring(0, 80)}..."`);
  const sendSpan = trace.span({ name: '6-send-response', input: { canal: msg.canal, phone: msg.phone } });
  try {
    await postJson(
      `${CHANNEL_SERVICE_URL}/internal/send`,
      { message: msg, resposta },
      { 'x-internal-secret': INTERNAL_SECRET }
    );
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
    await postJson(
      `${CRM_SERVICE_URL}/api/internal/salvar-interacao`,
      { message: msg, resposta },
      { 'x-internal-secret': INTERNAL_SECRET }
    );
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

  // Flush assíncrono — não bloqueia, envia em background
  langfuse.flushAsync().catch(() => {});

  console.log(`${tag} ✅ Pipeline completo em ${totalLatency}ms`);
}
