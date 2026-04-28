export interface PromptBundle {
  soul?: string;
  tom?: string;
  regras?: string;
  planos?: string;
  pensamentos?: string;
  anti_repeticao?: string;
  modo_rapido?: string;
}

export interface ConversationSnapshot {
  id?: string;
  etapa?: string;
  tutor_nome?: string | null;
  nome_pet?: string | null;
  especie?: string | null;
  raca?: string | null;
  idade_anos?: number | null;
}

export interface CatalogRow {
  slug: string;
  nome: string;
  descricao?: string | null;
  modalidade: string;
  valor?: number | null;
  valor_tabela?: number | null;
  valor_promocional?: number | null;
  valor_oferta?: number | null;
  valor_limite?: number | null;
}

function formatCurrency(value: any) {
  if (value == null || value === '') return '—';
  return `R$${Number(value).toFixed(2).replace('.', ',')}`;
}

function byPlan(rows: CatalogRow[]) {
  const grouped = new Map<string, { nome: string; descricao?: string | null; modalidades: CatalogRow[] }>();
  for (const row of rows) {
    if (!grouped.has(row.slug)) {
      grouped.set(row.slug, {
        nome: row.nome,
        descricao: row.descricao,
        modalidades: [],
      });
    }
    grouped.get(row.slug)!.modalidades.push(row);
  }
  return grouped;
}

function getPrimaryPrice(rowGroup: { modalidades: CatalogRow[] }) {
  const preferred = rowGroup.modalidades.find((item) => item.modalidade === 'cartao') || rowGroup.modalidades[0];
  return preferred?.valor_promocional ?? preferred?.valor ?? null;
}

export function detectGreetingOnly(text: string) {
  const normalized = (text || '')
    .toLowerCase()
    .replace(/[!?.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return false;
  if (/(plano|planos|pre[cç]o|valor|quanto custa|cobertura|car[eê]ncia|rede|consulta|exame|cirurgia|me explica|quero saber|quais)/i.test(normalized)) {
    return false;
  }

  return /^(oi|ola|olá|bom dia|boa tarde|boa noite|e ai|e aí|tudo bem|tudo bom|opa|joia|jóia|blz|beleza)( .*)?$/i.test(normalized);
}

export function detectCatalogIntent(text: string) {
  return /(quais planos|quais vc tem|quais vocês têm|quais voces tem|me explica os planos|me explica quais|quero saber os planos|quero saber quais planos|quais existem hoje|cat[aá]logo|catalogo)/i.test(text);
}

export function detectPriceIntent(text: string) {
  return /(quanto custa|qual valor|quais os valores|pre[cç]o|precos|mensalidade)/i.test(text);
}

export function inferTargetStage(messageText: string, conversaAtual?: ConversationSnapshot | null) {
  const text = (messageText || '').toLowerCase();
  if (detectGreetingOnly(text)) return 'acolhimento';
  if (detectCatalogIntent(text) || detectPriceIntent(text)) return 'apresentacao_planos';
  if (/(quero plano|quero pro meu cachorro|me indica|qual melhor plano)/i.test(text)) return 'qualificacao';
  return conversaAtual?.etapa || 'acolhimento';
}

export function buildMariPrompt({
  prompts,
  stage,
  conversationState,
  productCatalog,
  knowledgeBase,
  catalogIntent,
  includePlanContext,
}: {
  prompts: PromptBundle;
  stage: string;
  conversationState?: string;
  productCatalog?: string;
  knowledgeBase?: string;
  catalogIntent?: boolean;
  includePlanContext?: boolean;
}) {
  const sections: string[] = [];

  if (prompts.soul) sections.push(`# SOUL\n${prompts.soul}`);
  if (prompts.tom) sections.push(`# TOM E FLUXO\n${prompts.tom}`);
  if (prompts.regras) sections.push(`# REGRAS GERAIS\n${prompts.regras}`);
  if (prompts.anti_repeticao) sections.push(`# ANTI-REPETICAO\n${prompts.anti_repeticao}`);
  if (prompts.pensamentos) sections.push(`# PENSAMENTOS OPERACIONAIS\n${prompts.pensamentos}`);
  if (prompts.modo_rapido && ['acolhimento', 'qualificacao'].includes(stage)) {
    sections.push(`# MODO RAPIDO\n${prompts.modo_rapido}`);
  }
  if (prompts.planos && includePlanContext && (catalogIntent || ['apresentacao_planos', 'negociacao', 'pre_fechamento', 'fechamento'].includes(stage))) {
    sections.push(`# PLANOS E PRODUTOS\n${prompts.planos}`);
  }
  if (conversationState) sections.push(conversationState);
  if (includePlanContext && productCatalog) sections.push(productCatalog);
  if (knowledgeBase) sections.push(`# BASE DE CONHECIMENTO\n${knowledgeBase}`);

  sections.push(`# ORIENTACAO COMERCIAL
Etapa atual: ${stage}
- Siga a sequência comercial da Mari sem pular contexto.
- Se o cliente pedir os planos, explique primeiro os planos oficiais que existem hoje.
- Não peça "qual plano você quer" antes de listar o catálogo quando a pergunta for sobre planos existentes.
- Depois de listar o catálogo, avance com UMA próxima pergunta útil para qualificação ou recomendação.
- Nunca invente nomes de plano, cobertura, clínica ou valor fora do catálogo/contexto.`);

  return sections.filter(Boolean).join('\n\n');
}

export function buildGreetingResponse(conversaAtual?: ConversationSnapshot | null) {
  const tutor = conversaAtual?.tutor_nome?.trim();
  const pet = conversaAtual?.nome_pet?.trim();
  const greeting = tutor ? `Boa tarde, ${tutor}! 😊` : 'Boa tarde! 😊';
  const followup = pet
    ? `Como posso te ajudar com o ${pet}?`
    : 'Como posso te ajudar?';
  return `${greeting}\n${followup}`;
}

export function formatProductCatalogPrompt(rows: CatalogRow[]) {
  if (!rows.length) return '';

  const grouped = byPlan(rows);
  const lines = [
    '# DADOS DO PRODUTO',
    'Use APENAS os planos e preços abaixo. Nunca invente nomes de plano, faixas ou valores fora desta tabela.',
  ];

  for (const [slug, plan] of grouped.entries()) {
    lines.push(`## ${plan.nome} (${slug})`);
    if (plan.descricao) lines.push(plan.descricao);
    for (const modalidade of plan.modalidades) {
      lines.push(
        `- ${modalidade.modalidade}: vigente ${formatCurrency(modalidade.valor)} | tabela ${formatCurrency(modalidade.valor_tabela)} | promocional ${formatCurrency(modalidade.valor_promocional)} | oferta ${formatCurrency(modalidade.valor_oferta)} | limite ${formatCurrency(modalidade.valor_limite)}`
      );
    }
  }

  return lines.join('\n');
}

export function formatConversationStatePrompt(conversa: ConversationSnapshot | null | undefined) {
  if (!conversa) return '';
  return [
    '# ESTADO DO ATENDIMENTO',
    `Etapa atual: ${conversa.etapa || 'acolhimento'}`,
    `Tutor: ${conversa.tutor_nome || 'não informado'}`,
    `Pet: ${[
      conversa.nome_pet || null,
      conversa.especie || null,
      conversa.raca || null,
      conversa.idade_anos ? `${conversa.idade_anos} anos` : null,
    ].filter(Boolean).join(', ') || 'não informado'}`,
  ].join('\n');
}

export function buildDeterministicCatalogResponse(rows: CatalogRow[], conversaAtual?: ConversationSnapshot | null) {
  if (!rows.length) return null;

  const grouped = byPlan(rows);
  const introName = conversaAtual?.nome_pet ? `pro ${conversaAtual.nome_pet}` : 'pra te explicar certinho';
  const lines = [`Hoje os planos oficiais da Plamev ${introName} são estes:`];

  for (const [slug, plan] of grouped.entries()) {
    const primaryPrice = getPrimaryPrice(plan);
    const description = plan.descricao ? ` ${plan.descricao}` : '';
    lines.push(`- ${plan.nome}${description} Valor inicial: ${formatCurrency(primaryPrice)}.`);
  }

  const missingProfile = !conversaAtual?.idade_anos || !conversaAtual?.raca;
  if (missingProfile) {
    lines.push('Se você quiser, eu já posso te dizer qual deles faz mais sentido. Me conta só a raça e a idade do seu pet?');
  } else {
    lines.push(`Se quiser, eu também já posso te dizer qual desses faz mais sentido pro ${conversaAtual?.nome_pet || 'seu pet'}.`);
  }

  return lines.join('\n');
}

export function chooseNonRepeatingFallback(reason: string | undefined, historico: Array<{ role: string; content: string }>) {
  const fallbacks = [
    'Deixa eu confirmar essa informação com precisão pra te responder certinho, combinado?',
    'Quero te responder sem te enrolar: estou conferindo certinho aqui para te passar só as informações corretas.',
    'Pra não te passar nada errado, eu vou te responder só com o que está confirmado aqui no sistema.',
  ];

  if (reason?.includes('Plano fora do catálogo')) {
    return 'Quero te explicar só os planos oficiais da Plamev, então vou te responder com o catálogo certo.';
  }
  if (reason?.includes('Preço fora do contexto')) {
    return 'Quero te passar só os valores certos, então vou te responder com a tabela oficial.';
  }

  const recentAssistant = historico
    .filter((item) => item.role === 'assistant')
    .slice(-3)
    .map((item) => item.content.trim().toLowerCase());

  return fallbacks.find((candidate) => !recentAssistant.includes(candidate.toLowerCase())) || fallbacks[fallbacks.length - 1];
}
