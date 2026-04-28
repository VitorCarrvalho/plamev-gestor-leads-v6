import { GenerationResult } from '@plamev/shared';

export interface ValidationResult {
  isValid: boolean;
  reason?: string;
  rewrittenText?: string;
  matchedRules?: string[];
  severity?: 'low' | 'medium' | 'high';
}

interface OutputGuardContext {
  historico?: Array<{ role?: string; content?: string; conteudo?: string }>;
  perfil?: Record<string, any> | null;
  conversa?: Record<string, any> | null;
  clinicasReais?: any[] | null;
  ragSources?: string[];
  ragMode?: string;
}

const { validar } = require('./validator');

function normalizeCurrency(value: string): string {
  return value
    .replace(/R\$\s*/gi, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .trim();
}

function extractPrices(text: string): string[] {
  return (text.match(/R\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})/g) || [])
    .map(normalizeCurrency);
}

function extractKnownPlanNames(text: string): string[] {
  const names = new Set<string>();
  const headingRegex = /#{2,6}\s+([^\n(]+?)\s+\(([^)]+)\)/g;
  let headingMatch: RegExpExecArray | null = null;
  while ((headingMatch = headingRegex.exec(text)) !== null) {
    const label = headingMatch[1]?.trim()?.toLowerCase();
    const slug = headingMatch[2]?.trim()?.toLowerCase();
    if (label) names.add(label);
    if (slug) names.add(slug);
  }

  const slugRegex = /`((?:slim|advance|platinum|diamond)(?:_plus)?|plus)`/gi;
  let slugMatch: RegExpExecArray | null = null;
  while ((slugMatch = slugRegex.exec(text)) !== null) {
    names.add(slugMatch[1].trim().toLowerCase());
  }

  return [...names];
}

function detectMentionedPlanNames(text: string): string[] {
  const knownCandidates = [
    'slim', 'advance', 'platinum', 'diamond',
    'advance plus', 'platinum plus', 'diamond plus',
    'advance_plus', 'platinum_plus', 'diamond_plus',
    'plus',
  ];
  const lower = text.toLowerCase();
  return knownCandidates.filter((name) => lower.includes(name)).map((name) => name.toLowerCase());
}

export async function validateClaims(
  generation: GenerationResult,
  originalContext: string,
  modelName: string,
  context: OutputGuardContext = {},
): Promise<ValidationResult> {
  const response = generation.resposta;
  if (!response) return { isValid: true };

  const matchedRules: string[] = [];
  const structuralRewrite = validar(response, {
    historico: (context.historico || []).map((item) => ({
      role: item.role,
      conteudo: item.content || item.conteudo || '',
    })),
    perfil: context.perfil || {},
    conversa: context.conversa || {},
    clinicasReais: context.clinicasReais || null,
  });

  const aiTellPattern = /\b(como (uma |um )?(ia|intelig[eê]ncia artificial|modelo de linguagem)|não posso garantir|enquanto ia)\b/i;
  if (aiTellPattern.test(response)) {
    matchedRules.push('ai-tell');
    return {
      isValid: false,
      reason: 'Resposta expõe traços de agente de IA',
      rewrittenText: 'Deixa eu te responder isso de forma mais clara e objetiva 😊',
      matchedRules,
      severity: 'high',
    };
  }

  const internalLeakPattern = /(\[PDF|\[DOC|\[NOTA\]|system prompt|base de conhecimento|prompt interno|instru[cç][aã]o interna)/i;
  if (internalLeakPattern.test(response)) {
    matchedRules.push('internal-context-leak');
    return {
      isValid: false,
      reason: 'Resposta vazou marcadores internos ou placeholders operacionais',
      rewrittenText: 'Deixa eu confirmar essa informação pra você, só um minutinho...',
      matchedRules,
      severity: 'high',
    };
  }

  const priceMatches = response.match(/R\$\s*(\d+[,.]\d{2})/g);
  if (priceMatches) {
    for (const match of priceMatches) {
      const value = parseFloat(match.replace('R$', '').replace(',', '.').trim());
      if (value < 10 || value > 5000) {
        matchedRules.push('price-out-of-range');
        return {
          isValid: false,
          reason: `Alucinação de preço detectada: ${match}`,
          rewrittenText: 'Deixa eu confirmar o valor certinho pra você e já volto com a informação correta.',
          matchedRules,
          severity: 'high',
        };
      }
    }
  }

  const contextPrices = new Set(extractPrices(originalContext));
  const responsePrices = extractPrices(response);
  // Só bloqueia se o contexto TEM preços e a resposta usa preços diferentes.
  // Se o contexto não tem preços (catálogo não foi injetado), não há base de comparação.
  if (contextPrices.size > 0 && responsePrices.length > 0) {
    const pricesOutsideContext = responsePrices.filter((price) => !contextPrices.has(price));
    if (pricesOutsideContext.length > 0) {
      matchedRules.push('price-not-in-context');
      return {
        isValid: false,
        reason: `Preço fora do contexto recuperado: ${pricesOutsideContext.join(', ')}`,
        rewrittenText: 'Quero te passar esse valor com segurança, então vou confirmar certinho antes de te responder.',
        matchedRules,
        severity: 'high',
      };
    }
  }

  const contextPlanNames = new Set(extractKnownPlanNames(originalContext));
  const mentionedPlanNames = detectMentionedPlanNames(response);
  const plansOutsideContext = contextPlanNames.size > 0
    ? mentionedPlanNames.filter((plan) => !contextPlanNames.has(plan))
    : [];
  if (plansOutsideContext.length > 0) {
    matchedRules.push('plan-not-in-context');
    return {
      isValid: false,
      reason: `Plano fora do catálogo oficial no contexto: ${plansOutsideContext.join(', ')}`,
      rewrittenText: 'Quero te explicar só os planos oficiais da Plamev, então vou organizar isso certinho pra não te passar nada errado.',
      matchedRules,
      severity: 'high',
    };
  }

  // Só bloqueia sobre cobertura/rede se não há RAG E o catálogo também não foi injetado no contexto.
  // Se o contexto tem DADOS DO PRODUTO ou BASE DE CONHECIMENTO, o LLM tem base suficiente.
  const coverageSensitivePattern = /(car[eê]ncia|rede credenciada|reembolso|coparticipa[cç][aã]o)/i;
  const contextHasPlanData = /DADOS DO PRODUTO|BASE DE CONHECIMENTO/i.test(originalContext);
  if (coverageSensitivePattern.test(response)
      && (!context.ragSources || context.ragSources.length === 0)
      && !contextHasPlanData) {
    matchedRules.push('coverage-without-rag-support');
    return {
      isValid: false,
      reason: 'Resposta sensível sobre cobertura/rede sem base recuperada no contexto',
      rewrittenText: 'Deixa eu confirmar essa informação com precisão pra te responder certinho, combinado?',
      matchedRules,
      severity: 'medium',
    };
  }

  if (structuralRewrite !== response) {
    matchedRules.push('structural-validator-rewrite');
    return {
      isValid: true,
      reason: 'Resposta ajustada por guard rails estruturais',
      rewrittenText: structuralRewrite,
      matchedRules,
      severity: 'low',
    };
  }

  return {
    isValid: true,
    matchedRules,
  };
}
