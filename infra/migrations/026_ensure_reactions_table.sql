-- Garante existência da tabela message_reactions (idempotente).
-- Necessário porque a 025 pode não ter sido aplicada caso a 022 tenha falhado
-- em produção (bug pp.idade → pp.idade_anos, já corrigido).
CREATE TABLE IF NOT EXISTS message_reactions (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  msg_id         UUID        NOT NULL REFERENCES mensagens(id) ON DELETE CASCADE,
  msg_id_externo VARCHAR(100),
  emoji          VARCHAR(20) NOT NULL,
  enviado_por    VARCHAR(20) NOT NULL DEFAULT 'supervisora',
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reactions_msg ON message_reactions(msg_id);
