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
import { query, queryOne, execute } from '../config/db';
import { gravar as auditGravar } from '../services/audit.service';
import { reescreverComoMari } from '../services/actions.service';

const CHANNEL_SERVICE_URL = process.env.CHANNEL_SERVICE_URL || 'http://channel-service.railway.internal:8080';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'plamev-internal';

const router = Router();

router.patch('/:id', soAdmin, async (req, res) => {
  try {
    const { conteudo } = req.body || {};
    if (!conteudo || typeof conteudo !== 'string') {
      res.status(400).json({ erro: 'conteudo obrigatório' }); return;
    }
    const antes = await queryOne<any>(
      `SELECT m.conversa_id, m.conteudo, m.msg_id_externo, m.role,
              c.numero_externo AS phone, c.jid, c.instancia_whatsapp AS instancia
       FROM mensagens m JOIN conversas c ON c.id = m.conversa_id WHERE m.id=$1`,
      [req.params.id]
    );
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

    // Propagate text edit to WhatsApp if message was sent by the bot and has an Evolution key
    if (antes.msg_id_externo && antes.role === 'agent' && antes.phone && antes.instancia) {
      fetch(`${CHANNEL_SERVICE_URL}/internal/update-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
        body: JSON.stringify({
          phone: antes.phone,
          jid: antes.jid || null,
          instancia: antes.instancia,
          msgIdExterno: antes.msg_id_externo,
          novoTexto: conteudo,
        }),
        signal: AbortSignal.timeout(5000),
      }).catch(e => console.warn('[MENSAGENS] Falha ao propagar edição WA:', e.message));
    }

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

// ── Envio de mídia pelo supervisor ───────────────────────────────────────
router.post('/enviar-midia', autenticar, async (req, res) => {
  try {
    const { conversa_id, base64, mimeType, fileName } = req.body || {};
    if (!conversa_id || !base64 || !mimeType) {
      res.status(400).json({ erro: 'conversa_id, base64 e mimeType são obrigatórios' }); return;
    }
    const conversa = await queryOne<any>(
      `SELECT numero_externo, jid, instancia_whatsapp FROM conversas WHERE id=$1`,
      [conversa_id]
    );
    if (!conversa) { res.status(404).json({ erro: 'Conversa não encontrada' }); return; }

    const tipoLabel = mimeType.startsWith('image/') ? 'imagem'
      : mimeType.startsWith('video/') ? 'vídeo'
      : mimeType.startsWith('audio/') ? 'áudio'
      : 'arquivo';
    const conteudo = `[📎 ${tipoLabel}: ${fileName || 'arquivo'} enviado]`;

    await execute(
      `INSERT INTO mensagens (conversa_id, role, conteudo, enviado_por, metadata)
       VALUES ($1,'agent',$2,'supervisora',$3)`,
      [conversa_id, conteudo, JSON.stringify({ mediaType: tipoLabel, mimeType, fileName: fileName || 'arquivo' })]
    );

    fetch(`${CHANNEL_SERVICE_URL}/internal/send-media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({
        phone: conversa.numero_externo,
        jid: conversa.jid || null,
        instancia: conversa.instancia_whatsapp || null,
        base64,
        mimeType,
        fileName: fileName || 'arquivo',
        caption: '',
      }),
      signal: AbortSignal.timeout(30000),
    }).catch(e => console.warn('[MENSAGENS] Falha ao enviar mídia WA:', e.message));

    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Reações ────────────────────────────────────────────────────
// GET /:conversaId/reactions → mapa de msgId → emoji[]
router.get('/:conversaId/reactions', autenticar, async (req, res) => {
  try {
    const rows = await query<any>(
      `SELECT msg_id::text, emoji FROM message_reactions WHERE msg_id IN (
         SELECT id FROM mensagens WHERE conversa_id=$1
       ) ORDER BY criado_em ASC`,
      [req.params.conversaId]
    );
    const mapa: Record<string, string[]> = {};
    for (const r of rows) {
      if (!mapa[r.msg_id]) mapa[r.msg_id] = [];
      if (!mapa[r.msg_id].includes(r.emoji)) mapa[r.msg_id].push(r.emoji);
    }
    res.json({ ok: true, reactions: mapa });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// POST /:msgId/reaction → { emoji } — salva e envia via Evolution
router.post('/:msgId/reaction', autenticar, async (req, res) => {
  try {
    const { emoji } = req.body || {};
    if (!emoji) { res.status(400).json({ erro: 'emoji obrigatório' }); return; }

    const msg = await queryOne<any>(
      `SELECT m.id, m.msg_id_externo, m.conversa_id,
              c.numero_externo AS phone, c.jid, c.instancia_whatsapp AS instancia
       FROM mensagens m JOIN conversas c ON c.id = m.conversa_id WHERE m.id=$1`,
      [req.params.msgId]
    );
    if (!msg) { res.status(404).json({ erro: 'Mensagem não encontrada' }); return; }

    // Idempotência: remove reação anterior do mesmo supervisor nessa mensagem
    await execute(
      `DELETE FROM message_reactions WHERE msg_id=$1 AND enviado_por=$2`,
      [req.params.msgId, (req as any).user?.email || 'supervisora']
    );

    // Emoji vazio = remover reação
    if (emoji !== '') {
      await execute(
        `INSERT INTO message_reactions (msg_id, msg_id_externo, emoji, enviado_por)
         VALUES ($1,$2,$3,$4)`,
        [req.params.msgId, msg.msg_id_externo || null, emoji, (req as any).user?.email || 'supervisora']
      );
    }

    // Envia reação para WhatsApp apenas se tiver Evolution message ID
    if (msg.msg_id_externo && msg.phone) {
      fetch(`${CHANNEL_SERVICE_URL}/internal/send-reaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
        body: JSON.stringify({
          phone: msg.phone,
          jid: msg.jid || null,
          instancia: msg.instancia || null,
          msgIdExterno: msg.msg_id_externo,
          emoji: emoji || '❌',
        }),
        signal: AbortSignal.timeout(5000),
      }).catch(e => console.warn('[MENSAGENS] Falha ao enviar reação WA:', e.message));
    }

    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

export default router;
