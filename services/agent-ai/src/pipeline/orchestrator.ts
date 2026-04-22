import { InternalMessage, GenerationResult } from '@plamev/shared';
import { checkInputGuard } from './guards/input-guard';
import { validateClaims } from './guards/output-guard';
import { logInteraction } from './interaction-logger';
import { searchKnowledge } from './rag';
import { generateResponse, ChatMessage } from '../clients/llm-client';

export async function processMessage(msg: InternalMessage) {
  const start = Date.now();
  console.log(`[ORCHESTRATOR] 🚀 Iniciando processamento para ${msg.phone}`);

  // 1. Input Guard (Classificação e bloqueios rápidos)
  const guardResult = await checkInputGuard(msg);
  if (guardResult.action === 'drop') {
    console.log(`[ORCHESTRATOR] 🛑 Mensagem descartada pelo Input Guard: ${guardResult.intent}`);
    return;
  }
  if (guardResult.action === 'escalate') {
    console.log(`[ORCHESTRATOR] 🚨 Escalonamento solicitado: ${guardResult.intent}`);
    // TODO: Adicionar lógica de escalonamento para humano (crm-service)
    return;
  }

  // 2. Mock de Contexto / Decisão (Será substituído pelos módulos migrados)
  // TODO: Integrar context-builder e decisor.ts reais
  const systemPrompt = `Você é a Mari, assistente da Plamev. Responda em JSON compacto. Exemplo: {"r":"sua resposta","e":"acolhimento","d":{}}`;
  
  // 3. RAG (Busca de contexto adicional se aplicável)
  // TODO: RAG com Voyage (depende de termos um orgId/agentId válidos)
  // const ragContext = await searchKnowledge(msg.texto, 'org123', 'agent123');

  // 4. Brain / Geração LLM
  const messages: ChatMessage[] = [{ role: 'user', content: msg.texto }];
  const config = {
    id: 'agent123',
    org_id: 'org123',
    slug: msg.agentSlug,
    nome: 'Mari',
    provider: 'anthropic',
    model: 'claude-3-5-haiku-20241022',
    guard_model: 'claude-3-5-haiku-20241022'
  };

  const generationStart = Date.now();
  const generation = await generateResponse(systemPrompt, messages, config);
  const generationLatency = Date.now() - generationStart;

  if (!generation) {
    console.warn(`[ORCHESTRATOR] ⚠️ Geração falhou ou retornou null`);
    return;
  }

  // 5. Output Guard (Validação de claims/preços)
  const outputGuardStart = Date.now();
  const validation = await validateClaims(generation, systemPrompt, config.guard_model);
  const outputGuardLatency = Date.now() - outputGuardStart;

  if (!validation.isValid) {
    console.error(`[ORCHESTRATOR] 🚫 Alucinação detectada: ${validation.reason}`);
    // Fallback: mensagem padrão de erro/atraso
    generation.resposta = "Deixa eu confirmar essa informação pra você, só um minutinho...";
  }

  // 6. Enviar resposta de volta ao Gateway/Channel Service
  // TODO: Fazer requisição POST para o channel-service /internal/send
  console.log(`[ORCHESTRATOR] 💬 Resposta a enviar: ${generation.resposta}`);

  // 7. Salvar métricas e log
  await logInteraction({
    thread_id: msg.phone,
    input_guard_latency_ms: guardResult.latencyMs,
    generation_latency_ms: generationLatency,
    output_guard_latency_ms: outputGuardLatency,
    total_latency_ms: Date.now() - start,
    generation_tokens_in: generation._uso?.input_tokens,
    generation_tokens_out: generation._uso?.output_tokens,
    provider: config.provider,
    model: config.model
  });

  console.log(`[ORCHESTRATOR] ✅ Processamento concluído em ${Date.now() - start}ms`);
}
