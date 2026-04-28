# Recomendação de Plano por Perfil

<!-- FONTE ÚNICA de verdade para a lógica "qual plano recomendar".
     Usado por mariv3/services/apresentacao-planos.js (função definirPlano).
     Qualquer mudança aqui altera a recomendação imediatamente. -->

## Regra de decisão

Em ordem de prioridade (primeira que bater, decide):

| Prioridade | Condição | Plano recomendado |
|:---:|---|---|
| 1 | Pet com `problema_saude` preenchido (doente, cirurgia, internado, alergia, displasia, tratamento) | *Platinum* |
| 2 | `idade ≥ 7 anos` | *Platinum* |
| 3 | Raça sensível + `idade ≥ 5 anos` | *Platinum* |
| 4 | Qualquer outro caso (jovem, raça neutra) | *Advance* |

---

## Raças sensíveis (lista única)

Raças que, combinadas com idade ≥ 5 anos, recebem *Platinum*. Todas geram maior risco cirúrgico, dental, ortopédico ou respiratório na meia-idade.

- `bulldog` (todas variações)
- `buldogue`
- `persa`
- `maine coon`
- `pug`
- `shar-pei`
- `golden` / `golden retriever`
- `labrador`
- `pastor` (alemão, belga, australiano)
- `dachshund`
- `rottweiler`
- `yorkshire`

> ⚠️ Editar esta lista altera quem é "sensível" em runtime. Não duplicar em código JS.

---

## Preços oficiais

> ⚠️ *Todos os valores vêm EXCLUSIVAMENTE do BD* (tabela `precos`, injetados no prompt como `# DADOS DO PRODUTO`). Este arquivo *não* lista preços — se você está vendo algum R$ aqui, é bug.
>
> Fonte: `SELECT valor, valor_tabela, valor_promocional, valor_oferta, valor_limite FROM precos JOIN planos WHERE ativo=true`
>
> Veja [[Plamev/Precos-Estrategia]] para as 4 faixas e a lógica de apresentação.
>
> *A Mari NUNCA deve citar um número que não esteja no `# DADOS DO PRODUTO`.* Se o BD falhar, ela responde *"Deixa eu confirmar esse valor pra você, um segundo 😊"* e não inventa.

---

## Justificativas aceitas

A justificativa precisa relacionar *raça + problema típico + plano*:

| Raça | Problema típico | Exemplo de justificativa |
|---|---|---|
| Golden / Labrador | Displasia de quadril, coluna | *"Tutores de Golden geralmente preferem o Platinum porque essa raça tem predisposição a displasia de quadril após os 5 anos"* |
| Bulldog / Pug / Shar-pei | Braquicefálico, respiratório | *"Raças braquicefálicas como Bulldog costumam precisar de cirurgia de palato — por isso o Platinum"* |
| Shih Tzu / Yorkshire | Dental, ortopédico | *"Shih Tzu tem alta incidência de problema dental, e o Platinum cobre limpeza e extração"* |
| Dachshund | Hérnia de disco | *"Dachshund tem altíssimo risco de hérnia de disco — o Platinum cobre neurologia e cirurgia"* |
| Persa / Maine Coon | Renal, cardíaco | *"Gatos Persas têm predisposição a DRPA (doença renal) — o Platinum cobre exames completos"* |
| Rottweiler | Cardíaco, ortopédico | *"Rottweiler adulto geralmente precisa de checkups cardíacos — Platinum cobre especialistas"* |
| (raça neutra / filhote) | Preventivo | *"Pra filhote o Advance já cobre consultas, vacinas e urgências — é o mais escolhido"* |

---

## Proibições
- *NÃO* oferecer Slim depois que cliente deu dados do pet
- *NÃO* listar os 4 planos — recomendar *1 só*
- *NÃO* inventar justificativa — se a raça não está na tabela, usar formulação genérica neutra
