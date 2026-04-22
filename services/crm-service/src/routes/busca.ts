/**
 * routes/busca.ts — busca full-text em mensagens (GAP do V4).
 * Procura em mensagens.conteudo com ILIKE (pode evoluir para tsvector + GIN).
 */
import { Router } from 'express';
import { autenticar } from '../middleware/auth';
import { query } from '../config/db';

const router = Router();
router.use(autenticar);

router.get('/', async (req, res) => {
  try {
    const q = (req.query.q as string || '').trim();
    const canal = req.query.canal as string;
    const desde = req.query.desde as string;
    const limite = Math.min(parseInt(req.query.limite as string || '100'), 500);

    if (!q || q.length < 2) { res.json({ ok: true, resultados: [], total: 0 }); return; }

    const cond: string[] = [`m.conteudo ILIKE $1`];
    const vals: any[] = [`%${q}%`];
    if (canal) { cond.push(`c.canal = $${vals.length+1}`); vals.push(canal); }
    if (desde) { cond.push(`m.timestamp >= $${vals.length+1}`); vals.push(desde); }

    const rows = await query<any>(`
      SELECT
        m.id, m.conversa_id, m.role, m.enviado_por,
        LEFT(m.conteudo, 400) AS trecho,
        m.timestamp,
        c.canal, c.numero_externo AS phone,
        cli.nome AS nome_cliente, pp.nome AS nome_pet
      FROM mensagens m
      JOIN conversas c ON c.id = m.conversa_id
      LEFT JOIN clientes cli ON cli.id = c.client_id
      LEFT JOIN perfil_pet pp ON pp.client_id = c.client_id
      WHERE ${cond.join(' AND ')}
      ORDER BY m.timestamp DESC
      LIMIT ${limite}
    `, vals);

    res.json({ ok: true, resultados: rows, total: rows.length, query: q });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

export default router;
