-- Migration 018: Tabela de cotações submetidas à API Plamev

CREATE TABLE IF NOT EXISTS cotacoes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID REFERENCES organizations(id),
  conversa_id           UUID REFERENCES conversas(id) ON DELETE SET NULL,
  client_id             UUID REFERENCES clientes(id) ON DELETE SET NULL,

  -- Identificação
  numero_cotacao        VARCHAR(50),          -- ex: "2026-000123"
  data_fidelidade       VARCHAR(20),          -- ex: "29/04/2027"

  -- Dados do lead
  nome                  VARCHAR(200),
  email                 VARCHAR(200),
  telefone              VARCHAR(20),
  cep                   VARCHAR(8),
  estado_uf             VARCHAR(2),
  cidade                VARCHAR(200),

  -- Financeiro
  valor_adesao          NUMERIC(10,2) DEFAULT 0,
  valor_mensalidade     NUMERIC(10,2) DEFAULT 0,
  composicao            JSONB DEFAULT '[]',   -- ComposicaoMensalidade
  descontos             JSONB DEFAULT '[]',

  -- Dados brutos
  dados_pets            JSONB DEFAULT '[]',   -- CotacoesPets payload
  resposta_api          JSONB,                -- resposta completa da API

  -- Status
  status                VARCHAR(30) DEFAULT 'gerada',  -- gerada, enviada, convertida, cancelada
  criado_em             TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cotacoes_org     ON cotacoes(org_id, status);
CREATE INDEX IF NOT EXISTS idx_cotacoes_client  ON cotacoes(client_id);
CREATE INDEX IF NOT EXISTS idx_cotacoes_numero  ON cotacoes(numero_cotacao);
