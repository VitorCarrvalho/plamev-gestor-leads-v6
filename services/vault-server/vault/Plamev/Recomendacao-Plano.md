# Recomendação de Plano por Perfil

<!-- FONTE ÚNICA de verdade para a lógica "qual plano recomendar".
     Usado por mariv3/services/apresentacao-planos.js (função definirPlano).
     Qualquer mudança aqui altera a recomendação imediatamente. -->

## Regra de decisão

Em ordem de prioridade (primeira que bater, decide):

| Prioridade | Condição | Plano recomendado |
|:---:|---|---|
| 1 | Pet com `problema_saude` preenchido (doente, cirurgia, internado, alergia, displasia, tratamento) | *Platinum* |
| 2 | `idade ≥ 7 anos` (qualquer raça) | *Platinum* |
| 3 | Raça de **Risco Cirúrgico Alto** + `idade ≥ 4 anos` | *Platinum* |
| 4 | Raça de **Risco Moderado** + `idade ≥ 5 anos` | *Platinum* |
| 5 | Raça com **Risco Dental/Eletivo** (qualquer idade) | *Advance* + pitch proativo do Plus |
| 6 | Qualquer outro caso (raça neutra, filhote) | *Advance* |

> ⚠️ Editar esta tabela altera a lógica de recomendação em runtime. Não duplicar em código JS.

---

## Categoria A — Risco Cirúrgico Alto (Platinum a partir de 4 anos)

Raças com alto risco de cirurgia de urgência ou doença sistêmica grave antes dos 5 anos.
Limiares de idade mais baixos que o padrão.

| Raça | Principal risco clínico | Por que 4 anos |
|---|---|---|
| `dachshund` / `teckel` / `bassê` | IVDD (hérnia de disco) — risco acumulado de 30% ao longo da vida, pico entre 3 e 6 anos | Cirurgia de emergência neurológica frequente nessa faixa |
| `bulldog frances` / `french bulldog` / `frenchie` | BOAS (síndrome obstrutiva braquicefálica), IVDD, dermatite entre dobras, malformações espinhais | Dupla exposição: respiratório + disco. Cirurgia de palato antes dos 4 anos é comum |
| `boxer` | Estenose subaórtica (cardíaca), cardiomiopatia arritmogênica, alta incidência de câncer (mastocitoma, linfoma) | Problemas cardíacos e tumorais com onset precoce |
| `doberman` / `dobermann` | Cardiomiopatia dilatada (DCM) — onset típico entre 4 e 7 anos, Doença de Von Willebrand | DCM é silenciosa e avança rápido sem monitoramento |
| `cavalier king charles` / `cavalier` | Doença mitral valvar (MVD) — 50% dos Cavaliers já apresentam sopro aos 5 anos | Única raça onde o protocolo de breeding obriga ecocardiograma antes dos 2 anos |
| `scottish fold` | Osteocondrodisplasia — 100% dos Scottish Fold têm essa doença articular progressiva desde o nascimento | Toda a articulação é afetada; dor e cirurgia ortopédica inevitáveis com o tempo |

---

## Categoria B — Risco Moderado (Platinum a partir de 5 anos)

Raças com risco cirúrgico, ortopédico ou sistêmico relevante na meia-idade.

**Cães:**
- `bulldog` / `bulldog ingles` / `buldogue` — BOAS, dermatite, cardíaco
- `pug` — BOAS, olho seco (KCS), estenose de coluna cervical (NME), problemas de pele
- `shar-pei` — Febre familiar do Shar-pei, amiloidose renal, infecções cutâneas
- `golden retriever` / `golden` — Displasia de quadril e cotovelo, alta incidência de câncer (hemangiosarcoma, linfoma, osteossarcoma)
- `labrador` / `labrador retriever` — Displasia de quadril e cotovelo, hipotiroidismo, obesidade com complicações articulares
- `pastor alemao` / `german shepherd` — Displasia de quadril, mielopatia degenerativa (DM), EPI (insuficiência pancreática exócrina)
- `pastor australiano` / `australian shepherd` / `border collie` — Epilepsia (MDR1), anomalia do olho de collie (CEA), PRA
- `rottweiler` — Displasia severa de quadril e cotovelo, osteossarcoma (alta incidência em raças gigantes)
- `weimaraner` — Dilatação gástrica/vólvulo (GDV), displasia, hemofilias
- `cocker spaniel` — Otite externa crônica, ceratoconjuntivite seca (KCS), displasia de quadril
- `schnauzer miniatura` — Pancreatite recorrente, urolitíase (cálculos), comedone syndrome
- `basset hound` — IVDD (chondrodystrophic), otite crônica, obesidade

**Gatos:**
- `maine coon` — Cardiomiopatia hipertrófica (HCM) com onset entre 3 e 5 anos, displasia de quadril
- `persa` / `himalaia` — Doença renal policística (PKD), HCM, doença renal crônica, problemas respiratórios
- `ragdoll` — HCM (risco genético confirmado, gene FHL2)

---

## Categoria C — Risco Dental/Eletivo (Advance recomendado + pitch proativo do Plus)

Raças com alta probabilidade de necessitar de tartarectomia, extração dentária ou procedimentos eletivos frequentes.
O Advance cobre a maioria das necessidades, mas o Plus é fortemente recomendado para criar cobertura do tártaro e castração.

**Pitch obrigatório:** *"O Advance já cobre o que seu pet mais vai precisar. Mas [raça] tem muita tendência a tártaro, e a limpeza fica de fora do plano base. O Plus é um aditivo que inclui castração, limpeza de tártaro e sedação por +R$[diferença_plus do BD]/mês — esses serviços ficam disponíveis após cumprir a carência."*

| Raça | Risco principal | Detalhe clínico |
|---|---|---|
| `shih tzu` | Dental, luxação de patela, KCS (olho seco) | 80%+ dos Shih Tzu apresentam doença periodontal antes dos 3 anos. Thor (pet da Mari) é exemplo real. |
| `yorkshire terrier` / `yorkshire` / `york` | Dental (a mais afetada proporcionalmente), colapso de traqueia, luxação de patela | A piora dentária é progressiva e frequentemente requer extrações múltiplas |
| `maltes` / `maltês` | Dental severo, luxação de patela, lacrimejamento excessivo | Dentes pequenos e compactados — acúmulo de tártaro acelerado |
| `poodle` (toy, micro, miniatura) | Dental, epilepsia (genética), PRA (retinopatia), luxação de patela | Epilepsia idiopática é a segunda doença mais comum no Poodle |
| `lhasa apso` | Dental, displasia renal, problemas oculares (entrópio) | Risco renal aumentado — monitoramento após 6 anos |
| `chihuahua` | Dental (mais afetada entre cães pequenos), colapso de traqueia, hidrocefalia, luxação de patela | Moleiras abertas comuns — cuidado com traumas |
| `pinscher miniatura` / `pinscher` | Dental, luxação de patela, Legg-Calvé-Perthes (necrose da cabeça do fêmur) | Legg-Calvé-Perthes requer cirurgia ortopédica |
| `spitz alemao` / `lulu da pomerania` / `pomeranian` | Dental, alopecia X (doença hormonal cutânea), colapso de traqueia, luxação de patela | Alopecia X é esteticamente marcante e causa angústia nos tutores |
| `bichon frise` / `bichon` | Dental, alergias cutâneas, urolitíase (cálculos de oxalato) | Infecções de pele por dobras úmidas ao redor dos olhos |
| `pequines` | Dental, BOAS (braquicefálico), problemas oculares severos (proptose) | Olhos protuberantes com risco de saída da órbita em traumas leves |
| `cavalier king charles` | Dental + MVD (já listado em Cat. A) | Se < 4 anos: Advance + Plus. Se ≥ 4 anos: Platinum (MVD tem prioridade) |
| `siames` / `siamês` / `siamese` | Dental, asma felina, IBD (doença inflamatória intestinal), PRA | Asma felina frequentemente requer corticoides e monitoramento contínuo |

---

## Preços oficiais

> ⚠️ *Todos os valores vêm EXCLUSIVAMENTE do BD* (tabela `precos`, injetados no prompt como `# DADOS DO PRODUTO`). Este arquivo *não* lista preços — se você está vendo algum R$ aqui, é bug.
>
> Fonte: `SELECT valor, valor_tabela, valor_promocional, valor_oferta, valor_limite FROM precos JOIN planos WHERE ativo=true`
>
> *A Mari NUNCA deve citar um número que não esteja no `# DADOS DO PRODUTO`.* Se o BD falhar, ela responde *"Deixa eu confirmar esse valor pra você, um segundo 😊"* e não inventa.

---

## Justificativas aceitas por categoria

A justificativa precisa relacionar *raça + risco clínico real + plano*. Sempre em 1 frase, natural, sem lista.

| Raça | Justificativa modelo |
|---|---|
| Golden / Labrador | *"Golden tem predisposição alta a displasia de quadril e infelizmente uma das maiores taxas de câncer entre os cães — o Platinum cobre cirurgia, especialistas e muito mais"* |
| Bulldog / Pug / Frenchie | *"Raças braquicefálicas como o [raça] frequentemente precisam de cirurgia de palato antes dos 4 anos — o Platinum cobre isso direto"* |
| Dachshund | *"Dachshund tem 30% de chance de hérnia de disco ao longo da vida e a cirurgia é de urgência — o Platinum foi feito pra esse perfil"* |
| Boxer | *"Boxer tem predisposição cardíaca e altíssima incidência de câncer, inclusive em jovens — o Platinum cobre cardiologista e oncologista"* |
| Doberman | *"Doberman adulto tem altíssimo risco de cardiomiopatia dilatada — é silenciosa e avança rápido. O Platinum cobre ecocardiograma e acompanhamento"* |
| Cavalier King Charles | *"Cavalier é a raça com maior predisposição a doença cardíaca valvar — metade dos Cavaliers já tem sopro aos 5 anos. O Platinum é o ideal"* |
| Persa / Himalaia | *"Gatos Persas têm predisposição genética a doença renal policística — o Platinum cobre exames renais completos e acompanhamento"* |
| Maine Coon | *"Maine Coon tem cardiomiopatia hipertrófica como principal risco — o ecocardiograma anual é essencial a partir dos 4 anos, coberto no Platinum"* |
| Shih Tzu | *"Shih Tzu é campeão em tártaro — a limpeza periódica é quase certa. O Advance já cobre a maioria das necessidades, mas o Plus inclui tartarectomia, castração e sedação"* |
| Yorkshire | *"Yorkshire é a raça mais afetada por doença dentária proporcionalmente — o Plus faz muito sentido por incluir limpeza de tártaro e castração"* |
| Dachshund (< 4 anos) | *"Dachshund jovem: o Advance já cobre bem. Mas se chegar aos 4 anos, vale migrar pro Platinum — o risco de hérnia aumenta muito nessa fase"* |
| Scottish Fold | *"Scottish Fold tem osteocondrodisplasia — é genético e progressivo, todos têm. O Platinum cobre ortopedia e acompanhamento articular"* |
| (raça neutra / filhote / SRD) | *"Pra esse perfil o Advance já cobre consultas, urgências, cirurgias e exames — é o mais escolhido e cabe muito bem"* |

---

## Proibições
- *NÃO* oferecer Slim depois que cliente deu dados do pet
- *NÃO* listar os 4 planos — recomendar *1 só*
- *NÃO* inventar justificativa — se a raça não está nas tabelas, usar formulação genérica neutra
- *NÃO* recomendar Platinum para filhote saudável de raça neutra sem histórico de saúde
- *NÃO* pular o pitch do Plus para raças da Categoria C — é uma perda de upsell e de proteção real para o cliente
