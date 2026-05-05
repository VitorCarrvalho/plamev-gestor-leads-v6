/**
 * validador.js — Guard Rails pós-Brain
 * Roda depois do Haiku gerar a resposta, antes de enviar ao cliente.
 * Nunca depende de IA — é código puro.
 *
 * [COMPORTAMENTO MARI] Validador pós-Brain — guard rails estruturais — 15/04/2026 00:17
 */

// ── Regra 1: Remover travessão e duplo-hífen ──────────────────────────────
// Mari nunca usa — (travessão) nem -- (duplo hífen): ambos são tell de IA.
// Converte em vírgula, preservando URLs (https://...) e flags CLI (--foo).
function removerTravessao(texto) {
  let t = texto
    // travessão tipográfico (U+2014) em várias posições
    .replace(/ — /g, ', ')
    .replace(/— /g, ', ')
    .replace(/ —/g, ',')
    .replace(/—/g, ',');
  // duplo-hífen "--" usado como travessão em texto corrido (não em URL/CLI)
  // só substitui quando está envolto por espaço/pontuação — preserva --foo e http://
  t = t
    .replace(/\s--\s/g, ', ')   // " -- " → ", "
    .replace(/\s--$/gm, ',')    // " --" no fim de linha
    .replace(/^--\s/gm, '');    // "-- " no começo de linha (pouco comum)
  return t;
}

// ── Regra 1b: Normalizar formatação WhatsApp (lock 21/04/2026) ────────────
// WhatsApp renderiza com UM caractere:
//   *negrito*  _itálico_  ~tachado~
// Markdown (**bold**, __italic__, ~~strike~~) aparece LITERAL pro cliente e
// parece amador. Se a Mari escorregar e emitir double-char, convertemos aqui.
// Preserva blocos de código entre crases (` ... `) e URLs.
function normalizarFormatacaoWhatsApp(texto) {
  // Não tocar no conteúdo dentro de crase (``texto com **duplo**``)
  const partes = texto.split(/(`[^`]*`)/);
  for (let i = 0; i < partes.length; i++) {
    if (i % 2 === 1) continue; // é um bloco `...` → preserva
    partes[i] = partes[i]
      .replace(/\*\*/g, '*')  // **bold** → *bold*
      .replace(/~~/g, '~')    // ~~tachado~~ → ~tachado~
      .replace(/__/g, '_');   // __ital__ → _ital_
  }
  return partes.join('');
}

// ── Regra 2: Remover clínicas fictícias ───────────────────────────────────
// Se a resposta lista clínicas mas não vieram da API (não têm distância real),
// remover o bloco de clínicas inventadas.
function removerClinicasFicticias(texto, clinicasReais) {
  // Se há clínicas reais → manter
  if (clinicasReais && clinicasReais.length > 0) return texto;

  // Detectar padrões de clínicas inventadas na resposta
  const padraoClinica = /📍[^\n]+\n?/g;
  const linhasClinica = texto.match(padraoClinica) || [];

  if (linhasClinica.length === 0) return texto;

  // Se tem clínicas listadas mas não temos dados reais → remover
  let novo = texto;
  linhasClinica.forEach(linha => {
    novo = novo.replace(linha, '');
  });

  // Limpar linhas vazias duplas
  novo = novo.replace(/\n{3,}/g, '\n\n').trim();

  if (novo !== texto) {
    console.log('[VALIDADOR] ⚠️ Clínicas fictícias removidas da resposta');
  }

  return novo;
}

// ── Regra 3: Remover perguntas sobre dados já coletados ───────────────────
function removerPerguntasRepetidas(texto, perfil, conversa) {
  let novo = texto;
  let removeu = false;

  const checks = [
    // CEP já informado
    {
      temDado: !!(perfil?.cep),
      padroes: [
        /me passa? (o )?seu cep[^?]*\?/gi,
        /qual (é )?o (seu )?cep[^?]*\?/gi,
        /pode me passar o cep[^?]*\?/gi,
        /envia (o )?cep[^?]*\?/gi,
      ],
      label: 'CEP (já informado)'
    },
    // Nome do pet já informado
    {
      temDado: !!(perfil?.nome),
      padroes: [
        /qual (é )?(o )?nome do (seu )?pet[^?]*\?/gi,
        /como (se chama|chama) (o|a) (seu|sua)[^?]*\?/gi,
        /me fala o nome del[ea][^?]*\?/gi,
      ],
      label: 'Nome do pet (já informado)'
    },
    // Raça já informada
    {
      temDado: !!(perfil?.raca),
      padroes: [
        /qual (é )?(a )?raça[^?]*\?/gi,
        /que raça[^?]*\?/gi,
      ],
      label: 'Raça (já informada)'
    },
    // Nome do tutor já informado
    {
      temDado: !!(conversa?.tutor_nome && conversa.tutor_nome !== 'Cliente'),
      padroes: [
        /como posso te chamar[^?]*\?/gi,
        /qual (é )?(o )?seu nome[^?]*\?/gi,
        /me diz (o )?seu nome[^?]*\?/gi,
      ],
      label: 'Nome do tutor (já informado)'
    },
  ];

  for (const check of checks) {
    if (!check.temDado) continue;
    for (const padrao of check.padroes) {
      if (padrao.test(novo)) {
        // Remover a frase que contém a pergunta
        novo = novo.replace(padrao, '').trim();
        removeu = true;
        console.log(`[VALIDADOR] ⚠️ Pergunta repetida removida: ${check.label}`);
      }
    }
  }

  // Limpar duplos espaços/linhas
  if (removeu) {
    novo = novo.replace(/\n{3,}/g, '\n\n').trim();
  }

  return novo;
}

// ── Regra 4: Detectar contradição de cobertura ────────────────────────────
function detectarContradicaoCobertura(texto, historico) {
  const disseSemCobertura = historico.some(h =>
    h.role === 'assistant' &&
    /(não temos cobertura|sem cobertura|ainda não chegamos)/i.test(h.conteudo)
  );

  const disSendoComCobertura = /(temos cobertura|tem cobertura|tem clínicas)/i.test(texto);

  if (disseSemCobertura && disSendoComCobertura) {
    console.log('[VALIDADOR] ⚠️ Contradição de cobertura detectada — mantendo resposta mas logando');
    // Não bloqueia, mas loga para auditoria
    return true;
  }
  return false;
}

// ── Regra 5: Limpar "Deixa eu checar" duplicado ───────────────────────────
function removerChecagemDuplicada(texto, historico) {
  // Remover SE já apareceu no histórico OU se o próprio texto já tem o aviso de "checar" mais de uma vez
  const jaChecouHist = historico.some(h =>
    h.role === 'assistant' &&
    /deixa eu checar|um segundo 🔍|checando/i.test(h.conteudo)
  );

  // Também remover se a mensagem EM SI já foi enviada como aviso proativo (pelo processor)
  const padrao = /deixa eu checar a cobertura[^!\n]*[!\n]?\s*/gi;
  const umSegundo = /um segundo[^\n]*🔍[^\n]*\n?/gi;

  let novo = texto;
  if (jaChecouHist) {
    novo = novo.replace(padrao, '').replace(umSegundo, '').trim();
    if (novo !== texto) console.log('[VALIDADOR] ⚠️ "Deixa eu checar" duplicado removido');
  }

  // Remover múltiplas ocorrências dentro da mesma mensagem
  const count = (novo.match(padrao) || []).length;
  if (count > 1) {
    let first = true;
    novo = novo.replace(padrao, (m) => { if (first) { first = false; return m; } return ''; }).trim();
    console.log('[VALIDADOR] ⚠️ "Deixa eu checar" repetido na mesma mensagem removido');
  }

  return novo || texto;
}

// ── Regra 6: Garantir mínimo de conteúdo ─────────────────────────────────
function garantirConteudo(texto) {
  const limpo = texto.trim();
  if (limpo.length < 5) {
    console.log('[VALIDADOR] ⚠️ Resposta vazia após validação — restaurando fallback');
    return null; // sinaliza para usar fallback
  }
  return limpo;
}


// ── Regra: máximo 1 pergunta por mensagem ────────────────────────────────────
function limitarPerguntas(texto) {
  // Divide por sentenças terminadas com ? e conta perguntas
  // Mantém apenas a primeira pergunta, remove as demais
  const qtdPerguntas = (texto.match(/\?/g) || []).length;
  if (qtdPerguntas <= 1) return texto;

  // Remover tudo após a primeira sentença com '?'
  const primeiraIdx = texto.indexOf('?');
  if (primeiraIdx === -1) return texto;

  const atePrimeira = texto.slice(0, primeiraIdx + 1).trim();
  console.log('[VALIDADOR] ⚠️ Múltiplas perguntas reduzidas para 1');
  return atePrimeira;
}

// ── Função principal ───────────────────────────────────────────────────────
/**
 * Valida e corrige a resposta do Brain antes de enviar ao cliente
 * @param {string} resposta - texto gerado pelo Brain
 * @param {Object} ctx - contexto: { perfil, conversa, historico, clinicasReais }
 * @returns {string} resposta corrigida
 */
export function validar(resposta: string, ctx: any = {}) {
  if (!resposta) return resposta;

  const { perfil = {}, conversa = {}, historico = [], clinicasReais = null } = ctx;
  let texto = resposta;
  const alertas = [];

  // Aplicar todas as regras em sequência

  // Detectar preços inventados — validar contra tabela oficial
  const precosValidos = [59.99, 69.99, 119.99, 129.99, 149.99, 178.99, 189.99, 208.99,
    239.99, 248.99, 298.99, 359.99, 369.99, 399.99, 418.99, 458.99, 50.99, 104.99,
    167.99, 299.99]; // todos os preços do BD
  const precosEncontrados = texto.match(/R\$\s*(\d+[,\.]\d{2})/gi) || [];
  for (const p of precosEncontrados) {
    const num = parseFloat(p.replace(/R\$\s*/,'').replace(',','.'));
    if (!precosValidos.includes(num) && num > 30) {
      console.log('[VALIDADOR] ⚠️ Preço fictício detectado:', p, '— não está na tabela');
      // Não bloquear — apenas logar. O Haiku que interprete as regras.
    }
  }

  // Remover frases de abertura verbosas (caso Alan 22/04/2026 — "falar comigo" passou)
  const antesVerbosas = texto;
  texto = texto
    .replace(/fico feliz que voc[eê] (veio|se interessou|chegou|esteja aqui|me procurou|decidiu|tenha|veio falar|falou|resolveu|quis|entrou em contato|procurou)[^.!]*[.!]/gi, '')
    .replace(/que (bom|legal|ótimo|maravilha|prazer) que voc[eê][^.!]*[.!]/gi, '')
    .replace(/(?:que|tão) (?:bom|legal|ótimo|incrível|maravilhoso) (?:te|falar|ver)[^.!]*[.!]/gi, '')
    .replace(/seja (muito\s+)?bem[\s-]?vindo[^.!]*[.!]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/  +/g, ' ')
    .trim();
  if (texto !== antesVerbosas) alertas.push('abertura_verbosa_removida');

  const semTravessao = removerTravessao(texto);
  if (semTravessao !== texto) alertas.push('travessao_removido');
  texto = semTravessao;

  const semFormatacaoDupla = normalizarFormatacaoWhatsApp(texto);
  if (semFormatacaoDupla !== texto) alertas.push('formatacao_dupla_normalizada');
  texto = semFormatacaoDupla;

  const semClinicasFicticias = removerClinicasFicticias(texto, clinicasReais);
  if (semClinicasFicticias !== texto) alertas.push('clinicas_ficticias_removidas');
  texto = semClinicasFicticias;

  const semPerguntasRepetidas = removerPerguntasRepetidas(texto, perfil, conversa);
  if (semPerguntasRepetidas !== texto) alertas.push('perguntas_repetidas_removidas');
  texto = semPerguntasRepetidas;

  const semChecagemDuplicada = removerChecagemDuplicada(texto, historico);
  if (semChecagemDuplicada !== texto) alertas.push('checagem_duplicada_removida');
  texto = semChecagemDuplicada;

  detectarContradicaoCobertura(texto, historico); // só loga, não bloqueia

  // Regra: máximo 1 pergunta por mensagem
  const semMultiplasPerguntas = limitarPerguntas(texto);
  if (semMultiplasPerguntas !== texto) alertas.push('multiplas_perguntas_reduzidas');
  texto = semMultiplasPerguntas;

  // Regra: remover "As mais próximas são:" sem clínicas na sequência
  if (/as mais próximas são:/i.test(texto)) {
    const temClinicas = /📍/.test(texto);
    if (!temClinicas) {
      texto = texto.replace(/as mais próximas são:[\s\S]*?\n?/gi,
        'Você pode ver todas as clínicas no app Plamev Appet com seu CEP! 😊'
      ).trim();
      console.log('[VALIDADOR] ⚠️ Lista de clínicas vazia substituída');
    }
  }

  const final = garantirConteudo(texto);
  if (final === null) {
    console.log('[VALIDADOR] ⚠️ Resposta vazia — retornando original');
    return resposta; // retorna original se ficou vazio
  }

  if (alertas.length > 0) {
    console.log(`[VALIDADOR] ✅ Correções aplicadas: ${alertas.join(', ')}`);
  }

  return final;
}

