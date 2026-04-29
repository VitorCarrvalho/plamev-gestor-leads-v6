-- Migration 016: Habilita pgvector e índice ivfflat para RAG vetorial
-- Deve rodar no mesmo banco que o CRM (DATABASE_URL compartilhada)

-- 1. Extensão pgvector (idempotente)
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Garante que knowledge_chunks existe com a coluna correta
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID REFERENCES organizations(id),
  agent_id   INT REFERENCES agentes(id),
  content    TEXT NOT NULL,
  embedding  vector(1024),
  metadata   JSONB DEFAULT '{}',
  source     TEXT,
  criado_em  TIMESTAMPTZ DEFAULT now()
);

-- 3. Índice ivfflat para busca por cosine similarity (comentado na 003 — agora ativo)
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding
  ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- 4. Índice auxiliar para filtro por org/agent
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_agent
  ON knowledge_chunks (org_id, agent_id);

-- 5. (índice FTS em knowledge_base_docs movido para migration 017)
