# Coberturas, Procedimentos e Carências

<!-- [INSERIDO 15/04/2026 17:11] Aviso crítico contra invenção de coberturas — instruído por Getúlio -->
## AVISO CRÍTICO — Nunca inventar coberturas

O BD é a ÚNICA fonte de verdade para coberturas e carências.

NUNCA mencionar coberturas que não estão no BD:
- Homeopatia: NÃO existe em nenhum plano
- Nutrição veterinária: NÃO existe
- Prótese/órtese: NÃO existe
- Oncologista como especialidade: NÃO existe como cobertura explícita

Se o cliente perguntar sobre uma cobertura não listada: "Isso não está coberto nesse plano."


> ⚠️ REGRA ABSOLUTA: Mari NUNCA inventa cobertura, procedimento, carência ou limite.
> Sempre buscar no banco de dados antes de responder.
> Se não souber: "Vou verificar isso pra você agora!"

---

## Como buscar no BD

Quando o cliente perguntar sobre cobertura específica, Mari deve:
1. Verificar se o procedimento existe no BD do plano do cliente
2. Informar a carência em dias
3. Informar o limite de uso (quantas vezes por período)
4. Se não estiver coberto: dizer claramente sem inventar alternativas

---

## Resumo por plano (referência rápida)

### 🟢 Slim
| Categoria | Procedimentos | Carência |
|---|---|---|
| Consultas | Clínico Geral (6x), Emergencial, Retorno (6x), Telemedicina (2x) | 15-60 dias |
| Exames Laboratoriais | Hemograma, Bioquímica, Urinálise, Coproparasitológico | 36-90 dias |
| Vacinas | Múltipla, Antirrábica, Leptospirose, Quádrupla Felina | 90 dias |
| Ambulatorial | Curativo Simples (4x) | 36 dias |

### 🔵 Advance
Tudo do Slim, mais:
| Categoria | Adicionais | Carência |
|---|---|---|
| Exames de Imagem | Raio-X (6x), Ultrassom (4x), Eletrocardiograma (4x) | 120 dias |
| Exames Lab | Citologia de Pele, Histopatológico | 90-150 dias |
| Ambulatorial | Internação Diurna/Noturna (4x cada), Nebulização, Cistocentese | 36-190 dias |
| Cirurgias | Cesariana, Cistotomia, Corpo Estranho, Esplenectomia, Hérnia, Mastectomia, Orquiectomia | 190 dias |
| Anestesia | Geral Intravenosa, Inalatória | 190 dias |

### 🟣 Platinum
Tudo do Advance, mais:
| Categoria | Adicionais | Carência |
|---|---|---|
| Consultas | Especialista (4x), Telemedicina Ampliada (6x) | 120 dias |
| Terapias | Fisioterapia (8x), Acupuntura (6x), Ozonioterapia (4x) | 120 dias |
| Sorologias | Leishmaniose, Babesiose, Erliquiose, Toxoplasmose, Giardia (1x cada) | 90 dias |
| Hormonais | T3/T4/TSH (2x), Cortisol (2x), Estradiol (1x) | 90 dias |
| Vacinas | + Giardia, Gripe Felina | 90 dias |
| Cremação | Coletiva (1x) | 360 dias |

### 👑 Diamond
Tudo do Platinum, mais:
| Categoria | Adicionais | Carência |
|---|---|---|
| Consultas | Domiciliar (12x), Horário Não Comercial | 15-120 dias |
| Internação/UTI | UTI, Semi-Intensiva | 190 dias |
| Diagnóstico Avançado | Tomografia (2x), Colonoscopia, Endoscopia, Rinoscopia, Ecodopplercardiograma (2x) | 190 dias |
| Anestesia | + Sedação | 190 dias |
| Oftalmologia | Teste Oftalmológico (2x) | 120 dias |
| Reprodução | Inseminação Artificial (1x) | 360 dias |
| Cremação | + Individual (1x) | 360 dias |

---

## Regras de carência importantes

- *Emergência:* 15 dias em todos os planos
- *Retorno de consulta:* 0 dias (sem carência)
- *Telemedicina:* 8 dias
- *Cirurgias:* 190 dias
- *Vacinas:* 90 dias
- *Cremação:* 360 dias

---

## O que NUNCA está coberto (nenhum plano)

- Medicamentos
- Ração terapêutica
- Suplementos
- Banho e tosa
- Castração (exceto quando indicação clínica, verificar BD)
- Tratamentos estéticos
- Doenças preexistentes no período de carência

---

## Como responder quando não sabe

Se o cliente perguntar algo não listado acima:
*"Deixa eu verificar isso pra você no sistema! Um momento 😊"*

Nunca inventar. Nunca adivinhar. Sempre consultar.

---

<!-- [INSERIDO 15/04/2026 00:11] Regras antiloop CEP e clínicas fictícias, instruído por Getúlio -->
## Regras críticas sobre CEP e clínicas

*NUNCA inventar clínicas*, se a API não retornar resultados reais, dizer:
*"Não encontrei clínicas credenciadas nesse CEP específico. Você tem outro CEP próximo ou quer que eu consulte a cidade?"*

*NUNCA pedir CEP que já foi informado*, verificar o histórico antes de perguntar qualquer dado.

*NUNCA entrar em loop*, se já consultou o CEP nessa conversa, não consultar de novo a menos que o cliente peça explicitamente.

*Se a API retornar erro ou zero clínicas:*
*"Não encontrei clínicas credenciadas nesse raio. Pode ser que o CEP seja de uma área ainda não coberta. Quer que eu te coloque na lista de espera?"*

*NUNCA dizer "não temos cobertura" e depois "temos cobertura"*, verificar uma vez, responder uma vez, não contradizer.
---

## Link de busca de clínicas

Quando o cliente perguntar sobre clínicas, cobertura ou rede, Mari pode enviar o link de busca:

`https://webhook-v3.plamevbrasil.com.br/clinicas.html?cep=XXXXX`

Substituir XXXXX pelo CEP do cliente. A página abre já com o resultado.

Se não tiver o CEP do cliente ainda:
`https://webhook-v3.plamevbrasil.com.br/clinicas.html`

Exemplos de uso:
*"Te mando o link pra você ver todas as clínicas mais próximas de você! 😊"*
*"Olha aqui, você pode pesquisar pelo seu CEP e ver todas as clínicas na sua região: [link]"*
---

<!-- [INSERIDO 15/04/2026 13:02] Carências corretas de castração, corrigindo erro grave, instruído por Getúlio -->
## Castração, regras críticas

*CASTRAÇÃO NÃO ESTÁ NO ADVANCE REGULAR.* Só nos planos Plus.

| Plano | Castração | Carência |
|---|---|---|
| Advance | ❌ NÃO cobre | - |
| Platinum | ❌ NÃO cobre | - |
| Diamond | ❌ NÃO cobre | - |
| Advance Plus | ✅ Cobre | 270 dias |
| Platinum Plus | ✅ Cobre | 210 dias |
| Diamond Plus | ✅ Cobre | 180 dias |

*Quando cliente perguntar sobre castração:*
*"A castração está incluída nos planos Plus! O Advance Plus, por exemplo, já inclui a castração por apenas R$59/mês a mais que o Advance. A carência é de 270 dias para o Advance Plus."*

*NUNCA dizer que castração cobre em 36 dias*, 36 dias é carência de cirurgias gerais, não de castração.
*NUNCA dizer que o Advance cobre castração*, não cobre.

→ [[Plamev/Planos]] | [[Plamev/Empresa]] | [[Plamev/Diferenciais]] | [[Vendas/Objecoes]]

<!-- [INSERIDO 16/04/2026 15:47] Medicamentos não cobertos — instruído por Getúlio -->
## O que NÃO tem cobertura

*Medicamentos:* nenhum tipo de medicação é coberto em NENHUM plano Plamev.
Não importa se é prescrito em consulta, hospitalar ou preventivo — medicação NÃO entra.
Nunca dizer ao cliente que "medicamentos prescritos na consulta" são cobertos.
