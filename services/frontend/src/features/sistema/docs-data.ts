// docs-data.ts — Conteúdo real do módulo de documentação.
// Cada artigo segue o Diátaxis Framework: Tutorial, How-to, Reference, Explanation.

export type AudienceTag = 'engenheiro' | 'analista' | 'vendedor';
export type ArticleType = 'explicacao' | 'tutorial' | 'howto' | 'referencia' | 'adr';

export type Block =
  | { type: 'p';     text: string }
  | { type: 'h2';    text: string }
  | { type: 'h3';    text: string }
  | { type: 'code';  lang: string; title?: string; text: string }
  | { type: 'alert'; variant: 'info' | 'warning' | 'danger' | 'tip'; text: string }
  | { type: 'list';  items: string[] }
  | { type: 'ol';    items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'divider' };

export interface Article {
  id: string;
  title: string;
  category: string;
  type: ArticleType;
  audience: AudienceTag[];
  tags: string[];
  summary: string;
  blocks: Block[];
}

export const ARTICLES: Article[] = [

  // ─────────────────────────────────────────────────────────────────────────
  // VISÃO GERAL
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'visao-geral',
    title: 'Visão Geral do Sistema',
    category: 'Introdução',
    type: 'explicacao',
    audience: ['engenheiro', 'analista', 'vendedor'],
    tags: ['overview', 'sistema', 'introdução'],
    summary: 'O que é o sistema, o que ele faz e como os principais componentes se encaixam.',
    blocks: [
      { type: 'p', text: 'O Plamev Gestor de Leads é uma plataforma de atendimento automatizado por IA para comercialização de planos pet da Plamev. O sistema recebe leads via WhatsApp e Telegram, conduz a qualificação, apresenta planos, gera cotações em tempo real e encaminha o fechamento para um supervisor humano quando necessário.' },
      { type: 'h2', text: 'O que o sistema faz' },
      { type: 'list', items: [
        'Recebe mensagens de novos leads via WhatsApp Business (Evolution API) ou Telegram',
        'Identifica o contato, cria ou recupera o cliente no banco de dados',
        'Conduz conversa guiada por IA (Claude Sonnet) para coletar dados do pet e interesse em plano',
        'Consulta API da Plamev para gerar cotação personalizada com preço negociado',
        'Apresenta opções de cobertura, responde dúvidas e trata objeções de preço',
        'Sinaliza para supervisores humanos quando necessário',
        'Registra todo histórico para análise e reativação futura',
      ]},
      { type: 'h2', text: 'Serviços principais' },
      { type: 'table', headers: ['Serviço', 'Porta', 'Responsabilidade'], rows: [
        ['gateway', '3001', 'Ponto de entrada único; roteia para CRM, AI ou Analytics; emite WebSocket para o frontend'],
        ['crm-service', '3002', 'Persistência de clientes, conversas, mensagens; API REST para o frontend'],
        ['agent-ai', '3003', 'Pipeline de IA: debounce, input guard, RAG, LLM, output guard, cotação'],
        ['analytics', '3004', 'Métricas agregadas, funil, performance dos agentes'],
        ['frontend', '5173', 'SPA React/Vite — dashboard de supervisão em tempo real'],
      ]},
      { type: 'h2', text: 'Banco de dados' },
      { type: 'p', text: 'PostgreSQL único, schema `public`. Cada serviço acessa diretamente via pool de conexões. Não existe ORM — as queries são SQL puro com parameterização.' },
      { type: 'alert', variant: 'info', text: 'Para dúvidas rápidas de operação comercial, consulte o Guia do Vendedor. Para entender como o fluxo de IA funciona internamente, leia Fluxo de Atendimento Completo.' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // ARQUITETURA
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'arquitetura',
    title: 'Arquitetura do Sistema',
    category: 'Introdução',
    type: 'explicacao',
    audience: ['engenheiro'],
    tags: ['arquitetura', 'microserviços', 'infraestrutura'],
    summary: 'Como os serviços se comunicam, o papel do gateway e o fluxo de uma mensagem de ponta a ponta.',
    blocks: [
      { type: 'h2', text: 'Diagrama de comunicação' },
      { type: 'code', lang: 'text', title: 'Fluxo de uma mensagem de entrada', text: `WhatsApp (Evolution API)
        │
        ▼  POST /webhook/whatsapp
┌─────────────────┐
│    gateway :3001 │  ← único ponto exposto ao exterior
└────────┬────────┘
         │  valida HMAC + rate limit
         │
         ▼  POST interno
┌─────────────────┐
│  crm-service    │  ← persiste mensagem, resolve conversa/cliente
└────────┬────────┘
         │  emite evento via REST ou socket interno
         │
         ▼
┌─────────────────┐
│   agent-ai      │  ← pipeline: debounce → guards → RAG → LLM → output guard
└────────┬────────┘
         │  resposta pronta
         │
         ▼
┌─────────────────┐
│  crm-service    │  ← persiste resposta
└────────┬────────┘
         │  WebSocket
         ▼
┌─────────────────┐
│   frontend      │  ← atualiza UI do supervisor em tempo real
└─────────────────┘
         │  REST (Evolution API)
         ▼
    Lead no WhatsApp recebe resposta` },
      { type: 'h2', text: 'Gateway como proxy inteligente' },
      { type: 'p', text: 'O gateway em `services/gateway/src/index.ts` não contém lógica de negócio. Ele faz proxy HTTP com `http-proxy-middleware`, valida JWT (middleware `autenticar`), aplica rate limiting por IP e emite eventos WebSocket para o frontend quando eventos importantes chegam do CRM.' },
      { type: 'h2', text: 'Comunicação entre serviços' },
      { type: 'list', items: [
        'gateway → crm-service: HTTP REST (proxy)',
        'gateway → agent-ai: HTTP REST (proxy)',
        'agent-ai → crm-service: HTTP REST direto (para buscar histórico de conversa)',
        'crm-service → gateway: HTTP REST (para emitir WebSocket)',
        'crm-service → Evolution API: HTTP REST (para enviar mensagem ao lead)',
        'agent-ai → Plamev API: HTTP REST (cotação)',
        'agent-ai → Claude API (Anthropic): HTTPS (LLM)',
      ]},
      { type: 'alert', variant: 'warning', text: 'Não há broker de mensagens (Kafka, RabbitMQ). A comunicação é síncrona via HTTP. Isso simplifica o deploy mas significa que falhas no agent-ai não são automaticamente retentadas. O retry é manual ou via timeout do Evolution API.' },
      { type: 'h2', text: 'Variáveis de ambiente críticas' },
      { type: 'table', headers: ['Variável', 'Serviço', 'Descrição'], rows: [
        ['DATABASE_URL', 'crm, gateway, analytics', 'Connection string PostgreSQL'],
        ['ANTHROPIC_API_KEY', 'agent-ai', 'Chave da API Claude (Anthropic)'],
        ['PLAMEV_API_URL', 'agent-ai', 'Base URL da API Plamev (cotações)'],
        ['PLAMEV_TOKEN', 'agent-ai', 'Token Bearer para API Plamev'],
        ['EVOLUTION_API_URL', 'crm-service', 'Base URL da Evolution API (WhatsApp)'],
        ['EVOLUTION_API_KEY', 'crm-service', 'Chave de autenticação Evolution'],
        ['JWT_SECRET', 'todos', 'Segredo para assinar/verificar JWTs dos usuários'],
        ['WEBSOCKET_PORT', 'gateway', 'Porta do servidor WebSocket (padrão: 3001)'],
      ]},
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // FLUXO DE ATENDIMENTO
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'fluxo-atendimento',
    title: 'Fluxo de Atendimento Completo',
    category: 'Núcleo de IA',
    type: 'explicacao',
    audience: ['engenheiro', 'analista'],
    tags: ['fluxo', 'pipeline', 'conversa', 'etapas'],
    summary: 'Cada etapa da conversa desde o primeiro "oi" até o fechamento ou encaminhamento humano.',
    blocks: [
      { type: 'h2', text: 'Etapas da conversa (campo `etapa` na tabela `conversas`)' },
      { type: 'table', headers: ['Etapa', 'O que a IA faz', 'Próxima etapa'], rows: [
        ['saudacao', 'Apresenta-se como Mari e pergunta o nome do lead', 'qualificacao'],
        ['qualificacao', 'Coleta nome, espécie, raça, idade e problema de saúde do pet', 'interesse'],
        ['interesse', 'Pergunta sobre interesse em plano (preventivo, cirurgia, etc.)', 'apresentacao'],
        ['apresentacao', 'Consulta CEP → busca planos disponíveis → apresenta opções', 'negociacao'],
        ['negociacao', 'Responde objeções de preço, aplica desconto se autorizado', 'fechamento'],
        ['fechamento', 'Coleta método de pagamento e encaminha para supervisor', 'pos_venda'],
        ['pos_venda', 'Confirma processo, agenda contato de follow-up', '—'],
      ]},
      { type: 'h2', text: 'Regras de transição de etapa' },
      { type: 'p', text: 'A etapa é atualizada pelo agente de IA ao detectar que o objetivo da etapa foi atingido. A lógica está no system prompt (configurável via tabela `agente_config`). O LLM retorna JSON estruturado com campo `proxima_etapa` quando a transição deve ocorrer.' },
      { type: 'h2', text: 'Gatilhos para atendimento humano' },
      { type: 'list', items: [
        '`ia_silenciada = true`: supervisor clicou em "Silenciar IA" no dashboard',
        'Lead pede explicitamente falar com humano (detectado no output guard)',
        'Mais de 3 tentativas sem avançar na mesma etapa',
        'Cotação com valor acima do limite de desconto configurado',
        'Detecção de conteúdo sensível (ameaças, linguagem agressiva)',
      ]},
      { type: 'alert', variant: 'tip', text: 'O campo `ia_silenciada` é o mecanismo mais confiável para handoff. Quando `true`, o agente lê as mensagens mas não responde. O supervisor vê a conversa em tempo real e pode responder diretamente.' },
      { type: 'h2', text: 'Score de temperatura do lead' },
      { type: 'p', text: 'O campo `score` (0–100) na tabela `conversas` é calculado incrementalmente a cada interação com base em: velocidade de resposta, comprimento das mensagens, uso de palavras de interesse ("quero", "valor", "parcela") e progresso nas etapas. Leads acima de 70 são "quentes".' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // DEBOUNCE
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'debounce',
    title: 'Debounce de Mensagens',
    category: 'Núcleo de IA',
    type: 'explicacao',
    audience: ['engenheiro'],
    tags: ['debounce', 'pipeline', 'latência'],
    summary: 'Por que o sistema aguarda antes de responder e como isso evita respostas fragmentadas.',
    blocks: [
      { type: 'p', text: 'Usuários do WhatsApp frequentemente enviam várias mensagens curtas em sequência ("oi" / "tudo bem?" / "queria saber sobre planos"). Responder cada mensagem individualmente gera uma experiência ruim e desperdiça chamadas à API do LLM.' },
      { type: 'h2', text: 'Como funciona' },
      { type: 'p', text: 'Ao receber uma mensagem, o agent-ai configura um timer de 4 segundos (configurável via `DEBOUNCE_MS`). Se uma nova mensagem chegar do mesmo lead antes do timer expirar, o timer é reiniciado. Quando o timer dispara, todas as mensagens acumuladas são processadas juntas como um único turn de usuário.' },
      { type: 'code', lang: 'typescript', title: 'services/agent-ai/src/pipeline/debounce.ts (simplificado)', text: `const timers = new Map<string, NodeJS.Timeout>();
const buffers = new Map<string, string[]>();

export function debounceMessage(
  conversaId: string,
  texto: string,
  callback: (mensagens: string[]) => void,
  delayMs = 4000,
) {
  // Acumula no buffer
  const buf = buffers.get(conversaId) ?? [];
  buf.push(texto);
  buffers.set(conversaId, buf);

  // Reinicia timer
  clearTimeout(timers.get(conversaId));
  timers.set(conversaId, setTimeout(() => {
    const msgs = buffers.get(conversaId) ?? [];
    buffers.delete(conversaId);
    timers.delete(conversaId);
    callback(msgs);
  }, delayMs));
}` },
      { type: 'h2', text: 'Impacto na latência percebida' },
      { type: 'p', text: 'Com debounce de 4s, o lead vê o indicador "digitando..." do WhatsApp por até 4s antes da resposta. Testes mostraram que leads aceitam bem essa latência, especialmente quando combinada com a mensagem de "entendi, vou verificar..."' },
      { type: 'alert', variant: 'warning', text: 'Se o debounce estiver muito alto (>8s), leads abandonam a conversa antes da resposta. Se muito baixo (<2s), o agente responde mensagens incompletas. O valor atual (4s) foi calibrado empiricamente.' },
      { type: 'h2', text: 'Configuração' },
      { type: 'table', headers: ['Variável', 'Padrão', 'Descrição'], rows: [
        ['DEBOUNCE_MS', '4000', 'Tempo de espera em milissegundos'],
        ['DEBOUNCE_MAX_MSGS', '10', 'Máximo de mensagens acumuladas antes de forçar processamento'],
      ]},
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // INPUT GUARD
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'input-guard',
    title: 'Input Guard — Guardrail de Entrada',
    category: 'Núcleo de IA',
    type: 'explicacao',
    audience: ['engenheiro'],
    tags: ['guard', 'segurança', 'moderação', 'input'],
    summary: 'Como o sistema filtra mensagens de entrada antes de enviar ao LLM para evitar abusos e injeções de prompt.',
    blocks: [
      { type: 'p', text: 'O Input Guard é a primeira camada de processamento após o debounce. Ele analisa o texto do lead antes de qualquer chamada ao LLM.' },
      { type: 'h2', text: 'Verificações realizadas' },
      { type: 'ol', items: [
        'Comprimento máximo: mensagens >2000 caracteres são truncadas e o lead recebe aviso',
        'Detecção de spam/floods: >5 mensagens iguais consecutivas bloqueiam por 10min',
        'Injeção de prompt: padrões como "ignore todas as instruções anteriores" são bloqueados',
        'Conteúdo impróprio: palavrões graves acionam alerta para supervisor',
        'Números de cartão de crédito/CPF no chat: bloqueados por regex (PCI compliance)',
      ]},
      { type: 'code', lang: 'typescript', title: 'Trecho de services/agent-ai/src/pipeline/inputGuard.ts', text: `const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /ignore\s+(todas\s+as\s+)?instru[çc][õo]es/i,
  /system\s*prompt/i,
  /jailbreak/i,
  /DAN\b/,  // "Do Anything Now" jailbreak variant
];

export function checkInputGuard(text: string): GuardResult {
  if (text.length > 2000) return { blocked: false, truncated: text.slice(0, 2000) };

  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return { blocked: true, reason: 'prompt_injection' };
    }
  }

  // CPF: /\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}/
  if (/\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}/.test(text)) {
    return { blocked: true, reason: 'pii_cpf' };
  }

  return { blocked: false };
}` },
      { type: 'alert', variant: 'info', text: 'O Input Guard não usa LLM — é 100% baseado em regras para ter latência zero. A moderação semântica (tom agressivo, conteúdo sensível) é feita pelo Output Guard após o LLM processar.' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // RAG
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'rag',
    title: 'RAG — Recuperação Aumentada por Contexto',
    category: 'Núcleo de IA',
    type: 'explicacao',
    audience: ['engenheiro', 'analista'],
    tags: ['rag', 'contexto', 'conhecimento', 'banco de dados'],
    summary: 'Como o agente busca informações relevantes no banco de conhecimento antes de responder.',
    blocks: [
      { type: 'p', text: 'RAG (Retrieval-Augmented Generation) é a técnica que permite ao LLM responder com base em informações específicas da Plamev sem precisar "memorizar" tudo no treinamento. O agente busca chunks relevantes do banco de conhecimento e os injeta no system prompt antes da chamada ao LLM.' },
      { type: 'h2', text: 'Tabelas de conhecimento' },
      { type: 'table', headers: ['Tabela', 'Conteúdo'], rows: [
        ['rag_documentos', 'Documentos completos (FAQs, políticas, guias de planos)'],
        ['rag_chunks', 'Chunks de ~500 tokens com embedding vetorial (pgvector)'],
        ['planos_plamev_ids', 'Mapeamento tipo_cobertura → nome → UUID da API Plamev'],
        ['agente_config', 'System prompt, temperatura, modelo e regras do agente'],
      ]},
      { type: 'h2', text: 'Fluxo de recuperação' },
      { type: 'ol', items: [
        'Mensagem do lead passa pelo Input Guard',
        'Sistema gera embedding da mensagem (via Anthropic ou OpenAI)',
        'Busca por similaridade de cosseno em `rag_chunks` (top-5)',
        'Chunks recuperados são formatados como bloco `<contexto>` no system prompt',
        'LLM recebe: system prompt + contexto + histórico de conversa + mensagem atual',
      ]},
      { type: 'code', lang: 'sql', title: 'Query de busca vetorial (pgvector)', text: `SELECT id, conteudo, documento_id,
       1 - (embedding <=> $1::vector) AS similarity
FROM rag_chunks
WHERE org_id = $2
  AND ativo = true
ORDER BY embedding <=> $1::vector
LIMIT 5;` },
      { type: 'alert', variant: 'tip', text: 'Para atualizar o conteúdo que o agente conhece (ex: novo plano, nova regra de desconto), edite a tabela `rag_documentos` via SQL Browser e re-execute o processo de chunking/embedding. O agente usa o novo conteúdo imediatamente.' },
      { type: 'h2', text: 'Gerenciando o conhecimento via SQL Browser' },
      { type: 'ol', items: [
        'Acesse Sistema > SQL Browser',
        'Selecione a tabela `rag_documentos`',
        'Clique no ícone de lápis na linha que deseja editar',
        'Clique na célula `conteudo` para editar o texto',
        'Salve com Enter ou clique no ícone de check',
        'Execute o job de re-embedding (via endpoint POST /api/rag/reindex)',
      ]},
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // LLM
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'llm-payloads',
    title: 'LLM — Chamadas, Payloads e Configuração',
    category: 'Núcleo de IA',
    type: 'referencia',
    audience: ['engenheiro'],
    tags: ['llm', 'claude', 'anthropic', 'payload', 'api'],
    summary: 'Estrutura exata das chamadas ao Claude, campos configuráveis e como interpretar respostas.',
    blocks: [
      { type: 'p', text: 'O sistema usa a API Anthropic (Claude Sonnet 4 por padrão) para todas as respostas de conversação. A chamada é feita no arquivo `services/agent-ai/src/services/llm.ts`.' },
      { type: 'h2', text: 'Payload de chamada (Messages API)' },
      { type: 'code', lang: 'json', title: 'POST https://api.anthropic.com/v1/messages', text: `{
  "model": "claude-sonnet-4-5",
  "max_tokens": 1024,
  "temperature": 0.7,
  "system": "Você é Mari, assistente da Plamev Pet...\\n\\n<contexto_rag>\\n[chunks recuperados]\\n</contexto_rag>",
  "messages": [
    { "role": "user",      "content": "oi, queria saber sobre planos" },
    { "role": "assistant", "content": "Olá! Sou a Mari da Plamev..." },
    { "role": "user",      "content": "meu cachorro tem 3 anos, labrador" }
  ]
}` },
      { type: 'h2', text: 'Resposta esperada' },
      { type: 'code', lang: 'json', title: 'Resposta da API Anthropic', text: `{
  "id": "msg_01XFDUDYJgAACzvnptvVoYEL",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "Que ótimo, um Labrador! Antes de apresentar as opções..."
    }
  ],
  "model": "claude-sonnet-4-5-20251001",
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 842,
    "output_tokens": 156
  }
}` },
      { type: 'h2', text: 'Configuração por organização' },
      { type: 'p', text: 'Os parâmetros do LLM são armazenados na tabela `agente_config` por `org_id`. Isso permite que cada organização cliente tenha seu próprio agente com persona diferente.' },
      { type: 'table', headers: ['Campo', 'Tipo', 'Padrão', 'Descrição'], rows: [
        ['modelo', 'text', 'claude-sonnet-4-5', 'ID do modelo Anthropic'],
        ['temperatura', 'float', '0.7', 'Criatividade (0=determinístico, 1=criativo)'],
        ['max_tokens', 'int', '1024', 'Limite de tokens na resposta'],
        ['system_prompt', 'text', '...', 'Prompt de sistema completo com persona e regras'],
        ['nome_agente', 'text', 'Mari', 'Nome da IA exibido no WhatsApp'],
        ['idioma', 'text', 'pt-BR', 'Idioma das respostas'],
      ]},
      { type: 'h2', text: 'Custo por mensagem' },
      { type: 'p', text: 'Claude Sonnet 4.5: US$3/M tokens de entrada, US$15/M de saída. Uma conversa média de 20 turnos usa ~15.000 tokens de entrada e ~3.000 de saída, custando aproximadamente US$0,09 por conversa completa.' },
      { type: 'alert', variant: 'warning', text: 'O campo `temperature` afeta diretamente a consistência das respostas estruturadas (JSON de transição de etapa). Valores >0.9 podem gerar JSON malformado. Mantenha entre 0.6 e 0.8 para respostas de negociação.' },
      { type: 'h2', text: 'Resposta estruturada (JSON mode)' },
      { type: 'p', text: 'Para transições de etapa e extração de dados do pet, o agente usa uma instrução no system prompt solicitando JSON. O Output Guard valida e faz parse antes de persistir.' },
      { type: 'code', lang: 'json', title: 'Exemplo de resposta estruturada para extração de dados do pet', text: `{
  "resposta_usuario": "Entendido! Um Labrador de 3 anos. Vou verificar os planos disponíveis para ele.",
  "dados_extraidos": {
    "pet_nome": null,
    "pet_especie": "cachorro",
    "pet_raca": "labrador",
    "pet_idade": 3,
    "pet_problema": null
  },
  "proxima_etapa": "apresentacao",
  "acoes": ["buscar_planos_por_cep"]
}` },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // OUTPUT GUARD
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'output-guard',
    title: 'Output Guard — Guardrail de Saída',
    category: 'Núcleo de IA',
    type: 'explicacao',
    audience: ['engenheiro'],
    tags: ['guard', 'output', 'segurança', 'qualidade'],
    summary: 'Como as respostas do LLM são validadas antes de serem enviadas ao lead.',
    blocks: [
      { type: 'p', text: 'O Output Guard recebe a resposta bruta do LLM e executa verificações de qualidade e segurança antes de enviar ao lead via WhatsApp/Telegram.' },
      { type: 'h2', text: 'Verificações realizadas' },
      { type: 'list', items: [
        'Parse do JSON estruturado — se malformado, aplica fallback de texto puro',
        'Validação de campos obrigatórios (`resposta_usuario` não pode ser vazio)',
        'Detecção de alucinação de preço — se a resposta menciona R$ mas o valor não está no catálogo, bloqueia e usa valor real',
        'Filtragem de informações sensíveis — remove menções acidentais de token, senha, dados internos',
        'Tamanho da resposta — trunca respostas >500 palavras com aviso',
        'Detecção de solicitação de humano — se lead pede supervisor, aciona handoff',
      ]},
      { type: 'code', lang: 'typescript', title: 'Verificação de alucinação de preço (simplificada)', text: `const PRICE_PATTERN = /R\\\$\\s*[\\d.,]+/g;

export function checkPriceHallucination(
  resposta: string,
  planosDisponiveis: Plano[],
): { ok: boolean; corrigida?: string } {
  const mencionados = resposta.match(PRICE_PATTERN) ?? [];

  for (const preco of mencionados) {
    const valor = parseFloat(preco.replace(/R\\\$|\\s/g, '').replace(',', '.'));
    const matches = planosDisponiveis.some(p =>
      Math.abs(p.valor_mensal - valor) < 0.50
    );
    if (!matches) {
      return { ok: false }; // alucinação detectada
    }
  }
  return { ok: true };
}` },
      { type: 'alert', variant: 'danger', text: 'Respostas bloqueadas pelo Output Guard são registradas na tabela `alucinacoes_log` para análise. Uma taxa >5% por semana indica que o system prompt precisa ser revisado.' },
      { type: 'h2', text: 'Proibição de em-dash' },
      { type: 'p', text: 'O Output Guard remove automaticamente o caractere em-dash (—) de todas as respostas antes do envio. Esse caractere é característico de escrita por IA e foi identificado pelos supervisores como um indicador que faz leads desconfiarem que estão falando com robô.' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // CEP
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'consulta-cep',
    title: 'Consulta de CEP e Localização',
    category: 'Integrações',
    type: 'referencia',
    audience: ['engenheiro', 'analista'],
    tags: ['cep', 'viacep', 'estado', 'ibge', 'localização'],
    summary: 'Como o CEP do lead é resolvido para Estado e IBGE, e por que isso é necessário para cotação.',
    blocks: [
      { type: 'p', text: 'A API da Plamev exige o `EstadosId` (inteiro 1-27) para buscar planos disponíveis na região do lead. O CEP digitado pelo lead é convertido para Estado via API ViaCEP.' },
      { type: 'h2', text: 'Fluxo de resolução' },
      { type: 'ol', items: [
        'Lead informa o CEP durante a qualificação ("meu cep é 01310-100")',
        'Regex `\\d{5}-?\\d{3}` captura o CEP da mensagem',
        'GET `https://viacep.com.br/ws/{cep}/json/` retorna cidade, estado, ibge',
        'O campo `uf` (ex: "SP") é mapeado para `EstadosId` via dicionário em código',
        'Estado é armazenado em `perfil_pet.cep` e `conversas.estado_id`',
      ]},
      { type: 'code', lang: 'typescript', title: 'Mapeamento UF → EstadosId', text: `const UF_TO_ESTADOS_ID: Record<string, number> = {
  AC: 1,  AL: 2,  AP: 3,  AM: 4,  BA: 5,
  CE: 6,  DF: 7,  ES: 8,  GO: 9,  MA: 10,
  MT: 11, MS: 12, MG: 13, PA: 14, PB: 15,
  PR: 16, PE: 17, PI: 18, RJ: 19, RN: 20,
  RS: 21, RO: 22, RR: 23, SC: 24, SP: 25,
  SE: 26, TO: 27,
};` },
      { type: 'h2', text: 'Cache e fallback' },
      { type: 'p', text: 'CEPs resolvidos são cacheados em memória por 24h para evitar latência na ViaCEP. Se a API da ViaCEP estiver indisponível, o agente pede ao lead que informe apenas o estado.' },
      { type: 'alert', variant: 'info', text: 'CEPs de caixa postal (ex: 70002-900) retornam apenas UF sem cidade. Isso é suficiente para cotação pois a Plamev usa apenas o Estado para definir preço.' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // GERAÇÃO DE COTAÇÃO
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'geracao-cotacao',
    title: 'Geração de Cotação — Fluxo Completo',
    category: 'Integrações',
    type: 'tutorial',
    audience: ['engenheiro', 'analista'],
    tags: ['cotacao', 'plamev-api', 'planos', 'preço', 'campanha'],
    summary: 'Os 6 passos para gerar uma cotação com preço negociado via API Plamev, com payloads reais.',
    blocks: [
      { type: 'p', text: 'A cotação é gerada quando o lead demonstra interesse em um plano específico e informa o CEP. O fluxo envolve 4 chamadas à API Plamev.' },
      { type: 'h2', text: 'Passo 1 — Resolver EstadosId pelo CEP' },
      { type: 'p', text: 'Já descrito em "Consulta de CEP". O resultado é um inteiro 1-27 correspondente ao estado.' },
      { type: 'h2', text: 'Passo 2 — Buscar tipo_cobertura pelo nome do plano' },
      { type: 'p', text: 'O nome do plano de interesse do lead ("Platinum", "Advance Plus", etc.) é mapeado para `tipo_cobertura` via tabela `planos_plamev_ids` no PostgreSQL.' },
      { type: 'code', lang: 'sql', title: 'Query de resolução do plano', text: `SELECT tipo_cobertura, coberturas_id
FROM planos_plamev_ids
WHERE LOWER(nome_cobertura) LIKE LOWER($1)
LIMIT 1;` },
      { type: 'h2', text: 'Passo 3 — BuscarCampanhasEv' },
      { type: 'p', text: 'Busca as campanhas ativas para o estado e tipo de cobertura. Retorna lista de campanhas com `CampanhasCoberturasId` e nome.' },
      { type: 'code', lang: 'json', title: 'POST /BuscarCampanhasEv (payload)', text: `{
  "EstadosId": 25,
  "TipoCobertura": 5
}` },
      { type: 'code', lang: 'json', title: 'Resposta BuscarCampanhasEv', text: `{
  "Campanhas": [
    {
      "CampanhasCoberturasId": "A4F527FF-6B3D-4E8A-B1C2-D5E6F7A8B9C0",
      "CampanhasCoberturasNome": "Platinum SP Varejo 2025",
      "DataInicio": "2025-01-01",
      "DataFim": "2025-12-31",
      "Ativo": true
    }
  ]
}` },
      { type: 'h2', text: 'Passo 4 — CampanhasCoberturasTabelas/consultar' },
      { type: 'p', text: 'Busca as tabelas de preço para a campanha selecionada. O campo `ValorOfertado` (valor negociado) permite filtrar pela tabela de desconto correta.' },
      { type: 'code', lang: 'json', title: 'POST /CampanhasCoberturasTabelas/consultar (payload)', text: `{
  "CampanhasCoberturasId": "A4F527FF-6B3D-4E8A-B1C2-D5E6F7A8B9C0"
}` },
      { type: 'code', lang: 'json', title: 'Resposta CampanhasCoberturasTabelas/consultar', text: `{
  "Tabelas": [
    {
      "CampanhasCoberturaTabelasId": "B2C3D4E5-F6A7-8B9C-0D1E-2F3A4B5C6D7E",
      "ValorOriginal": 149.90,
      "ValorOfertado": 89.90,
      "Descricao": "Tabela Especial Parceiro"
    },
    {
      "CampanhasCoberturaTabelasId": "C3D4E5F6-A7B8-9C0D-1E2F-3A4B5C6D7E8F",
      "ValorOriginal": 149.90,
      "ValorOfertado": 149.90,
      "Descricao": "Tabela Normal"
    }
  ]
}` },
      { type: 'alert', variant: 'warning', text: 'A seleção da tabela correta é crítica. O agente usa `ValorOfertado` para identificar qual tabela oferece o preço negociado. Se `valorOfertado` não foi fornecido pelo supervisor (campo em `conversas`), a tabela Normal é usada.' },
      { type: 'h2', text: 'Passo 5 — SolicitaCotacaoPet' },
      { type: 'code', lang: 'json', title: 'POST /SolicitaCotacaoPet (payload completo)', text: `{
  "CampanhasCoberturasId": "A4F527FF-6B3D-4E8A-B1C2-D5E6F7A8B9C0",
  "CampanhasCoberturaTabelasId": "B2C3D4E5-F6A7-8B9C-0D1E-2F3A4B5C6D7E",
  "CoberturasId": "3A0AB126-EA29-70BA-77D5-C78742EE6550",
  "TipoCobertura": 5,
  "EstadosId": 25,
  "PetNome": "Rex",
  "PetEspecie": 1,
  "PetRaca": "Labrador Retriever",
  "PetIdade": 3,
  "PetSexo": 1,
  "DadosContratante": {
    "Nome": "João Silva",
    "CPF": "000.000.000-00",
    "Telefone": "11999999999"
  }
}` },
      { type: 'h2', text: 'Passo 6 — Resultado e apresentação' },
      { type: 'p', text: 'A resposta de `SolicitaCotacaoPet` contém o `CotacaoId` e o preço final. O agente formata a mensagem de apresentação com o preço, coberturas incluídas e formas de pagamento disponíveis.' },
      { type: 'alert', variant: 'tip', text: 'Se a API retornar preço cheio (ex: R$149,90) mesmo passando CampanhasCoberturaTabelasId correto, verifique se o UUID está em uppercase. A Plamev API é case-sensitive nos UUIDs.' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // APRESENTAÇÃO DE PLANOS
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'planos-disponiveis',
    title: 'Planos Disponíveis e Coberturas',
    category: 'Operação Comercial',
    type: 'referencia',
    audience: ['analista', 'vendedor'],
    tags: ['planos', 'coberturas', 'preços', 'plamev'],
    summary: 'Tabela de planos, coberturas e regras de apresentação para o lead.',
    blocks: [
      { type: 'h2', text: 'Planos por tipo de cobertura' },
      { type: 'table', headers: ['tipo_cobertura', 'Nome', 'Perfil', 'Destaques'], rows: [
        ['1', 'Basic', 'Preventivo básico', 'Vacinas, vermífugos, antipulgas'],
        ['2', 'Essential', 'Preventivo completo', 'Basic + consultas ilimitadas'],
        ['3', 'Advance', 'Médio', 'Essential + exames laboratoriais'],
        ['4', 'Advance Plus', 'Médio+', 'Advance + internação básica'],
        ['5', 'Platinum', 'Premium', 'Advance Plus + cirurgias eletivas'],
        ['14', 'Platinum Plus', 'Premium+', 'Platinum + oncologia + fisioterapia'],
        ['6', 'Diamond', 'Top', 'Cobertura total sem carência'],
      ]},
      { type: 'h2', text: 'Regras de apresentação' },
      { type: 'list', items: [
        'Apresentar máximo 3 opções por vez para não sobrecarregar o lead',
        'Sempre partir do plano de interesse declarado (âncora) e oferecer um acima e um abaixo',
        'Nunca mencionar o preço de tabela (R$149,90) quando existe preço negociado (R$89,90)',
        'Reforçar o custo-benefício: "por menos de R$3 por dia, seu pet tem..."',
        'Animais >8 anos têm restrições em alguns planos — verificar no catalog antes de oferecer',
      ]},
      { type: 'alert', variant: 'warning', text: 'Pets com problema de saúde preexistente declarado NÃO podem contratar planos com cobertura para a condição informada. O agente inclui aviso de carência na apresentação.' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // NEGOCIAÇÃO
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'negociacao',
    title: 'Negociação de Preço e Objeções',
    category: 'Operação Comercial',
    type: 'howto',
    audience: ['analista', 'vendedor'],
    tags: ['negociação', 'objeção', 'desconto', 'preço'],
    summary: 'Como o agente lida com objeções de preço e como supervisores podem autorizar descontos.',
    blocks: [
      { type: 'h2', text: 'Fluxo de objeção de preço' },
      { type: 'ol', items: [
        'Lead objeta ao preço: "está caro", "não tenho esse dinheiro"',
        'Agente tenta primeira recontextualização: foco no custo diário e no risco de vet emergencial',
        'Se lead insiste, agente oferece plano de menor cobertura como alternativa',
        'Se lead ainda resiste, agente informa que "pode verificar uma condição especial" e silencia temporariamente',
        'Supervisor recebe alerta e pode definir `valorOfertado` na conversa',
        'Agente retoma com nova cotação usando o preço negociado',
      ]},
      { type: 'h2', text: 'Como definir o preço negociado (supervisor)' },
      { type: 'ol', items: [
        'No Dashboard, localize a conversa com objeção de preço',
        'Clique em "Ver conversa" para abrir o chat',
        'No painel de detalhes da conversa, edite o campo "Valor Ofertado"',
        'Digite o valor negociado (ex: 89.90)',
        'Clique em "Reativar IA" — o agente recomeça com o novo preço',
      ]},
      { type: 'alert', variant: 'danger', text: 'Nunca autorize desconto abaixo do piso mínimo cadastrado em `agente_config.desconto_minimo_reais`. Cotações abaixo do piso são bloqueadas pelo sistema.' },
      { type: 'h2', text: 'Objeções comuns e respostas do agente' },
      { type: 'table', headers: ['Objeção', 'Estratégia do agente'], rows: [
        ['"Preciso pensar"', 'Urgência suave: "Esse preço especial é até X data"'],
        ['"Meu pet é saudável"', 'Reframe: "É exatamente quando é saudável que custa menos contratar"'],
        ['"Tenho veterinário de confiança"', 'Complementaridade: "O plano funciona junto com qualquer vet"'],
        ['"Posso pagar parcelado?"', 'Sim, apresenta opções de 3, 6 ou 12x sem juros'],
        ['"Não confio em planos"', 'Prova social: depoimentos + política de reembolso clara'],
      ]},
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // API REFERENCE
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'api-reference',
    title: 'API Reference — Endpoints Internos',
    category: 'Referência Técnica',
    type: 'referencia',
    audience: ['engenheiro'],
    tags: ['api', 'endpoints', 'rest', 'swagger'],
    summary: 'Todos os endpoints REST expostos pelo gateway, com método, autenticação e parâmetros.',
    blocks: [
      { type: 'h2', text: 'Base URL' },
      { type: 'code', lang: 'text', text: `Production:  https://api.plamevbrasil.com.br
Development: http://localhost:3001` },
      { type: 'h2', text: 'Autenticação' },
      { type: 'p', text: 'Todos os endpoints (exceto /auth/login) exigem header `Authorization: Bearer <JWT>`. O JWT é obtido via POST /auth/login e expira em 24h.' },
      { type: 'h2', text: 'Conversas' },
      { type: 'table', headers: ['Método', 'Path', 'Descrição'], rows: [
        ['GET', '/api/conversas', 'Lista conversas com paginação e filtros'],
        ['GET', '/api/conversas/:id', 'Detalhe de uma conversa com mensagens'],
        ['PATCH', '/api/conversas/:id', 'Atualiza campos (etapa, ia_silenciada, score)'],
        ['POST', '/api/conversas/:id/mensagem', 'Envia mensagem manual como supervisor'],
        ['POST', '/api/conversas/:id/silenciar', 'Ativa/desativa IA nesta conversa'],
      ]},
      { type: 'h2', text: 'Clientes' },
      { type: 'table', headers: ['Método', 'Path', 'Descrição'], rows: [
        ['GET', '/api/clientes', 'Lista clientes com busca e filtros'],
        ['GET', '/api/clientes/:id', 'Perfil completo com pet e histórico'],
        ['PATCH', '/api/clientes/:id', 'Atualiza dados do cliente'],
      ]},
      { type: 'h2', text: 'Estatísticas' },
      { type: 'table', headers: ['Método', 'Path', 'Descrição'], rows: [
        ['GET', '/api/stats', 'KPIs: novos clientes, msgs, custo, taxa sucesso'],
        ['GET', '/api/stats/series', 'Séries temporais para gráficos'],
        ['GET', '/api/stats/funil', 'Contagem por etapa do funil'],
      ]},
      { type: 'h2', text: 'SQL Browser (soAdmin)' },
      { type: 'table', headers: ['Método', 'Path', 'Descrição'], rows: [
        ['GET', '/api/db/tables', 'Lista tabelas do schema public'],
        ['GET', '/api/db/tables/:name', 'Schema de colunas e PKs de uma tabela'],
        ['GET', '/api/db/preview/:name', 'Primeiras linhas (paginado)'],
        ['POST', '/api/db/query', 'SELECT livre (apenas SELECT permitido)'],
        ['PATCH', '/api/db/record/:name', 'UPDATE de um registro pelo PK'],
      ]},
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // WEBHOOKS
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'webhooks',
    title: 'Webhooks — Eventos de Entrada',
    category: 'Referência Técnica',
    type: 'referencia',
    audience: ['engenheiro'],
    tags: ['webhook', 'whatsapp', 'telegram', 'evolution'],
    summary: 'Estrutura dos webhooks recebidos da Evolution API (WhatsApp) e bot Telegram.',
    blocks: [
      { type: 'h2', text: 'WhatsApp via Evolution API' },
      { type: 'p', text: 'A Evolution API envia um POST para `POST /webhook/whatsapp` a cada mensagem nova. O gateway valida a assinatura HMAC-SHA256 antes de processar.' },
      { type: 'code', lang: 'json', title: 'Payload de mensagem de texto (WhatsApp)', text: `{
  "event": "messages.upsert",
  "instance": "plamev-instance-1",
  "data": {
    "key": {
      "remoteJid": "5511999999999@s.whatsapp.net",
      "fromMe": false,
      "id": "3EB0ABC123DEF456"
    },
    "message": {
      "conversation": "oi, quero saber sobre planos para meu cachorro"
    },
    "messageTimestamp": 1715000000,
    "pushName": "João Silva"
  }
}` },
      { type: 'h2', text: 'Tipos de evento tratados' },
      { type: 'table', headers: ['Evento', 'Ação'], rows: [
        ['messages.upsert', 'Processa nova mensagem do lead'],
        ['messages.update', 'Atualiza status de entrega/leitura'],
        ['connection.update', 'Monitora status da conexão WhatsApp'],
        ['qr.updated', 'Emite novo QR code via WebSocket para reconexão'],
      ]},
      { type: 'h2', text: 'Telegram' },
      { type: 'code', lang: 'json', title: 'Update do Telegram Bot API', text: `{
  "update_id": 123456789,
  "message": {
    "message_id": 1,
    "from": {
      "id": 987654321,
      "first_name": "Maria",
      "username": "maria_pet"
    },
    "chat": { "id": 987654321, "type": "private" },
    "date": 1715000000,
    "text": "olá, tenho um gato"
  }
}` },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // BANCO DE DADOS
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'banco-de-dados',
    title: 'Banco de Dados — Schema Principal',
    category: 'Referência Técnica',
    type: 'referencia',
    audience: ['engenheiro', 'analista'],
    tags: ['postgres', 'schema', 'tabelas', 'sql'],
    summary: 'Descrição das tabelas principais, seus campos e relações.',
    blocks: [
      { type: 'h2', text: 'Diagrama de entidades (simplificado)' },
      { type: 'code', lang: 'text', text: `orgs (1)─────────────(N) clientes
                              │
                              └──(N) conversas (1)──(N) mensagens
                                        │
                                        └──(1) perfil_pet` },
      { type: 'h2', text: 'Tabelas core' },
      { type: 'table', headers: ['Tabela', 'PK', 'Descrição'], rows: [
        ['orgs', 'id UUID', 'Organizações clientes do sistema'],
        ['usuarios', 'id UUID', 'Supervisores com acesso ao dashboard'],
        ['clientes', 'id UUID', 'Leads/contatos recebidos via WhatsApp'],
        ['identificadores_cliente', 'id UUID', 'Telefones, emails, IDs externos do cliente'],
        ['conversas', 'id UUID', 'Thread de conversa por canal (WhatsApp, Telegram)'],
        ['mensagens', 'id UUID', 'Mensagens individuais da conversa'],
        ['perfil_pet', 'id UUID', 'Dados do pet do lead (espécie, raça, idade)'],
        ['agente_config', 'id UUID', 'Configuração do agente IA por organização'],
        ['rag_documentos', 'id UUID', 'Documentos de conhecimento para RAG'],
        ['rag_chunks', 'id UUID', 'Chunks com embeddings vetoriais'],
        ['planos_plamev_ids', 'nome_cobertura text', 'Mapeamento plano ↔ tipo_cobertura ↔ coberturas_id'],
        ['templates', 'id UUID', 'Templates de mensagem reutilizáveis'],
      ]},
      { type: 'h2', text: 'Campos importantes de `conversas`' },
      { type: 'table', headers: ['Campo', 'Tipo', 'Descrição'], rows: [
        ['etapa', 'text', 'Etapa atual da conversa (ver Fluxo de Atendimento)'],
        ['status', 'text', 'ativa | pausada | encerrada | transferida'],
        ['canal', 'text', 'whatsapp | telegram'],
        ['ia_silenciada', 'boolean', 'Se true, IA não responde (handoff humano)'],
        ['score', 'int', 'Temperatura do lead 0-100'],
        ['valor_ofertado', 'numeric', 'Preço negociado pelo supervisor'],
        ['cotacao_id', 'text', 'ID da última cotação gerada pela API Plamev'],
        ['numero_externo', 'text', 'Número do WhatsApp ou chat_id do Telegram'],
        ['ultima_interacao', 'timestamptz', 'Timestamp da última mensagem'],
      ]},
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SEGURANÇA
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'seguranca',
    title: 'Segurança e Autenticação',
    category: 'Referência Técnica',
    type: 'referencia',
    audience: ['engenheiro'],
    tags: ['segurança', 'jwt', 'auth', 'rbac', 'sql-injection'],
    summary: 'Modelo de autenticação, autorização por role e proteções contra SQL injection.',
    blocks: [
      { type: 'h2', text: 'Autenticação' },
      { type: 'p', text: 'JWT assinado com HS256. Payload: `{ sub: userId, orgId, role, iat, exp }`. Expira em 24h. Refresh token não implementado — re-login necessário.' },
      { type: 'h2', text: 'Roles disponíveis' },
      { type: 'table', headers: ['Role', 'Permissões'], rows: [
        ['admin', 'Acesso total, incluindo SQL Browser, Usuários e Planos'],
        ['supervisor', 'Atender conversas, ver dashboard, silenciar IA, definir desconto'],
        ['viewer', 'Somente visualização — sem edição'],
      ]},
      { type: 'h2', text: 'Proteção SQL Injection no SQL Browser' },
      { type: 'list', items: [
        'Nomes de tabela: validados por regex `/^[a-z_][a-z0-9_]*$/i` antes de interpolar na query',
        'Verificação de existência da tabela via `pg_class` (evita TOCTOU)',
        'Nomes de coluna no PATCH: mesma regex aplicada a cada coluna',
        'Valores de célula: sempre passados como parâmetros `$1, $2, ...` — nunca interpolados',
        'Bloqueio de DDL/DML no endpoint de SELECT livre via regex de palavras reservadas',
      ]},
      { type: 'code', lang: 'typescript', title: 'Validação de identificador SQL', text: `function isIdentValido(nome: string): boolean {
  return /^[a-z_][a-z0-9_]*$/i.test(nome) && nome.length <= 64;
}` },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // LOGS E OBSERVABILIDADE
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'logs',
    title: 'Logs e Observabilidade',
    category: 'Referência Técnica',
    type: 'referencia',
    audience: ['engenheiro'],
    tags: ['logs', 'observabilidade', 'debug', 'erros'],
    summary: 'Como ler os logs dos serviços, onde encontrar erros e como rastrear uma conversa.',
    blocks: [
      { type: 'h2', text: 'Prefixos de log por serviço' },
      { type: 'table', headers: ['Prefixo', 'Serviço', 'Exemplo'], rows: [
        ['[GATEWAY]', 'gateway', '[GATEWAY] Proxy /api/conversas → CRM 200'],
        ['[CRM]', 'crm-service', '[CRM] Nova mensagem conversa abc123'],
        ['[AI]', 'agent-ai', '[AI] Pipeline iniciado conversa abc123'],
        ['[COTACAO]', 'agent-ai/cotacao', '[COTACAO] BuscarCampanhasEv SP tipo=5'],
        ['[LLM]', 'agent-ai/llm', '[LLM] Claude 842 in / 156 out tokens'],
        ['[GUARD]', 'agent-ai/guards', '[GUARD] Input blocked: prompt_injection'],
      ]},
      { type: 'h2', text: 'Rastreando uma conversa por ID' },
      { type: 'code', lang: 'bash', title: 'Filtrar todos os logs de uma conversa', text: `# Em produção (Docker logs)
docker logs crm-service 2>&1 | grep "abc123-conversa-id"
docker logs agent-ai 2>&1 | grep "abc123-conversa-id"

# Local (se usando pm2)
pm2 logs agent-ai --lines 200 | grep "abc123"` },
      { type: 'h2', text: 'Logs de cotação (diagnóstico de preço errado)' },
      { type: 'p', text: 'O módulo de cotação loga o payload completo de cada chamada à API Plamev (com token mascarado) e a resposta bruta. Se o preço retornado estiver errado, o log mostrará exatamente quais IDs foram enviados.' },
      { type: 'code', lang: 'text', title: 'Exemplo de log de cotação', text: `[COTACAO] cURL equivalente:
  curl -X POST https://api.plamev.com.br/SolicitaCotacaoPet
  -H "Authorization: Bearer TOKEN***"
  -d '{"CampanhasCoberturasId":"A4F5..","CampanhasCoberturaTabelasId":"B2C3.."}'

[COTACAO] Resposta bruta: {"ValorMensal":89.90,"CotacaoId":"XYZ123"}` },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // GUIA DO DESENVOLVEDOR
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'guia-desenvolvedor',
    title: 'Guia do Desenvolvedor',
    category: 'Guias',
    type: 'tutorial',
    audience: ['engenheiro'],
    tags: ['setup', 'desenvolvimento', 'docker', 'onboarding'],
    summary: 'Como configurar o ambiente local, rodar os serviços e desenvolver novas features.',
    blocks: [
      { type: 'h2', text: 'Pré-requisitos' },
      { type: 'list', items: [
        'Node.js 20+ (use nvm)',
        'Docker Desktop (para PostgreSQL local)',
        'pnpm 8+ (`npm install -g pnpm`)',
        'Conta Anthropic com ANTHROPIC_API_KEY',
      ]},
      { type: 'h2', text: 'Setup inicial' },
      { type: 'code', lang: 'bash', title: 'Clone e instalação', text: `git clone git@github.com:plamev/gestor-leads-v6.git
cd gestor-leads-v6
pnpm install  # instala todas as workspaces

# Variáveis de ambiente
cp .env.example .env
# Edite .env com suas chaves locais

# Banco de dados local
docker-compose up -d postgres

# Migrations
pnpm --filter crm-service run migrate

# Rodar todos os serviços
pnpm dev` },
      { type: 'h2', text: 'Estrutura de diretórios' },
      { type: 'code', lang: 'text', text: `gestor-leads-v6/
├── services/
│   ├── frontend/        # SPA React (Vite + TypeScript)
│   ├── gateway/         # Express proxy + WebSocket
│   ├── crm-service/     # API REST + PostgreSQL
│   ├── agent-ai/        # Pipeline de IA
│   └── analytics/       # Métricas
├── infra/
│   └── migrations/      # SQL migrations numeradas
└── shared/              # Tipos compartilhados entre serviços` },
      { type: 'h2', text: 'Adicionando uma migration' },
      { type: 'code', lang: 'bash', text: `# Crie o arquivo seguindo a convenção de numeração
touch infra/migrations/030_nova_feature.sql
# Escreva o SQL com BEGIN/COMMIT
# Execute via script de migration
pnpm --filter crm-service run migrate` },
      { type: 'alert', variant: 'tip', text: 'Cada migration deve ser idempotente quando possível. Use `CREATE TABLE IF NOT EXISTS`, `ON CONFLICT DO UPDATE`, etc.' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // GUIA DO ANALISTA COMERCIAL
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'guia-analista',
    title: 'Guia do Analista Comercial',
    category: 'Guias',
    type: 'tutorial',
    audience: ['analista'],
    tags: ['analista', 'dashboard', 'métricas', 'relatórios', 'funil'],
    summary: 'Como usar o dashboard, interpretar métricas e identificar oportunidades de melhoria.',
    blocks: [
      { type: 'h2', text: 'KPIs que você deve monitorar diariamente' },
      { type: 'table', headers: ['KPI', 'Meta', 'Onde ver', 'O que fazer se baixo'], rows: [
        ['Taxa de resposta', '>95%', 'Dashboard > KPIs', 'Verificar conexão WhatsApp'],
        ['Taxa de conversão', '>15%', 'Dashboard > Funil', 'Revisar etapa de apresentação'],
        ['Tempo médio até cotação', '<10min', 'Performance > Agentes', 'Verificar debounce e latência'],
        ['Taxa de alucinação', '<2%', 'Performance > Qualidade', 'Revisão do system prompt'],
        ['Leads quentes sem follow-up', '0', 'Contatos > Filtro: quente', 'Acionar supervisor imediatamente'],
      ]},
      { type: 'h2', text: 'Usando o Funil' },
      { type: 'p', text: 'Analisar > Funil mostra quantos leads estão em cada etapa. A diferença entre etapas consecutivas é a taxa de abandono. Etapas com >40% de abandono indicam problema no script ou no fluxo.' },
      { type: 'h2', text: 'Identificando leads para reativação' },
      { type: 'ol', items: [
        'Acesse Atender > Contatos',
        'Filtre por Status = "pausada" e Última interação = "7 dias atrás"',
        'Ordene por Score decrescente',
        'Use o botão "Follow-up" nos leads com score >50',
        'Selecione o template "Reativação 7 dias" e personalize o texto',
      ]},
      { type: 'alert', variant: 'info', text: 'Leads que chegaram até a etapa "negociacao" e pararam têm 3x mais chance de fechar com um follow-up personalizado do que leads em etapas anteriores.' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // GUIA DO VENDEDOR
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'guia-vendedor',
    title: 'Guia do Vendedor — Supervisão de Atendimento',
    category: 'Guias',
    type: 'tutorial',
    audience: ['vendedor'],
    tags: ['vendedor', 'chat', 'supervisão', 'handoff', 'whatsapp'],
    summary: 'Como monitorar conversas em andamento, assumir atendimentos e fechar vendas.',
    blocks: [
      { type: 'h2', text: 'Seu papel no sistema' },
      { type: 'p', text: 'A Mari (IA) conduz ~80% das conversas de forma autônoma. Seu papel é: (1) monitorar conversas quentes em tempo real, (2) assumir quando o lead pede humano ou há resistência de preço, (3) fechar a venda e coletar dados para contratação.' },
      { type: 'h2', text: 'Monitorando conversas em tempo real' },
      { type: 'ol', items: [
        'Acesse o Dashboard — o painel "Aguardando Atendimento" mostra conversas que precisam de você',
        'Clique em qualquer conversa para abrir o chat ao lado',
        'Você vê todas as mensagens em tempo real (lead + Mari)',
        'A barra de temperatura mostra quão próximo da compra o lead está',
      ]},
      { type: 'h2', text: 'Assumindo um atendimento' },
      { type: 'ol', items: [
        'Clique em "Silenciar IA" — a Mari para de responder nesta conversa',
        'Você aparece como "Supervisor" na conversa (o lead não vê isso)',
        'Digite sua mensagem e pressione Enter para enviar pelo WhatsApp',
        'Quando terminar, clique em "Reativar IA" para a Mari continuar',
      ]},
      { type: 'alert', variant: 'warning', text: 'Quando você silencia a IA, o lead não recebe resposta automática. Se demorar mais de 5 minutos para responder, o lead pode abandonar. Responda rapidamente ou deixe uma mensagem de espera.' },
      { type: 'h2', text: 'Autorizando desconto de preço' },
      { type: 'ol', items: [
        'Na conversa, encontre o painel lateral direito',
        'Clique em "Editar" ao lado de "Valor Ofertado"',
        'Digite o preço negociado (ex: 89.90 para R$89,90)',
        'Clique em "Reativar IA" — a Mari vai gerar nova cotação com o preço especial',
      ]},
      { type: 'h2', text: 'Sinais de que a Mari está indo bem (não interfira)' },
      { type: 'list', items: [
        'Lead respondendo em menos de 1 minuto',
        'Lead fazendo perguntas sobre coberturas específicas',
        'Lead informando dados do pet voluntariamente',
        'Lead pedindo formas de pagamento',
      ]},
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // TROUBLESHOOTING
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'troubleshooting',
    title: 'Troubleshooting — Problemas Comuns',
    category: 'Suporte',
    type: 'howto',
    audience: ['engenheiro', 'analista', 'vendedor'],
    tags: ['troubleshooting', 'erros', 'debug', 'suporte'],
    summary: 'Diagnóstico e solução dos problemas mais frequentes reportados.',
    blocks: [
      { type: 'h2', text: 'IA não está respondendo' },
      { type: 'ol', items: [
        'Verifique se `ia_silenciada = true` na conversa (SQL Browser → tabela conversas)',
        'Verifique se o ANTHROPIC_API_KEY está válido: `curl https://api.anthropic.com/v1/models -H "x-api-key: $KEY"`',
        'Verifique os logs do agent-ai por erros 429 (rate limit) ou 500',
        'Verifique se o debounce não ficou travado (reinicie o serviço se necessário)',
      ]},
      { type: 'h2', text: 'Cotação retorna preço cheio (não o negociado)' },
      { type: 'list', items: [
        'Verifique se `valor_ofertado` está preenchido na conversa',
        'Confirme que o `CampanhasCoberturaTabelasId` correto está sendo enviado nos logs [COTACAO]',
        'Verifique se os UUIDs estão em UPPERCASE na chamada à API Plamev',
        'Consulte o mapeamento em `planos_plamev_ids` — o `tipo_cobertura` pode estar desatualizado',
      ]},
      { type: 'h2', text: 'WhatsApp desconectou' },
      { type: 'ol', items: [
        'Acesse Sistema > Provedores',
        'Clique em "Reconectar" na instância da Evolution API',
        'Escaneie o QR Code com o celular que tem o número da Plamev',
        'Aguarde "Conectado" aparecer no status',
      ]},
      { type: 'h2', text: 'Lead recebendo mensagens duplicadas' },
      { type: 'p', text: 'Causa mais comum: webhook configurado para múltiplas instâncias ou URL de webhook duplicada na Evolution API. Verifique o painel da Evolution e remova webhooks duplicados.' },
      { type: 'h2', text: 'Dashboard mostrando dados desatualizados' },
      { type: 'p', text: 'O WebSocket reconecta automaticamente, mas em caso de problema: recarregue a página (F5). Se o problema persistir, verifique se o gateway está rodando e se a porta 3001 está acessível.' },
      { type: 'alert', variant: 'tip', text: 'Para reportar um bug com contexto completo: inclua o ID da conversa, o timestamp exato, e os logs dos serviços relevantes nas últimas 30 linhas.' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // GLOSSÁRIO
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'glossario',
    title: 'Glossário',
    category: 'Suporte',
    type: 'referencia',
    audience: ['engenheiro', 'analista', 'vendedor'],
    tags: ['glossário', 'termos', 'definições'],
    summary: 'Definições dos termos técnicos e de negócio usados na plataforma.',
    blocks: [
      { type: 'table', headers: ['Termo', 'Definição'], rows: [
        ['Alucinação', 'Quando o LLM inventa informações (ex: preço ou cobertura inexistente). Detectado pelo Output Guard.'],
        ['Campanha', 'Configuração de preço na API Plamev que define o valor negociado para um plano em um estado.'],
        ['Canal', 'Meio de comunicação com o lead: WhatsApp ou Telegram.'],
        ['CEP', 'Código de Endereçamento Postal. Usado para determinar o Estado do lead.'],
        ['Chunk', 'Fragmento de documento de ~500 tokens armazenado no banco vetorial para RAG.'],
        ['CoberturaId / CoberturasId', 'UUID que identifica o plano na API Plamev. Armazenado em `planos_plamev_ids.coberturas_id`.'],
        ['Debounce', 'Técnica de aguardar N ms após a última mensagem antes de processar, para agrupar mensagens fragmentadas.'],
        ['EstadosId', 'Inteiro 1-27 que representa o estado do lead na API Plamev.'],
        ['Etapa', 'Fase da jornada de vendas na qual a conversa se encontra.'],
        ['Guardrail', 'Camada de proteção que filtra inputs ou outputs da IA para garantir segurança e qualidade.'],
        ['Handoff', 'Transferência da conversa da IA para um humano.'],
        ['IA Silenciada', 'Estado em que o agente IA lê mensagens mas não responde, aguardando humano.'],
        ['Lead', 'Prospect que iniciou contato pelo WhatsApp ou Telegram.'],
        ['LLM', 'Large Language Model — o modelo de IA (Claude) que gera as respostas.'],
        ['RAG', 'Retrieval-Augmented Generation — técnica que injeta contexto recuperado do banco de dados no prompt do LLM.'],
        ['Score / Temperatura', 'Indicador 0-100 do nível de interesse e engajamento do lead.'],
        ['System Prompt', 'Instruções de persona e comportamento enviadas ao LLM em toda chamada.'],
        ['tipo_cobertura', 'Inteiro que identifica o plano na API Plamev (ex: 5 = Platinum).'],
        ['Valor Ofertado', 'Preço negociado pelo supervisor para um lead específico, abaixo do preço de tabela.'],
        ['WebSocket', 'Protocolo de comunicação bidirecional em tempo real. Usado para atualizar o dashboard sem recarregar a página.'],
      ]},
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // ADR-001
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'adr-001',
    title: 'ADR-001: Arquitetura de Microserviços com Gateway Central',
    category: 'ADRs',
    type: 'adr',
    audience: ['engenheiro'],
    tags: ['adr', 'arquitetura', 'gateway', 'microserviços'],
    summary: 'Decisão de usar microserviços separados em vez de monolito, com gateway como único ponto de entrada.',
    blocks: [
      { type: 'h2', text: 'Status' },
      { type: 'p', text: 'Aceito — Implementado' },
      { type: 'h2', text: 'Contexto' },
      { type: 'p', text: 'Na V4 do sistema, toda a lógica estava em um monolito Express único. Deploy de qualquer feature exigia reiniciar o servidor completo, e o crescimento do pipeline de IA tornava o arquivo `server.ts` com mais de 3.000 linhas ingerenciável.' },
      { type: 'h2', text: 'Decisão' },
      { type: 'p', text: 'Separar em 4 serviços independentes (gateway, crm-service, agent-ai, analytics), cada um com sua própria porta e responsabilidade única. O gateway atua como proxy reverso e ponto único de autenticação.' },
      { type: 'h2', text: 'Consequências positivas' },
      { type: 'list', items: [
        'Restart do agent-ai não afeta o CRM (histórico de conversas sempre acessível)',
        'Escalabilidade horizontal: agent-ai pode ter múltiplas instâncias',
        'Time pode trabalhar em serviços diferentes sem conflitos de merge',
        'Fácil substituição do LLM: apenas o agent-ai precisa mudar',
      ]},
      { type: 'h2', text: 'Consequências negativas' },
      { type: 'list', items: [
        'Setup de ambiente local mais complexo (múltiplos processos)',
        'Chamadas cross-service adicionam latência (~1-5ms por hop)',
        'Sem service mesh: falhas em cascata não têm circuit breaker automático',
      ]},
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // ADR-002
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'adr-002',
    title: 'ADR-002: Event Bus via CustomEvent vs REST vs WebSocket',
    category: 'ADRs',
    type: 'adr',
    audience: ['engenheiro'],
    tags: ['adr', 'event-bus', 'websocket', 'navegação'],
    summary: 'Decisão de usar CustomEvent do browser como event bus de navegação no frontend, em vez de React Router.',
    blocks: [
      { type: 'h2', text: 'Status' },
      { type: 'p', text: 'Aceito — Em uso' },
      { type: 'h2', text: 'Contexto' },
      { type: 'p', text: 'O frontend usa uma SPA sem React Router para evitar complexidade de URL hash em aplicações de supervisão em tempo real. Componentes filhos (cards de leads, notificações) precisam navegar para outras páginas sem acesso direto ao estado do Shell.' },
      { type: 'h2', text: 'Decisão' },
      { type: 'p', text: 'Usar `window.dispatchEvent(new CustomEvent("dashv5-navegar", { detail: { pilar, subPage, conversaId? } }))` como event bus leve. O Shell ouve o evento e atualiza o estado de navegação.' },
      { type: 'code', lang: 'typescript', title: 'Padrão de navegação cross-component', text: `// Em qualquer componente filho, para navegar:
window.dispatchEvent(new CustomEvent('dashv5-navegar', {
  detail: {
    pilar: 'atender',
    subPage: 'chat',
    conversaId: 'abc-123',
  },
}));` },
      { type: 'h2', text: 'Por que não React Router?' },
      { type: 'list', items: [
        'A app não tem URLs distintas por página (uso interno, sem deep links necessários)',
        'React Router adicionaria complexidade de LayoutRoutes e Outlet para um SPA single-level',
        'O event bus funciona de dentro de iframes, Web Workers ou shadow DOM se necessário no futuro',
      ]},
      { type: 'h2', text: 'Risco' },
      { type: 'p', text: 'Acoplamento fraco mas implícito: qualquer componente pode navegar para qualquer lugar sem type-checking. Mitigação: os nomes de pilar/subPage são exportados como tipos do Sidebar.tsx.' },
    ],
  },

];

// ─── helpers de busca ─────────────────────────────────────────────────────────

function normalizar(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ');
}

export function buscarArtigos(
  query: string,
  audienciaFiltro: AudienceTag | 'todos',
  tipoFiltro: ArticleType | 'todos',
): Article[] {
  let lista = ARTICLES;

  if (audienciaFiltro !== 'todos') {
    lista = lista.filter(a => a.audience.includes(audienciaFiltro));
  }
  if (tipoFiltro !== 'todos') {
    lista = lista.filter(a => a.type === tipoFiltro);
  }

  if (!query.trim()) return lista;

  const q = normalizar(query);
  const termos = q.split(/\s+/).filter(Boolean);

  return lista
    .map(a => {
      const texto = normalizar(`${a.title} ${a.summary} ${a.tags.join(' ')} ${a.category}`);
      const score = termos.reduce((acc, t) => acc + (texto.includes(t) ? 1 : 0), 0);
      return { a, score };
    })
    .filter(({ score }) => score > 0)
    .sort((x, y) => y.score - x.score)
    .map(({ a }) => a);
}

export const CATEGORIAS = [...new Set(ARTICLES.map(a => a.category))];

export const TIPO_LABELS: Record<ArticleType, string> = {
  explicacao: 'Explicação',
  tutorial: 'Tutorial',
  howto: 'Como fazer',
  referencia: 'Referência',
  adr: 'ADR',
};

export const AUDIENCIA_LABELS: Record<AudienceTag, string> = {
  engenheiro: 'Engenheiro',
  analista: 'Analista Comercial',
  vendedor: 'Vendedor',
};
