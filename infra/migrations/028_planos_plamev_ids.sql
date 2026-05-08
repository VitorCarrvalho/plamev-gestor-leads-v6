-- Migration 028: Tabela de de/para dos IDs e tipos de cobertura da Plamev
BEGIN;

CREATE TABLE IF NOT EXISTS planos_plamev_ids (
  id SERIAL PRIMARY KEY,
  tipo_cobertura INT NOT NULL,
  nome_cobertura VARCHAR(100) NOT NULL,
  coberturas_id UUID NOT NULL,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(nome_cobertura)
);

-- Populando os dados da legenda oficial fornecida
INSERT INTO planos_plamev_ids (tipo_cobertura, nome_cobertura, coberturas_id) VALUES
(1, 'Slim', '946A526B-C1C2-7CCA-4422-70F979442C28'),
(4, 'Advance', 'A4F527FF-7449-59F1-87AE-7696B6611EDA'),
(5, 'Platinum', '3A0AB126-EA29-70BA-77D5-C78742EE6550'),
(14, 'Advance Plus', 'A4F527FF-7449-59F1-87AE-7696B6611EDA'),
(16, 'Diamond Plus', 'BADC3412-5849-188D-0F0F-ABE68BDDA1DA'),
(17, 'Slim Essencial', 'BD355B7D-B6B7-D47F-F612-A8E127F1FAA3')
ON CONFLICT (nome_cobertura) DO UPDATE SET 
  tipo_cobertura = EXCLUDED.tipo_cobertura,
  coberturas_id = EXCLUDED.coberturas_id;

COMMIT;
