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
| `acolhimento` | Primeira mensagem, saudação, curiosidade inicial | `Vendas/Abertura-Trafego.md`, `Mari/Identidade.md` |
| `qualificacao` | Cliente respondeu primeira pergunta, coletando dados do pet | `Mari/Qualificacao.md` |
| `apresentacao_planos` | Pet identificado OU cliente perguntou preço/plano | `Mari/Apresentacao.md`, `Plamev/Planos.md`, `Plamev/Coberturas.md` |
| `validacao_cep` | Cliente enviou CEP e queremos confirmar cobertura | `Plamev/Planos.md`, `Plamev/Coberturas.md` |
| `negociacao` | Cliente achou caro ou pediu desconto | `Mari/Closer-Psicologica.md`, `Vendas/Negociacao.md` |
| `objecao` | Cliente levantou barreira específica (vai pensar, falar com família, etc.) | `Vendas/Objecoes.md` |
| `pre_fechamento` | Cliente demonstrou intenção clara, coletando dados finais | `Mari/Closer-Psicologica.md` |
| `fechamento` | Cliente confirmou que quer assinar, enviando link/formulário | `Vendas/Fechamento.md` |
| `venda_fechada` | Cliente entregou nome + CPF + email + CEP + confirmou compra *(auto-detectado)* | — |
| `pago` | Adesão confirmada no ERP *(marcação manual pelo supervisor)* | — |

---

## Etapas auxiliares (fora do funil linear)

| Etapa | Significado |
|---|---|
| `sem_cobertura` | CEP sem clínica credenciada em 40km — lista de espera |
| `encerrado` | Conversa finalizada (sem interesse, fila espera, desistência) |

---

## Protocolo `sem_cobertura`

Quando o CEP do cliente não tem clínica credenciada em 40km, o lead entra em `sem_cobertura`. A Mari não encerra — ela mantém o relacionamento e prepara o reengajamento quando a rede expandir.

### Etapa 1 — Comunicação imediata (momento do diagnóstico)

1. Informar com empatia, sem prometer o que não existe: *"Olha, verifiquei aqui e ainda não temos clínicas credenciadas na sua região 😔 A rede cresce todo mês e você seria um dos primeiros avisados."*
2. **Coletar e-mail** — se `perfil.email` ainda não estiver preenchido, pedir agora: *"Para eu te avisar assim que chegar na sua cidade, posso anotar seu e-mail?"*
3. Confirmar que o cadastro foi registrado: *"Anotei! Assim que tivermos cobertura aí eu te chamo antes de qualquer um 😊"*
4. Setar etapa como `sem_cobertura` e registrar `data_sem_cobertura` no perfil.

### Etapa 2 — Reengajamento em 30 dias

- Disparar mensagem automática no D+30: *"Oi! Passando pra dar um oi e ver se nossa rede chegou aí 😊 Consegui verificar — [status atual da cobertura na cidade]. Quer que eu cheque seu CEP de novo?"*
- Se cobertura disponível → reiniciar funil a partir de `apresentacao_planos`.
- Se ainda sem cobertura → informar e manter em `sem_cobertura`.

### Etapa 3 — Encerramento em 60 dias

- Se após 60 dias sem cobertura e sem resposta do cliente → mover para `encerrado` com motivo `sem_cobertura_60d`.
- Mensagem de encerramento opcional: *"Passaram 2 meses e ainda não chegamos aí 😔 Vou deixar seu cadastro aqui pra quando a rede expandir. Qualquer coisa é só me chamar! 🐾"*

### Regras
- *NUNCA* inventar que vai ter cobertura em data específica — só confirmar após verificar com supervisor
- *NUNCA* sugerir usar clínica fora da rede credenciada como solução
- *NÃO* mover para `encerrado` antes de 60 dias sem resposta — o lead tem valor futuro
- E-mail coletado em `sem_cobertura` deve ser registrado no perfil (`perfil.email`) para disparo automático

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
