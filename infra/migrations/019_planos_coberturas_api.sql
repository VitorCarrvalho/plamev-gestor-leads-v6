-- Migration 019: Tabela de cache para UUIDs de coberturas da API externa Plamev
-- Mapeia: (nome do plano, UF) → cobertura_uuid da API
BEGIN;

CREATE TABLE IF NOT EXISTS planos_coberturas_api (
  id              SERIAL PRIMARY KEY,
  plano_nome      VARCHAR(150) NOT NULL,
  plano_slug      VARCHAR(50),
  uf              CHAR(2) NOT NULL,
  cobertura_uuid  VARCHAR(50) NOT NULL,
  valor           NUMERIC(10,2),
  sincronizado_em TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (plano_nome, uf)
);

CREATE INDEX IF NOT EXISTS idx_planos_coberturas_api_uf ON planos_coberturas_api (uf);
CREATE INDEX IF NOT EXISTS idx_planos_coberturas_api_slug ON planos_coberturas_api (plano_slug);

COMMIT;
