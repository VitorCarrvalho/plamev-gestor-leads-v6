-- ═══════════════════════════════════════════════════════════
-- MariV3 — Seeds de produto (dados dos PDFs Plamev)
-- ═══════════════════════════════════════════════════════════

-- AGENTES
INSERT INTO agentes (slug, nome, obsidian_path, modelo_decisao, modelo_negociacao) VALUES
  ('mari',  'Mariana', '/Users/geta/Documents/Mari-Knowledge-Base', 'claude-haiku-4-5', 'claude-haiku-4-5'),
  ('rapha', 'Raphaela', '/Users/geta/Documents/Rapha-Knowledge-Base', 'claude-haiku-4-5', 'claude-haiku-4-5');

-- PLANOS
INSERT INTO planos (slug, nome, descricao) VALUES
  ('slim',     'Slim',     'Proteção básica — consultas, emergência e exames essenciais'),
  ('advance',  'Advance',  'Mais vendido — cobertura completa com cirurgias e internação'),
  ('platinum', 'Platinum', 'Cobertura ampla com especialistas e fisioterapia'),
  ('diamond',  'Diamond',  'Cobertura máxima — UTI, domiciliar, tomografia e mais');

-- PREÇOS ATUAIS
INSERT INTO precos (plano_id, modalidade, valor) VALUES
  (1, 'cartao',  59.99),
  (1, 'boleto',  69.99),
  (1, 'pix',     69.99),
  (2, 'cartao', 139.99),
  (2, 'boleto', 149.99),
  (2, 'pix',    149.99),
  (3, 'cartao', 229.99),
  (3, 'boleto', 239.99),
  (3, 'pix',    239.99),
  (4, 'cartao', 399.99),
  (4, 'boleto', 409.99),
  (4, 'pix',    409.99);

-- REGRAS COMERCIAIS
INSERT INTO regras_comerciais (chave, valor, descricao) VALUES
  ('desconto_max_pct',       '20',    'Desconto máximo vitalício permitido'),
  ('pix_mensal_aceito',      'false', 'PIX mensal não é aceito'),
  ('cartao_desconto',        '10',    'Desconto de R$10 para pagamento no cartão vs boleto'),
  ('reengajamento_1_min',    '5',     'Primeiro reengajamento em minutos'),
  ('reengajamento_2_min',    '10',    'Segundo reengajamento em minutos'),
  ('reengajamento_3_min',    '30',    'Terceiro reengajamento em minutos'),
  ('reengajamento_dia1',     '1440',  'Quarto reengajamento em minutos (1 dia)'),
  ('reengajamento_semanal',  '10080', 'Reengajamento semanal em minutos'),
  ('historico_msgs_contexto','8',     'Número de mensagens no histórico para contexto'),
  ('score_escalar',          '8',     'Score mínimo para escalar para supervisor');

-- EXCLUSÕES (todos os planos)
INSERT INTO exclusoes (descricao, todos_os_planos) VALUES
  ('Medicamentos (nenhum tipo)', true),
  ('Ambulância', true),
  ('Insumos (cateter, acesso para soro)', true),
  ('Castração', true),
  ('Quimioterapia', true),
  ('Vermífugos', true),
  ('Tratamento hormonal anticoncepcional', true),
  ('Cirurgias estéticas', true),
  ('Transplantes', true);

-- CATEGORIAS DE PROCEDIMENTOS
INSERT INTO categorias_procedimento (nome) VALUES
  ('Consultas'),
  ('Exames Laboratoriais'),
  ('Exames de Imagem'),
  ('Vacinas'),
  ('Procedimentos Ambulatoriais'),
  ('Procedimentos Cirúrgicos'),
  ('Anestesia'),
  ('Especialidades'),
  ('Internação e UTI'),
  ('Cremação');

-- PROCEDIMENTOS PRINCIPAIS
INSERT INTO procedimentos (nome, categoria_id) VALUES
  -- Consultas (cat 1)
  ('Consulta Clínico Geral', 1),
  ('Consulta Emergencial', 1),
  ('Consulta Retorno', 1),
  ('Telemedicina', 1),
  -- Exames Laboratoriais (cat 2)
  ('Hemograma Completo', 2),
  ('Bioquímica Sérica', 2),
  ('Urinálise', 2),
  ('Coproparasitológico', 2),
  ('Citologia de Pele', 2),
  ('Exame Histopatológico', 2),
  -- Exames de Imagem (cat 3)
  ('Raio-X Simples', 3),
  ('Ultrassonografia', 3),
  ('Eletrocardiograma', 3),
  ('Tomografia Computadorizada', 3),
  ('Ecocardiograma', 3),
  -- Vacinas (cat 4)
  ('Vacina Múltipla V8/V10', 4),
  ('Vacina Quádrupla Felina', 4),
  ('Vacina Antirrábica', 4),
  ('Vacina Leptospirose', 4),
  -- Ambulatoriais (cat 5)
  ('Curativo Simples', 5),
  ('Internação Período Diurno', 5),
  ('Internação Período Noturno', 5),
  ('Nebulização', 5),
  ('Cistocentese', 5),
  ('Lavagem de Ouvido', 5),
  ('Eutanásia', 5),
  -- Cirúrgicos (cat 6)
  ('Cesariana', 6),
  ('Cistotomia', 6),
  ('Esplenectomia', 6),
  ('Mastectomia', 6),
  ('Corpo Estranho Gástrico', 6),
  ('Corpo Estranho Intestinal', 6),
  ('Hérnia Umbilical', 6),
  ('Orquiectomia', 6),
  -- Anestesia (cat 7)
  ('Anestesia Geral Intravenosa', 7),
  ('Anestesia Inalatória', 7),
  -- Especialidades (cat 8)
  ('Acupuntura', 8),
  ('Fisioterapia', 8),
  -- Internação UTI (cat 9)
  ('UTI', 9),
  ('Atendimento Domiciliar', 9),
  -- Cremação (cat 10)
  ('Cremação Coletiva', 10);

-- COBERTURAS POR PLANO (dados dos PDFs)
-- Slim (plano_id=1)
INSERT INTO coberturas (plano_id, procedimento_id, carencia_dias, limite_uso, periodicidade) VALUES
  (1, 1, 60, 6, 30),    -- Consulta Clínico
  (1, 2, 15, NULL, 1),  -- Emergência ilimitada
  (1, 3, 0,  6, 30),    -- Retorno
  (1, 4, 8,  2, 30),    -- Telemedicina 2x/mês
  (1, 5, 36, 6, 60),    -- Hemograma
  (1, 6, 90, 6, 60),    -- Bioquímica
  (1, 7, 90, 6, 60),    -- Urinálise
  (1, 8, 90, 7, 60),    -- Coproparasitológico
  (1, 16, 90, 1, 360),  -- Vacina V8/V10
  (1, 17, 90, 1, 360),  -- Vacina Quádrupla Felina
  (1, 18, 90, 1, 360),  -- Antirrábica
  (1, 19, 90, 1, 360),  -- Leptospirose
  (1, 20, 36, 4, 1);    -- Curativo

-- Advance (plano_id=2) — tudo do Slim +
INSERT INTO coberturas (plano_id, procedimento_id, carencia_dias, limite_uso, periodicidade) VALUES
  (2, 1, 36, 6, 30),    -- Consulta Clínico (carência menor)
  (2, 2, 15, NULL, 1),  -- Emergência
  (2, 3, 0,  6, 30),    -- Retorno
  (2, 4, 8,  4, 30),    -- Telemedicina 4x/mês
  (2, 5, 36, 6, 60),    -- Hemograma
  (2, 6, 90, 6, 60),    -- Bioquímica
  (2, 7, 90, 6, 60),    -- Urinálise
  (2, 8, 90, 7, 60),    -- Coproparasitológico
  (2, 9, 90, 6, 60),    -- Citologia
  (2, 10, 150, 1, 360), -- Histopatológico
  (2, 11, 120, 6, 60),  -- Raio-X
  (2, 12, 120, 4, 60),  -- Ultrassom
  (2, 13, 120, 4, 60),  -- ECG
  (2, 16, 90, 1, 360),  -- Vacinas
  (2, 17, 90, 1, 360),
  (2, 18, 90, 1, 360),
  (2, 19, 90, 1, 360),
  (2, 20, 36, 4, 1),    -- Curativo
  (2, 21, 190, 4, 1),   -- Internação Diurna
  (2, 22, 190, 4, 1),   -- Internação Noturna
  (2, 23, 36, 4, 1),    -- Nebulização
  (2, 24, 190, 3, 90),  -- Cistocentese
  (2, 27, 190, 1, 360), -- Cesariana
  (2, 28, 190, 1, 360), -- Cistotomia
  (2, 29, 190, 1, 360), -- Esplenectomia
  (2, 30, 190, 2, 360), -- Mastectomia
  (2, 31, 190, 1, 360), -- Corpo Estranho Gástrico
  (2, 32, 190, 1, 360), -- Corpo Estranho Intestinal
  (2, 33, 190, 1, 360), -- Hérnia Umbilical
  (2, 34, 190, 1, 360), -- Orquiectomia
  (2, 35, 190, NULL, NULL), -- Anestesia Geral
  (2, 36, 190, NULL, NULL); -- Anestesia Inalatória

-- Platinum (plano_id=3) — tudo do Advance +
INSERT INTO coberturas (plano_id, procedimento_id, carencia_dias, limite_uso, periodicidade) VALUES
  (3, 1, 36, 6, 30),
  (3, 2, 15, NULL, 1),
  (3, 3, 0,  6, 30),
  (3, 4, 8,  NULL, 30), -- Telemedicina incluso
  (3, 5, 36, 6, 60),
  (3, 6, 70, 6, 60),
  (3, 7, 70, 6, 60),
  (3, 8, 70, 7, 60),
  (3, 9, 70, 6, 60),
  (3, 10, 120, 1, 360),
  (3, 11, 100, 6, 60),
  (3, 12, 100, 4, 60),
  (3, 13, 100, 4, 60),
  (3, 16, 90, 1, 360),
  (3, 17, 90, 1, 360),
  (3, 18, 90, 1, 360),
  (3, 19, 90, 1, 360),
  (3, 20, 36, 4, 1),
  (3, 21, 180, 4, 1),
  (3, 22, 180, 4, 1),
  (3, 23, 36, 4, 1),
  (3, 27, 180, 1, 360),
  (3, 28, 180, 1, 360),
  (3, 29, 180, 1, 360),
  (3, 30, 180, 2, 360),
  (3, 31, 180, 1, 360),
  (3, 32, 180, 1, 360),
  (3, 33, 180, 1, 360),
  (3, 34, 180, 1, 360),
  (3, 35, 180, NULL, NULL),
  (3, 36, 180, NULL, NULL),
  (3, 37, 120, NULL, NULL), -- Acupuntura
  (3, 38, 120, NULL, NULL), -- Fisioterapia
  (3, 40, 180, NULL, NULL), -- Especialista 4x/período
  (3, 42, 360, 1, NULL);    -- Cremação Coletiva

-- Diamond (plano_id=4) — tudo + UTI + domiciliar + tomografia
INSERT INTO coberturas (plano_id, procedimento_id, carencia_dias, limite_uso, periodicidade) VALUES
  (4, 1, 36, 6, 30),
  (4, 2, 15, NULL, 1),
  (4, 3, 0,  6, 30),
  (4, 4, 8,  NULL, 1),  -- Telemedicina ilimitada
  (4, 5, 36, 6, 60),
  (4, 6, 60, 6, 60),
  (4, 7, 60, 6, 60),
  (4, 8, 60, 7, 60),
  (4, 9, 60, 6, 60),
  (4, 10, 100, 1, 360),
  (4, 11, 80,  6, 60),
  (4, 12, 80,  4, 60),
  (4, 13, 80,  4, 60),
  (4, 14, 360, 1, 360), -- Tomografia
  (4, 15, 360, 1, 360), -- Ecocardiograma
  (4, 16, 90, 1, 360),
  (4, 17, 90, 1, 360),
  (4, 18, 90, 1, 360),
  (4, 19, 90, 1, 360),
  (4, 20, 36, 4, 1),
  (4, 21, 160, NULL, 1),
  (4, 22, 160, NULL, 1),
  (4, 23, 36, 4, 1),
  (4, 27, 160, 1, 360),
  (4, 28, 160, 1, 360),
  (4, 29, 160, 1, 360),
  (4, 30, 160, 2, 360),
  (4, 31, 160, 1, 360),
  (4, 32, 160, 1, 360),
  (4, 33, 160, 1, 360),
  (4, 34, 160, 1, 360),
  (4, 35, 160, NULL, NULL),
  (4, 36, 160, NULL, NULL),
  (4, 37, 100, NULL, NULL), -- Acupuntura
  (4, 38, 100, NULL, NULL), -- Fisioterapia
  (4, 39, 360, NULL, NULL), -- UTI
  (4, 40, 160, NULL, NULL), -- Domiciliar
  (4, 42, 360, 1, NULL);    -- Cremação

-- CONTEXTO RELACIONAL DA MARI
INSERT INTO contexto_relacional (agent_id, tipo, nome, relacao, especie, raca, idade, historia, tags) VALUES
  (1, 'pet',    'Thor',     'meu pet',          'cachorro', 'Yorkshire Terrier', '4 anos', 
   'Passou por um episódio de saúde grave que custou caro. Foi esse susto que criou empatia profunda com clientes que passam pelo mesmo.',
   ARRAY['yorkshire','pequeno_porte','caro_no_vet','empatia']),
  
  (1, 'pet',    'Bidu',     'meu pet',          'cachorro', 'Shih Tzu', 'adulto',
   'Companhia diária. Sempre junto.',
   ARRAY['shih_tzu','companhia','pequeno_porte']),
  
  (1, 'pet',    'Hércules', 'meu gato',         'gato', NULL, 'adulto',
   'Foi resgatado. Faz parte da família.',
   ARRAY['gato','resgatado','familia']),
  
  (1, 'pessoa', 'Família',  'familia_proxima',  NULL, NULL, NULL,
   'Muito próxima dos pais e do irmão mesmo morando sozinha. Valores familiares aparecem na forma como trata clientes.',
   ARRAY['familia','valores','emocional']);

-- USUÁRIO ADMIN PADRÃO (senha: Plamev@2026)
-- Hash bcrypt da senha Plamev@2026
INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES
  ('Getúlio Cavalcante', 'geta.hubcenter@gmail.com', '$2b$10$placeholder_hash_here', 'admin');
