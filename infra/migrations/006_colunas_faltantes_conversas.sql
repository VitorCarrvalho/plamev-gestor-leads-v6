-- Migração 006: Adiciona colunas presentes no schema de produção mas ausentes nas migrations
-- Todas usam ADD COLUMN IF NOT EXISTS para ser seguras em re-runs.

-- ── Tabela conversas ─────────────────────────────────────────────
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS sender_chip         VARCHAR(50);
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS instancia_whatsapp  VARCHAR(100);
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS temperatura_lead    VARCHAR(20);
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS objecao_principal   TEXT;
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS plano_recomendado   TEXT;
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS intensidade         VARCHAR(30);
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS negociacao_step     VARCHAR(50);
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS lead_quality_score  NUMERIC(5,2);
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS lead_quality_class  VARCHAR(20);
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS resumo_conversa     TEXT;
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS classificacao_rede  TEXT;
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS clinicas_20km       INT;
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS clinicas_40km       INT;

-- ── Tabela perfil_pet ────────────────────────────────────────────
ALTER TABLE perfil_pet ADD COLUMN IF NOT EXISTS vinculo_emocional  TEXT;
ALTER TABLE perfil_pet ADD COLUMN IF NOT EXISTS cep                VARCHAR(10);
ALTER TABLE perfil_pet ADD COLUMN IF NOT EXISTS cidade             VARCHAR(100);
ALTER TABLE perfil_pet ADD COLUMN IF NOT EXISTS estado             VARCHAR(2);
ALTER TABLE perfil_pet ADD COLUMN IF NOT EXISTS email              VARCHAR(200);
ALTER TABLE perfil_pet ADD COLUMN IF NOT EXISTS cpf                VARCHAR(20);
ALTER TABLE perfil_pet ADD COLUMN IF NOT EXISTS indicado_por       TEXT;
ALTER TABLE perfil_pet ADD COLUMN IF NOT EXISTS conversa_id        UUID REFERENCES conversas(id) ON DELETE SET NULL;
