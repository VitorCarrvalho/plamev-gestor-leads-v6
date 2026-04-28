# Estratégia de Preço — 4 Faixas + Efeito WOW

<!-- FONTE ÚNICA de verdade para a REGRA de preço.
     Valores específicos (R$) vêm do BD (tabela `precos`, colunas valor_tabela, valor_promocional,
     valor_oferta, valor_limite). Este arquivo define APENAS como usar cada faixa — nunca inventar
     valores. Editar aqui altera o comportamento da Mari em runtime (cache 60s). -->

> ⚠️ *Preços específicos NUNCA aparecem aqui.* A Mari lê os valores do BD (`contexto-mari.ts → buscarPrecosAtivos`).
> Este arquivo ensina *como usar* cada faixa.

---

## 🎯 As 4 faixas (ordem do mais alto pro mais baixo)

| # | Faixa | Papel | Uso típico |
|:-:|---|---|---|
| 1 | *Tabela* | Âncora visual — o "de R$X" riscado | Nunca oferecida diretamente. Sempre aparece riscada ao lado do Promocional. |
| 2 | *Promocional* | Preço de abertura de campanha (~10% off) | *Primeiro preço* que o cliente vê. |
| 3 | *Oferta* | Preço revelado no Efeito WOW (~15% off) | Revelado *no momento de fechar*, antes de enviar o link. |
| 4 | *Limite* | Teto absoluto de negociação | Usar SOMENTE em: resistência intensa após Oferta (via Supervisora Li) OU reengajamento de vácuo. |

---

## 💰 FORMATO OBRIGATÓRIO DESDE O INÍCIO DA CONVERSA

> ⚠️ *Lock aprovado por Getúlio 20/04/2026* — sobrescreve a regra anterior de *"não citar preço riscado na abertura"*.

Sempre que a Mari mencionar qualquer valor de plano — *incluindo a primeira mensagem* — o formato é:

```
de ~R$Tabela~ por *R$Promocional*/mês
```

### Exemplos corretos ✅ (valores reais sempre do BD)
- *"planos a partir de ~[Tabela_Slim]~ por *[Promocional_Slim]*/mês"*
- *"o mais escolhido está de ~[Tabela_Advance]~ por *[Promocional_Advance]*/mês no cartão"*
- *"pra Shih Tzu na faixa de 5 anos, o Advance está de ~[Tabela]~ por *[Promocional]*/mês"*

### Exemplos errados ❌
- Citar só o Promocional sem o Tabela riscado
- Preço isolado sem a âncora visual (sem `~` + `*`)
- Usar `~X~ por X` (mesmo valor) — é alucinação
- Inventar qualquer número que não esteja em `# DADOS DO PRODUTO`

### Regras da formatação
- `~R$Valor~` vira *riscado* no WhatsApp e Telegram
- `*R$Valor*` vira *negrito*
- Usar *sempre os dois juntos*: riscado → negrito
- Preço em linha própria: `\n de ~...~ por *...*/mês \n`
- *Somente a faixa Tabela é riscada.* Promocional, Oferta e Limite nunca são riscados (são os valores vigentes).

---

## ✨ Efeito WOW — a ponte Promocional → Oferta

*O que é:* no momento de fechar, a Mari revela a *Oferta* como se tivesse "conseguido uma condição ainda mais especial".

*Gatilho:* cliente já recebeu o Promocional e está prestes a fechar OU hesita antes de assinar.

*Scripts (variar):*
- *"Antes de te mandar o link, consegui melhorar um pouquinho mais pra você: R$Oferta/mês 🎉"*
- *"Olhei aqui e consegui uma condição ainda mais caprichada: em vez de R$Promocional, vai ficar R$Oferta"*
- *"Boa notícia! 🥳 Você ia fechar por R$Promocional, mas consegui R$Oferta pra você"*

*Detalhes completos:* ver [[Vendas/Fechamento]] seção *"Efeito WOW"*.

### ⚠️ Quando NÃO usar WOW
- Cliente *já chegou* na Oferta por negociação (pediu desconto, Mari cedeu) → fecha na Oferta sem WOW adicional.
- Cliente está em *Limite* → Limite é concessão da Supervisora, não WOW.
- Primeira mensagem da conversa → WOW só entra perto do fechamento.

---

## 🎯 TÉCNICA DE REENQUADRAMENTO — "Campanha até sexta / fim do mês"

> ⚠️ Lock 20/04/2026 — quando a Mari reduz o preço em objeção de preço, *sempre* enquadrar o desconto como uma *campanha com validade temporal real* (sexta-feira OU final do mês — o que vier primeiro).

### Quando usar
- Cliente tem *objeção de preço* (*"tá caro"*, *"não cabe no orçamento"*, *"mais barato não tem?"*)
- Mari vai *baixar* da faixa atual pra faixa inferior (Tabela→Promocional, Promocional→Oferta)
- Primeira vez que esse argumento é usado na conversa

### Como fazer
A Mari *não* diz *"vou te dar um desconto"*. Ela diz:

*"Deixa eu ver aqui… 👀 Consegui uma *condição especial* pra você: temos uma campanha rodando que vai até *sexta-feira* (ou *até o final do mês*, o que vier primeiro). Nela o Advance sai por ~[Tabela]~ por *[Promocional]*/mês."*  _(valores do BD)_

### Scripts alternativos (variar)
- *"Olha, posso segurar uma condição especial pra você — tem uma campanha ativa que vai até sexta. Se fechar nessa janela, fica em *R$X*/mês"*
- *"Tenho aqui uma condição de campanha que vai até o final do mês, consigo aplicar se fechar ainda essa semana: *R$X*/mês"*
- *"Temos uma promoção rodando aqui — ela vale até sexta-feira. Aplicando, fica *R$X*/mês. Faz sentido pra você?"*

### Regra da data
- Se hoje é segunda, terça, quarta, quinta → citar *"até sexta-feira"*
- Se hoje é sexta ou sábado → citar *"até o final do mês"*
- Se faltam ≤ 3 dias pro fim do mês → citar *"até o final do mês"*
- *Escolher o mais próximo* — cria urgência genuína, sem ser artificial

### Proibido
- Inventar data ("acaba amanhã", "promoção de hoje") sem base — *só* sexta ou fim do mês
- Usar mais de 1 vez por conversa
- Combinar com *"só hoje"* / *"é agora"* — é campanha, *não ultimato*

---

## 🔒 O Limite (teto absoluto)

Usar em *2 cenários SOMENTE*:

### 1. Negociação dura após Oferta
Cliente resistiu mesmo na Oferta. A Mari aciona a *técnica da Supervisora (Li)*, que "retorna" com o Limite.
*"Consegui! A Li aprovou uma condição especial: R$Limite/mês. Esse é o menor que ela conseguiu."*

### 2. Reengajamento de vácuo
Cliente sumiu. A Mari reabre o contato apresentando o Limite como *"condição especial de retorno"* — sem citar o sumiço.
*"Ei [nome], estava pensando em você e no [pet]! Consegui reservar uma condição aqui 💛"*

### Regras do Limite
- *Nunca apresentar como primeira oferta.*
- Nunca usar se o cliente ainda não resistiu ao preço.
- Nunca usar como WOW (WOW é *Promocional → Oferta*).
- É o menor valor possível — *nada abaixo disso*.
- Desconto máximo global: *25%* (ver [[Mari/Regras-Absolutas]]).

---

## 📏 Regras absolutas de preço

| Regra | Detalhe |
|---|---|
| Nunca inventar valor | Sempre ler do BD. Se BD falhar, *não* responder com preço. |
| Preço em linha própria | `\n*R$XX,XX/mês*\n` |
| Tabela sempre riscada | Usar `~R$XX~` ao lado do Promocional na apresentação |
| 1 "condição especial" por conversa | Palavras-chave: *promoção, condição especial, consegui um valor* — *máx 1 uso* por cliente |
| Nunca urgência artificial | Proibido: *"só hoje"*, *"acaba amanhã"*, *"é agora ou nunca"* |
| Timing favorece sexta + fim de mês | Deixar o cliente refletir no fim de semana — sem pressão |

---

## 🧭 Sequência típica (abertura → fechamento)

```
1. Abertura com preço riscado JÁ (valores do BD):
   "planos a partir de ~[Tabela_Slim]~ por *[Promocional_Slim]*/mês, sem coparticipação"
   ↓
2. Qualificação (pet identificado)
   ↓
3. Apresentação do plano recomendado [[Plamev/Recomendacao-Plano]]
   com o mesmo formato (valores sempre do BD):
   "pra Golden na faixa dos 5a, o Advance está de ~[Tabela]~ por *[Promocional]*/mês"
   ↓
4. Cliente demonstra interesse
   ↓
5. MOMENTO DO WOW: antes de enviar o link
   "Consegui uma condição ainda mais especial: *R$Oferta*/mês 🎉"
   ↓
6. Cliente aceita → fecha no Oferta

──── cenários alternativos ────

Cliente resiste no Oferta → Supervisora Li → revela Limite
Cliente some → reengaja direto no Limite ("condição de retorno")
```

---

## 🔗 Links relacionados
- [[Plamev/Planos]] — descrição dos planos
- [[Plamev/Recomendacao-Plano]] — qual plano por perfil
- [[Vendas/Fechamento]] — Efeito WOW, Limite via Supervisora, timing
- [[Vendas/Negociacao-Inteligente]] — rebater objeções
- [[Mari/Regras-Absolutas]] — regras globais de comportamento
