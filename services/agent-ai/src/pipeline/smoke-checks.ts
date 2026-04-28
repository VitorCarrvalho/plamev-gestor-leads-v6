import {
  buildDeterministicCatalogResponse,
  buildMariPrompt,
  chooseNonRepeatingFallback,
  detectCatalogIntent,
  formatConversationStatePrompt,
  formatProductCatalogPrompt,
} from './mari-runtime';

function assert(condition: any, message: string) {
  if (!condition) throw new Error(message);
}

function run() {
  const catalogRows = [
    { slug: 'slim', nome: 'Slim', descricao: 'Plano de entrada', modalidade: 'cartao', valor: 59.99, valor_promocional: 59.99 },
    { slug: 'advance', nome: 'Advance', descricao: 'Plano intermediário', modalidade: 'cartao', valor: 119.99, valor_promocional: 119.99 },
    { slug: 'platinum', nome: 'Platinum', descricao: 'Plano robusto', modalidade: 'cartao', valor: 189.99, valor_promocional: 189.99 },
    { slug: 'diamond', nome: 'Diamond', descricao: 'Plano premium', modalidade: 'cartao', valor: 359.99, valor_promocional: 359.99 },
  ];

  assert(detectCatalogIntent('quero saber quais planos existe hoje ai'), 'Deveria detectar intent de catálogo');

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

  const fallback = chooseNonRepeatingFallback(undefined, [
    { role: 'assistant', content: 'Deixa eu confirmar essa informação com precisão pra te responder certinho, combinado?' },
  ]);
  assert(!fallback.toLowerCase().includes('deixa eu confirmar essa informação com precisão'), 'Fallback não deve repetir a mesma frase imediatamente');

  console.log('[SMOKE] ✅ Mari runtime smoke checks passaram');
}

run();
