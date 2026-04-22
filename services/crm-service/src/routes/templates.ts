/**
 * routes/templates.ts — CRUD de templates de mensagem (Ctrl+T no chat).
 */
import { Router } from 'express';
import { autenticar, soAdmin } from '../middleware/auth';
import { queryIntel, executeIntel } from '../config/db';
import { gravar as auditGravar } from '../services/audit.service';

const router = Router();
router.use(autenticar);

router.get('/', async (req, res) => {
  try {
    const cat = req.query.categoria as string;
    const where = cat ? 'WHERE categoria = $1' : '';
    const rows = await queryIntel<any>(
      `SELECT * FROM dashv5_templates ${where} ORDER BY uso_count DESC, titulo`,
      cat ? [cat] : []
    );
    res.json({ ok: true, templates: rows });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

router.post('/', soAdmin, async (req, res) => {
  try {
    const { categoria = 'geral', atalho, titulo, corpo } = req.body || {};
    if (!titulo || !corpo) { res.status(400).json({ erro: 'titulo e corpo obrigatórios' }); return; }
    const user = (req as any).user;
    const rows = await queryIntel<any>(
      `INSERT INTO dashv5_templates (categoria, atalho, titulo, corpo, criado_por)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [categoria, atalho || null, titulo, corpo, user?.email || 'admin']
    );
    auditGravar({ ator_email: user?.email, acao: 'template_criar', alvo_tipo: 'template', alvo_id: String(rows[0].id), detalhe: { titulo } });
    res.json({ ok: true, template: rows[0] });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

router.patch('/:id', soAdmin, async (req, res) => {
  try {
    const { categoria, atalho, titulo, corpo } = req.body || {};
    const sets: string[] = [];
    const vals: any[] = [];
    if (categoria !== undefined) { sets.push(`categoria=$${vals.length+1}`); vals.push(categoria); }
    if (atalho    !== undefined) { sets.push(`atalho=$${vals.length+1}`);    vals.push(atalho || null); }
    if (titulo    !== undefined) { sets.push(`titulo=$${vals.length+1}`);    vals.push(titulo); }
    if (corpo     !== undefined) { sets.push(`corpo=$${vals.length+1}`);     vals.push(corpo); }
    if (!sets.length) { res.status(400).json({ erro: 'Nada para atualizar' }); return; }
    sets.push(`atualizado_em = NOW()`);
    vals.push(req.params.id);
    await executeIntel(`UPDATE dashv5_templates SET ${sets.join(',')} WHERE id=$${vals.length}`, vals);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

router.delete('/:id', soAdmin, async (req, res) => {
  try {
    const user = (req as any).user;
    await executeIntel(`DELETE FROM dashv5_templates WHERE id=$1`, [req.params.id]);
    auditGravar({ ator_email: user?.email, acao: 'template_excluir', alvo_tipo: 'template', alvo_id: req.params.id });
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// Incrementa contador de uso (chamado quando user insere no chat)
router.post('/:id/usar', async (req, res) => {
  try {
    await executeIntel(`UPDATE dashv5_templates SET uso_count = uso_count + 1 WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

export default router;
