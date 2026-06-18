-- Migration 031: Tabela persistente de estados da API Plamev
-- IDs de estado não mudam, portanto fazemos a consulta a /Estados/Consultar
-- apenas quando a tabela estiver vazia.
BEGIN;

CREATE TABLE IF NOT EXISTS plamev_estados (
  uf          CHAR(2) PRIMARY KEY,
  estado_id   UUID    NOT NULL,
  nome        VARCHAR(80),
  sincronizado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plamev_estados_estado_id ON plamev_estados (estado_id);

COMMIT;
