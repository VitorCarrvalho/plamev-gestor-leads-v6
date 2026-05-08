-- Adiciona campos de perfil e preferências ao usuário
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS foto_url TEXT,
  ADD COLUMN IF NOT EXISTS preferencias JSONB DEFAULT '{}'::jsonb;
