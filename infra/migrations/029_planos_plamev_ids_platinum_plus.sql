-- Migration 029: Adiciona Platinum Plus e Diamond à tabela planos_plamev_ids
-- ATENÇÃO: tipo_cobertura=15 para Platinum Plus é estimado com base no padrão
-- (Platinum=5 → Platinum Plus=15, análogo a Advance=4 → Advance Plus=14).
-- VERIFICAR o valor correto na API da Plamev antes de aplicar em produção.
-- O coberturas_id do Platinum Plus compartilha o UUID do Platinum (padrão dos Plus).
BEGIN;

INSERT INTO planos_plamev_ids (tipo_cobertura, nome_cobertura, coberturas_id) VALUES
(15, 'Platinum Plus', '3A0AB126-EA29-70BA-77D5-C78742EE6550')
ON CONFLICT (nome_cobertura) DO UPDATE SET
  tipo_cobertura = EXCLUDED.tipo_cobertura,
  coberturas_id  = EXCLUDED.coberturas_id;

COMMIT;
