# Etapas do Funil (fonte única)

<!-- Lista canônica das etapas que a Mari pode usar.
     Lida em runtime por: processor.js, contexto.js, dashboard-v5.
     Adicionar etapa aqui = disponível em todo o sistema. -->

## Ordem canônica

```
acolhimento
→ qualificacao
→ apresentacao_planos
→ validacao_cep
→ negociacao
→ objecao
→ pre_fechamento
→ fechamento
→ venda_fechada
→ pago
```

> ⚠️ Ordem NÃO é dependência obrigatória. Um lead pode pular etapas (ex: ir direto de `acolhimento` para `fechamento` se confirmou rápido).

---

## Descrição de cada etapa

| Etapa | Quando entra | Arquivos Obsidian carregados |
|---|---|---|
| `acolhimento` | Primeira mensagem, saudação, curiosidade inicial | `Mari/Abertura.md`, `Mari/Tom-e-Fluxo.md` |
| `qualificacao` | Cliente respondeu primeira pergunta, coletando dados do pet | `Mari/Qualificacao.md` |
| `apresentacao_planos` | Pet identificado OU cliente perguntou preço/plano | `Mari/Apresentacao.md`, `Plamev/Planos.md`, `Plamev/Coberturas.md` |
| `validacao_cep` | Cliente enviou CEP e queremos confirmar cobertura | `Plamev/Planos.md`, `Plamev/Coberturas.md` |
| `negociacao` | Cliente achou caro ou pediu desconto | `Mari/Closer-Psicologica.md`, `Plamev/Descontos.md` |
| `objecao` | Cliente levantou barreira específica (vai pensar, falar com família, etc.) | `Mari/Objecoes.md`, `Plamev/Objecoes.md` |
| `pre_fechamento` | Cliente demonstrou intenção clara, coletando dados finais | `Mari/Closer-Psicologica.md` |
| `fechamento` | Cliente confirmou que quer assinar, enviando link/formulário | `Plamev/Contratos.md` |
| `venda_fechada` | Cliente entregou nome + CPF + email + CEP + confirmou compra *(auto-detectado)* | — |
| `pago` | Adesão confirmada no ERP *(marcação manual pelo supervisor)* | — |

---

## Etapas auxiliares (fora do funil linear)

| Etapa | Significado |
|---|---|
| `sem_cobertura` | CEP sem clínica credenciada em 40km — lista de espera |
| `encerrado` | Conversa finalizada (sem interesse, fila espera, desistência) |

---

## Transições automáticas

Quem promove:

| Transição | Origem | Quem promove |
|---|---|---|
| `acolhimento → apresentacao_planos` | Decisor detecta sinal de compra (veja `Mari/Decisor-Prompt.md`) | `processor.js:345` |
| `apresentacao_planos → validacao_cep` | Cliente enviou CEP válido com cobertura | `processor.js` (CEP proativo) |
| `apresentacao_planos → sem_cobertura` | CEP sem clínicas credenciadas | `processor.js` (CEP proativo) |
| `* → fechamento` | Brain detectou intenção forte | Brain retorna `etapa=fechamento` no JSON |
| `* → venda_fechada` | Perfil completo (nome+CPF+email+CEP) + cliente confirmou | `processor.js:545` (regra automática) |
| `* → pago` | Botão manual no Dashboard V5 | `PATCH /api/conversa/:id/etapa` |
