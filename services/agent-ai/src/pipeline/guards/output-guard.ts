import { GenerationResult } from '@plamev/shared';

export interface ValidationResult {
  isValid: boolean;
  reason?: string;
}

export async function validateClaims(
  generation: GenerationResult,
  originalContext: string,
  modelName: string
): Promise<ValidationResult> {
  const response = generation.resposta;
  if (!response) return { isValid: true };

  // TODO: Integrar com LLM leve (Haiku) para validação de claims usando o originalContext
  // Exemplo: verificar se a IA ofereceu um preço diferente da tabela passada no contexto
  
  // Por enquanto, validação simples por regex (exemplo: detecção de preços absurdos)
  const priceMatches = response.match(/R\$\s*(\d+[,.]\d{2})/g);
  if (priceMatches) {
    for (const match of priceMatches) {
      const value = parseFloat(match.replace('R$', '').replace(',', '.').trim());
      // Se o modelo alucinar um preço de plano menor que R$10 ou maior que R$5000, barrar
      if (value < 10 || value > 5000) {
        return { 
          isValid: false, 
          reason: `Alucinação de preço detectada: ${match}` 
        };
      }
    }
  }

  return { isValid: true };
}
