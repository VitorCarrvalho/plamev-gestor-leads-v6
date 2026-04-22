import { InternalMessage } from '@plamev/shared';

// Intents reconhecidos
export type IntentType = 
  | 'saudacao_simples'
  | 'duvida_produto'
  | 'intencao_compra'
  | 'objecao_preco'
  | 'pedido_cancelamento'
  | 'pedido_humano'
  | 'envio_documento'
  | 'outros';

export interface GuardResult {
  intent: IntentType;
  action: 'process' | 'escalate' | 'drop';
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
}

export async function checkInputGuard(message: InternalMessage): Promise<GuardResult> {
  const start = Date.now();
  const text = message.texto.toLowerCase();

  // 1. Regras rápidas (Regex) - Timeout de 1ms
  if (text === '' && (message.imagem || message.documento || message.audio)) {
    return { intent: 'envio_documento', action: 'process', latencyMs: Date.now() - start };
  }

  if (/falar com humano|atendente|pessoa real|sair do robô|cancelar/i.test(text)) {
    const isCancel = /cancelar/i.test(text);
    return { 
      intent: isCancel ? 'pedido_cancelamento' : 'pedido_humano', 
      action: 'escalate',
      latencyMs: Date.now() - start 
    };
  }

  // TODO: Integrar com LLM (Haiku) para classificação rápida em < 2s
  // Para a fundação, vamos fazer uma classificação simples por regex
  const sinaisCompra = /quanto custa|qual plano|como funciona|quero|me interessa/i.test(text);
  const objecaoPreco = /caro|não tenho dinheiro|desconto|abaixar o preço/i.test(text);
  
  let intent: IntentType = 'outros';
  if (sinaisCompra) intent = 'intencao_compra';
  else if (objecaoPreco) intent = 'objecao_preco';
  else if (/^(oi|olá|ola|bom dia|boa tarde|boa noite)[!.,\s]*$/i.test(text)) intent = 'saudacao_simples';

  return { 
    intent, 
    action: 'process',
    latencyMs: Date.now() - start
  };
}
