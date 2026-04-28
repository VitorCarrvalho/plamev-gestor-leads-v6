import {
  buildGreetingResponse,
  buildDeterministicCatalogResponse,
  buildMariPrompt,
  chooseNonRepeatingFallback,
  detectCatalogIntent,
  detectGreetingOnly,
  formatConversationStatePrompt,
  formatProductCatalogPrompt,
} from './mari-runtime';
import { validateClaims } from './guards/output-guard';

function assert(condition: any, message: string) {
  if (!condition) throw new Error(message);
}

async function run() {
  const catalogRows = [
    { slug: 'slim', nome: 'Slim', descricao: 'Plano de entrada', modalidade: 'cartao', valor: 59.99, valor_promocional: 59.99 },
    { slug: 'advance', nome: 'Advance', descricao: 'Plano intermediário', modalidade: 'cartao', valor: 119.99, valor_promocional: 119.99 },
    { slug: 'platinum', nome: 'Platinum', descricao: 'Plano robusto', modalidade: 'cartao', valor: 189.99, valor_promocional: 189.99 },
    { slug: 'diamond', nome: 'Diamond', descricao: 'Plano premium', modalidade: 'cartao', valor: 359.99, valor_promocional: 359.99 },
  ];

  assert(detectCatalogIntent('quero saber quais planos existe hoje ai'), 'Deveria detectar intent de catálogo');
  assert(detectGreetingOnly('boa tarde'), 'Deveria detectar saudação simples');
  assert(!detectGreetingOnly('boa tarde, quero saber os planos'), 'Não deveria tratar saudação com intenção comercial como greeting-only');

  const catalogPrompt = formatProductCatalogPrompt(catalogRows as any);
  assert(catalogPrompt.includes('Slim') && catalogPrompt.includes('Diamond'), 'Prompt de catálogo precisa listar planos oficiais');

  const prompt = buildMariPrompt({
    prompts: {
      soul: 'Você é a Mari.',
      tom: 'Tom humano e direto.',
      regras: 'Nunca invente preço.',
      anti_repeticao: 'Não repetir perguntas.',
      planos: 'Explique os planos oficiais.',
    },
    stage: 'apresentacao_planos',
    conversationState: formatConversationStatePrompt({ etapa: 'apresentacao_planos', tutor_nome: 'Vitor', nome_pet: 'Lilás', especie: 'cachorro', raca: 'pitbull', idade_anos: 11 }),
    productCatalog: catalogPrompt,
    knowledgeBase: '### Plamev/Planos\nUse os planos oficiais.',
    catalogIntent: true,
  });
  assert(prompt.includes('# SOUL') && prompt.includes('# PLANOS E PRODUTOS'), 'Prompt final precisa incluir bundle da Mari');
  assert(prompt.includes('Etapa atual: apresentacao_planos'), 'Prompt final precisa incluir etapa comercial');

  const greetingPrompt = buildMariPrompt({
    prompts: {
      soul: 'Você é a Mari.',
      tom: 'Tom humano e direto.',
      regras: 'Nunca invente preço.',
      planos: 'Explique os planos oficiais.',
    },
    stage: 'acolhimento',
    conversationState: formatConversationStatePrompt({ etapa: 'apresentacao_planos', tutor_nome: 'Vitor', nome_pet: 'Lilás' }),
    productCatalog: catalogPrompt,
    knowledgeBase: '### Mari/Identidade\nSeja acolhedora.',
    catalogIntent: false,
    includePlanContext: false,
  });
  assert(!greetingPrompt.includes('# PLANOS E PRODUTOS'), 'Saudação simples não deve injetar prompt de planos');
  assert(!greetingPrompt.includes('# DADOS DO PRODUTO'), 'Saudação simples não deve injetar catálogo');

  const deterministic = buildDeterministicCatalogResponse(catalogRows as any, {
    etapa: 'apresentacao_planos',
    tutor_nome: 'Vitor',
    nome_pet: 'Lilás',
    especie: 'cachorro',
    raca: 'pitbull',
    idade_anos: 11,
  });
  assert(deterministic?.includes('Slim') && deterministic?.includes('Diamond'), 'Resposta determinística precisa listar catálogo oficial');
  assert(!deterministic?.toLowerCase().includes('gold'), 'Resposta determinística não pode inventar plano');

  const greeting = buildGreetingResponse({ tutor_nome: 'Vitor', nome_pet: 'Lilás' });
  assert(greeting.includes('Vitor') && greeting.includes('Lilás'), 'Saudação determinística deve usar contexto disponível');

  const fallback = chooseNonRepeatingFallback(undefined, [
    { role: 'assistant', content: 'Deixa eu confirmar essa informação com precisão pra te responder certinho, combinado?' },
  ]);
  assert(!fallback.toLowerCase().includes('deixa eu confirmar essa informação com precisão'), 'Fallback não deve repetir a mesma frase imediatamente');

  const premiumAdjective = await validateClaims(
    { resposta: 'Boa tarde! Aqui você vai ter um atendimento premium e bem cuidadoso 😊' } as any,
    prompt,
    'test-model',
    { historico: [] },
  );
  assert(premiumAdjective.isValid, 'Adjetivo "premium" não deve ser bloqueado como nome de plano');

  console.log('[SMOKE] ✅ Mari runtime smoke checks passaram');
}

run().catch((error) => {
  console.error('[SMOKE] ❌ Falha:', error.message);
  process.exit(1);
});
