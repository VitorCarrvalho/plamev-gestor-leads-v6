import { InteractionMetrics } from '@plamev/shared';
import { pool } from './rag';

export async function logInteraction(metrics: InteractionMetrics): Promise<void> {
  try {
    await pool.query(`
      INSERT INTO ai_interaction_logs (
        thread_id,
        input_guard_tokens_in,
        input_guard_tokens_out,
        generation_tokens_in,
        generation_tokens_out,
        output_guard_tokens_in,
        output_guard_tokens_out,
        estimated_cost_usd,
        total_latency_ms,
        provider,
        model
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
      metrics.thread_id,
      metrics.input_guard_tokens_in || 0,
      metrics.input_guard_tokens_out || 0,
      metrics.generation_tokens_in || 0,
      metrics.generation_tokens_out || 0,
      metrics.output_guard_tokens_in || 0,
      metrics.output_guard_tokens_out || 0,
      metrics.estimated_cost_usd || 0,
      metrics.total_latency_ms || 0,
      metrics.provider || 'unknown',
      metrics.model || 'unknown'
    ]);
  } catch (error) {
    console.error('[AGENT-AI] Erro ao gravar interaction log (fire-and-forget):', error);
  }
}
