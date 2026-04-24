import { execute } from '../config/db';

export async function gravar(params: {
  ator_email?: string;
  ator_ip?: string;
  acao: string;
  alvo_tipo?: string;
  alvo_id?: string | null;
  detalhe?: object;
}): Promise<void> {
  try {
    await execute(
      `INSERT INTO dashv5_audit_log (ator_email, ator_ip, acao, alvo_tipo, alvo_id, detalhe)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.ator_email || null,
        params.ator_ip || null,
        params.acao,
        params.alvo_tipo || null,
        params.alvo_id || null,
        params.detalhe ? JSON.stringify(params.detalhe) : null,
      ]
    );
  } catch (e: any) {
    console.error('[AUDIT] Falha ao gravar:', e.message);
  }
}
