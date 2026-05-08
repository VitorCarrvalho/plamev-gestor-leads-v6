-- Reações em mensagens (estilo WhatsApp)
-- msg_id_externo: ID da mensagem na Evolution API, para envio da reação via sendReaction
CREATE TABLE IF NOT EXISTS message_reactions (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  msg_id         UUID        NOT NULL REFERENCES mensagens(id) ON DELETE CASCADE,
  msg_id_externo VARCHAR(100),                     -- Evolution API key.id
  emoji          VARCHAR(20) NOT NULL,
  enviado_por    VARCHAR(20) NOT NULL DEFAULT 'supervisora',
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reactions_msg ON message_reactions(msg_id);
