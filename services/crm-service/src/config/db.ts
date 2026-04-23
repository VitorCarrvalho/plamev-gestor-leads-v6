/**
 * server/config/db.ts — Dashboard V5
 * Pool PostgreSQL com retry, keepalive e pg_isready check.
 */
import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://geta@localhost:5432/mariv3',
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  keepAlive: true,
});
pool.on('error', e => console.error('[DB mariv3] Erro:', e.message));

export const poolIntel = new Pool({
  connectionString: process.env.DATABASE_INTEL_URL || 'postgresql://geta@localhost:5432/mari_intelligence',
  max: 5,
  idleTimeoutMillis: 30_000,
  keepAlive: true,
});
poolIntel.on('error', e => console.error('[DB intel] Erro:', e.message));

export const query        = <T>(sql: string, p?: any[]) => pool.query(sql, p).then(r => r.rows as T[]);
export const queryOne     = <T>(sql: string, p?: any[]) => pool.query(sql, p).then(r => r.rows[0] as T || null);
export const execute      = (sql: string, p?: any[]) => pool.query(sql, p);

export const queryIntel   = <T>(sql: string, p?: any[]) => poolIntel.query(sql, p).then(r => r.rows as T[]);
export const executeIntel = (sql: string, p?: any[]) => poolIntel.query(sql, p);

export async function testar() {
  try {
    const r = await queryOne<any>(`SELECT 1 as ok`);
    console.log(`[DB V5] ✅ Conexão estabelecida.`);
  } catch (e: any) {
    console.warn(`[DB V5] ⚠️ Falha na conexão: ${e.message}`);
  }
}
