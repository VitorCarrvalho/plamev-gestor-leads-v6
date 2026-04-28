# Task — Continuidade Operacional do Plamev SaaS v6

## Objetivo atual
- Garantir que o fluxo SaaS de mensagens esteja funcional de ponta a ponta.
- Validar a ordem correta entre input guardrails, debounce, fila, RAG, LLM, output guardrails, envio e persistencia.
- Reduzir risco de alucinacao e aumentar tolerancia a falhas sem reescrever a arquitetura.
- Preservar padrao visual, estrutura de pastas, nomenclatura e estilo de codigo existentes.

## Regras de execucao
- [x] Nao reescrever o projeto do zero
- [x] Nao alterar arquitetura sem justificativa
- [x] Nao quebrar funcionalidades existentes
- [x] Preservar padrao visual, nomenclatura, estrutura e estilo
- [x] Trabalhar com commits pequenos e rastreaveis
- [x] Antes de alterar arquivos criticos, explicar impacto
- [ ] Rodar build/lint/test ao final de cada etapa quando existirem
- [ ] Entregar resumo do que mudou, arquivos alterados e proximos passos ao final de cada etapa

## Diagnostico inicial concluido
- [x] Ler a estrutura do repositorio
- [x] Entender stack, arquitetura, rotas, banco, componentes e estilo visual
- [x] Identificar o que ja esta pronto
- [x] Identificar riscos, inconsistencias e pontos frageis
- [x] Consolidar resumo tecnico do projeto

## Riscos principais encontrados
- [x] Gateway sobe um socket minimo no bootstrap atual e nao pluga o socket operacional completo
- [x] Agent AI ativo usa pipeline simplificado, enquanto parte das capacidades ricas estao em fluxo legado paralelo
- [x] Input guard e output guard do caminho ativo ainda estao simplificados
- [x] RAG ativo esta em full-text simplificado, enquanto o RAG vetorial esta fora do caminho principal
- [x] Configuracao de provider/model/guard no fluxo ativo ainda esta hardcoded
- [x] Multi-tenancy existe no schema, mas nao atravessa o fluxo inteiro de runtime
- [x] Nao ha suite de testes automatizados cobrindo o funil principal

## Plano de implementacao

### Etapa 1 — Mapear runtime real e instrumentar o fluxo
- [x] Registrar no codigo e em endpoints de diagnostico qual pipeline esta ativo hoje
- [x] Expor o encadeamento real: webhook -> debounce -> BullMQ -> Agent AI -> envio -> persistencia
- [x] Validar pontos de entrada e saida sem mudar regra de negocio
- [x] Confirmar quais modulos estao operacionais e quais estao apenas presentes no repositorio
- [x] Atualizar este arquivo com achados e proximos passos

#### Achados da Etapa 1
- [x] Entrada real do WhatsApp confirmada em `channel-service` via `/webhooks/whatsapp`
- [x] Debounce real confirmado em Redis + BullMQ com fila `incoming-messages`
- [x] Consumo real confirmado no `agent-ai` via `pipeline/consumer.ts`
- [x] Pipeline ativo confirmado como `pipeline/orchestrator.ts`
- [x] Envio real confirmado do `agent-ai` para `channel-service` em `/internal/send`
- [x] Persistencia real confirmada do `agent-ai` para `crm-service` em `/api/internal/salvar-interacao`
- [x] Socket operacional completo identificado no repositorio, mas fora do bootstrap atual do gateway
- [x] Guardrails e RAG do caminho ativo confirmados como simplificados em relacao ao desenho alvo

#### Evidencias adicionadas na etapa
- [x] Endpoint `GET /debug/runtime` no gateway
- [x] Endpoint `GET /debug/runtime` no channel-service
- [x] Endpoint `GET /debug/pipeline` no agent-ai
- [x] Build do monorepo executado com sucesso apos instrumentacao

### Etapa 2 — Corrigir canal de tempo real do dashboard
- [x] Conectar o gateway ao socket operacional correto
- [x] Validar autenticacao, eventos e telas dependentes de socket
- [x] Garantir que monitoramento e atendimento em tempo real reflitam o estado real do sistema

#### Achados da Etapa 2
- [x] Gateway deixou de subir apenas um socket vazio e passou a usar o servidor operacional de socket
- [x] Eventos de leitura do frontend agora estao ligados ao repositorio real de conversas do CRM
- [x] Eventos de atualizacao em tempo real (`nova_msg`, `conversa_atualizada`, `ia_status`) agora tem caminho operacional no gateway
- [x] Rotas internas de notificacao do dashboard foram expostas em `/interno/nova-msg` e `/internal/nova-msg`
- [x] A autenticacao do socket passou a reutilizar a validacao JWT existente do CRM
- [x] Algumas acoes supervisoras ainda permanecem nao operacionais via socket e foram mantidas com erro explicito, sem comportamento falso

#### Pendencias abertas apos a Etapa 2
- [ ] Reintegrar acoes supervisoras que dependem de envio ativo ao cliente (`provocar`, `instrucao`, `falar_direto`, `enviar_manual`)
- [ ] Decidir se essas acoes ficam no gateway, voltam para um modulo proprio ou entram na unificacao do pipeline da Etapa 3

#### Incidente corrigido apos a Etapa 2
- [x] Deploy isolado do `gateway` no Railway quebrou porque o socket passou a importar arquivos-fonte de `crm-service`
- [x] O `gateway` agora possui camada local minima de `auth`, `db`, `repo` e `actions` para o socket, sem depender de imports cross-service no build
- [x] Dependencias locais do `gateway` foram alinhadas para o deploy isolado (`pg` + tipos)
- [x] Webhooks WhatsApp passaram a abortar no `channel-service` porque o `gateway` consumia o body com `express.json()` antes do proxy
- [x] O parser JSON do `gateway` foi movido para baixo dos proxies, preservando o body bruto para `/webhooks`

### Etapa 3 — Unificar o caminho ativo do pipeline do Agent AI
- [x] Definir o caminho oficial de execucao no Agent AI
- [x] Reaproveitar o que ja existe no processor legado sem reescrever do zero
- [x] Eliminar sobreposicao entre fluxo simplificado e fluxo rico

#### Achados da Etapa 3
- [x] Consumer do BullMQ agora usa um unico runtime oficial para mensagens recebidas
- [x] Runtime oficial definido em `services/agent-ai/src/pipeline/runtime.ts`
- [x] Pipeline textual principal permanece em `services/agent-ai/src/pipeline/orchestrator.ts`, mas agora atras de um entrypoint unico
- [x] Audio, imagem e documento deixaram de depender de um fluxo paralelo invisivel e passaram a ser tratados no runtime oficial
- [x] Entrega e persistencia foram extraidas para uma camada comum de `delivery`
- [x] Persistencia interna do CRM passou a aceitar override do texto de entrada para registrar anexos sem forcar `message.texto`
- [x] `processor.ts` deixou de ser necessario no caminho principal e passou a ser apenas referencia legada fora do runtime ativo

#### Pendencias abertas apos a Etapa 3
- [ ] Migrar para o runtime oficial outras regras comerciais ricas ainda exclusivas do `processor.ts`
- [ ] Decidir se `processor.ts` sera arquivado, fatiado em modulos menores ou usado apenas como referencia historica
- [ ] Validar em ambiente integrado o comportamento de audio, imagem e documento com os provedores reais

### Etapa 4 — Remover hardcodes do fluxo principal
- [x] Ler provider, model, guard_model, orgId e agente a partir das tabelas existentes
- [x] Garantir coerencia entre painel de configuracao e runtime real

#### Achados da Etapa 4
- [x] O runtime ativo do `agent-ai` agora resolve `orgId` a partir do `agentSlug`, com fallback para a organizacao padrao
- [x] O pipeline textual passou a consumir `provider`, `model` e `guard_model` dinamicamente em vez de usar config fake hardcoded
- [x] A resolucao de config passou a combinar `agentes`, `llm_configs` e `organizations`, mantendo fallback seguro quando faltar dado
- [x] O historico e o carregamento do soul prompt no `orchestrator` passaram a respeitar o contexto real de org/agente do runtime
- [x] A persistencia interna do CRM deixou de gravar tudo na org default e passou a resolver `org_id` pelo agente da mensagem
- [x] O endpoint de debug do `agent-ai` agora deixa explicita a origem da configuracao operacional

#### Risco residual apos a Etapa 4
- [ ] Confirmar em ambiente integrado se a precedencia entre `agentes.modelo_principal` e `llm_configs.padrao` reflete exatamente a expectativa operacional do painel
- [ ] Propagar multi-tenancy no contrato da fila quando houver necessidade de distinguir mensagens por org sem depender apenas de `agentSlug`

### Etapa 5 — Fortalecer input guardrails no caminho ativo
- [x] Validar ordem correta apos debounce
- [x] Integrar classificacao mais robusta no input guard
- [x] Tratar fail-open e escalonamento com observabilidade

#### Achados da Etapa 5
- [x] Ordem operacional confirmada como `webhook -> debounce Redis -> job BullMQ -> input guard -> contexto/RAG -> LLM -> output guard -> envio -> persistencia`
- [x] O input guard ativo deixou de depender apenas de regex minima e passou a classificar saudacao, duvida de produto, intencao de compra e objecao de preco com regras deterministicas mais claras
- [x] Mensagens vazias sem anexo passaram a ser descartadas cedo, enquanto anexos sem texto continuam seguindo para o fluxo multimodal oficial
- [x] Pedidos de humano/cancelamento, sinais de conflito juridico/agressividade e tentativas de prompt injection agora escalam explicitamente
- [x] Sinais fortes de spam ou ruido agora podem ser descartados antes de consumir contexto e LLM
- [x] O input guard agora opera em fail-open observavel: se falhar internamente, a mensagem segue com marcador explicito de degradacao em logs e traces

#### Risco residual apos a Etapa 5
- [ ] Refinar com exemplos reais de producao os padrões de spam, abuso e prompt injection para reduzir falso positivo
- [ ] Decidir se escalonamentos do input guard devem apenas parar no trace ou tambem abrir algum mecanismo operacional de fila humana

### Etapa 6 — Conectar RAG real ao fluxo principal
- [x] Integrar retrieval vetorial/rerank no pipeline oficial
- [x] Manter fallback seguro quando embeddings ou rerank falharem
- [x] Validar uso correto da knowledge base existente

#### Achados da Etapa 6
- [x] O pipeline principal agora tenta primeiro o RAG vetorial em `knowledge_chunks`, com embeddings e rerank, antes de cair para a busca full-text em `knowledge_base_docs`
- [x] A integração foi feita no caminho oficial do `orchestrator`, sem depender de arquivos locais nem de fallback por filesystem
- [x] Quando `VOYAGE_API_KEY` não estiver configurada, quando não houver chunks vetoriais ou quando a busca vetorial falhar, o pipeline continua operando com o full-text atual
- [x] O trace do pipeline agora registra `rag_mode` e `rag_latency_ms`, permitindo separar em observabilidade quando houve hit vetorial, fallback textual ou ausência de contexto
- [x] O endpoint de debug do `agent-ai` passou a refletir o caminho real do RAG ativo

#### Risco residual apos a Etapa 6
- [ ] Confirmar em ambiente integrado se a tabela `knowledge_chunks` ja esta populada para os agentes ativos; sem isso o runtime vai operar majoritariamente em fallback full-text
- [ ] Revisar futuramente a estrategia de deduplicacao entre chunks vetoriais e documentos sempre ativos para evitar contexto redundante no prompt

### Etapa 7 — Fortalecer output guardrails e logs
- [x] Validar claims com base no contexto usado
- [x] Registrar melhor reescritas, bloqueios, latencias e fontes
- [x] Reduzir risco de alucinacao na resposta final

#### Achados da Etapa 7
- [x] O output guard do caminho principal deixou de validar apenas faixa absurda de preco e passou a checar preco fora do contexto recuperado, vazamento de marcadores internos, traços de IA e respostas sensiveis sem base RAG
- [x] O validador estrutural legado foi reintegrado ao runtime oficial para corrigir formatação, perguntas duplicadas e outros sinais de resposta artificial sem depender de outro modelo
- [x] O pipeline agora diferencia bloqueio e reescrita no output guard, em vez de tratar toda invalidação como a mesma classe de evento
- [x] Traces e logs agora registram `output_guard_reason`, `output_guard_rules`, `output_guard_severity` e `output_guard_blocked`
- [x] O score operacional passou a distinguir quando houve bloqueio efetivo da resposta final

#### Risco residual apos a Etapa 7
- [ ] Refinar com exemplos reais as regras de `coverage-without-rag-support` para evitar bloqueio excessivo em respostas seguras mas genéricas
- [ ] Avaliar em etapa futura se o `services/judge.ts` deve entrar no caminho assíncrono oficial de auditoria pós-envio

#### Ajuste comportamental apos a Etapa 7
- [x] Corrigido loop de fallback repetido quando o output guard bloqueava respostas consecutivas sobre catálogo/produto
- [x] O runtime principal agora injeta etapa atual da conversa e catálogo oficial de planos/preços no system prompt
- [x] O RAG oficial passou a combinar recuperação por etapa/assunto com o caminho vetorial/full-text, reduzindo respostas fora da sequência comercial da Mari
- [x] O output guard passou a bloquear menção de planos fora do catálogo oficial presente no contexto

#### Pacote corretivo da Mari
- [x] Runtime oficial voltou a montar o contexto com Soul + prompts configuráveis (`tom`, `regras`, `planos`, `pensamentos`, `anti_repeticao`, `modo_rapido`)
- [x] Perguntas de catálogo agora têm resposta determinística a partir do banco, sem depender do LLM para listar planos oficiais
- [x] O runtime passou a inferir etapa-alvo mínima para perguntas comerciais sobre planos e preços
- [x] Fallbacks passaram a evitar repetição imediata da mesma frase em bloqueios sucessivos
- [x] Smoke check local do cenário de catálogo/plano adicionado ao `agent-ai`

### Etapa 8 — Criar smoke tests e verificacoes operacionais
- [ ] Cobrir o funil principal de captacao e resposta
- [ ] Formalizar checks minimos de saude do pipeline
- [ ] Deixar base pronta para evoluir para E2E e CI/CD

## Progresso atual
- Status geral: Etapa 7 concluida
- Ultima atualizacao: pacote corretivo da Mari implementado no runtime oficial com montagem completa de prompts, catálogo determinístico, etapa comercial mínima, anti-loop e smoke check; build do monorepo validado
- Proxima acao imediata: redeploy do `agent-ai` e validação em conversa real; depois disso retomar Etapa 8 com checks operacionais mais amplos
