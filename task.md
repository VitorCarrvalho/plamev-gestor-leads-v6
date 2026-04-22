# Task — Monorepo Plamev SaaS v6

## Fase 0 — Fundação
- [x] Criar estrutura de diretórios do monorepo
- [x] Root `package.json` com npm workspaces
- [x] `.gitignore` raiz (com .env, dist, node_modules)
- [x] `packages/shared` — tipos TypeScript compartilhados
- [x] `infra/migrations/` — SQL versionados
- [x] `infra/docker-compose.yml` — dev local
- [x] `.env.example` raiz

## Fase 1 — Channel Service
- [x] Migrar `mariv3/gateway/index.js` → TypeScript
- [x] Migrar `mariv3/services/sender.js` → TypeScript
- [x] Migrar `mariv3/services/chips.js` → TypeScript
- [x] BullMQ Producer com debounce 5s
- [x] HMAC validation de webhooks
- [x] Comandos de controle (--parar, --reset, etc.)
- [x] Webhooks de pagamento e indicação
- [x] Dockerfile + railway.toml

## Fase 2 — Agent AI (núcleo)
- [x] BullMQ Consumer
- [x] `input-guard.ts` (regex + LLM classifier)
- [x] `rag.ts` (Voyage AI embed + pgvector + rerank)
- [x] `llm-client.ts` (Anthropic + OpenAI)
- [x] `output-guard.ts` (claim validation)
- [x] `interaction-logger.ts`
- [x] `generation.ts` (Brain migrado + retry 3x)
- [x] `decisor.ts` (migrado)
- [x] `context-builder.ts` (migrado com Obsidian vault)
- [x] `validator.ts` (guard rails migrado)
- [x] Services: audio, image, document, cep, reengagement, followup, scheduler, lead-memory, consistency, supervisor-notifier, judge, vault
- [x] Actions do supervisor (provocar, instruirMari, etc.)
- [x] Multi-tenancy (orgId em todas as queries)
- [x] Obsidian vault copiado para services/agent-ai/vault/
- [x] Dockerfile + railway.toml

## Fase 3 — CRM Service
- [x] Migrar `mariv3/db/index.js` → TypeScript
- [x] Migrar `dashboard-v5/server/repositories/` → TypeScript
- [x] Endpoints REST: conversas, clientes, perfil, funil, templates, agenda
- [x] Multi-tenancy
- [x] Dockerfile + railway.toml

## Fase 4 — Gateway
- [x] Migrar `dashboard-v5/server/app.ts` + routes/
- [x] Migrar `socket.server.ts` (todos os eventos)
- [x] Proxy routes para crm-service, analytics, agent-ai, channel-service
- [x] JWT auth centralizado
- [x] HMAC proxy para webhooks
- [x] Rate limiting
- [x] CORS apenas hub.plamevbrasil.com.br
- [x] Dockerfile + railway.toml

## Fase 5 — Analytics
- [x] Migrar `routes/analisar.ts`
- [x] Endpoints: funil, agentes, salvas, ai-logs, custo-ia
- [x] Dockerfile + railway.toml

## Fase 6 — Frontend
- [x] Migrar `dashboard-v5/client/` → services/frontend/
- [x] Configurar VITE_API_URL por env
- [x] Nova página: Configuração do Agente IA
- [x] Nova página: Logs de IA
- [x] `public/_redirects` para SPA fallback
- [x] Dockerfile (sem Nginx, com serve)

## Fase 7 — Deploy Railway
- [x] Provisionar PostgreSQL + ativar pgvector
- [x] Provisionar Redis
- [x] Rodar migrations
- [x] Deploy 6 serviços
- [x] Configurar domínio hub.plamevbrasil.com.br
- [x] Apontar webhook Evolution API para gateway
- [x] Smoke tests

## Fase 8 — Operação e Pós-Deploy (Próximos Passos)
- [ ] Implementar Testes End-to-End (E2E) no funil principal de captação
- [ ] Configurar CI/CD com GitHub Actions para automatizar os deploys
- [ ] Configurar Monitoramento/Logs centralizados (Datadog, Sentry ou similar)
- [ ] Refinar os Prompts do Agent AI com base nas interações reais (Observabilidade)
- [ ] Expansão do Multi-tenancy (Módulo de faturamento automatizado por organização)
