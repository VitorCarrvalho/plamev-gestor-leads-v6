/**
 * websocket/socket.server.ts
 * Servidor Socket.IO do dashboard V4.
 *
 * Responsabilidades:
 * - Autenticar conexões via JWT
 * - Receber eventos do pipeline da Mari (POST /interno/nova-msg)
 * - Emitir eventos para o frontend em tempo real
 * - Delegar ações operacionais aos serviços
 *
 * Separação clara:
 * - Eventos de LEITURA: buscar dados do BD
 * - Eventos de ESCRITA: ações operacionais (provocar, silenciar, etc.)
 * - Notificações: recebidas do pipeline, repassadas ao frontend
 */
import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import { validarTokenSocket } from '../../../crm-service/src/middleware/auth';
import * as repo from '../../../crm-service/src/repositories/conversations.repository';
import { reescreverComoMari } from '../../../crm-service/src/services/actions.service';
import { execute, queryOne, query } from '../../../crm-service/src/config/db';

let io: SocketServer;
const ORG_ID = '00000000-0000-0000-0000-000000000000';

function emitUnsupported(socket: Socket, eventName: string) {
  socket.emit('erro', { msg: `Ação ainda não operacional via socket: ${eventName}` });
}

export function iniciarSocket(server: HttpServer): SocketServer {
  io = new SocketServer(server, {
    cors: { origin: '*' },
    pingTimeout: 60000,
  });

  // ── Autenticação ─────────────────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Token ausente'));
    const user = validarTokenSocket(token);
    if (!user) return next(new Error('Token inválido'));
    (socket as any).user = user;
    next();
  });

  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] Conectado: ${socket.id} (${(socket as any).user?.email})`);

    // ── LEITURA: lista de conversas ────────────────────────────
    socket.on('get_conversas', async () => {
      try {
        const conversas = await repo.listarConversas(ORG_ID);
        socket.emit('conversas_data', conversas);
        socket.emit('stats_data', await repo.buscarStats(ORG_ID));
      } catch (e: any) {
        socket.emit('erro', { msg: e.message });
      }
    });

    // ── LEITURA: conversa completa ─────────────────────────────
    socket.on('get_conversa', async (id: string) => {
      try {
        const conversa = await repo.buscarConversa(ORG_ID, id);
        if (!conversa) return socket.emit('erro', { msg: 'Conversa não encontrada' });
        const mensagens = await repo.buscarMensagens(ORG_ID, id);
        const perfil = await repo.buscarPerfil(conversa.client_id);
        const agendamentos = await repo.buscarAgendamentos(id);
        const obsidianAtivo = await repo.buscarObsidianAtivo(id).catch(() => []);
        const etapasVisitadas = await repo.buscarEtapasVisitadas(id).catch(() => []);
        socket.join(`conversa:${id}`);
        socket.emit('conversa_data', { conversa, mensagens, perfil, agendamentos, obsidianAtivo, etapasVisitadas });
      } catch (e: any) {
        socket.emit('erro', { msg: e.message });
      }
    });

    // ── LEITURA: mais mensagens (paginação) ────────────────────
    socket.on('get_mais_msgs', async ({ conversa_id, antes_id }: { conversa_id: string; antes_id: string }) => {
      try {
        const mensagens = await repo.buscarMensagens(ORG_ID, conversa_id, undefined, antes_id);
        socket.emit('mais_msgs_data', { conversa_id, mensagens });
      } catch (e: any) {
        socket.emit('erro', { msg: e.message });
      }
    });

    // ── AÇÃO: silenciar / ativar IA ────────────────────────────
    socket.on('silenciar_ia', async (conversa_id: string) => {
      try {
        const silenciada = await repo.toggleSilenciarIA(conversa_id);
        io.emit('ia_status', { conversa_id, silenciada });
      } catch (e: any) {
        socket.emit('erro', { msg: e.message });
      }
    });

    // ── AÇÃO: provocar (reativação contextualizada) ────────────
    socket.on('provocar', async ({ conversa_id }: { conversa_id: string }) => {
      console.log(`[ACTIONS] 🎯 provocar → conversa=${conversa_id} por ${(socket as any).user?.email}`);
      emitUnsupported(socket, 'provocar');
    });

    // ── AÇÃO: instruir Mari (supervisor instrui, Mari executa) ──
    socket.on('instrucao', async ({ conversa_id, texto }: { conversa_id: string; texto: string }) => {
      console.log(`[ACTIONS] 🎯 instrucao → conversa=${conversa_id} texto="${(texto||'').slice(0,50)}"`);
      emitUnsupported(socket, 'instrucao');
    });

    // ── AÇÃO: falar direto (supervisor → Mari reescreve → envia) ─
    socket.on('falar_direto', async ({ conversa_id, texto, reescrever }: any) => {
      console.log(`[ACTIONS] 🎯 falar_direto → conversa=${conversa_id} reescrever=${reescrever} texto="${(texto||'').slice(0,50)}"`);
      socket.emit('falar_direto_err', { erro: 'Ação ainda não operacional via socket: falar_direto' });
      emitUnsupported(socket, 'falar_direto');
    });

    // ── AÇÃO: preview de falar direto ─────────────────────────
    socket.on('fd_preview', async ({ conversa_id, texto }: { conversa_id: string; texto: string }) => {
      try { socket.emit('fd_preview_ok', { msg: await reescreverComoMari(conversa_id, texto) }); }
      catch { socket.emit('fd_preview_ok', { msg: texto }); }
    });

    // ── AÇÃO: enviar manual do plano (PDF) ao cliente ──────────
    // Supervisor escolhe o plano e o PDF é enviado direto no WhatsApp
    socket.on('enviar_manual', async ({ conversa_id, plano_slug }: { conversa_id: string; plano_slug: string }) => {
      socket.emit('manual_enviado_err', { conversa_id, erro: 'Ação ainda não operacional via socket: enviar_manual' });
      emitUnsupported(socket, 'enviar_manual');
    });

    // ── AÇÃO: transferir conversa ─────────────────────────────
    socket.on('transferir', async ({ conversa_id, agent_slug }: any) => {
      try {
        await repo.transferirConversa(conversa_id, agent_slug);
        socket.emit('transferido_ok', { conversa_id });
        io.emit('conversa_atualizada', { conversa_id });
      } catch (e: any) {
        socket.emit('erro', { msg: e.message });
      }
    });

    // ── AÇÃO: resetar cliente ─────────────────────────────────
    socket.on('resetar_cliente', async ({ conversa_id }: { conversa_id: string }) => {
      try {
        await repo.resetarCliente(conversa_id);
        socket.emit('resetar_ok', { conversa_id });
      } catch (e: any) {
        socket.emit('erro', { msg: e.message });
      }
    });

    // ── AÇÃO: limpar dados (mantém cadastro, apaga histórico) ──
    socket.on('excluir_dados', async ({ conversa_id }: { conversa_id: string }) => {
      try {
        await execute('DELETE FROM mensagens              WHERE conversa_id=$1', [conversa_id]);
        await execute('DELETE FROM instrucoes_ativas      WHERE conversa_id=$1', [conversa_id]);
        await execute('DELETE FROM agendamentos           WHERE conversa_id=$1', [conversa_id]);
        await execute('DELETE FROM custos_ia              WHERE conversa_id=$1', [conversa_id]);
        await execute('DELETE FROM funil_conversao        WHERE conversa_id=$1', [conversa_id]);
        await execute('DELETE FROM acoes_supervisor       WHERE conversa_id=$1', [conversa_id]).catch(()=>{});
        await execute('DELETE FROM conversa_obsidian      WHERE conversa_id=$1', [conversa_id]).catch(()=>{});
        await execute('DELETE FROM decisoes_orquestrador  WHERE conversa_id=$1', [conversa_id]).catch(()=>{});
        await execute('DELETE FROM followup_agendado      WHERE conversa_id=$1', [conversa_id]).catch(()=>{});
        await execute('DELETE FROM transferencias         WHERE conversa_id=$1', [conversa_id]).catch(()=>{});
        await execute(`UPDATE conversas SET etapa='acolhimento', score=0, resumo_conversa=NULL WHERE id=$1`, [conversa_id]);
        socket.emit('dados_limpos', { conversa_id });
        io.emit('conversa_atualizada', { conversa_id });
      } catch (e: any) { socket.emit('erro', { msg: e.message }); }
    });

    // ── AÇÃO: excluir contato (remove tudo) ─────────────────
    socket.on('excluir_contato', async ({ conversa_id }: { conversa_id: string }) => {
      try {
        // Buscar TODAS as conversas do cliente antes de excluir
        const conv = await queryOne<any>('SELECT client_id FROM conversas WHERE id=$1', [conversa_id]);
        if (!conv) { socket.emit('erro', { msg: 'Conversa não encontrada' }); return; }
        const todasConversas = await query<any>('SELECT id FROM conversas WHERE client_id=$1', [conv.client_id]);
        const nome = (await queryOne<any>('SELECT nome FROM clientes WHERE id=$1', [conv.client_id]))?.nome;

        await repo.excluirContato(conversa_id);

        // Emitir remoção para CADA conversa do cliente
        todasConversas.forEach(({ id }: any) => io.emit('conversa_removida', { conversa_id: id }));
        socket.emit('excluir_ok', { conversa_id, nome });
        console.log(`[Socket] Excluído: ${nome} (${todasConversas.length} conversa(s))`);
      } catch (e: any) {
        socket.emit('erro', { msg: e.message });
      }
    });

    // ── AÇÃO: agendar mensagem manual (supervisor) ──────────────
    socket.on('agendar_manual', async ({ conversa_id, texto, reescrever, executar_em }: any) => {
      try {
        // Reescrever no tom da Mari se solicitado
        let msgFinal = texto;
        if (reescrever && texto?.trim()) {
          msgFinal = await reescreverComoMari(conversa_id, texto).catch(() => texto);
        }
        const dt = new Date(executar_em);
        await execute(
          `INSERT INTO followup_agendado (conversa_id, tipo, mensagem, motivo, executar_em, sequencia)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [conversa_id, 'manual', msgFinal, 'agendamento manual supervisor', dt.toISOString(), 0]
        );
        socket.emit('agendar_ok', { conversa_id, msg: msgFinal, executar_em: dt.toISOString() });
      } catch (e: any) { socket.emit('erro', { msg: e.message }); }
    });

    // ── Listar mensagens programadas ───────────────────────────
    socket.on('get_programadas', async () => {
      try {
        const rows = await query(`
          SELECT fa.id, fa.tipo, fa.status, fa.mensagem, fa.motivo,
                 fa.executar_em AT TIME ZONE 'America/Sao_Paulo' AS hora_brt,
                 fa.executado_em AT TIME ZONE 'America/Sao_Paulo' AS executado_brt,
                 fa.tentativas, fa.sequencia,
                 cl.nome AS cliente_nome, c.numero_externo, c.instancia_whatsapp,
                 CASE
                   WHEN c.instancia_whatsapp = 'mari-plamev-whatsapp' THEN '📱 Mari 011'
                   WHEN c.instancia_whatsapp = 'mari-plamev-zap2'    THEN '📱 Mari 031'
                   WHEN c.instancia_whatsapp = 'plamev'              THEN '📱 Bella 021'
                   ELSE COALESCE(c.instancia_whatsapp, c.canal)
                 END AS chip
          FROM followup_agendado fa
          JOIN conversas c ON c.id = fa.conversa_id
          JOIN clientes cl ON cl.id = c.client_id
          ORDER BY fa.executar_em DESC
          LIMIT 200
        `);
        socket.emit('programadas_data', rows);
      } catch (e: any) { socket.emit('erro', { msg: e.message }); }
    });

    // Cancelar agendamento manual
    socket.on('cancelar_programada', async ({ id }: { id: number }) => {
      try {
        await execute('UPDATE followup_agendado SET status=$1 WHERE id=$2 AND status=$3', ['cancelado', id, 'pendente']);
        socket.emit('programada_cancelada', { id });
      } catch (e: any) { socket.emit('erro', { msg: e.message }); }
    });

    // ── AÇÃO: salvar nota interna ─────────────────────────────
    socket.on('salvar_nota', async ({ conversa_id, texto }: any) => {
      console.log(`[ACTIONS] 🎯 salvar_nota → conversa=${conversa_id} texto="${(texto||'').slice(0,50)}"`);
      try {
        await execute(
          'INSERT INTO mensagens (conversa_id, role, conteudo, enviado_por) VALUES ($1,$2,$3,$4)',
          [conversa_id, 'supervisor', `[NOTA] ${texto}`, 'supervisora']
        );
        console.log(`[ACTIONS] ✅ salvar_nota ok`);
        socket.emit('nota_ok', { conversa_id });
      } catch (e: any) {
        console.error(`[ACTIONS] ❌ salvar_nota ERRO: ${e.message}`);
        socket.emit('erro', { msg: e.message });
      }
    });

    // ── Salvar conversa para análise futura ───────────────
    socket.on('salvar_conversa_analise', async ({ conversa_id, titulo, motivo, tags, desde_ts }: any) => {
      try {
        // Buscar mensagens — com ou sem filtro de período
        let msgs: any[];
        if (desde_ts) {
          const desde = new Date(desde_ts).toISOString();
          msgs = await query(
            `SELECT * FROM mensagens
             WHERE conversa_id = $1 AND timestamp >= $2
             ORDER BY timestamp ASC`,
            [conversa_id, desde]
          );
        } else {
          msgs = await repo.buscarMensagens(ORG_ID, conversa_id);
        }

        const conv = await queryOne<{ client_id: string }>('SELECT client_id FROM conversas WHERE id=$1', [conversa_id]);
        const perf = conv ? await repo.buscarPerfil(conv.client_id) : {};

        // Guardar período escolhido no motivo para rastreabilidade
        const motivoFinal = [motivo || '', desde_ts ? `[período: desde ${new Date(desde_ts).toLocaleString('pt-BR')}]` : '[período: completo]'].filter(Boolean).join(' ');

        await execute(
          `INSERT INTO conversas_salvas (conversa_id, titulo, motivo, tags, snapshot_msgs, snapshot_perfil)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [conversa_id, titulo, motivoFinal, tags || [], JSON.stringify(msgs), JSON.stringify(perf)]
        );
        socket.emit('conversa_salva_ok', { conversa_id, titulo, total_msgs: msgs.length });
      } catch (e: any) {
        socket.emit('erro', { msg: e.message });
      }
    });

    // ── Listar conversas salvas ──────────────────────────────
    socket.on('get_conversas_salvas', async () => {
      try {
        const rows = await query(
          `SELECT cs.id, cs.conversa_id, cs.titulo, cs.motivo, cs.tags, cs.avaliado,
                  cs.criado_em, c.numero_externo, c.etapa,
                  cl.nome AS cliente_nome,
                  jsonb_array_length(cs.snapshot_msgs) AS total_msgs
           FROM conversas_salvas cs
           JOIN conversas c ON c.id = cs.conversa_id
           JOIN clientes cl ON cl.id = c.client_id
           ORDER BY cs.criado_em DESC
           LIMIT 100`
        );
        socket.emit('conversas_salvas_data', rows);
      } catch (e: any) {
        socket.emit('erro', { msg: e.message });
      }
    });

    // ── Exportar snapshot (JSON completo para análise IA) ───
    socket.on('exportar_conversa_salva', async ({ id }: { id: number }) => {
      try {
        const row = await queryOne(
          `SELECT cs.*, c.numero_externo, c.etapa, c.canal, c.instancia_whatsapp,
                  cl.nome AS cliente_nome, cl.origem
           FROM conversas_salvas cs
           JOIN conversas c ON c.id = cs.conversa_id
           JOIN clientes cl ON cl.id = c.client_id
           WHERE cs.id=$1`, [id]
        );
        socket.emit('exportar_ok', row);
      } catch (e: any) {
        socket.emit('erro', { msg: e.message });
      }
    });

    // ── Excluir conversa salva ───────────────────────────────
    socket.on('excluir_conversa_salva', async ({ id }: { id: number }) => {
      try {
        await execute('DELETE FROM conversas_salvas WHERE id=$1', [id]);
        socket.emit('conversa_salva_excluida', { id });
      } catch (e: any) {
        socket.emit('erro', { msg: e.message });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] Desconectado: ${socket.id}`);
    });
  });

  return io;
}

/**
 * Notifica o dashboard quando o pipeline da Mari envia/recebe mensagem.
 * Chamado via POST /interno/nova-msg do pipeline principal.
 */
export function notificarDashboard(
  conversaId: string, phone: string, nome: string,
  msgCliente: string | null, msgMari: string | null
) {
  if (!io) return;
  io.emit('nova_msg', {
    conversa_id: conversaId, phone, nome,
    msg_cliente: msgCliente, msg_mari: msgMari,
    timestamp: new Date().toISOString(),
  });
  io.emit('conversa_atualizada', { conversa_id: conversaId });
}

export { io };
