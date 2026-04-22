-- ═══════════════════════════════════════════════════════════
-- MariV3 — Schema inicial
-- Migração 001: estrutura completa
-- ═══════════════════════════════════════════════════════════

-- Extensões
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- busca por similaridade

-- ─────────────────────────────────────────
-- PRODUTO (fonte de verdade)
-- ─────────────────────────────────────────

CREATE TABLE planos (
  id          SERIAL PRIMARY KEY,
  slug        VARCHAR(20) UNIQUE NOT NULL,  -- slim, advance, platinum, diamond
  nome        VARCHAR(100) NOT NULL,
  descricao   TEXT,
  ativo       BOOLEAN DEFAULT TRUE,
  criado_em   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE precos (
  id               SERIAL PRIMARY KEY,
  plano_id         INT REFERENCES planos(id),
  modalidade       VARCHAR(20) NOT NULL CHECK (modalidade IN ('cartao','boleto','pix')),
  valor            NUMERIC(10,2) NOT NULL,
  vigencia_inicio  DATE NOT NULL DEFAULT CURRENT_DATE,
  vigencia_fim     DATE,
  ativo            BOOLEAN DEFAULT TRUE
);

CREATE TABLE categorias_procedimento (
  id    SERIAL PRIMARY KEY,
  nome  VARCHAR(100) UNIQUE NOT NULL  -- Consultas, Cirurgias, Exames, Vacinas, etc.
);

CREATE TABLE procedimentos (
  id           SERIAL PRIMARY KEY,
  nome         VARCHAR(200) NOT NULL,
  categoria_id INT REFERENCES categorias_procedimento(id),
  descricao    TEXT,
  ativo        BOOLEAN DEFAULT TRUE,
  UNIQUE(nome)
);
CREATE INDEX idx_proc_nome ON procedimentos USING gin(nome gin_trgm_ops);

CREATE TABLE coberturas (
  id               SERIAL PRIMARY KEY,
  plano_id         INT REFERENCES planos(id),
  procedimento_id  INT REFERENCES procedimentos(id),
  carencia_dias    INT NOT NULL DEFAULT 0,
  limite_uso       INT,         -- NULL = ilimitado
  periodicidade    INT,         -- em dias (ex: 30 = mensal, 360 = anual)
  UNIQUE(plano_id, procedimento_id)
);

CREATE TABLE exclusoes (
  id                SERIAL PRIMARY KEY,
  descricao         TEXT NOT NULL,
  todos_os_planos   BOOLEAN DEFAULT TRUE,
  plano_ids         INT[]  -- se não for todos
);

CREATE TABLE campanhas (
  id            SERIAL PRIMARY KEY,
  nome          VARCHAR(200) NOT NULL,
  desconto_pct  NUMERIC(5,2) NOT NULL,
  condicao      TEXT,
  plano_ids     INT[],
  vigencia_fim  DATE,
  ativo         BOOLEAN DEFAULT TRUE,
  criado_em     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE regras_comerciais (
  id        SERIAL PRIMARY KEY,
  chave     VARCHAR(100) UNIQUE NOT NULL,
  valor     TEXT NOT NULL,
  descricao TEXT,
  -- Exemplos: desconto_max=20, pix_aceito=false, reengajamento_dias=3
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- AGENTES
-- ─────────────────────────────────────────

CREATE TABLE agentes (
  id                  SERIAL PRIMARY KEY,
  slug                VARCHAR(20) UNIQUE NOT NULL,  -- mari, rapha
  nome                VARCHAR(100) NOT NULL,
  obsidian_path       TEXT,
  modelo_decisao      VARCHAR(50) DEFAULT 'claude-haiku-4-5',
  modelo_negociacao   VARCHAR(50) DEFAULT 'claude-haiku-4-5',
  ativo               BOOLEAN DEFAULT TRUE,
  criado_em           TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- CLIENTES
-- ─────────────────────────────────────────

CREATE TABLE clientes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome        VARCHAR(200),
  origem      VARCHAR(50),   -- indicacao, ads, organico, etc.
  criado_em   TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE identificadores_cliente (
  id          SERIAL PRIMARY KEY,
  client_id   UUID REFERENCES clientes(id) ON DELETE CASCADE,
  tipo        VARCHAR(20) NOT NULL CHECK (tipo IN ('phone','email','telegram_id')),
  valor       VARCHAR(200) NOT NULL,
  UNIQUE(tipo, valor)
);
CREATE INDEX idx_ident_valor ON identificadores_cliente(valor);
CREATE INDEX idx_ident_client ON identificadores_cliente(client_id);

CREATE TABLE perfil_pet (
  id              SERIAL PRIMARY KEY,
  client_id       UUID REFERENCES clientes(id) ON DELETE CASCADE,
  nome            VARCHAR(100),
  especie         VARCHAR(50),   -- cachorro, gato, etc.
  raca            VARCHAR(100),
  idade_anos      NUMERIC(4,1),
  sexo            VARCHAR(10) CHECK (sexo IN ('macho','femea','nao_informado')),
  castrado        BOOLEAN,
  problema_saude  TEXT,
  atualizado_em   TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- CONVERSAS (unidade principal)
-- ─────────────────────────────────────────

CREATE TABLE conversas (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id        UUID REFERENCES clientes(id),
  agent_id         INT REFERENCES agentes(id),
  canal            VARCHAR(20) NOT NULL CHECK (canal IN ('whatsapp','telegram')),
  numero_externo   VARCHAR(50),  -- phone ou telegram_id do cliente
  jid              VARCHAR(100), -- WhatsApp JID
  status           VARCHAR(20) DEFAULT 'ativa' CHECK (status IN ('ativa','pausada','encerrada','transferida')),
  etapa            VARCHAR(50) DEFAULT 'acolhimento',
  score            NUMERIC(3,1) DEFAULT 0,
  numero_cotacao   VARCHAR(20),
  ia_silenciada    BOOLEAN DEFAULT FALSE,  -- supervisor silenciou a IA
  criado_em        TIMESTAMPTZ DEFAULT NOW(),
  ultima_interacao TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_conv_client ON conversas(client_id);
CREATE INDEX idx_conv_agent ON conversas(agent_id);
CREATE INDEX idx_conv_status ON conversas(status);
CREATE INDEX idx_conv_interacao ON conversas(ultima_interacao DESC);

CREATE TABLE mensagens (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversa_id     UUID REFERENCES conversas(id) ON DELETE CASCADE,
  role            VARCHAR(20) NOT NULL CHECK (role IN ('user','agent','supervisor','system')),
  conteudo        TEXT NOT NULL,
  enviado_por     VARCHAR(20) DEFAULT 'ia' CHECK (enviado_por IN ('ia','humano','supervisora')),
  msg_id_externo  VARCHAR(100),  -- ID do WhatsApp/Telegram para deduplicação
  metadata        JSONB DEFAULT '{}',
  timestamp       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_msg_conversa ON mensagens(conversa_id, timestamp DESC);
CREATE INDEX idx_msg_externo ON mensagens(msg_id_externo) WHERE msg_id_externo IS NOT NULL;

CREATE TABLE transferencias (
  id                SERIAL PRIMARY KEY,
  conversa_id       UUID REFERENCES conversas(id),
  agent_origem_id   INT REFERENCES agentes(id),
  agent_destino_id  INT REFERENCES agentes(id),
  supervisor_id     INT,  -- usuario_id de quem transferiu
  motivo            TEXT,
  timestamp         TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- DECISÃO E ORQUESTRADOR
-- ─────────────────────────────────────────

CREATE TABLE decisoes_orquestrador (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversa_id  UUID REFERENCES conversas(id),
  mensagem_id  UUID REFERENCES mensagens(id),
  input_json   JSONB NOT NULL,
  output_json  JSONB NOT NULL,
  modelo       VARCHAR(50),
  input_tokens INT,
  output_tokens INT,
  custo_usd    NUMERIC(10,6),
  duracao_ms   INT,
  timestamp    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_dec_conversa ON decisoes_orquestrador(conversa_id, timestamp DESC);

CREATE TABLE instrucoes_ativas (
  id           SERIAL PRIMARY KEY,
  conversa_id  UUID REFERENCES conversas(id),
  instrucao    TEXT NOT NULL,
  criado_por   INT,  -- usuario_id
  ativa        BOOLEAN DEFAULT TRUE,
  expira_em    TIMESTAMPTZ,
  criado_em    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- CONTEXTO RELACIONAL DA MARI
-- ─────────────────────────────────────────

CREATE TABLE contexto_relacional (
  id            SERIAL PRIMARY KEY,
  agent_id      INT REFERENCES agentes(id),
  tipo          VARCHAR(20) NOT NULL CHECK (tipo IN ('pet','pessoa','lugar')),
  nome          VARCHAR(100) NOT NULL,
  relacao       VARCHAR(100),  -- "pet meu", "prima", "vizinha"
  especie       VARCHAR(50),
  raca          VARCHAR(100),
  idade         VARCHAR(50),
  historia      TEXT,          -- narrativa curta para conexão
  tags          TEXT[],        -- ["resgatado","idoso","sensivel","yorkshire"]
  ativo         BOOLEAN DEFAULT TRUE
);
CREATE INDEX idx_ctx_agent ON contexto_relacional(agent_id);
CREATE INDEX idx_ctx_tags ON contexto_relacional USING gin(tags);

-- ─────────────────────────────────────────
-- OPERACIONAL
-- ─────────────────────────────────────────

CREATE TABLE agendamentos (
  id           SERIAL PRIMARY KEY,
  conversa_id  UUID REFERENCES conversas(id),
  tipo         VARCHAR(50),   -- reengajamento_30min, reengajamento_1h, etc.
  executar_em  TIMESTAMPTZ NOT NULL,
  status       VARCHAR(20) DEFAULT 'pendente' CHECK (status IN ('pendente','executado','cancelado')),
  tentativas   INT DEFAULT 0,
  criado_em    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_agend_executar ON agendamentos(executar_em) WHERE status='pendente';

CREATE TABLE indicacoes (
  id                SERIAL PRIMARY KEY,
  conversa_indicador UUID REFERENCES conversas(id),
  phone_indicado    VARCHAR(50) NOT NULL,
  nome_indicado     VARCHAR(200),
  nome_pet          VARCHAR(100),
  horario_preferido VARCHAR(100),
  status            VARCHAR(20) DEFAULT 'pendente',
  contatado_em      TIMESTAMPTZ,
  criado_em         TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- RELATÓRIOS
-- ─────────────────────────────────────────

CREATE TABLE funil_conversao (
  id            SERIAL PRIMARY KEY,
  conversa_id   UUID REFERENCES conversas(id),
  etapa_origem  VARCHAR(50),
  etapa_destino VARCHAR(50),
  timestamp     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE custos_ia (
  id            SERIAL PRIMARY KEY,
  conversa_id   UUID REFERENCES conversas(id),
  agent_id      INT REFERENCES agentes(id),
  modelo        VARCHAR(50),
  input_tokens  INT,
  output_tokens INT,
  custo_usd     NUMERIC(10,6),
  timestamp     TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- USUÁRIOS DO DASHBOARD
-- ─────────────────────────────────────────

CREATE TABLE usuarios (
  id          SERIAL PRIMARY KEY,
  nome        VARCHAR(200) NOT NULL,
  email       VARCHAR(200) UNIQUE NOT NULL,
  senha_hash  VARCHAR(200) NOT NULL,
  perfil      VARCHAR(20) DEFAULT 'operador' CHECK (perfil IN ('admin','supervisora','operador')),
  ativo       BOOLEAN DEFAULT TRUE,
  criado_em   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sessoes_usuario (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id  INT REFERENCES usuarios(id),
  token_jwt   TEXT NOT NULL,
  expira_em   TIMESTAMPTZ NOT NULL,
  ip          VARCHAR(50),
  criado_em   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE acoes_supervisor (
  id           SERIAL PRIMARY KEY,
  usuario_id   INT REFERENCES usuarios(id),
  conversa_id  UUID REFERENCES conversas(id),
  tipo_acao    VARCHAR(50),  -- transferir, assumir, silenciar, instruir, fazer_agora
  detalhe      TEXT,
  timestamp    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_acoes_conv ON acoes_supervisor(conversa_id, timestamp DESC);
