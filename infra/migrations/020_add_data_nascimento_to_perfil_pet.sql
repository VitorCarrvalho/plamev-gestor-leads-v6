-- Migration para adicionar a coluna data_nascimento na tabela perfil_pet
ALTER TABLE perfil_pet ADD COLUMN IF NOT EXISTS data_nascimento VARCHAR(20);
