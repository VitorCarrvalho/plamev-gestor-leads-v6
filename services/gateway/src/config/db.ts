import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://geta@localhost:5432/mariv3',
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  keepAlive: true,
});

pool.on('error', (e) => console.error('[GATEWAY][DB] Erro:', e.message));

export const query = <T>(sql: string, params?: any[]) => pool.query(sql, params).then(r => r.rows as T[]);
export const queryOne = <T>(sql: string, params?: any[]) => pool.query(sql, params).then(r => (r.rows[0] as T) || null);
export const execute = (sql: string, params?: any[]) => pool.query(sql, params);
