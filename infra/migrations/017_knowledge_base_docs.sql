-- Migration 017: Garante que knowledge_base_docs existe neste banco
-- Usa IF NOT EXISTS em tudo — seguro mesmo se a tabela já existir em outro DB

CREATE TABLE IF NOT EXISTS knowledge_base_docs (
  id            SERIAL PRIMARY KEY,
  agent_id      INT NOT NULL REFERENCES agentes(id) ON DELETE CASCADE,
  pasta         VARCHAR(50)  NOT NULL,
  arquivo       VARCHAR(100) NOT NULL,
  titulo        VARCHAR(200),
  conteudo      TEXT NOT NULL DEFAULT '',
  etapas        TEXT[] DEFAULT '{}',
  sempre_ativo  BOOLEAN DEFAULT FALSE,
  ativo         BOOLEAN DEFAULT TRUE,
  ordem         INT DEFAULT 0,
  atualizado_em TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_id, pasta, arquivo)
);

CREATE INDEX IF NOT EXISTS idx_kbdocs_agent
  ON knowledge_base_docs(agent_id, ativo);

CREATE INDEX IF NOT EXISTS idx_kbdocs_fts
  ON knowledge_base_docs
  USING gin(to_tsvector('portuguese', coalesce(titulo,'') || ' ' || coalesce(conteudo,'')));
