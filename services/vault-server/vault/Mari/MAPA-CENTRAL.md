<!-- MAPA-CENTRAL — leitura humana, não carregado em runtime pelo contexto.js -->
<!-- Atualizado: 2026-04-29 | Vault: 26 arquivos -->

# MAPA CENTRAL DO VAULT — Mari / Plamev

Referência para editores e desenvolvedores. Descreve arquitetura, autoridade, mapa de carregamento e regras de edição.

---

## ─── ARQUITETURA DO SISTEMA ──────────────────────────────────────────────────

```
Lead entra
    │
    ▼
[Decisor — Mari/Decisor-Prompt.md]   ← Haiku (~$0.0001/call)
    │  proxima_acao: responder | aprofundar | apresentar_plano | negociar | fechar | escalar | aguardar
    ▼
[Brain — modelo completo]             ← carrega contexto via contexto.js
    │  lê etapa atual → seleciona arquivos do vault abaixo
    ▼
Resposta JSON: {"r":"...","e":"etapa","d":{...}}
    │
    ▼
[processor.js]                        ← persiste dados, avança etapa, dispara regras automáticas
```

**Fontes de verdade:**
- **Preços / carências / coberturas** → Banco de Dados (NUNCA no vault)
- **Comportamento / scripts / estratégia** → Vault Obsidian (aqui)
- **Etapas e transições** → `Tecnico/Etapas-Funil.md` + `processor.js`

---

## ─── MAPA DE CARREGAMENTO POR ETAPA ─────────────────────────────────────────

| Etapa | Arquivos carregados |
|---|---|
| `acolhimento` | `Vendas/Abertura-Trafego.md`, `Mari/Identidade.md` |
| `qualificacao` | `Mari/Qualificacao.md` |
| `apresentacao_planos` | `Mari/Apresentacao.md`, `Plamev/Planos.md`, `Plamev/Coberturas.md` |
| `validacao_cep` | `Plamev/Planos.md`, `Plamev/Coberturas.md` |
| `negociacao` | `Mari/Closer-Psicologica.md`, `Vendas/Negociacao.md` |
| `objecao` | `Vendas/Objecoes.md` |
| `pre_fechamento` | `Mari/Closer-Psicologica.md` |
| `fechamento` | `Vendas/Fechamento.md` |
| `venda_fechada` | — (auto-detectado por processor.js) |
| `pago` | — (marcação manual no Dashboard) |
| `sem_cobertura` | — (protocolo em `Tecnico/Etapas-Funil.md`) |
| `encerrado` | — |

> Fonte canônica completa: [[Tecnico/Etapas-Funil]]

---

## ─── MAPA DE AUTORIDADE (FONTE ÚNICA) ──────────────────────────────────────

| Domínio | Arquivo canônico | Observação |
|---|---|---|
| Identidade e personalidade | `Mari/Identidade.md` | Inclui tom, estilo, pets |
| Regras absolutas e proibições | `Mari/Regras-Absolutas.md` | Nunca editar sem aprovação |
| Apresentação de planos | `Mari/Apresentacao.md` | Usa dados do BD via contexto |
| Qualificação invisível | `Mari/Qualificacao.md` | |
| Negociação e conduta de vendas | `Vendas/Negociacao.md` | 4 faixas + WOW + Supervisora |
| Objeções | `Vendas/Objecoes.md` | |
| Fechamento | `Vendas/Fechamento.md` | |
| Reengajamento (vácuo) | `Vendas/Reengajamento.md` | |
| Abertura de tráfego | `Vendas/Abertura-Trafego.md` | |
| Psicologia e postura de closer | `Mari/Closer-Psicologica.md` | |
| Estratégia de preços (4 faixas) | `Plamev/Precos-Estrategia.md` | Sem valores hardcoded — BD |
| Recomendação de plano por raça | `Plamev/Recomendacao-Plano.md` | Matriz raça × risco × plano |
| Planos Plus (castração/dental) | `Plamev/Planos-Plus.md` | Gatilhos específicos |
| Coberturas e carências | `Plamev/Coberturas.md` + `Coberturas/Procedimentos-e-Carencias.md` | Valores via BD |
| Empresa e diferenciais | `Plamev/Empresa.md` | Números institucionais |
| Diferenciais de produto | `Plamev/Diferenciais.md` | |
| Etapas do funil | `Tecnico/Etapas-Funil.md` | Fonte única de etapas |
| Decisor (Haiku) | `Mari/Decisor-Prompt.md` | Não editar sem testar custo |
| Apresentação (prompt) | `Mari/Apresentacao-Prompt.md` | Prompt do Brain para apresentação |
| Anti-repetição | `Mari/Anti-Repeticao.md` | |
| Exemplos de alta conversão | `Mari/Exemplos-Alta-Conversao.md` | |
| Modo rápido | `Mari/Modo-Rapido.md` | |
| Personalidade de vendas | `Mari/Personalidade-Vendas.md` | |
| Manuais operacionais | `Plamev/Manuais.md` | |

---

## ─── REGRAS DE EDIÇÃO ───────────────────────────────────────────────────────

1. **Preços nunca no vault** — toda menção a valor monetário deve usar `[Tabela_X]`, `[Promocional_X]`, `[Oferta_X]`, `[Limite_X]` onde X é o nome do plano
2. **Wikilinks canônicos** — usar sempre `[[Pasta/Arquivo]]` sem extensão `.md`
3. **Sem scripts decorados** — exemplos são inspiração, nunca texto fixo. Usar *itálico* nos exemplos
4. **Sem checkmarks (✔️) em listas de planos** — conflita com comunicação de vendas
5. **Etapa nova** → adicionar primeiro em `Tecnico/Etapas-Funil.md`, depois no `contexto.js`
6. **Arquivo novo** → registrar neste MAPA-CENTRAL antes de criar
7. **Arquivo deletado** → corrigir todos os wikilinks antes de remover (buscar por `[[Pasta/Arquivo]]`)
8. **Locks temporários** (`[LOCK 20/04]` etc.) são notas de desenvolvimento — remover após revisão, não são regras permanentes

---

## ─── INVENTÁRIO COMPLETO (26 arquivos) ─────────────────────────────────────

```
Coberturas/
  Procedimentos-e-Carencias.md   ← tabela de carências (referencia BD)

Mari/
  Anti-Repeticao.md              ← evitar repetição de estrutura e frases
  Apresentacao-Prompt.md         ← prompt Brain para etapa apresentacao_planos
  Apresentacao.md                ← estratégia de apresentação de planos
  Closer-Psicologica.md          ← postura, sensações, técnica supervisora
  Decisor-Prompt.md              ← prompt Haiku (não carregar no Brain)
  Exemplos-Alta-Conversao.md     ← conversas modelo de alta conversão
  Identidade.md                  ← quem é a Mari, tom, estilo, pets
  MAPA-CENTRAL.md                ← este arquivo (não carregado em runtime)
  Modo-Rapido.md                 ← comportamento em sessão de alta velocidade
  Personalidade-Vendas.md        ← traços de personalidade aplicados a vendas
  Qualificacao.md                ← qualificação invisível, dados do pet
  Regras-Absolutas.md            ← proibições e limites não negociáveis

Plamev/
  Coberturas.md                  ← resumo de coberturas (valores via BD)
  Diferenciais.md                ← diferenciais competitivos da Plamev
  Empresa.md                     ← dados institucionais, números, estados
  Manuais.md                     ← manuais operacionais e processos internos
  Planos-Plus.md                 ← plano Plus: gatilhos, coberturas especiais
  Planos.md                      ← estratégia de oferta (sem preços)
  Precos-Estrategia.md           ← regra das 4 faixas + efeito WOW
  Recomendacao-Plano.md          ← matriz raça × risco × plano recomendado

Tecnico/
  Etapas-Funil.md                ← fonte única de etapas, transições, sem_cobertura

Vendas/
  Abertura-Trafego.md            ← scripts de abertura por origem do lead
  Fechamento.md                  ← protocolo de fechamento e coleta de dados
  Negociacao.md                  ← negociação, desconto, supervisora Li
  Objecoes.md                    ← mapa de objeções e respostas
  Reengajamento.md               ← reativação de leads em vácuo
```

---

## ─── ARQUIVOS DEPRECIADOS (histórico) ──────────────────────────────────────

| Arquivo | Motivo | Absorvido em |
|---|---|---|
| `Mari/Tom-e-Fluxo.md` | Stub vazio | `Mari/Identidade.md` |
| `Mari/Abertura.md` | Conteúdo duplicado | `Vendas/Abertura-Trafego.md` |
| `Mari/Pre-Acolhimento.md` | Conteúdo duplicado | `Vendas/Abertura-Trafego.md`, `Mari/Regras-Absolutas.md` |
| `Vendas/Conduta-Vendas.md` | Consolidado | `Vendas/Negociacao.md` |
| `Vendas/Negociacao-Inteligente.md` | Duplicado | `Vendas/Negociacao.md` |
| `Produto/Planos.md` | Violava regras (checkmarks, todos os planos) | — |
| `Vendas/Como-Vender.md` | Coberto por outros | `Mari/Identidade.md`, `Mari/Personalidade-Vendas.md` |
| `mari_cobertura_cidades.md` | Nota de sistema | — |
| `mari_responses.md` | Nota de sistema | — |

---

→ [[Tecnico/Etapas-Funil]] | [[Mari/Regras-Absolutas]] | [[Mari/Identidade]]
