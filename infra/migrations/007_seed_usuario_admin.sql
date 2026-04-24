-- Migração 007: Seed do usuário admin
-- Usa pgcrypto para gerar o hash bcrypt direto no banco.
-- ON CONFLICT garante idempotência: rodar duas vezes não duplica o registro.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO usuarios (nome, email, senha_hash, perfil, ativo)
VALUES (
  'Admin',
  'geta.hubcenter@gmail.com',
  crypt('Plamev@2026', gen_salt('bf', 10)),
  'admin',
  true
)
ON CONFLICT (email) DO NOTHING;
