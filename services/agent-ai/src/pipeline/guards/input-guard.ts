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
  | 'spam_repetitivo'
  | 'risco_abuso'
  | 'prompt_injection'
  | 'outros';

export interface GuardResult {
  intent: IntentType;
  action: 'process' | 'escalate' | 'drop';
  reason?: string;
  matchedRules?: string[];
  failOpen?: boolean;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
}

export async function checkInputGuard(message: InternalMessage): Promise<GuardResult> {
  const start = Date.now();
  try {
    const rawText = String(message.texto || '');
    const text = rawText.toLowerCase().trim();
    const matchedRules: string[] = [];

    // 1. Anexos sem texto seguem para o fluxo multimodal.
    if (text === '' && (message.imagem || message.documento || message.audio)) {
      matchedRules.push('multimodal-empty-text');
      return {
        intent: 'envio_documento',
        action: 'process',
        reason: 'Mensagem sem texto, mas com anexo válido',
        matchedRules,
        latencyMs: Date.now() - start,
      };
    }

    if (!text) {
      matchedRules.push('empty-text-no-attachment');
      return {
        intent: 'outros',
        action: 'drop',
        reason: 'Mensagem vazia sem conteúdo aproveitável',
        matchedRules,
        latencyMs: Date.now() - start,
      };
    }

    // 2. Regras de descarte ou escalonamento precoce.
    const humanRequest = /(falar com humano|quero falar com atendente|atendente|pessoa real|sair do rob[oô]|suporte humano|me transfere)/i;
    const cancelRequest = /(cancelar|quero cancelar|encerrar plano|cancelamento)/i;
    if (humanRequest.test(text) || cancelRequest.test(text)) {
      matchedRules.push(cancelRequest.test(text) ? 'cancel-request' : 'human-request');
      return {
        intent: cancelRequest.test(text) ? 'pedido_cancelamento' : 'pedido_humano',
        action: 'escalate',
        reason: cancelRequest.test(text)
          ? 'Pedido explícito de cancelamento'
          : 'Pedido explícito de atendimento humano',
        matchedRules,
        latencyMs: Date.now() - start,
      };
    }

    const spamPatterns = [
      /(.)\1{7,}/i,
      /(?:https?:\/\/|www\.)\S{20,}/i,
      /\b(?:gratis|promo[cç][aã]o|bitcoin|investimento|clique aqui)\b/i,
    ];
    if (spamPatterns.some((pattern) => pattern.test(text))) {
      matchedRules.push('spam-pattern');
      return {
        intent: 'spam_repetitivo',
        action: 'drop',
        reason: 'Conteúdo com forte sinal de spam ou ruído',
        matchedRules,
        latencyMs: Date.now() - start,
      };
    }

    const abusePatterns = [
      /\b(xingar|idiota|burro|ot[aá]ri[oa]|vai se foder|vsf|fdp)\b/i,
      /\b(processa|advogado|reclama[cç][aã]o|procon|judicial)\b/i,
    ];
    if (abusePatterns.some((pattern) => pattern.test(text))) {
      matchedRules.push('abuse-or-legal-risk');
      return {
        intent: 'risco_abuso',
        action: 'escalate',
        reason: 'Mensagem com conflito, agressividade ou risco jurídico',
        matchedRules,
        latencyMs: Date.now() - start,
      };
    }

    const promptInjectionPatterns = [
      /\bignore (todas|todas as|as) instru[cç][oõ]es\b/i,
      /\bignore previous instructions\b/i,
      /\bsystem prompt\b/i,
      /\bmostre suas instru[cç][oõ]es\b/i,
      /\baja como chatgpt\b/i,
    ];
    if (promptInjectionPatterns.some((pattern) => pattern.test(text))) {
      matchedRules.push('prompt-injection-attempt');
      return {
        intent: 'prompt_injection',
        action: 'escalate',
        reason: 'Tentativa de manipular instruções do agente',
        matchedRules,
        latencyMs: Date.now() - start,
      };
    }

    // 3. Classificação semântica leve por regras determinísticas.
    const greetingOnly = /^(oi|olá|ola|bom dia|boa tarde|boa noite|e ai|e aí|opa)[!.,\s]*$/i.test(text);
    const sinaisCompra = /(quanto custa|qual plano|como funciona|quero|me interessa|tenho interesse|valor|pre[cç]o|cotar|cota[cç][aã]o)/i.test(text);
    const objecaoPreco = /(caro|n[aã]o tenho dinheiro|desconto|abaixar o pre[cç]o|tem desconto|parcelamento)/i.test(text);
    const duvidaProduto = /(cobertura|car[eê]ncia|rede credenciada|veterin[aá]rio|funciona|o que cobre|plano)/i.test(text);

    let intent: IntentType = 'outros';
    if (greetingOnly) {
      intent = 'saudacao_simples';
      matchedRules.push('simple-greeting');
    } else if (objecaoPreco) {
      intent = 'objecao_preco';
      matchedRules.push('price-objection');
    } else if (sinaisCompra) {
      intent = 'intencao_compra';
      matchedRules.push('buy-signal');
    } else if (duvidaProduto) {
      intent = 'duvida_produto';
      matchedRules.push('product-question');
    }

    return {
      intent,
      action: 'process',
      reason: matchedRules.length ? 'Classificação por regras determinísticas' : 'Sem bloqueios no input guard',
      matchedRules,
      latencyMs: Date.now() - start,
    };
  } catch (error: any) {
    return {
      intent: 'outros',
      action: 'process',
      reason: `Fail-open do input guard: ${error?.message || 'erro desconhecido'}`,
      matchedRules: ['guard-fail-open'],
      failOpen: true,
      latencyMs: Date.now() - start,
    };
  }
}
