/**
 * routes/agenda.ts — mensagens agendadas (followup_agendado).
 */
import { Router } from 'express';
import { autenticar } from '../middleware/auth';
import { query, execute } from '../config/db';

const router = Router();
router.use(autenticar);

router.get('/', async (req, res) => {
  try {
    const orgId = req.headers['x-org-id'] || '00000000-0000-0000-0000-000000000000';
    const status = (req.query.status as string) || 'pendente';
    const rows = await query<any>(`
      SELECT fa.*, c.numero_externo AS phone, cli.nome AS nome_cliente, pp.nome AS nome_pet
      FROM followup_agendado fa
      LEFT JOIN conversas c ON c.id = fa.conversa_id
      LEFT JOIN clientes cli ON cli.id = c.client_id
      LEFT JOIN perfil_pet pp ON pp.client_id = c.client_id
      WHERE ($1 = 'todos' OR fa.status = $1) AND c.org_id = $2
      ORDER BY fa.executar_em ASC NULLS LAST
      LIMIT 200
    `, [status, orgId]);
    res.json({ ok: true, agendamentos: rows });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

router.post('/:id/cancelar', async (req, res) => {
  try {
    await execute(`UPDATE followup_agendado SET status='cancelado' WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// PATCH: editar mensagem e/ou reagendar um followup PENDENTE
// Body: { mensagem?: string, executar_em?: ISO-8601 }
router.patch('/:id', async (req, res) => {
  try {
    const mensagem: string | undefined = req.body?.mensagem;
    const executarEm: string | undefined = req.body?.executar_em;

    if (mensagem === undefined && executarEm === undefined) {
      res.status(400).json({ erro: 'Nada para atualizar (mensagem ou executar_em)' }); return;
    }

    // Valida existência e status
    const rows = await query<any>(
      `SELECT id, status FROM followup_agendado WHERE id=$1`,
      [req.params.id]
    );
    if (!rows.length) { res.status(404).json({ erro: 'Agendamento não encontrado' }); return; }
    if (rows[0].status !== 'pendente') {
      res.status(400).json({ erro: `Não é possível editar: status=${rows[0].status}` }); return;
    }

    // Valida data se fornecida
    if (executarEm) {
      const dt = new Date(executarEm);
      if (isNaN(dt.getTime())) { res.status(400).json({ erro: 'executar_em inválido' }); return; }
      if (dt.getTime() < Date.now() - 60_000) {
        res.status(400).json({ erro: 'executar_em não pode estar no passado' }); return;
      }
    }

    // Monta UPDATE dinâmico com os campos presentes
    const sets: string[] = [];
    const vals: any[] = [];
    if (mensagem !== undefined)   { sets.push(`mensagem = $${sets.length + 1}`);    vals.push(mensagem); }
    if (executarEm !== undefined) { sets.push(`executar_em = $${sets.length + 1}`); vals.push(executarEm); }
    vals.push(req.params.id);

    await execute(
      `UPDATE followup_agendado SET ${sets.join(', ')} WHERE id = $${vals.length}`,
      vals
    );
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

export default router;
