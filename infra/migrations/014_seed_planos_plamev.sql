-- Migration 014: Seed idempotente dos planos oficiais da Plamev
-- Objetivo: garantir que a tabela `planos` não fique vazia no deploy do Railway
-- Observação: esta migration não inventa preços. Os valores continuam vindo da tabela `precos`.

INSERT INTO planos (slug, nome, descricao, ativo)
VALUES
  (
    'slim',
    'Slim',
    'Plano básico essencial, ideal para pets jovens e saudáveis. Inclui consultas veterinárias, exames básicos, vacinas e cobertura para emergências a partir de 15 dias, sem coparticipação.',
    TRUE
  ),
  (
    'advance',
    'Advance',
    'Plano âncora e mais vendido. Inclui tudo do Slim, com mais exames laboratoriais, procedimentos clínicos e cobertura para cirurgias essenciais, sem coparticipação.',
    TRUE
  ),
  (
    'platinum',
    'Platinum',
    'Plano de segurança ampliada. Inclui tudo do Advance, exames mais completos e especializados, cobertura cirúrgica mais ampla e acompanhamento mais completo da saúde, sem coparticipação.',
    TRUE
  ),
  (
    'diamond',
    'Diamond',
    'Plano premium de máxima cobertura. Inclui tudo do Platinum, UTI e internação, exames avançados, atendimento domiciliar e telemedicina ampliada, sem coparticipação.',
    TRUE
  )
ON CONFLICT (slug) DO UPDATE
SET
  nome = EXCLUDED.nome,
  descricao = EXCLUDED.descricao,
  ativo = EXCLUDED.ativo;

SELECT setval(
  pg_get_serial_sequence('planos', 'id'),
  GREATEST(COALESCE((SELECT MAX(id) FROM planos), 1), 1),
  TRUE
);
