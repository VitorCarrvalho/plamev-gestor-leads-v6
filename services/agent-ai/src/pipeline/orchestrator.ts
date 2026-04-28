import https from 'https';
import http from 'http';
import { InternalMessage } from '@plamev/shared';
import { pool } from './rag';
import { checkInputGuard } from './guards/input-guard';
import { validateClaims } from './guards/output-guard';
import { logInteraction } from './interaction-logger';
import { generateResponse, ChatMessage } from '../clients/llm-client';

const CHANNEL_SERVICE_URL = process.env.CHANNEL_SERVICE_URL || 'http://channel-service.railway.internal:8080';
const CRM_SERVICE_URL     = process.env.CRM_SERVICE_URL     || 'http://crm-service.railway.internal:8080';
const INTERNAL_SECRET     = process.env.INTERNAL_SECRET     || 'plamev-internal';
const HISTORY_LIMIT       = 30;   // últimas N mensagens de histórico
const KB_CHAR_LIMIT       = 8000; // limite de chars de knowledge base injetados

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

// ── 1. Busca histórico de mensagens da conversa ativa ─────────
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

// ── 2. Carrega soul (system prompt) do agente ─────────────────
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

// ── 3. RAG: busca documentos relevantes em knowledge_base_docs ─
async function buscarKnowledge(agentSlug: string, texto: string): Promise<{ conteudo: string; fontes: string[] }> {
  try {
    // Resolve agent_id
    const { rows: ag } = await pool.query(
      'SELECT id FROM agentes WHERE slug=$1 LIMIT 1', [agentSlug]
    );
    if (!ag[0]) return { conteudo: '', fontes: [] };
    const agentId = ag[0].id;

    // Docs sempre ativos (identidade, regras absolutas, etc.)
    const { rows: sempre } = await pool.query(`
      SELECT titulo, arquivo, conteudo
      FROM knowledge_base_docs
      WHERE agent_id=$1 AND sempre_ativo=true AND ativo=true
      ORDER BY ordem
    `, [agentId]);

    // Docs relevantes via full-text search português
    const palavrasChave = texto.slice(0, 200); // limita a query
    const { rows: relevantes } = await pool.query(`
      SELECT titulo, arquivo, conteudo
      FROM knowledge_base_docs
      WHERE agent_id=$1 AND ativo=true AND sempre_ativo=false
        AND to_tsvector('portuguese', coalesce(titulo,'') || ' ' || coalesce(conteudo,''))
            @@ plainto_tsquery('portuguese', $2)
      ORDER BY ordem
      LIMIT 8
    `, [agentId, palavrasChave]).catch(() => ({ rows: [] }));

    const todos = [...sempre, ...relevantes];
    if (!todos.length) return { conteudo: '', fontes: [] };

    // Concatena até o limite de chars
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

  // ── ETAPA 1: Input Guard ──────────────────────────────────
  const guardResult = await checkInputGuard(msg);
  console.log(`${tag} [1/7] InputGuard → action=${guardResult.action} intent=${guardResult.intent} (${guardResult.latencyMs}ms)`);

  if (guardResult.action === 'drop') {
    console.log(`${tag} 🛑 Mensagem descartada pelo guard`);
    return;
  }
  if (guardResult.action === 'escalate') {
    console.log(`${tag} 🚨 Escalando para humano`);
    // TODO: notificar supervisor
    return;
  }

  // ── ETAPA 2: Carregar contexto em paralelo ────────────────
  const [soulPrompt, historico, kb] = await Promise.all([
    buscarSoul(msg.agentSlug || 'mari'),
    buscarHistorico(msg.phone, msg.canal),
    buscarKnowledge(msg.agentSlug || 'mari', msg.texto || ''),
  ]);

  console.log(`${tag} [2/7] Contexto | soul=${soulPrompt ? 'DB' : 'fallback'} | histórico=${historico.length}msgs | kb=${kb.fontes.length} docs (${kb.conteudo.length} chars)`);
  if (kb.fontes.length) console.log(`${tag}     KB fontes: ${kb.fontes.join(', ')}`);

  // ── ETAPA 3: Montar system prompt ─────────────────────────
  const baseSoul = soulPrompt ||
    `Você é a Mari, assistente virtual da Plamev, plano de saúde para pets. Seja simpática, objetiva e natural em português. Não se apresente se já há histórico de conversa.`;

  const systemPrompt = kb.conteudo
    ? `${baseSoul}\n\n# BASE DE CONHECIMENTO\n${kb.conteudo}`
    : baseSoul;

  // ── ETAPA 4: Montar messages com histórico ────────────────
  const messages: ChatMessage[] = [
    ...historico,
    { role: 'user', content: msg.texto || '' },
  ];

  console.log(`${tag} [3/7] Prompt montado | ${messages.length} msgs total (${systemPrompt.length} chars system)`);

  // ── ETAPA 5: Geração LLM ──────────────────────────────────
  const config = {
    id: 'agent123',
    org_id: 'org123',
    slug: msg.agentSlug || 'mari',
    nome: 'Mari',
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    guard_model: 'claude-haiku-4-5-20251001',
  };

  const t4 = Date.now();
  const generation = await generateResponse(systemPrompt, messages, config);
  console.log(`${tag} [4/7] LLM gerou em ${Date.now() - t4}ms | tokens_in=${generation?._uso?.input_tokens} out=${generation?._uso?.output_tokens}`);

  if (!generation) {
    console.warn(`${tag} ⚠️ Geração retornou null`);
    return;
  }

  // ── ETAPA 6: Output Guard ─────────────────────────────────
  const t5 = Date.now();
  const validation = await validateClaims(generation, systemPrompt, config.guard_model);
  console.log(`${tag} [5/7] OutputGuard → válido=${validation.isValid} (${Date.now() - t5}ms)${!validation.isValid ? ' | ' + validation.reason : ''}`);

  if (!validation.isValid) {
    generation.resposta = 'Deixa eu confirmar essa informação pra você, só um minutinho...';
  }

  const resposta = generation.resposta;
  if (!resposta) {
    console.warn(`${tag} ⚠️ Resposta vazia`);
    return;
  }

  // ── ETAPA 7: Enviar resposta ──────────────────────────────
  console.log(`${tag} [6/7] Enviando: "${resposta.substring(0, 80)}..."`);
  try {
    await postJson(
      `${CHANNEL_SERVICE_URL}/internal/send`,
      { message: msg, resposta },
      { 'x-internal-secret': INTERNAL_SECRET }
    );
    console.log(`${tag} ✅ Resposta entregue ao channel-service`);
  } catch (e: any) {
    console.error(`${tag} ❌ Falha ao entregar resposta: ${e.message}`);
  }

  // ── ETAPA 8: Persistir no CRM ─────────────────────────────
  try {
    await postJson(
      `${CRM_SERVICE_URL}/api/internal/salvar-interacao`,
      { message: msg, resposta },
      { 'x-internal-secret': INTERNAL_SECRET }
    );
    console.log(`${tag} [7/7] Persistido no CRM`);
  } catch (e: any) {
    console.error(`${tag} ❌ Falha ao salvar no CRM: ${e.message}`);
  }

  // ── Log de métricas ───────────────────────────────────────
  await logInteraction({
    thread_id: msg.phone,
    total_latency_ms: Date.now() - start,
    generation_tokens_in:  generation._uso?.input_tokens,
    generation_tokens_out: generation._uso?.output_tokens,
    generation_latency_ms: Date.now() - t4,
    provider: config.provider,
    model: config.model,
    rag_docs_count:      kb.fontes.length,
    rag_sources:         kb.fontes.join(', ') || null,
    kb_chars_injected:   kb.conteudo.length,
    history_msgs_count:  historico.length,
    input_guard_intent:  guardResult.intent,
    input_guard_action:  guardResult.action,
    was_rewritten:       !validation.isValid,
  });

  console.log(`${tag} ✅ Pipeline completo em ${Date.now() - start}ms`);
}
