-- Migração 008: Tabelas do dashboard que existiam no DB secundário (mari_intelligence)
-- Movidas para o banco principal para simplificar a infra no Railway.

CREATE TABLE IF NOT EXISTS conversas_salvas (
  id              SERIAL PRIMARY KEY,
  conversa_id     UUID REFERENCES conversas(id) ON DELETE SET NULL,
  titulo          VARCHAR(300),
  motivo          TEXT,
  tags            TEXT[],
  snapshot_msgs   JSONB,
  snapshot_perfil JSONB,
  analise_status  VARCHAR(30) DEFAULT 'pendente',
  criado_em       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dashv5_audit_log (
  id         BIGSERIAL PRIMARY KEY,
  ator_email VARCHAR(200),
  ator_ip    VARCHAR(50),
  acao       VARCHAR(100) NOT NULL,
  alvo_tipo  VARCHAR(50),
  alvo_id    VARCHAR(200),
  detalhe    JSONB,
  criado_em  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_criado ON dashv5_audit_log(criado_em DESC);

CREATE TABLE IF NOT EXISTS dashv5_templates (
  id            SERIAL PRIMARY KEY,
  categoria     VARCHAR(50)  DEFAULT 'geral',
  atalho        VARCHAR(20),
  titulo        VARCHAR(200) NOT NULL,
  corpo         TEXT         NOT NULL,
  uso_count     INT          DEFAULT 0,
  criado_por    VARCHAR(200),
  atualizado_em TIMESTAMPTZ  DEFAULT NOW(),
  criado_em     TIMESTAMPTZ  DEFAULT NOW()
);
