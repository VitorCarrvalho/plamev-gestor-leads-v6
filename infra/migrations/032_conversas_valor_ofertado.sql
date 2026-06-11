-- Migration 032: Coluna `valor_ofertado` na tabela conversas
-- Persiste o valor negociado com o cliente. Lido por dispararCotacao()
-- antes de chamar /CampanhasCoberturasTabelas/consultar (Req 4) para
-- selecionar a tabela de preço correta.

ALTER TABLE conversas ADD COLUMN IF NOT EXISTS valor_ofertado NUMERIC(10,2);
