-- 024_sandbox_cenarios.sql
-- Tabela para cenários salvos do Chat Simulator (sandbox)
CREATE TABLE IF NOT EXISTS sandbox_cenarios (
  id          SERIAL PRIMARY KEY,
  nome        TEXT NOT NULL,
  descricao   TEXT,
  etapa       TEXT DEFAULT 'acolhimento',
  canal       TEXT DEFAULT 'whatsapp',
  perfil_lead JSONB DEFAULT '{}',
  mensagens   JSONB DEFAULT '[]',
  criado_em   TIMESTAMPTZ DEFAULT NOW()
);
