/**
 * routes/llm-config.ts — CRUD de provedores LLM.
 * Montado em /api/config/llm
 * API keys nunca são retornadas em claro — apenas últimos 4 chars + tem_key flag.
 */
import { Router } from 'express';
import { autenticar, soAdmin } from '../middleware/auth';
import { query, execute, queryOne } from '../config/db';

const router = Router();

export const PROVEDORES_MODELOS: Record<string, string[]> = {
  anthropic: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-5'],
  openai:    ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  google:    ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  groq:      ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768', 'llama-3.1-8b-instant'],
  mistral:   ['mistral-large-latest', 'mistral-medium', 'mistral-small-latest'],
};

function isMasked(v: unknown): boolean {
  return typeof v === 'string' && v.includes('•');
}

// ── Modelos disponíveis por provedor ──────────────────────────────
router.get('/modelos', autenticar, (_req, res) => {
  res.json({ ok: true, provedores: PROVEDORES_MODELOS });
});

// ── Lista todos (keys mascaradas) ─────────────────────────────────
router.get('/', autenticar, async (req, res) => {
  try {
    const orgId = req.headers['x-org-id'] as string;
    const rows = await query<any>(
      `SELECT id, nome, provedor, modelo, temperatura, max_tokens, ativo, padrao, criado_em,
              CASE WHEN LENGTH(api_key) > 0 THEN TRUE ELSE FALSE END AS tem_key,
              CASE WHEN LENGTH(api_key) >= 4 THEN '••••••••' || RIGHT(api_key, 4) ELSE '' END AS api_key_display
       FROM llm_configs WHERE org_id=$1 ORDER BY padrao DESC, nome ASC`,
      [orgId]
    );
    res.json({ ok: true, configs: rows });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Criar ─────────────────────────────────────────────────────────
router.post('/', soAdmin, async (req, res) => {
  try {
    const orgId = req.headers['x-org-id'] as string;
    const { nome, provedor, modelo, api_key = '', temperatura = 0.7, max_tokens = 4096 } = req.body || {};
    if (!nome || !provedor || !modelo) {
      res.status(400).json({ erro: 'nome, provedor e modelo são obrigatórios' }); return;
    }
    const row = await queryOne<any>(
      `INSERT INTO llm_configs (org_id, nome, provedor, modelo, api_key, temperatura, max_tokens)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, nome, provedor, modelo, temperatura, max_tokens, ativo, padrao`,
      [orgId, nome, provedor, modelo, api_key, temperatura, max_tokens]
    );
    res.json({ ok: true, config: row });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Atualizar ─────────────────────────────────────────────────────
router.patch('/:id', soAdmin, async (req, res) => {
  try {
    const orgId = req.headers['x-org-id'] as string;
    const allowed = ['nome', 'provedor', 'modelo', 'temperatura', 'max_tokens', 'ativo'];
    const sets: string[] = [];
    const vals: any[] = [];
    for (const k of allowed) {
      if (req.body[k] !== undefined) { sets.push(`${k}=$${vals.length + 1}`); vals.push(req.body[k]); }
    }
    if (req.body.api_key && !isMasked(req.body.api_key)) {
      sets.push(`api_key=$${vals.length + 1}`); vals.push(String(req.body.api_key).trim());
    }
    if (!sets.length) { res.status(400).json({ erro: 'Nada para atualizar' }); return; }
    vals.push(req.params.id, orgId);
    await execute(
      `UPDATE llm_configs SET ${sets.join(',')} WHERE id=$${vals.length - 1} AND org_id=$${vals.length}`,
      vals
    );
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Definir como padrão ───────────────────────────────────────────
router.put('/:id/padrao', soAdmin, async (req, res) => {
  try {
    const orgId = req.headers['x-org-id'] as string;
    await execute('UPDATE llm_configs SET padrao=FALSE WHERE org_id=$1', [orgId]);
    await execute('UPDATE llm_configs SET padrao=TRUE WHERE id=$1 AND org_id=$2', [req.params.id, orgId]);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Remover ───────────────────────────────────────────────────────
router.delete('/:id', soAdmin, async (req, res) => {
  try {
    const orgId = req.headers['x-org-id'] as string;
    const cfg = await queryOne<any>('SELECT padrao FROM llm_configs WHERE id=$1 AND org_id=$2', [req.params.id, orgId]);
    if (!cfg) { res.status(404).json({ erro: 'Config não encontrada' }); return; }
    if (cfg.padrao) { res.status(400).json({ erro: 'Não é possível remover o provedor padrão. Defina outro como padrão primeiro.' }); return; }
    await execute('DELETE FROM llm_configs WHERE id=$1 AND org_id=$2', [req.params.id, orgId]);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

export default router;
