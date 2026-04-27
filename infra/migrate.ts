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

/**
 * Divide um arquivo SQL em statements individuais.
 * Respeita dollar-quoting ($BODY$...$BODY$) — não divide dentro deles.
 */
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let dollarTag: string | null = null;
  let i = 0;

  while (i < sql.length) {
    // Detecta início/fim de dollar-quoting
    if (dollarTag === null) {
      const dollarMatch = sql.slice(i).match(/^(\$[A-Za-z0-9_]*\$)/);
      if (dollarMatch) {
        dollarTag = dollarMatch[1];
        current += dollarTag;
        i += dollarTag.length;
        continue;
      }
    } else {
      if (sql.slice(i).startsWith(dollarTag)) {
        current += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
    }

    const ch = sql[i];

    // Fora de dollar-quoting: semicolon separa statements
    if (dollarTag === null && ch === ';') {
      const stmt = current.trim();
      if (stmt) statements.push(stmt + ';');
      current = '';
      i++;
      continue;
    }

    // Pula comentários de linha
    if (dollarTag === null && ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end + 1;
      continue;
    }

    current += ch;
    i++;
  }

  const remaining = current.trim();
  if (remaining) statements.push(remaining);
  return statements;
}

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
      path.join(process.cwd(), '../../infra/migrations'),
      path.join(process.cwd(), '../infra/migrations'),
      path.join(__dirname, 'migrations'),
      path.join(__dirname, '../infra/migrations'),
      path.join(__dirname, '../../infra/migrations'),
      path.join(__dirname, '../../../infra/migrations'),
      '/app/infra/migrations' // Caminho absoluto padrão no Docker Railway
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
      console.error('[MIGRATE] 📂 Caminhos tentados:', JSON.stringify(possiblePaths, null, 2));
      return;
    }

    console.log('[MIGRATE] 📂 Usando diretório:', migrationsDir);

    // Listar e ordenar migrations
    const allFiles = fs.readdirSync(migrationsDir);
    console.log('[MIGRATE] 📄 Arquivos encontrados no diretório:', allFiles);

    const sqlFiles = allFiles
      .filter(f => f.endsWith('.sql'))
      .sort(); // Ordem lexicográfica: 001_, 002_, 003_...
    
    console.log('[MIGRATE] 📝 SQLs para processar:', sqlFiles);

    // Buscar migrations já aplicadas
    const { rows } = await client.query(
      'SELECT version FROM schema_migrations ORDER BY version ASC'
    );
    const applied = new Set(rows.map((r: any) => r.version));

    let applied_count = 0;

    for (const file of sqlFiles) {
      if (applied.has(file)) {
        console.log(`[MIGRATE] ✅ Já aplicada: ${file}`);
        continue;
      }

      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      console.log(`[MIGRATE] 🔧 Aplicando: ${file} (${sql.length} bytes)`);

      // Executar em transação atômica, statement por statement
      // (evita falha silenciosa do pg com SQLs muito grandes / dollar-quoting)
      await client.query('BEGIN');
      try {
        // Divide o SQL em statements individuais respeitando dollar-quoting
        const statements = splitSqlStatements(sql);
        console.log(`[MIGRATE] 📝 ${file}: ${statements.length} statements`);
        for (let i = 0; i < statements.length; i++) {
          const stmt = statements[i].trim();
          if (!stmt) continue;
          try {
            await client.query(stmt);
          } catch (stmtErr: any) {
            console.error(`[MIGRATE] ❌ ${file} statement ${i + 1}/${statements.length}: ${stmtErr.message}`);
            console.error(`[MIGRATE] SQL: ${stmt.substring(0, 200)}`);
            throw stmtErr;
          }
        }
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
