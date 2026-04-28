-- Migration 015: Seed idempotente dos preços oficiais da Plamev
-- Objetivo: completar o schema de `precos` e cadastrar os valores oficiais
-- usados pelo runtime da Mari no Railway.

BEGIN;

-- Completa o schema atual de `precos` com as colunas que o runtime já espera.
ALTER TABLE precos
  ADD COLUMN IF NOT EXISTS valor_tabela      NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS valor_oferta      NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS desconto_max_pct  NUMERIC(4,1) DEFAULT 25.0,
  ADD COLUMN IF NOT EXISTS valor_promocional NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS valor_limite      NUMERIC(10,2);

-- Garante os planos plus necessários para relacionar os preços herdados.
INSERT INTO planos (slug, nome, descricao, ativo)
VALUES
  ('advance_plus', 'Advance Plus', 'Advance com castração inclusa.', TRUE),
  ('platinum_plus', 'Platinum Plus', 'Platinum com castração inclusa.', TRUE),
  ('diamond_plus', 'Diamond Plus', 'Diamond com castração inclusa.', TRUE)
ON CONFLICT (slug) DO UPDATE
SET
  nome = EXCLUDED.nome,
  descricao = EXCLUDED.descricao,
  ativo = EXCLUDED.ativo;

-- Índice único para manter o seed idempotente por plano/modalidade/vigência.
CREATE UNIQUE INDEX IF NOT EXISTS idx_precos_plano_modalidade_vigencia
  ON precos (plano_id, modalidade, vigencia_inicio);

INSERT INTO precos (
  plano_id,
  modalidade,
  valor_tabela,
  valor_promocional,
  valor_oferta,
  valor_limite,
  valor,
  desconto_max_pct,
  vigencia_inicio,
  ativo
)
SELECT
  p.id,
  t.modalidade,
  t.valor_tabela,
  t.valor_promocional,
  t.valor_oferta,
  t.valor_limite,
  t.valor,
  t.desconto_max_pct,
  t.vigencia_inicio,
  TRUE
FROM planos p
JOIN (
  VALUES
    -- Slim
    ('slim', 'cartao', 59.99::numeric, 54.90::numeric, 48.90::numeric, 39.90::numeric, 54.90::numeric, 15.0::numeric, '2026-04-11'::date),
    ('slim', 'boleto', 59.99::numeric, 54.90::numeric, 48.90::numeric, 48.90::numeric, 54.90::numeric, 25.0::numeric, '2026-04-11'::date),
    ('slim', 'pix',    59.99::numeric, 54.90::numeric, 48.90::numeric, 48.90::numeric, 54.90::numeric, 25.0::numeric, '2026-04-11'::date),

    -- Advance
    ('advance', 'cartao', 149.99::numeric, 119.99::numeric, 99.99::numeric, 89.99::numeric, 119.99::numeric, 30.0::numeric, '2026-04-11'::date),
    ('advance', 'boleto', 149.99::numeric, 119.99::numeric, 119.99::numeric, 109.99::numeric, 119.99::numeric, 25.0::numeric, '2026-04-11'::date),
    ('advance', 'pix',    149.99::numeric, 119.99::numeric, 119.99::numeric, 109.99::numeric, 119.99::numeric, 25.0::numeric, '2026-04-11'::date),

    -- Platinum
    ('platinum', 'cartao', 239.99::numeric, 189.99::numeric, 169.99::numeric, 139.99::numeric, 189.99::numeric, 30.0::numeric, '2026-04-11'::date),
    ('platinum', 'boleto', 239.99::numeric, 189.99::numeric, 169.99::numeric, 149.99::numeric, 189.99::numeric, 25.0::numeric, '2026-04-11'::date),
    ('platinum', 'pix',    239.99::numeric, 189.99::numeric, 169.99::numeric, 149.99::numeric, 189.99::numeric, 25.0::numeric, '2026-04-11'::date),

    -- Diamond
    ('diamond', 'cartao', 399.99::numeric, 359.99::numeric, 319.99::numeric, 299.99::numeric, 359.99::numeric, 25.0::numeric, '2026-04-11'::date),
    ('diamond', 'boleto', 399.99::numeric, 359.99::numeric, 329.99::numeric, 309.99::numeric, 359.99::numeric, 25.0::numeric, '2026-04-11'::date),
    ('diamond', 'pix',    399.99::numeric, 359.99::numeric, 329.99::numeric, 309.99::numeric, 359.99::numeric, 25.0::numeric, '2026-04-11'::date),

    -- Advance Plus
    ('advance_plus', 'cartao', 208.99::numeric, 178.99::numeric, 158.99::numeric, 148.99::numeric, 178.99::numeric, 25.0::numeric, '2026-04-15'::date),
    ('advance_plus', 'boleto', 208.99::numeric, 178.99::numeric, 178.99::numeric, 168.99::numeric, 178.99::numeric, 25.0::numeric, '2026-04-15'::date),
    ('advance_plus', 'pix',    208.99::numeric, 178.99::numeric, 178.99::numeric, 168.99::numeric, 178.99::numeric, 25.0::numeric, '2026-04-15'::date),

    -- Platinum Plus
    ('platinum_plus', 'cartao', 298.99::numeric, 248.99::numeric, 228.99::numeric, 198.99::numeric, 248.99::numeric, 25.0::numeric, '2026-04-14'::date),
    ('platinum_plus', 'boleto', 298.99::numeric, 248.99::numeric, 228.99::numeric, 208.99::numeric, 248.99::numeric, 25.0::numeric, '2026-04-14'::date),
    ('platinum_plus', 'pix',    298.99::numeric, 248.99::numeric, 228.99::numeric, 208.99::numeric, 248.99::numeric, 25.0::numeric, '2026-04-14'::date),

    -- Diamond Plus
    ('diamond_plus', 'cartao', 458.99::numeric, 418.99::numeric, 378.99::numeric, 358.99::numeric, 418.99::numeric, 25.0::numeric, '2026-04-14'::date),
    ('diamond_plus', 'boleto', 458.99::numeric, 418.99::numeric, 388.99::numeric, 368.99::numeric, 418.99::numeric, 25.0::numeric, '2026-04-14'::date),
    ('diamond_plus', 'pix',    458.99::numeric, 418.99::numeric, 388.99::numeric, 368.99::numeric, 418.99::numeric, 25.0::numeric, '2026-04-14'::date)
) AS t(
  slug,
  modalidade,
  valor_tabela,
  valor_promocional,
  valor_oferta,
  valor_limite,
  valor,
  desconto_max_pct,
  vigencia_inicio
) ON p.slug = t.slug
ON CONFLICT (plano_id, modalidade, vigencia_inicio) DO UPDATE
SET
  valor_tabela = EXCLUDED.valor_tabela,
  valor_promocional = EXCLUDED.valor_promocional,
  valor_oferta = EXCLUDED.valor_oferta,
  valor_limite = EXCLUDED.valor_limite,
  valor = EXCLUDED.valor,
  desconto_max_pct = EXCLUDED.desconto_max_pct,
  ativo = EXCLUDED.ativo;

SELECT setval(
  pg_get_serial_sequence('precos', 'id'),
  GREATEST(COALESCE((SELECT MAX(id) FROM precos), 1), 1),
  TRUE
);

COMMIT;
