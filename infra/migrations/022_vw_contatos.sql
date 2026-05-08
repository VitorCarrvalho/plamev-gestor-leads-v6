-- View agregada para a tela de Contatos
-- Agrega cliente + conversa ativa + telefone + pet sem criar tabela nova

CREATE OR REPLACE VIEW vw_contatos AS
SELECT
  cl.id                        AS id,
  cl.nome                      AS nome,
  cl.origem                    AS origem,
  cl.criado_em                 AS criado_em,

  -- identificador principal (telefone)
  ic.valor                     AS telefone,

  -- conversa ativa (última se houver múltiplas)
  c.id                         AS conversa_id,
  c.etapa                      AS etapa,
  c.status                     AS status,
  c.canal                      AS canal,
  c.score                      AS score,
  c.ia_silenciada              AS ia_silenciada,
  c.numero_externo             AS numero_externo,
  c.criado_em                  AS inicio_conversa,
  c.ultima_interacao           AS ultima_interacao,
  c.agent_id                   AS agente_id,
  c.org_id                     AS org_id,

  -- plano recomendado (campo direto na conversa se existir)
  c.plano_recomendado          AS plano_recomendado,

  -- dados do pet
  pp.nome                      AS pet_nome,
  pp.especie                   AS pet_especie,
  pp.raca                      AS pet_raca,
  pp.idade                     AS pet_idade,
  pp.sexo                      AS pet_sexo,
  pp.problema_saude            AS pet_problema,
  pp.cep                       AS pet_cep

FROM clientes cl
LEFT JOIN identificadores_cliente ic
       ON ic.client_id = cl.id AND ic.tipo = 'phone'
LEFT JOIN LATERAL (
  SELECT * FROM conversas cv
  WHERE cv.client_id = cl.id
  ORDER BY cv.ultima_interacao DESC NULLS LAST, cv.criado_em DESC
  LIMIT 1
) c ON true
LEFT JOIN perfil_pet pp ON pp.client_id = cl.id;
