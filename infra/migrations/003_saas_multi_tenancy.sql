-- Habilitar pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Multi-tenancy: tabela de organizações
CREATE TABLE organizations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       TEXT UNIQUE NOT NULL,
  nome       TEXT NOT NULL,
  ativo      BOOLEAN DEFAULT true,
  criado_em  TIMESTAMPTZ DEFAULT now()
);

-- Inserir organização default (migração de dados)
INSERT INTO organizations (id, slug, nome) VALUES ('00000000-0000-0000-0000-000000000000', 'plamev', 'Plamev Vendas');

-- Adicionar org_id nas tabelas principais
ALTER TABLE agentes ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) DEFAULT '00000000-0000-0000-0000-000000000000';

-- Config multi-provider por agente
ALTER TABLE agentes
  ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'anthropic',
  ADD COLUMN IF NOT EXISTS model TEXT DEFAULT 'claude-haiku-4-5',
  ADD COLUMN IF NOT EXISTS api_key_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS guard_model TEXT DEFAULT 'claude-haiku-4-5';

-- RAG: base de conhecimento com embeddings
CREATE TABLE knowledge_chunks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID REFERENCES organizations(id),
  agent_id   INT REFERENCES agentes(id),
  content    TEXT NOT NULL,
  embedding  vector(1024),
  metadata   JSONB DEFAULT '{}',
  source     TEXT,
  criado_em  TIMESTAMPTZ DEFAULT now()
);
-- CREATE INDEX ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Logs de interação IA
CREATE TABLE ai_interaction_logs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID REFERENCES organizations(id),
  agent_id                INT REFERENCES agentes(id),
  thread_id               TEXT NOT NULL,
  input_guard_tokens_in   INTEGER,
  input_guard_tokens_out  INTEGER,
  generation_tokens_in    INTEGER,
  generation_tokens_out   INTEGER,
  output_guard_tokens_in  INTEGER,
  output_guard_tokens_out INTEGER,
  estimated_cost_usd      NUMERIC(10,6),
  input_guard_latency_ms  INTEGER,
  rag_latency_ms          INTEGER,
  generation_latency_ms   INTEGER,
  output_guard_latency_ms INTEGER,
  total_latency_ms        INTEGER,
  input_guard_intent      TEXT,
  input_guard_action      TEXT,
  output_guard_action     TEXT,
  output_guard_score      NUMERIC(4,3),
  was_rewritten           BOOLEAN DEFAULT false,
  provider                TEXT,
  model                   TEXT,
  system_prompt_hash      TEXT,
  tool_cycles             INTEGER DEFAULT 0,
  criado_em               TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_logs_org     ON ai_interaction_logs(org_id);
CREATE INDEX idx_logs_agent   ON ai_interaction_logs(agent_id);
CREATE INDEX idx_logs_thread  ON ai_interaction_logs(thread_id);
CREATE INDEX idx_logs_created ON ai_interaction_logs(criado_em);
CREATE INDEX idx_logs_cost    ON ai_interaction_logs(estimated_cost_usd);
