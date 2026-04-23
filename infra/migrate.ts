/**
 * infra/migrate.ts — Migration Runner automático
 * 
 * Estratégia:
 * - Cria a tabela `schema_migrations` se não existir
 * - Lê todos os arquivos .sql em `infra/migrations/` em ordem
 * - Executa apenas os que ainda não foram aplicados
 * - Idempotente: pode ser chamado múltiplas vezes sem problema
 * - Cada migration roda em uma transação atômica
 */
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();

  try {
    console.log('[MIGRATE] 🔄 Verificando migrations pendentes...');

    // Criar tabela de controle se não existir
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     VARCHAR(255) PRIMARY KEY,
        applied_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Diretório das migrations
    // Em produção (Docker), o processo roda na raiz /app
    // Em dev, roda na raiz do projeto.
    // Tentamos caminhos comuns para garantir que funcione em ambos.
    const possiblePaths = [
      path.join(process.cwd(), 'infra/migrations'),
      path.join(__dirname, 'migrations'),
      path.join(__dirname, '../infra/migrations'),
      path.join(__dirname, '../../infra/migrations')
    ];

    let migrationsDir = '';
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        migrationsDir = p;
        break;
      }
    }

    if (!migrationsDir) {
      console.error('[MIGRATE] ❌ Erro: Nenhum diretório de migrations encontrado!');
      console.error('[MIGRATE] 📂 Caminhos tentados:', possiblePaths);
      return;
    }

    console.log('[MIGRATE] 📂 Usando diretório:', migrationsDir);

    // Listar e ordenar migrations
    const files = fs
      .readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort(); // Ordem lexicográfica: 001_, 002_, 003_...

    // Buscar migrations já aplicadas
    const { rows } = await client.query(
      'SELECT version FROM schema_migrations ORDER BY version ASC'
    );
    const applied = new Set(rows.map((r: any) => r.version));

    let applied_count = 0;

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`[MIGRATE] ✅ Já aplicada: ${file}`);
        continue;
      }

      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      console.log(`[MIGRATE] 🔧 Aplicando: ${file}`);

      // Executar em transação atômica
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
        console.log(`[MIGRATE] ✅ Concluída: ${file}`);
        applied_count++;
      } catch (err: any) {
        await client.query('ROLLBACK');
        console.error(`[MIGRATE] ❌ Falha em ${file}: ${err.message}`);
        throw err; // Re-lança para interromper o startup do serviço
      }
    }

    if (applied_count === 0) {
      console.log('[MIGRATE] ✅ Banco de dados atualizado. Nenhuma migration pendente.');
    } else {
      console.log(`[MIGRATE] 🎉 ${applied_count} migration(s) aplicada(s) com sucesso.`);
    }
  } finally {
    client.release();
  }
}
