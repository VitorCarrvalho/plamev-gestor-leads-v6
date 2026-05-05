-- Migration 021: Atualização massiva da tabela de preços oficiais
-- Objetivo: Garantir que todos os preços de todos os planos estejam sincronizados com a tabela oficial.

BEGIN;

-- Primeiro desativa todos os preços atuais para evitar duplicidade de vigência ativa
UPDATE precos SET ativo = false;

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
  t.valor_promocional, -- O valor base usado pelo sistema é o promocional
  t.desconto_max,
  CURRENT_DATE,
  TRUE
FROM planos p
JOIN (
  VALUES
    -- Slim
    ('slim', 'cartao', 59.99::numeric, 54.90::numeric, 48.90::numeric, 39.90::numeric, 25.0::numeric),
    ('slim', 'boleto', 59.99::numeric, 54.90::numeric, 48.90::numeric, 48.90::numeric, 25.0::numeric),
    ('slim', 'pix',    59.99::numeric, 54.90::numeric, 48.90::numeric, 48.90::numeric, 25.0::numeric),

    -- Advance
    ('advance', 'cartao', 149.99::numeric, 119.99::numeric, 99.99::numeric, 89.99::numeric, 30.0::numeric),
    ('advance', 'boleto', 149.99::numeric, 119.99::numeric, 119.99::numeric, 109.99::numeric, 25.0::numeric),
    ('advance', 'pix',    149.99::numeric, 119.99::numeric, 119.99::numeric, 109.99::numeric, 25.0::numeric),

    -- Platinum
    ('platinum', 'cartao', 239.99::numeric, 189.99::numeric, 169.99::numeric, 139.99::numeric, 30.0::numeric),
    ('platinum', 'boleto', 239.99::numeric, 189.99::numeric, 169.99::numeric, 149.99::numeric, 25.0::numeric),
    ('platinum', 'pix',    239.99::numeric, 189.99::numeric, 169.99::numeric, 149.99::numeric, 25.0::numeric),

    -- Diamond
    ('diamond', 'cartao', 399.99::numeric, 359.99::numeric, 319.99::numeric, 299.99::numeric, 25.0::numeric),
    ('diamond', 'boleto', 399.99::numeric, 359.99::numeric, 329.99::numeric, 309.99::numeric, 25.0::numeric),
    ('diamond', 'pix',    399.99::numeric, 359.99::numeric, 329.99::numeric, 309.99::numeric, 25.0::numeric),

    -- Advance Plus
    ('advance_plus', 'cartao', 208.99::numeric, 178.99::numeric, 158.99::numeric, 148.99::numeric, 25.0::numeric),
    ('advance_plus', 'boleto', 208.99::numeric, 178.99::numeric, 178.99::numeric, 168.99::numeric, 25.0::numeric),
    ('advance_plus', 'pix',    208.99::numeric, 178.99::numeric, 178.99::numeric, 168.99::numeric, 25.0::numeric),

    -- Platinum Plus
    ('platinum_plus', 'cartao', 298.99::numeric, 248.99::numeric, 228.99::numeric, 198.99::numeric, 25.0::numeric),
    ('platinum_plus', 'boleto', 298.99::numeric, 248.99::numeric, 228.99::numeric, 208.99::numeric, 25.0::numeric),
    ('platinum_plus', 'pix',    298.99::numeric, 248.99::numeric, 228.99::numeric, 208.99::numeric, 25.0::numeric),

    -- Diamond Plus
    ('diamond_plus', 'cartao', 458.99::numeric, 418.99::numeric, 378.99::numeric, 358.99::numeric, 25.0::numeric),
    ('diamond_plus', 'boleto', 458.99::numeric, 418.99::numeric, 388.99::numeric, 368.99::numeric, 25.0::numeric),
    ('diamond_plus', 'pix',    458.99::numeric, 418.99::numeric, 388.99::numeric, 368.99::numeric, 25.0::numeric)
) AS t(
  slug,
  modalidade,
  valor_tabela,
  valor_promocional,
  valor_oferta,
  valor_limite,
  desconto_max
) ON p.slug = t.slug
ON CONFLICT (plano_id, modalidade, vigencia_inicio) DO UPDATE
SET
  valor_tabela = EXCLUDED.valor_tabela,
  valor_promocional = EXCLUDED.valor_promocional,
  valor_oferta = EXCLUDED.valor_oferta,
  valor_limite = EXCLUDED.valor_limite,
  valor = EXCLUDED.valor_promocional,
  ativo = TRUE;

COMMIT;
