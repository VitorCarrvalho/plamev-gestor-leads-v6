/**
 * routes/mensagens.ts — CRUD de mensagens individuais do histórico.
 * - PATCH :id  — editar conteúdo (admin)
 * - DELETE :id — excluir mensagem (admin)
 * - POST /reescrever — Mari reescreve um texto no tom dela (com contexto da conversa)
 *
 * Todas as ações vão para auditoria (dashv5_audit_log).
 */
import { Router } from 'express';
import { autenticar, soAdmin } from '../middleware/auth';
import { queryOne, execute } from '../config/db';
import { gravar as auditGravar } from '../services/audit.service';
import { reescreverComoMari } from '../services/actions.service';

const router = Router();

router.patch('/:id', soAdmin, async (req, res) => {
  try {
    const { conteudo } = req.body || {};
    if (!conteudo || typeof conteudo !== 'string') {
      res.status(400).json({ erro: 'conteudo obrigatório' }); return;
    }
    const antes = await queryOne<any>(`SELECT conversa_id, conteudo FROM mensagens WHERE id=$1`, [req.params.id]);
    if (!antes) { res.status(404).json({ erro: 'Mensagem não encontrada' }); return; }

    await execute(`UPDATE mensagens SET conteudo=$1 WHERE id=$2`, [conteudo, req.params.id]);

    const user = (req as any).user;
    await auditGravar({
      ator_email: user?.email,
      ator_ip: req.ip,
      acao: 'mensagem_editar',
      alvo_tipo: 'mensagem',
      alvo_id: req.params.id,
      detalhe: { conversa_id: antes.conversa_id, antes: antes.conteudo, depois: conteudo },
    });

    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

router.delete('/:id', soAdmin, async (req, res) => {
  try {
    const antes = await queryOne<any>(`SELECT conversa_id, conteudo, role FROM mensagens WHERE id=$1`, [req.params.id]);
    if (!antes) { res.status(404).json({ erro: 'Mensagem não encontrada' }); return; }

    await execute(`DELETE FROM mensagens WHERE id=$1`, [req.params.id]);

    const user = (req as any).user;
    await auditGravar({
      ator_email: user?.email,
      ator_ip: req.ip,
      acao: 'mensagem_excluir',
      alvo_tipo: 'mensagem',
      alvo_id: req.params.id,
      detalhe: { conversa_id: antes.conversa_id, role: antes.role, conteudo: antes.conteudo },
    });

    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

router.post('/reescrever', autenticar, async (req, res) => {
  try {
    const { texto, conversa_id, instrucao } = req.body || {};
    if (!texto || typeof texto !== 'string') {
      res.status(400).json({ erro: 'texto obrigatório' }); return;
    }
    const reescrita = await reescreverComoMari(conversa_id, texto, instrucao);

    const user = (req as any).user;
    await auditGravar({
      ator_email: user?.email,
      ator_ip: req.ip,
      acao: 'mensagem_reescrever',
      alvo_tipo: 'conversa',
      alvo_id: conversa_id || null,
      detalhe: { original: texto, instrucao: instrucao || null },
    });

    res.json({ ok: true, texto_reescrito: reescrita });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

export default router;
