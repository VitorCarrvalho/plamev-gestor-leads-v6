/**
 * config/env.ts — V5
 * Diferença vs V4: secrets SEMPRE de process.env, sem fallback hardcoded em prod.
 * Em dev mantém defaults para facilitar.
 *
 * ⚠️ 21/04/2026 — Getúlio: carregamos com override=true pra garantir que
 * vars do `.env` do dashboard-v5 ganham de qualquer var exportada no shell
 * (antes, se o shell tinha ANTHROPIC_API_KEY, o dotenv ignorava a nossa e
 * a Mari ficava sem poder chamar Claude pro provocar/instruir/reescrever).
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

const DEV = (process.env.NODE_ENV || 'development') !== 'production';

function req(key: string, devFallback?: string): string {
  const v = process.env[key];
  if (v) return v;
  if (DEV && devFallback !== undefined) return devFallback;
  throw new Error(`Env obrigatória ausente: ${key}`);
}

export const env = {
  port:         parseInt(process.env.DASH_V5_PORT || '3452'),
  jwtSecret:    req('JWT_SECRET_DASH_V5', 'dashv5-secret-dev'),
  dbUrl:        process.env.DATABASE_URL      || 'postgresql://geta@localhost:5432/mariv3',
  dbIntelUrl:   process.env.DATABASE_INTEL_URL || 'postgresql://geta@localhost:5432/mari_intelligence',
  adminEmail:   req('ADMIN_EMAIL', 'geta.hubcenter@gmail.com'),
  adminPass:    req('ADMIN_PASS',  'Plamev@2026'),
  evolutionUrl: process.env.EVOLUTION_API_URL || 'https://legendarios-evolution-api.bycpkh.easypanel.host',
  // APIs externas — opcionais (rotas desativam quando ausente)
  evolutionKey: process.env.EVOLUTION_API_KEY || '',
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  claudeModel:  process.env.MODEL_AGENTE || 'claude-haiku-4-5',
  mariApiUrl:   process.env.MARI_API_URL || 'http://localhost:3401',
  corsOrigins:  (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim()),
  nodeEnv:      process.env.NODE_ENV || 'development',
  isDev:        DEV,
};
