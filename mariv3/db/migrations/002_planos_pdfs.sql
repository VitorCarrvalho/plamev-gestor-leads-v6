-- Migration 002 — Tabela de PDFs por plano + coluna pdf_oferecido em conversas
-- Criado em: 16/04/2026

CREATE TABLE IF NOT EXISTS planos_pdfs (
  id           SERIAL PRIMARY KEY,
  plano_slug   VARCHAR(50)  NOT NULL UNIQUE, -- slim, advance, platinum, diamond, plus
  nome_arquivo VARCHAR(255) NOT NULL,
  caminho      TEXT         NOT NULL,        -- caminho absoluto no servidor
  criado_em    TIMESTAMPTZ  DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE conversas ADD COLUMN IF NOT EXISTS pdf_oferecido BOOLEAN DEFAULT false;
