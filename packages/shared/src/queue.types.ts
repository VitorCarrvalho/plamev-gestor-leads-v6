export interface InternalMessage {
  id: string;
  canal: 'whatsapp' | 'telegram';
  phone: string;
  jid: string | null;
  senderPn: string | null;
  senderChip: string | null;
  instancia: string | null;
  chatId: string | null;
  nome: string;
  texto: string;
  audio: any | null;
  imagem: any | null;
  documento: any | null;
  agentSlug: string;
  timestamp: number;
}

export interface JobPayload {
  message: InternalMessage;
}
