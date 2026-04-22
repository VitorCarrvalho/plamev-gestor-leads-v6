/**
 * services/audit.service.ts
 * Helper para gravar ações do supervisor na tabela dashv5_audit_log (mari_intelligence).
 * Append-only — nunca deleta.
 */
import { executeIntel } from '../config/db';
import { logger } from '../config/logger';

export interface AuditEntry {
  ator_email?: string;
  ator_ip?: string;
  acao: string;          // ex: 'provocar' | 'silenciar_ia' | 'login' | 'sql_query' ...
  alvo_tipo?: string;    // ex: 'conversa' | 'agente' | 'plano'
  alvo_id?: string;
  detalhe?: any;
}

export async function gravar(e: AuditEntry): Promise<void> {
  try {
    await executeIntel(
      `INSERT INTO dashv5_audit_log (ator_email, ator_ip, acao, alvo_tipo, alvo_id, detalhe)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [e.ator_email || null, e.ator_ip || null, e.acao, e.alvo_tipo || null, e.alvo_id || null, e.detalhe || {}]
    );
  } catch (err: any) {
    logger.warn({ err: err.message, entry: e }, 'falha ao gravar audit');
  }
}
