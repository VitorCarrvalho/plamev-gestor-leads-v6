-- Corrige tamanhos insuficientes nas colunas da tabela message_reactions.
-- VARCHAR(20) era muito pequeno para emails (enviado_por) e emojis compostos.
-- Usa TEXT para flexibilidade máxima sem overhead significativo.
ALTER TABLE message_reactions
  ALTER COLUMN emoji       TYPE TEXT,
  ALTER COLUMN enviado_por TYPE TEXT;
