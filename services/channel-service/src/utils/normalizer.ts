import { InternalMessage } from '@plamev/shared';

export function normalizeMessage(payload: any): InternalMessage {
  return {
    id: payload.id,
    canal: payload.canal,
    phone: payload.phone || '',
    jid: payload.jid || null,
    senderPn: payload.senderPn || null,
    senderChip: payload.senderChip || null,
    instancia: payload.instancia || null,
    chatId: payload.chatId || null,
    nome: payload.nome || 'Cliente',
    texto: payload.texto || '',
    audio: payload.audio || null,
    imagem: payload.imagem || null,
    documento: payload.documento || null,
    agentSlug: payload.agentSlug || 'mari',
    timestamp: payload.timestamp || Date.now(),
  };
}
