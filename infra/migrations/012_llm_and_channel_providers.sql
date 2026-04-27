-- Migration 012: LLM provider configs + WhatsApp provider-specific fields

-- ── Tabela de configurações de LLM ───────────────────────────────
CREATE TABLE IF NOT EXISTS llm_configs (
  id           SERIAL PRIMARY KEY,
  org_id       UUID         NOT NULL,
  nome         VARCHAR(100) NOT NULL,
  provedor     VARCHAR(50)  NOT NULL,  -- 'anthropic' | 'openai' | 'google' | 'groq' | 'mistral'
  modelo       VARCHAR(100) NOT NULL,
  api_key      TEXT         NOT NULL DEFAULT '',
  temperatura  NUMERIC(3,2) DEFAULT 0.7,
  max_tokens   INT          DEFAULT 4096,
  ativo        BOOLEAN      DEFAULT TRUE,
  padrao       BOOLEAN      DEFAULT FALSE,
  criado_em    TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE(org_id, nome)
);

-- ── Campos de provedor no canal WhatsApp ─────────────────────────
ALTER TABLE canais_whatsapp
  ADD COLUMN IF NOT EXISTS provider           VARCHAR(20) DEFAULT 'evolution',
  ADD COLUMN IF NOT EXISTS evolution_url      TEXT        DEFAULT '',
  ADD COLUMN IF NOT EXISTS evolution_api_key  TEXT        DEFAULT '',
  ADD COLUMN IF NOT EXISTS twilio_account_sid TEXT        DEFAULT '',
  ADD COLUMN IF NOT EXISTS twilio_auth_token  TEXT        DEFAULT '',
  ADD COLUMN IF NOT EXISTS twilio_phone_from  TEXT        DEFAULT '';

-- ── Coluna atualizado_em em agente_prompts (usada no upsert) ─────
ALTER TABLE agente_prompts
  ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ DEFAULT NOW();

-- ── Seed: Anthropic Claude como provedor padrão ──────────────────
INSERT INTO llm_configs (org_id, nome, provedor, modelo, temperatura, max_tokens, ativo, padrao)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'Claude (Principal)',
  'anthropic',
  'claude-opus-4-5',
  0.7,
  4096,
  TRUE,
  TRUE
) ON CONFLICT (org_id, nome) DO NOTHING;
