-- Migration 011: Repair — garante criação das tabelas de configuração dinâmica
-- Idempotente: usa IF NOT EXISTS em tudo.

ALTER TABLE agentes
  ADD COLUMN IF NOT EXISTS modelo_principal VARCHAR(100) DEFAULT 'claude-opus-4-5',
  ADD COLUMN IF NOT EXISTS temperatura      NUMERIC(3,2) DEFAULT 0.7,
  ADD COLUMN IF NOT EXISTS avatar_url       TEXT,
  ADD COLUMN IF NOT EXISTS descricao        TEXT,
  ADD COLUMN IF NOT EXISTS atualizado_em    TIMESTAMPTZ  DEFAULT NOW();

CREATE TABLE IF NOT EXISTS agente_prompts (
  id         SERIAL PRIMARY KEY,
  agent_id   INT NOT NULL REFERENCES agentes(id) ON DELETE CASCADE,
  tipo       VARCHAR(50)  NOT NULL,
  titulo     VARCHAR(100),
  conteudo   TEXT         NOT NULL DEFAULT '',
  ativo      BOOLEAN      DEFAULT TRUE,
  ordem      INT          DEFAULT 0,
  UNIQUE(agent_id, tipo)
);

CREATE TABLE IF NOT EXISTS canais_whatsapp (
  id               SERIAL PRIMARY KEY,
  agent_id         INT NOT NULL REFERENCES agentes(id) ON DELETE CASCADE,
  instancia_nome   VARCHAR(100) NOT NULL,
  instancia_label  VARCHAR(100),
  ddd_prefixos     TEXT[]  DEFAULT '{}',
  chip_fallback    BOOLEAN DEFAULT FALSE,
  ativo            BOOLEAN DEFAULT TRUE,
  UNIQUE(instancia_nome)
);

CREATE TABLE IF NOT EXISTS canais_telegram (
  id         SERIAL PRIMARY KEY,
  agent_id   INT  NOT NULL REFERENCES agentes(id) ON DELETE CASCADE,
  bot_token  TEXT NOT NULL,
  bot_nome   VARCHAR(100),
  ativo      BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS knowledge_base_docs (
  id            SERIAL PRIMARY KEY,
  agent_id      INT          NOT NULL REFERENCES agentes(id) ON DELETE CASCADE,
  pasta         VARCHAR(50)  NOT NULL,
  arquivo       VARCHAR(100) NOT NULL,
  titulo        VARCHAR(200),
  conteudo      TEXT         NOT NULL DEFAULT '',
  etapas        TEXT[]       DEFAULT '{}',
  sempre_ativo  BOOLEAN      DEFAULT FALSE,
  ativo         BOOLEAN      DEFAULT TRUE,
  ordem         INT          DEFAULT 0,
  atualizado_em TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE(agent_id, pasta, arquivo)
);

CREATE INDEX IF NOT EXISTS idx_kbdocs_agent        ON knowledge_base_docs(agent_id, ativo);
CREATE INDEX IF NOT EXISTS idx_agente_prompts_agent ON agente_prompts(agent_id, ativo);

-- Seed slots de prompt para todos os agentes existentes
INSERT INTO agente_prompts (agent_id, tipo, titulo, ordem)
SELECT a.id, v.tipo, v.titulo, v.ordem
FROM agentes a
CROSS JOIN (VALUES
  ('soul',           'Soul (Identidade)',  1),
  ('tom',            'Tom de Voz',         2),
  ('regras',         'Regras Gerais',      3),
  ('planos',         'Planos e Precos',    4),
  ('pensamentos',    'Pensamentos IA',     5),
  ('anti_repeticao', 'Anti-Repeticao',     6),
  ('modo_rapido',    'Modo Rapido',        7)
) AS v(tipo, titulo, ordem)
ON CONFLICT (agent_id, tipo) DO NOTHING;

-- Seed canais WhatsApp para mari
INSERT INTO canais_whatsapp (agent_id, instancia_nome, instancia_label, ddd_prefixos, chip_fallback)
SELECT a.id, 'mari-plamev-whatsapp', 'Mari Principal',
       ARRAY['011','012','013','014','015','016','017','018','019'], FALSE
FROM agentes a WHERE a.slug = 'mari'
ON CONFLICT (instancia_nome) DO NOTHING;

INSERT INTO canais_whatsapp (agent_id, instancia_nome, instancia_label, ddd_prefixos, chip_fallback)
SELECT a.id, 'mari011', 'Mari 011',
       ARRAY['021','022','024','027','028'], FALSE
FROM agentes a WHERE a.slug = 'mari'
ON CONFLICT (instancia_nome) DO NOTHING;

INSERT INTO canais_whatsapp (agent_id, instancia_nome, instancia_label, ddd_prefixos, chip_fallback)
SELECT a.id, 'mari-plamev-zap2', 'Mari Fallback',
       ARRAY[]::TEXT[], TRUE
FROM agentes a WHERE a.slug = 'mari'
ON CONFLICT (instancia_nome) DO NOTHING;
