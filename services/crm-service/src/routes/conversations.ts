/**
 * routes/conversations.ts — endpoints REST de monitoramento.
 * Reusa repository do V4 sem alterações.
 */
import { Router } from 'express';
import { autenticar } from '../middleware/auth';
import * as repo from '../repositories/conversations.repository';
import { execute, queryOne } from '../config/db';

const router = Router();

router.get('/conversas', autenticar, async (_req, res) => {
  try { res.json(await repo.listarConversas()); }
  catch (e: any) { res.status(500).json({ erro: e.message }); }
});

router.get('/conversa/:id', autenticar, async (req, res) => {
  try {
    const id = req.params.id;
    const conversa = await repo.buscarConversa(id);
    if (!conversa) { res.status(404).json({ erro: 'Conversa não encontrada' }); return; }
    const msgs = await repo.buscarMensagens(id);
    const perfil = await repo.buscarPerfil(conversa.client_id);
    const agendamentos = await repo.buscarAgendamentos(id);
    const obsidianAtivo = await repo.buscarObsidianAtivo(id);
    const etapasVisitadas = await repo.buscarEtapasVisitadas(id);
    res.json({ conversa, msgs, perfil, agendamentos, obsidianAtivo, etapasVisitadas });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

router.get('/stats', autenticar, async (_req, res) => {
  try { res.json(await repo.buscarStats()); }
  catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// Atualiza etapa da conversa manualmente — usado para marcar "pago" quando
// o pagamento é confirmado no ERP, ou para corrigir etapas emperradas.
router.patch('/conversa/:id/etapa', autenticar, async (req, res) => {
  try {
    const { id } = req.params;
    const etapa: string = (req.body?.etapa || '').toString();
    const ETAPAS_VALIDAS = [
      'acolhimento','qualificacao','apresentacao_planos','validacao_cep',
      'negociacao','objecao','pre_fechamento','fechamento','venda_fechada','pago',
      'sem_cobertura','encerrado',
    ];
    if (!ETAPAS_VALIDAS.includes(etapa)) {
      res.status(400).json({ erro: `etapa inválida: ${etapa}` }); return;
    }
    const atual = await queryOne<any>('SELECT etapa FROM conversas WHERE id=$1', [id]);
    if (!atual) { res.status(404).json({ erro: 'Conversa não encontrada' }); return; }
    await execute('UPDATE conversas SET etapa=$1 WHERE id=$2', [etapa, id]);
    await execute(
      'INSERT INTO funil_conversao (conversa_id, etapa_origem, etapa_destino) VALUES ($1,$2,$3)',
      [id, atual.etapa, etapa]
    ).catch(() => {});

    // Ao marcar 'pago' manualmente, notifica supervisores pelo WhatsApp
    // com os dados do cliente (nome, telefone, pet, plano, CEP).
    if (etapa === 'pago') {
      const ctx = await queryOne<any>(
        `SELECT c.nome AS cliente_nome, c.phone AS cliente_phone,
                p.nome AS pet_nome, p.raca AS pet_raca, p.cep AS pet_cep,
                co.plano_recomendado
         FROM conversas co
         JOIN clientes c ON c.id = co.cliente_id
         LEFT JOIN perfil_pet p ON p.cliente_id = c.id
         WHERE co.id = $1
         LIMIT 1`,
        [id]
      ).catch(() => null);
      if (ctx) {
        const { notificarPagoManual } = await import('../services/supervisor-notifier');
        notificarPagoManual({
          clienteNome:  ctx.cliente_nome,
          clientePhone: ctx.cliente_phone,
          petNome:      ctx.pet_nome,
          petRaca:      ctx.pet_raca,
          cep:          ctx.pet_cep,
          plano:        ctx.plano_recomendado,
          etapa:        'pago',
        }).catch(e => console.warn('[SUPERVISOR] notify pago:', e.message));
      }
    }

    res.json({ ok: true, etapa });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

export default router;
