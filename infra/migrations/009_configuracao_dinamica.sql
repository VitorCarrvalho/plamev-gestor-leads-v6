-- Migration 009: Configuração dinâmica de agentes, canais e prompts
-- Remove dependência de hardcode no código; tudo gerenciável pelo frontend.

-- Expand tabela agentes com campos operacionais
ALTER TABLE agentes
  ADD COLUMN IF NOT EXISTS modelo_principal  VARCHAR(50)    DEFAULT 'claude-haiku-4-5',
  ADD COLUMN IF NOT EXISTS temperatura       NUMERIC(3,2)   DEFAULT 0.70,
  ADD COLUMN IF NOT EXISTS avatar_url        TEXT,
  ADD COLUMN IF NOT EXISTS descricao         TEXT,
  ADD COLUMN IF NOT EXISTS atualizado_em     TIMESTAMPTZ    DEFAULT NOW();

-- Soul e prompts do agente (substitui arquivos Obsidian)
CREATE TABLE IF NOT EXISTS agente_prompts (
  id            SERIAL PRIMARY KEY,
  agent_id      INT NOT NULL REFERENCES agentes(id) ON DELETE CASCADE,
  tipo          VARCHAR(50) NOT NULL,
  titulo        VARCHAR(100),
  conteudo      TEXT NOT NULL DEFAULT '',
  ativo         BOOLEAN DEFAULT TRUE,
  ordem         INT DEFAULT 0,
  atualizado_em TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_id, tipo)
);

-- Instâncias WhatsApp por agente
CREATE TABLE IF NOT EXISTS canais_whatsapp (
  id              SERIAL PRIMARY KEY,
  agent_id        INT NOT NULL REFERENCES agentes(id) ON DELETE CASCADE,
  instancia_nome  VARCHAR(100) NOT NULL,
  instancia_label VARCHAR(100),
  ddd_prefixos    TEXT[] DEFAULT '{}',
  chip_fallback   BOOLEAN DEFAULT FALSE,
  ativo           BOOLEAN DEFAULT TRUE,
  criado_em       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(instancia_nome)
);

-- Bots Telegram por agente
CREATE TABLE IF NOT EXISTS canais_telegram (
  id         SERIAL PRIMARY KEY,
  agent_id   INT NOT NULL REFERENCES agentes(id) ON DELETE CASCADE,
  bot_token  TEXT NOT NULL,
  bot_nome   VARCHAR(100),
  ativo      BOOLEAN DEFAULT TRUE,
  criado_em  TIMESTAMPTZ DEFAULT NOW()
);

-- Seed: slots de prompt para cada agente existente
INSERT INTO agente_prompts (agent_id, tipo, titulo, ordem)
SELECT a.id, t.tipo, t.titulo, t.ordem
FROM agentes a,
(VALUES
  ('soul',           'Soul — Identidade Completa',  0),
  ('tom',            'Tom e Fluxo de Conversa',     1),
  ('regras',         'Regras Absolutas',            2),
  ('planos',         'Planos e Produtos',           3),
  ('pensamentos',    'Pensamentos',                 4),
  ('anti_repeticao', 'Anti-Repetição',              5),
  ('modo_rapido',    'Modo Rápido',                 6)
) AS t(tipo, titulo, ordem)
ON CONFLICT (agent_id, tipo) DO NOTHING;

-- Seed: instâncias WhatsApp conhecidas para o agente mari
INSERT INTO canais_whatsapp (agent_id, instancia_nome, instancia_label, ddd_prefixos, chip_fallback)
SELECT a.id, 'mari-plamev-whatsapp', 'Mari 011 (legado)', ARRAY[]::TEXT[], FALSE
FROM agentes a WHERE a.slug = 'mari'
ON CONFLICT (instancia_nome) DO NOTHING;

INSERT INTO canais_whatsapp (agent_id, instancia_nome, instancia_label, ddd_prefixos, chip_fallback)
SELECT a.id, 'mari011', 'Mari São Paulo', ARRAY['5511','5512','5513','5514','5515','5516','5517','5518','5519'], FALSE
FROM agentes a WHERE a.slug = 'mari'
ON CONFLICT (instancia_nome) DO NOTHING;

INSERT INTO canais_whatsapp (agent_id, instancia_nome, instancia_label, ddd_prefixos, chip_fallback)
SELECT a.id, 'mari-plamev-zap2', 'Mari Minas Gerais', ARRAY['5531','5532','5533','5534','5535','5537'], TRUE
FROM agentes a WHERE a.slug = 'mari'
ON CONFLICT (instancia_nome) DO NOTHING;
