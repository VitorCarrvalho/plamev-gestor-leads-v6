import https from 'https';
import http from 'http';
import { InternalMessage } from '@plamev/shared';
import { pool } from './rag';
import { checkInputGuard } from './guards/input-guard';
import { validateClaims } from './guards/output-guard';
import { logInteraction } from './interaction-logger';
import { generateResponse, ChatMessage } from '../clients/llm-client';

const CHANNEL_SERVICE_URL = process.env.CHANNEL_SERVICE_URL || 'http://channel-service.railway.internal:8080';
const CRM_SERVICE_URL = process.env.CRM_SERVICE_URL || 'http://crm-service.railway.internal:8080';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'plamev-internal';
const HISTORY_LIMIT = 30; // últimas N mensagens como contexto

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

async function buscarHistorico(phone: string, canal: string): Promise<ChatMessage[]> {
  try {
    const { rows } = await pool.query(`
      SELECT m.role, m.conteudo, m.enviado_por
      FROM mensagens m
      JOIN conversas c ON c.id = m.conversa_id
      WHERE c.numero_externo = $1
        AND c.canal = $2
        AND c.status = 'ativa'
        AND m.role IN ('user', 'agent')
      ORDER BY m.timestamp DESC
      LIMIT $3
    `, [phone, canal, HISTORY_LIMIT]);

    // Retorna em ordem cronológica (mais antigo primeiro)
    return rows.reverse().map((r: any) => ({
      role: r.role === 'agent' ? 'assistant' : 'user',
      content: r.conteudo,
    } as ChatMessage));
  } catch (e: any) {
    console.warn(`[ORCHESTRATOR] ⚠️ Falha ao buscar histórico: ${e.message}`);
    return [];
  }
}

async function buscarSoulAgente(agentSlug: string): Promise<string | null> {
  try {
    const { rows } = await pool.query(`
      SELECT ap.conteudo
      FROM agente_prompts ap
      JOIN agentes a ON a.id = ap.agent_id
      WHERE a.slug = $1 AND ap.tipo = 'soul' AND ap.ativo = true
      LIMIT 1
    `, [agentSlug]);
    return rows[0]?.conteudo || null;
  } catch {
    return null;
  }
}

export async function processMessage(msg: InternalMessage) {
  const start = Date.now();
  console.log(`[ORCHESTRATOR] 🚀 Iniciando processamento para ${msg.phone}`);

  // 1. Input Guard
  const guardResult = await checkInputGuard(msg);
  if (guardResult.action === 'drop') {
    console.log(`[ORCHESTRATOR] 🛑 Mensagem descartada: ${guardResult.intent}`);
    return;
  }
  if (guardResult.action === 'escalate') {
    console.log(`[ORCHESTRATOR] 🚨 Escalonamento: ${guardResult.intent}`);
    return;
  }

  // 2. Buscar soul do agente e histórico em paralelo
  const [soulPrompt, historico] = await Promise.all([
    buscarSoulAgente(msg.agentSlug || 'mari'),
    buscarHistorico(msg.phone, msg.canal),
  ]);

  const systemPrompt = soulPrompt ||
    `Você é a Mari, assistente virtual da Plamev, plano de saúde para pets. Seja simpática, objetiva e ajude o cliente. Responda de forma natural em português. Não se apresente se já tiver contexto de conversa anterior.`;

  console.log(`[ORCHESTRATOR] 📜 Histórico: ${historico.length} msgs | Soul: ${soulPrompt ? 'DB' : 'fallback'}`);

  // 3. Monta messages com histórico + mensagem atual
  const textoAtual = msg.texto || '';
  const messages: ChatMessage[] = [
    ...historico,
    { role: 'user', content: textoAtual },
  ];

  const config = {
    id: 'agent123',
    org_id: 'org123',
    slug: msg.agentSlug || 'mari',
    nome: 'Mari',
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    guard_model: 'claude-haiku-4-5-20251001',
  };

  // 4. Geração LLM
  const generationStart = Date.now();
  const generation = await generateResponse(systemPrompt, messages, config);
  const generationLatency = Date.now() - generationStart;

  if (!generation) {
    console.warn(`[ORCHESTRATOR] ⚠️ Geração falhou`);
    return;
  }

  // 5. Output Guard
  const outputGuardStart = Date.now();
  const validation = await validateClaims(generation, systemPrompt, config.guard_model);
  const outputGuardLatency = Date.now() - outputGuardStart;

  if (!validation.isValid) {
    console.error(`[ORCHESTRATOR] 🚫 Alucinação detectada: ${validation.reason}`);
    generation.resposta = 'Deixa eu confirmar essa informação pra você, só um minutinho...';
  }

  const resposta = generation.resposta;
  if (!resposta) {
    console.warn(`[ORCHESTRATOR] ⚠️ Resposta vazia`);
    return;
  }

  console.log(`[ORCHESTRATOR] 💬 Resposta (${generationLatency}ms): "${resposta.substring(0, 60)}..."`);

  // 6. Enviar via channel-service
  try {
    await postJson(
      `${CHANNEL_SERVICE_URL}/internal/send`,
      { message: msg, resposta },
      { 'x-internal-secret': INTERNAL_SECRET }
    );
    console.log(`[ORCHESTRATOR] ✅ Resposta entregue`);
  } catch (sendErr: any) {
    console.error(`[ORCHESTRATOR] ❌ Falha ao entregar: ${sendErr.message}`);
  }

  // 7. Persiste no CRM
  try {
    await postJson(
      `${CRM_SERVICE_URL}/api/internal/salvar-interacao`,
      { message: msg, resposta },
      { 'x-internal-secret': INTERNAL_SECRET }
    );
  } catch (crmErr: any) {
    console.error(`[ORCHESTRATOR] ❌ Falha ao salvar no CRM: ${crmErr.message}`);
  }

  // 8. Log de métricas
  await logInteraction({
    thread_id: msg.phone,
    total_latency_ms: Date.now() - start,
    generation_tokens_in: generation._uso?.input_tokens,
    generation_tokens_out: generation._uso?.output_tokens,
    provider: config.provider,
    model: config.model,
  });

  console.log(`[ORCHESTRATOR] ✅ Concluído em ${Date.now() - start}ms`);
}
