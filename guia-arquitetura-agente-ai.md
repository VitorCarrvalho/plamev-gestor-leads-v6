# Guia de implementação — Agente AI multi-tenant com guardrails

Este documento descreve a arquitetura completa de um agente conversacional AI para WhatsApp, com guardrails de entrada/saída, RAG com reranking, suporte multi-provider e observabilidade. O objetivo é servir como referência prática para implementar o sistema do zero.

---

## Visão geral da arquitetura

O sistema é um pipeline em camadas com defesa em profundidade. Cada mensagem do WhatsApp passa por uma sequência de estágios antes da resposta ser enviada:

```
Mensagem (WhatsApp/Twilio/EvolutionAPI)
    ↓
Message Batch Processor (Inngest, debounce 5s)
    ↓
Input Guard (regex + LLM classifier)
    ↓           ↓ (em paralelo)
RAG Retrieval   LLM Generation (até 5 ciclos tool use)
    ↓
Output Guard (validação de claims)
    ↓
Interaction Logger (async, fire-and-forget)
    ↓
Resposta final (WhatsApp via Twilio/EvolutionAPI)
```

### Stack tecnológica

- **Runtime**: Node.js / TypeScript
- **Banco de dados**: Supabase (Postgres + RLS)
- **Queue/Orchestration**: Inngest
- **Messaging**: Twilio/EvolutionAPI (WhatsApp)
- **Embeddings**: Voyage AI 3 (1024 dimensões)
- **Reranking**: Voyage AI Rerank-2
- **LLM Providers**: Anthropic, OpenAI, Google (multi-tenant, cada org escolhe)

---

## 1. Message batch processor

**Arquivo**: `process-message-batch.ts`

O ponto de entrada do sistema. Recebe webhooks do Twilio/EvolutionAPI via Inngest e agrupa mensagens por thread.

### Comportamento

- **Debounce de 5s por thread**: se o usuário manda 3 mensagens seguidas, espera 5s após a última antes de processar. Evita gerar 3 respostas separadas.
- **Validação multi-tenant**: verifica se a org existe, se o agente está ativo, e carrega as configs (provider, modelo, API key).
- **Typing indicator**: envia o indicador de "digitando" no WhatsApp enquanto processa.
- **Handling de botões**: trata respostas de botões interativos do WhatsApp (quick replies).

### Implementação

```typescript
// Pseudocódigo do fluxo principal
export const processMessageBatch = inngest.createFunction(
  {
    id: "process-message-batch",
    debounce: { key: "event.data.threadId", period: "5s" },
  },
  { event: "whatsapp/message.received" },
  async ({ event, step }) => {
    // 1. Validar tenant e carregar config
    const config = await step.run("load-config", () =>
      loadTenantConfig(event.data.orgId)
    );

    // 2. Enviar typing indicator
    await step.run("typing", () =>
      sendTypingIndicator(event.data.threadId)
    );

    // 3. Executar pipeline
    const result = await step.run("pipeline", () =>
      executePipeline(event.data.messages, config)
    );

    // 4. Enviar resposta via Twilio/EvolutionAPI
    await step.run("send", () =>
      sendWhatsAppMessage(event.data.threadId, result.response)
    );
  }
);
```

---

## 2. Input guard

**Arquivo**: `input-guard.ts`

Primeira camada de defesa. Classifica a intenção da mensagem e decide o que fazer antes de gastar tokens com RAG ou geração.

### Camada 1 — Regex rápido (sem LLM)

Roda antes de qualquer chamada de API. Custo zero de tokens.

**Prompt injection**: patterns regex que detectam tentativas conhecidas de injection (ex: "ignore previous instructions", "you are now", "system prompt", etc.).

**Resposta de nome**: detecta quando o usuário simplesmente respondeu com um nome (ex: após ser perguntado "qual seu nome?"). Não precisa de RAG.

```typescript
// Exemplo de patterns de regex
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /you\s+are\s+now\s+/i,
  /system\s*prompt/i,
  /\bDAN\b/,
  /act\s+as\s+(if\s+)?you/i,
];

const NAME_RESPONSE_PATTERN = /^[A-ZÀ-Ú][a-zà-ú]+(\s[A-ZÀ-Ú][a-zà-ú]+){0,3}$/;

function regexGuard(message: string): GuardResult | null {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(message)) {
      return { action: "block", reason: "prompt_injection_regex" };
    }
  }
  if (NAME_RESPONSE_PATTERN.test(message.trim())) {
    return { action: "skip_rag", reason: "name_response" };
  }
  return null; // sem match, segue pra camada 2
}
```

### Camada 2 — Classificação LLM

Se o regex não pegou nada, chama o modelo de guard (modelo leve: Haiku, GPT-4o-mini, ou Gemini Flash) para classificar a mensagem em 1 de 10 intents:

| Intent | Ação |
|---|---|
| `product_question` | Prossegue (pipeline completo) |
| `objection` | Prossegue |
| `pricing` | Prossegue |
| `scheduling` | Prossegue |
| `greeting` | Pula RAG |
| `farewell` | Pula RAG |
| `acknowledgment` | Pula RAG |
| `prompt_injection` | Bloqueia |
| `off_topic` | Escala para humano |
| `complaint` | Escala para humano |

### Timeout e fail-open

```typescript
const GUARD_TIMEOUT_MS = 2000;

async function inputGuard(message: string, config: AgentConfig): Promise<GuardResult> {
  // Camada 1: regex
  const regexResult = regexGuard(message);
  if (regexResult) return regexResult;

  // Camada 2: LLM com timeout
  try {
    const result = await Promise.race([
      classifyIntent(message, config),
      timeout(GUARD_TIMEOUT_MS),
    ]);
    return result;
  } catch {
    // Fail-open: se timeout, prossegue
    return { action: "proceed", reason: "guard_timeout" };
  }
}
```

**Filosofia**: melhor responder com possível imprecisão do que deixar o cliente sem resposta.

---

## 3. RAG — Retrieval-Augmented Generation

**Arquivo**: `rag.ts`

Busca híbrida com embedding + reranking para encontrar o conhecimento mais relevante.

### Pipeline de busca

```
Query do usuário
    ↓
Embedding (Voyage AI 3, 1024 dims)
    ↓
Busca vetorial (30 candidatos)
    ↓
Reranking (Voyage AI Rerank-2)
    ↓
Top 5 chunks (threshold 0.30)
```

### Detalhes

- **Embedding model**: Voyage AI 3 com 1024 dimensões
- **Candidatos iniciais**: 30 resultados da busca vetorial
- **Reranking**: Voyage AI Rerank-2 reordena os 30 candidatos por relevância
- **Top K**: 5 chunks finais enviados pro LLM
- **Threshold normal**: 0.30 (score mínimo de relevância)
- **Threshold emergência**: 0.20 (usado quando nenhum chunk passa o threshold normal)
- **Detecção multi-produto**: mapeamento de aliases em português para identificar qual produto o usuário está perguntando sobre

### Skip inteligente

O RAG é pulado automaticamente para intents que não precisam de conhecimento:

- `greeting` ("oi", "bom dia")
- `acknowledgment` ("ok", "entendi")
- `farewell` ("obrigado", "tchau")

Isso economiza chamadas de API do Voyage AI e reduz latência.

```typescript
const SKIP_RAG_INTENTS = ["greeting", "acknowledgment", "farewell"];

async function retrieveContext(
  query: string,
  intent: string,
  orgId: string
): Promise<RagResult> {
  if (SKIP_RAG_INTENTS.includes(intent)) {
    return { chunks: [], skipped: true, reason: "intent_skip" };
  }

  // 1. Gerar embedding
  const embedding = await voyageEmbed(query);

  // 2. Buscar candidatos
  const candidates = await supabase.rpc("match_documents", {
    query_embedding: embedding,
    match_count: 30,
    filter_org: orgId,
  });

  // 3. Rerankar
  const reranked = await voyageRerank(query, candidates);

  // 4. Filtrar por threshold
  const threshold = reranked[0]?.score >= 0.30 ? 0.30 : 0.20;
  const topChunks = reranked
    .filter((c) => c.score >= threshold)
    .slice(0, 5);

  return { chunks: topChunks, skipped: false };
}
```

### Detecção multi-produto

O sistema suporta múltiplos produtos/serviços por organização. Aliases em português mapeiam para product IDs:

```typescript
const PRODUCT_ALIASES: Record<string, string> = {
  "visto t": "visa-t",
  "visto de trabalho": "visa-t",
  "green card": "green-card",
  "cidadania": "citizenship",
  "asilo": "asylum",
  // ...
};
```

Isso permite filtrar os chunks do RAG por produto, aumentando a precisão.

---

## 4. LLM Generation — Multi-provider

**Arquivo**: `generation-client.ts`

Geração da resposta principal com suporte a 3 providers e tool use.

### Providers suportados

| Provider | SDK | Modelo padrão |
|---|---|---|
| Anthropic | `@anthropic-ai/sdk` | `claude-haiku-4-5` |
| OpenAI | `openai` | `gpt-4o-mini` |
| Google | `@google/generative-ai` | `gemini-2.5-flash` |

### Abstração unificada

Dois clientes abstraídos:

- **`llm-client.ts`**: usado pelos guards (input e output). Precisa ser rápido e barato.
- **`generation-client.ts`**: usado pela geração principal. Suporta tool use, system prompts longos, e contexto do RAG.

```typescript
interface LLMClient {
  generate(params: {
    model: string;
    systemPrompt: string;
    messages: Message[];
    tools?: Tool[];
    maxTokens?: number;
  }): Promise<LLMResponse>;
}

// Factory que retorna o client correto baseado na config da org
function createLLMClient(provider: "anthropic" | "openai" | "google", apiKey: string): LLMClient {
  switch (provider) {
    case "anthropic": return new AnthropicClient(apiKey);
    case "openai": return new OpenAIClient(apiKey);
    case "google": return new GoogleClient(apiKey);
  }
}
```

### Tool use

O sistema suporta até 5 ciclos de tool use por interação. Isso permite que o agente:

- Consulte informações em tempo real
- Agende compromissos
- Busque status de processos
- Execute ações no CRM

```typescript
const MAX_TOOL_CYCLES = 5;

async function generateResponse(
  messages: Message[],
  ragChunks: Chunk[],
  config: AgentConfig
): Promise<GenerationResult> {
  const client = createLLMClient(config.provider, config.apiKey);
  let response: LLMResponse;
  let toolCycles = 0;

  do {
    response = await client.generate({
      model: config.model,
      systemPrompt: buildSystemPrompt(config, ragChunks),
      messages,
      tools: config.tools,
    });

    if (response.hasToolUse) {
      const toolResult = await executeToolCall(response.toolCall);
      messages.push(
        { role: "assistant", content: response.raw },
        { role: "user", content: toolResult }
      );
      toolCycles++;
    }
  } while (response.hasToolUse && toolCycles < MAX_TOOL_CYCLES);

  return { text: response.text, tokensUsed: response.usage, toolCycles };
}
```

### Config multi-tenant

Cada organização define seu provider, modelo e API key:

```sql
-- Tabela ai_agents (migration 001)
ALTER TABLE ai_agents ADD COLUMN provider TEXT DEFAULT 'anthropic';
ALTER TABLE ai_agents ADD COLUMN model TEXT DEFAULT 'claude-haiku-4-5';
ALTER TABLE ai_agents ADD COLUMN api_key TEXT; -- encrypted
```

---

## 5. Output guard

**Arquivo**: `output-guard.ts`

Última camada antes do envio. Valida se a resposta do LLM tem base no conhecimento do RAG.

### Processo de validação

1. **Decomposição**: quebra a resposta em claims factuais individuais
2. **Validação cruzada**: compara cada claim contra os chunks do RAG
3. **Score de groundedness**: calcula o % de claims fundamentadas
4. **Decisão**:
   - **>50% sem base** → escala para humano
   - **Parcialmente sem base** → reescreve automaticamente (remove claims sem fundamento)
   - **Tudo fundamentado** → envia direto

```typescript
const OUTPUT_GUARD_TIMEOUT_MS = 3000;
const HALLUCINATION_THRESHOLD = 0.5; // 50%

async function outputGuard(
  response: string,
  ragChunks: Chunk[],
  config: AgentConfig
): Promise<OutputGuardResult> {
  try {
    const result = await Promise.race([
      validateClaims(response, ragChunks, config),
      timeout(OUTPUT_GUARD_TIMEOUT_MS),
    ]);

    const ungroundedRatio = result.ungroundedClaims / result.totalClaims;

    if (ungroundedRatio > HALLUCINATION_THRESHOLD) {
      return { action: "escalate", reason: "hallucination_detected", score: ungroundedRatio };
    }

    if (result.ungroundedClaims > 0) {
      const rewritten = await rewriteResponse(response, result.groundedClaims);
      return { action: "rewrite", response: rewritten, score: ungroundedRatio };
    }

    return { action: "send", response, score: 0 };
  } catch {
    // Fail-open: se timeout, envia direto
    return { action: "send", response, reason: "guard_timeout" };
  }
}
```

### Validação de claims

```typescript
async function validateClaims(
  response: string,
  chunks: Chunk[],
  config: AgentConfig
): Promise<ValidationResult> {
  const client = createLLMClient(config.provider, config.apiKey);

  // Pede pro LLM decompor a resposta em claims e validar cada uma
  const result = await client.generate({
    model: config.guardModel,
    systemPrompt: `Decompose the following response into individual factual claims.
For each claim, determine if it is supported by the provided context chunks.
Return JSON: { claims: [{ text: string, grounded: boolean }] }`,
    messages: [
      {
        role: "user",
        content: `Response: ${response}\n\nContext chunks:\n${chunks.map(c => c.text).join("\n---\n")}`,
      },
    ],
  });

  const parsed = JSON.parse(result.text);
  return {
    totalClaims: parsed.claims.length,
    groundedClaims: parsed.claims.filter((c: any) => c.grounded),
    ungroundedClaims: parsed.claims.filter((c: any) => !c.grounded).length,
  };
}
```

---

## 6. Interaction logger

**Arquivo**: `interaction-logger.ts`

Registra métricas de cada interação de forma assíncrona (fire-and-forget).

### O que registra

- **Tokens**: contagem por estágio (input guard, geração, output guard)
- **Custo estimado**: cálculo baseado no pricing de cada provider/modelo
- **Latência**: tempo de cada etapa do pipeline
- **Resultados dos guards**: intent classificado, ação tomada, score de groundedness
- **System prompt hash**: SHA-256 do prompt (não armazena o texto completo)
- **Flags de rewrite**: se o output guard reescreveu a resposta

### Tabela no Supabase

```sql
-- Migration 002
CREATE TABLE ai_interaction_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id),
  agent_id UUID REFERENCES ai_agents(id),
  thread_id TEXT NOT NULL,

  -- Métricas de tokens
  input_guard_tokens_in INTEGER,
  input_guard_tokens_out INTEGER,
  generation_tokens_in INTEGER,
  generation_tokens_out INTEGER,
  output_guard_tokens_in INTEGER,
  output_guard_tokens_out INTEGER,

  -- Custo
  estimated_cost_usd NUMERIC(10, 6),

  -- Latência (ms)
  input_guard_latency_ms INTEGER,
  rag_latency_ms INTEGER,
  generation_latency_ms INTEGER,
  output_guard_latency_ms INTEGER,
  total_latency_ms INTEGER,

  -- Guard results
  input_guard_intent TEXT,
  input_guard_action TEXT,
  output_guard_action TEXT,
  output_guard_score NUMERIC(4, 3),
  was_rewritten BOOLEAN DEFAULT FALSE,

  -- Provider info
  provider TEXT,
  model TEXT,
  system_prompt_hash TEXT,

  -- Tool use
  tool_cycles INTEGER DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 8 indexes para queries rápidas
CREATE INDEX idx_logs_org ON ai_interaction_logs(org_id);
CREATE INDEX idx_logs_agent ON ai_interaction_logs(agent_id);
CREATE INDEX idx_logs_thread ON ai_interaction_logs(thread_id);
CREATE INDEX idx_logs_created ON ai_interaction_logs(created_at);
CREATE INDEX idx_logs_intent ON ai_interaction_logs(input_guard_intent);
CREATE INDEX idx_logs_action ON ai_interaction_logs(input_guard_action);
CREATE INDEX idx_logs_cost ON ai_interaction_logs(estimated_cost_usd);
CREATE INDEX idx_logs_provider ON ai_interaction_logs(provider);

-- RLS
ALTER TABLE ai_interaction_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orgs see own logs"
  ON ai_interaction_logs FOR SELECT
  USING (org_id = auth.jwt() ->> 'org_id');
```

### Logger assíncrono

```typescript
// Fire-and-forget — não bloqueia a resposta
function logInteraction(metrics: InteractionMetrics): void {
  supabase
    .from("ai_interaction_logs")
    .insert({
      org_id: metrics.orgId,
      agent_id: metrics.agentId,
      thread_id: metrics.threadId,
      input_guard_tokens_in: metrics.inputGuard.tokensIn,
      input_guard_tokens_out: metrics.inputGuard.tokensOut,
      generation_tokens_in: metrics.generation.tokensIn,
      generation_tokens_out: metrics.generation.tokensOut,
      estimated_cost_usd: calculateCost(metrics),
      input_guard_intent: metrics.inputGuard.intent,
      input_guard_action: metrics.inputGuard.action,
      output_guard_action: metrics.outputGuard.action,
      output_guard_score: metrics.outputGuard.score,
      was_rewritten: metrics.outputGuard.wasRewritten,
      provider: metrics.provider,
      model: metrics.model,
      system_prompt_hash: hashSHA256(metrics.systemPrompt),
      tool_cycles: metrics.toolCycles,
      total_latency_ms: metrics.totalLatency,
    })
    .then(() => {}) // fire-and-forget
    .catch((err) => console.error("Log failed:", err));
}
```

### Cálculo de custo

```typescript
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 0.80, output: 4.00 }, // por 1M tokens
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "gemini-2.5-flash": { input: 0.15, output: 0.60 },
};

function calculateCost(metrics: InteractionMetrics): number {
  const pricing = PRICING[metrics.model];
  if (!pricing) return 0;

  const totalIn = (metrics.inputGuard.tokensIn ?? 0)
    + (metrics.generation.tokensIn ?? 0)
    + (metrics.outputGuard.tokensIn ?? 0);

  const totalOut = (metrics.inputGuard.tokensOut ?? 0)
    + (metrics.generation.tokensOut ?? 0)
    + (metrics.outputGuard.tokensOut ?? 0);

  return (totalIn * pricing.input + totalOut * pricing.output) / 1_000_000;
}
```

---

## 7. Testes

**57+ testes** cobrindo todo o sistema:

### `guards.test.ts`

- Regex detecta patterns de prompt injection
- Regex detecta respostas de nome
- LLM classifica corretamente cada um dos 10 intents
- Timeout de 2s funciona e faz fail-open
- Output guard detecta claims sem fundamento
- Output guard reescreve respostas parcialmente alucinadas
- Timeout de 3s no output guard faz fail-open

### `multi-provider.test.ts`

- Paridade de comportamento entre Anthropic, OpenAI e Google
- Cada provider retorna o formato esperado
- Tool use funciona em todos os providers
- Fallback quando provider está indisponível

### `e2e-scenarios.test.ts`

- Mensagem simples → resposta completa (pipeline inteiro)
- Prompt injection → bloqueio
- Greeting → pula RAG, responde direto
- Pergunta sobre produto → RAG + geração + validação
- Alucinação detectada → escalação para humano
- Timeout nos guards → fail-open
- Múltiplas mensagens → debounce funciona

---

## 8. Decisões de design

### Por que fail-open nos guards?

No contexto de atendimento via WhatsApp, o pior cenário é o cliente ficar sem resposta. Um guard que falha silenciosamente e deixa a mensagem passar é preferível a um que bloqueia o pipeline inteiro. O logging registra quando isso acontece para monitoramento.

### Por que reranking depois do embedding?

Embeddings são bons pra recall (encontrar candidatos), mas não tão bons pra precision (ordenar por relevância real). O reranking com Voyage Rerank-2 olha pra semântica mais profunda e reordena os 30 candidatos, resultando em top 5 muito mais preciso.

### Por que multi-provider?

Cada org pode ter preferências ou restrições diferentes (preço, compliance, qualidade). O sistema abstrai o provider completamente — trocar de Claude pra GPT é mudar uma coluna no banco.

### Por que debounce de 5s?

Usuários de WhatsApp frequentemente mandam várias mensagens curtas em sequência. Sem debounce, cada mensagem geraria uma resposta separada, desperdiçando tokens e criando uma experiência ruim.

---

## Checklist de implementação

- [ ] Configurar Supabase com as 2 migrations (provider config + logs)
- [ ] Implementar `llm-client.ts` com abstração para os 3 providers
- [ ] Implementar `generation-client.ts` com tool use loop
- [ ] Implementar `input-guard.ts` (regex + LLM classifier)
- [ ] Implementar `output-guard.ts` (decomposição + validação de claims)
- [ ] Implementar `rag.ts` (Voyage AI embed + rerank)
- [ ] Implementar `interaction-logger.ts` (async logging)
- [ ] Implementar `process-message-batch.ts` (Inngest function)
- [ ] Configurar Twilio/EvolutionAPI webhook → Inngest
- [ ] Configurar Voyage AI (API key para embed + rerank)
- [ ] Popular base de conhecimento com chunks + embeddings
- [ ] Escrever testes (guards, multi-provider, e2e)
- [ ] Deploy e monitoramento
