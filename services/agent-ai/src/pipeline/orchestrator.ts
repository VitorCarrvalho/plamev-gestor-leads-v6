import https from 'https';
import http from 'http';
import { InternalMessage, GenerationResult } from '@plamev/shared';
import { checkInputGuard } from './guards/input-guard';
import { validateClaims } from './guards/output-guard';
import { logInteraction } from './interaction-logger';
import { generateResponse, ChatMessage } from '../clients/llm-client';

const CHANNEL_SERVICE_URL = process.env.CHANNEL_SERVICE_URL || 'http://channel-service.railway.internal:8080';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'plamev-internal';

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
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout ao enviar resposta')); });
    req.write(b);
    req.end();
  });
}

export async function processMessage(msg: InternalMessage) {
  const start = Date.now();
  console.log(`[ORCHESTRATOR] 🚀 Iniciando processamento para ${msg.phone}`);

  // 1. Input Guard
  const guardResult = await checkInputGuard(msg);
  if (guardResult.action === 'drop') {
    console.log(`[ORCHESTRATOR] 🛑 Mensagem descartada pelo Input Guard: ${guardResult.intent}`);
    return;
  }
  if (guardResult.action === 'escalate') {
    console.log(`[ORCHESTRATOR] 🚨 Escalonamento solicitado: ${guardResult.intent}`);
    return;
  }

  // 2. System prompt — usa soul do DB via agentSlug (futuro context-builder)
  const systemPrompt = `Você é a Mari, assistente virtual da Plamev, plano de saúde para pets. Seja simpática, objetiva e ajude o cliente. Responda de forma natural em português.`;

  // 3. Brain / Geração LLM
  const messages: ChatMessage[] = [{ role: 'user', content: msg.texto || '' }];
  const config = {
    id: 'agent123',
    org_id: 'org123',
    slug: msg.agentSlug || 'mari',
    nome: 'Mari',
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    guard_model: 'claude-haiku-4-5-20251001',
  };

  const generationStart = Date.now();
  const generation = await generateResponse(systemPrompt, messages, config);
  const generationLatency = Date.now() - generationStart;

  if (!generation) {
    console.warn(`[ORCHESTRATOR] ⚠️ Geração falhou ou retornou null`);
    return;
  }

  // 4. Output Guard
  const outputGuardStart = Date.now();
  const validation = await validateClaims(generation, systemPrompt, config.guard_model);
  const outputGuardLatency = Date.now() - outputGuardStart;

  if (!validation.isValid) {
    console.error(`[ORCHESTRATOR] 🚫 Alucinação detectada: ${validation.reason}`);
    generation.resposta = "Deixa eu confirmar essa informação pra você, só um minutinho...";
  }

  const resposta = generation.resposta;
  if (!resposta) {
    console.warn(`[ORCHESTRATOR] ⚠️ Resposta vazia, ignorando`);
    return;
  }

  console.log(`[ORCHESTRATOR] 💬 Enviando resposta: "${resposta.substring(0, 60)}..."`);

  // 5. Enviar resposta via channel-service
  try {
    await postJson(
      `${CHANNEL_SERVICE_URL}/internal/send`,
      { message: msg, resposta },
      { 'x-internal-secret': INTERNAL_SECRET }
    );
    console.log(`[ORCHESTRATOR] ✅ Resposta entregue ao channel-service`);
  } catch (sendErr: any) {
    console.error(`[ORCHESTRATOR] ❌ Falha ao entregar resposta: ${sendErr.message}`);
  }

  // 6. Log de métricas
  await logInteraction({
    thread_id: msg.phone,
    total_latency_ms: Date.now() - start,
    generation_tokens_in: generation._uso?.input_tokens,
    generation_tokens_out: generation._uso?.output_tokens,
    provider: config.provider,
    model: config.model,
  });

  console.log(`[ORCHESTRATOR] ✅ Processamento concluído em ${Date.now() - start}ms`);
}
