-- Migration 030: Análise de conversas com IA
-- Adiciona classificação de resultado e campo para armazenar análise da IA

ALTER TABLE conversas_salvas
  ADD COLUMN IF NOT EXISTS tipo_resultado VARCHAR(20) DEFAULT 'analise',
  ADD COLUMN IF NOT EXISTS analise_resultado JSONB;

-- tipo_resultado: 'sucesso' (fechou venda), 'falha' (não converteu), 'analise' (neutro)
-- analise_resultado: JSON estruturado retornado pelo Claude Sonnet após análise
