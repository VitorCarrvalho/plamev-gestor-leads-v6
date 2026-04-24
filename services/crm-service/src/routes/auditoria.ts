/**
 * routes/auditoria.ts — leitura do log de auditoria (append-only).
 */
import { Router } from 'express';
import { autenticar } from '../middleware/auth';
import { query } from '../config/db';

const router = Router();
router.use(autenticar);

router.get('/', async (req, res) => {
  try {
    const { acao, ator, alvo_tipo, desde, limite = '200' } = req.query as any;
    const lim = Math.min(parseInt(limite) || 200, 1000);
    const cond: string[] = [];
    const vals: any[] = [];
    if (acao)      { cond.push(`acao = $${vals.length+1}`);       vals.push(acao); }
    if (ator)      { cond.push(`ator_email ILIKE $${vals.length+1}`); vals.push(`%${ator}%`); }
    if (alvo_tipo) { cond.push(`alvo_tipo = $${vals.length+1}`);  vals.push(alvo_tipo); }
    if (desde)     { cond.push(`criado_em >= $${vals.length+1}`); vals.push(desde); }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

    const rows = await query<any>(
      `SELECT * FROM dashv5_audit_log ${where} ORDER BY criado_em DESC LIMIT ${lim}`,
      vals
    );
    res.json({ ok: true, logs: rows });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

router.get('/acoes', autenticar, async (_req, res) => {
  try {
    const rows = await query<any>(`SELECT acao, COUNT(*)::int AS n FROM dashv5_audit_log GROUP BY acao ORDER BY n DESC`);
    res.json({ ok: true, acoes: rows });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

export default router;
