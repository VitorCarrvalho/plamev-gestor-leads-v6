-- Migração 005: Seed de dados básicos para funcionamento do Dashboard

-- 1. Garantir Organização Default
INSERT INTO organizations (id, slug, nome) 
VALUES ('00000000-0000-0000-0000-000000000000', 'plamev', 'Plamev Vendas')
ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome;

-- 2. Garantir Agente Mari (id 1)
INSERT INTO agentes (id, slug, nome, ativo, org_id)
VALUES (1, 'mari', 'Mari (IA)', true, '00000000-0000-0000-0000-000000000000')
ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, org_id = EXCLUDED.org_id;

-- 3. Garantir Agente Rapha (id 2)
INSERT INTO agentes (id, slug, nome, ativo, org_id)
VALUES (2, 'rapha', 'Rapha (IA)', true, '00000000-0000-0000-0000-000000000000')
ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, org_id = EXCLUDED.org_id;

-- Ajustar a sequência do ID de agentes (necessário por causa do INSERT manual de IDs fixos)
SELECT setval(pg_get_serial_sequence('agentes', 'id'), (SELECT MAX(id) FROM agentes));
