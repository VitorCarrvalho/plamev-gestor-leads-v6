/**
 * services/supervisor-notifier.js — Notificações para supervisores via WhatsApp
 *
 * Lê mari_config.supervisores_telefones (CSV, com DDI 55) e dispara mensagens
 * quando:
 *   - cliente pede retorno por telefone
 *   - conversa entra em pre_fechamento
 *   - conversa entra em fechamento
 *   - conversa marcada como pago (venda concluída)
 *
 * Anti-duplicação: mantém cache em memória de (conversaId, evento) por 6h
 * para não reenviar o mesmo alerta se o processor re-avaliar a mensagem.
 */

const db = require('../db');
const sender = require('./sender');

// Cache de notificações já disparadas — evita duplicatas (conversa_id:evento → timestamp)
const _notificadas = new Map();
const TTL_MS = 6 * 60 * 60 * 1000; // 6h

function jaNotificado(conversaId, evento) {
  const chave = `${conversaId}:${evento}`;
  const ts = _notificadas.get(chave);
  if (!ts) return false;
  if (Date.now() - ts > TTL_MS) { _notificadas.delete(chave); return false; }
  return true;
}
function marcarNotificado(conversaId, evento) {
  _notificadas.set(`${conversaId}:${evento}`, Date.now());
}

async function getSupervisores() {
  try {
    const cfg = await db.buscarConfig();
    const raw = (cfg && cfg.supervisores_telefones) || '';
    return raw.split(',').map(s => s.trim().replace(/\D/g, '')).filter(s => s.length >= 10);
  } catch (e) {
    console.warn('[SUPERVISOR] erro ao ler supervisores_telefones:', e.message);
    return [];
  }
}

function formatarLead({ cliente, perfil, conversa }) {
  const nome  = cliente?.nome || 'Lead sem nome';
  const fone  = cliente?.phone ? `+${String(cliente.phone).replace(/\D/g, '')}` : '?';
  const pet   = perfil?.nome && perfil.nome !== '?' ? perfil.nome : null;
  const raca  = perfil?.raca || null;
  const idade = perfil?.idade || null;
  const cep   = perfil?.cep  || null;
  const plano = conversa?.plano_recomendado || null;
  const etapa = conversa?.etapa || null;

  const linhas = [
    `*Cliente:* ${nome}`,
    `*Telefone:* ${fone}`,
  ];
  if (pet)   linhas.push(`*Pet:* ${pet}${raca ? ` (${raca}${idade ? ', ' + idade : ''})` : ''}`);
  if (cep)   linhas.push(`*CEP:* ${cep}`);
  if (plano) linhas.push(`*Plano:* ${plano}`);
  if (etapa) linhas.push(`*Etapa:* ${etapa}`);
  return linhas.join('\n');
}

// Envia a mesma mensagem pra todos os supervisores via WhatsApp.
// Usa a instância da conversa atual se houver; senão deixa o sender decidir por DDD.
async function disparar(texto, { conversa } = {}) {
  const supers = await getSupervisores();
  if (supers.length === 0) {
    console.log('[SUPERVISOR] Nenhum supervisor cadastrado em mari_config.supervisores_telefones — pulando');
    return;
  }
  for (const phone of supers) {
    const msgSynth = {
      phone,
      canal: 'whatsapp',
      jid: null,
      instancia: conversa?.instancia_origem || null,
    };
    await sender.enviar(msgSynth, texto).catch(e =>
      console.warn(`[SUPERVISOR] falhou pra ${phone}: ${e.message}`)
    );
    console.log(`[SUPERVISOR] ✅ alerta enviado pra ${phone}`);
  }
}

async function notificarPedidoTelefone(ctx) {
  if (jaNotificado(ctx.conversa.id, 'pedido_telefone')) return;
  marcarNotificado(ctx.conversa.id, 'pedido_telefone');
  const cabecalho = `📞 *RETORNO POR TELEFONE SOLICITADO*\n\nO cliente abaixo pediu para falar com alguém por ligação:`;
  const texto = `${cabecalho}\n\n${formatarLead(ctx)}\n\n_Entre em contato assim que possível._`;
  await disparar(texto, ctx);
}

async function notificarEtapa(etapa, ctx) {
  const eventos = {
    pre_fechamento: {
      emoji: '🎯',
      titulo: 'PRÉ-FECHAMENTO',
      sub: 'O cliente autorizou gerar o link — coletando dados finais.',
    },
    fechamento: {
      emoji: '✍️',
      titulo: 'FECHAMENTO',
      sub: 'Link de pagamento enviado ao cliente — aguardando pagamento.',
    },
    venda_fechada: {
      emoji: '🎉',
      titulo: 'VENDA FECHADA',
      sub: 'Dados completos + cliente confirmou. Acompanhar pagamento no ERP.',
    },
    pago: {
      emoji: '💰',
      titulo: 'PAGAMENTO CONFIRMADO',
      sub: 'Adesão marcada como paga no ERP.',
    },
  };
  const ev = eventos[etapa];
  if (!ev) return;
  if (jaNotificado(ctx.conversa.id, etapa)) return;
  marcarNotificado(ctx.conversa.id, etapa);

  const texto = `${ev.emoji} *${ev.titulo}*\n${ev.sub}\n\n${formatarLead(ctx)}`;
  await disparar(texto, ctx);
}

module.exports = {
  notificarPedidoTelefone,
  notificarEtapa,
};
