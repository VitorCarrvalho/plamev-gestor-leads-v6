-- Migração 004: Tabelas operacionais faltantes detectadas no código

-- Configurações globais (usado para limites de mensagens, etc)
CREATE TABLE IF NOT EXISTS mari_config (
  id          SERIAL PRIMARY KEY,
  chave       VARCHAR(100) UNIQUE NOT NULL,
  valor       TEXT NOT NULL,
  descricao   TEXT,
  criado_em   TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO mari_config (chave, valor, descricao) 
VALUES ('dashboard_msgs_limite', '50', 'Limite de mensagens exibidas no dashboard por padrão')
ON CONFLICT (chave) DO NOTHING;

-- Agendamentos de followup (usado na query de listarConversas)
CREATE TABLE IF NOT EXISTS followup_agendado (
  id            SERIAL PRIMARY KEY,
  conversa_id   UUID REFERENCES conversas(id) ON DELETE CASCADE,
  executar_em   TIMESTAMPTZ NOT NULL,
  tipo          VARCHAR(50) DEFAULT 'reengajamento',
  mensagem      TEXT,
  status        VARCHAR(20) DEFAULT 'pendente' CHECK (status IN ('pendente','executado','cancelado')),
  criado_em     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_followup_conversa ON followup_agendado(conversa_id);
CREATE INDEX IF NOT EXISTS idx_followup_status   ON followup_agendado(status) WHERE status = 'pendente';

-- Relacionamento Conversa <-> Obsidian (usado na exclusão e busca ativa)
CREATE TABLE IF NOT EXISTS conversa_obsidian (
  id            SERIAL PRIMARY KEY,
  conversa_id   UUID REFERENCES conversas(id) ON DELETE CASCADE,
  arquivo_path  TEXT NOT NULL,
  criado_em     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(conversa_id, arquivo_path)
);
