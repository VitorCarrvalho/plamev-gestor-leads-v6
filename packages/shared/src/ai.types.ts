export interface AgentConfig {
  id: string;
  org_id: string;
  slug: string;
  nome: string;
  provider: string;
  model: string;
  guard_model: string;
}

export interface RagResult {
  text: string;
  source: string;
  score: number;
}

export interface GenerationResult {
  resposta: string | null;
  etapa: string;
  dados_extraidos: Record<string, any>;
  acoes: string[];
  _uso?: { input_tokens: number; output_tokens: number };
}

export interface InteractionMetrics {
  thread_id: string;
  input_guard_tokens_in?: number;
  input_guard_tokens_out?: number;
  generation_tokens_in?: number;
  generation_tokens_out?: number;
  output_guard_tokens_in?: number;
  output_guard_tokens_out?: number;
  estimated_cost_usd?: number;
  total_latency_ms?: number;
  provider?: string;
  model?: string;
}
