/**
 * orchestrator/contexto.js — Monta o contexto completo para o Brain
 * Fonte primária: agente_prompts (banco). Fallback: arquivos Obsidian.
 */
require('dotenv').config({ path: '../.env' });
const fs   = require('fs');
const path = require('path');
const db   = require('../db');
const vault = require('../services/vault-prompts');

// ── Cache de prompts do banco (60s TTL) ───────────────────────
const _promptsCache = new Map();
const PROMPTS_TTL = 60_000;

async function carregarPromptsBanco(agentId) {
  const cached = _promptsCache.get(agentId);
  if (cached && Date.now() - cached.ts < PROMPTS_TTL) return cached.prompts;
  try {
    const prompts = await db.buscarPrompts(agentId);
    _promptsCache.set(agentId, { ts: Date.now(), prompts });
    return prompts;
  } catch(e) {
    return cached?.prompts || {};
  }
}

// ── Obsidian: vault Mari-Knowledge-Base (atual) ─────────────
// Contexto dinâmico por etapa — menos tokens, mais foco
// Caminho relativo ao agente.obsidian_path

// VAULT: Mari-Knowledge-Base (nova estrutura — limpa e focada)
// Base: carregado em TODAS as etapas
const BASE_MARI = [
  'Mari/Identidade.md',       // quem é a Mari, Salvador, Thor e Magali, regras absolutas
  'Mari/Tom-e-Fluxo.md',      // fluxo completo: CEP, carência, descontos, fechamento, pós-venda
  'Mari/Anti-Repeticao.md',   // regras para não repetir, coleta em bloco, usar histórico
  'Mari/Modo-Rapido.md',      // modo rápido para leads de anúncio com intenção de compra
  'Mari/Qualificacao.md',   // qualificação inteligente sem travar venda
  'Mari/Apresentacao.md',  // regra de recomendação única
  'Mari/Exemplos-Alta-Conversao.md', // padrões de comportamento por exemplo
  'Plamev/Empresa.md',        // o que é a Plamev, rede, estados, números reais
];

// Por etapa: carrega só o que é relevante naquele momento
const ETAPA_ARQUIVOS = {
  acolhimento:         ['Mari/Modo-Rapido.md'],
  qualificacao:        ['Mari/Modo-Rapido.md', 'Plamev/Empresa.md'],
  apresentacao_planos: ['Plamev/Planos.md', 'Mari/Apresentacao.md', 'Plamev/Recomendacao-Plano.md', 'Plamev/Precos-Estrategia.md', 'Plamev/Planos-Plus.md'],
  validacao_cep:       ['Plamev/Planos.md'],
  negociacao:          ['Plamev/Planos.md', 'Vendas/Objecoes.md', 'Mari/Closer-Psicologica.md', 'Vendas/Negociacao-Inteligente.md', 'Vendas/Conduta-Vendas.md', 'Plamev/Recomendacao-Plano.md', 'Plamev/Precos-Estrategia.md', 'Plamev/Planos-Plus.md'],
  objecao:             ['Vendas/Objecoes.md', 'Mari/Closer-Psicologica.md', 'Plamev/Planos.md', 'Vendas/Conduta-Vendas.md', 'Plamev/Precos-Estrategia.md'],
  pre_fechamento:      ['Plamev/Planos.md', 'Vendas/Fechamento.md', 'Vendas/Negociacao-Inteligente.md', 'Vendas/Conduta-Vendas.md', 'Plamev/Precos-Estrategia.md', 'Plamev/Planos-Plus.md'],
  fechamento:          ['Vendas/Fechamento.md', 'Vendas/Conduta-Vendas.md', 'Mari/Apresentacao.md', 'Plamev/Precos-Estrategia.md'],
};

const FIXOS_POR_AGENTE = {
  mari:  BASE_MARI,
  rapha: BASE_MARI,
};


function lerObsidian(vaultPath, arquivos) {
  return arquivos.map(rel => {
    try {
      const conteudo = fs.readFileSync(path.join(vaultPath, rel), 'utf8');
      const nome = rel.split('/').pop().replace('.md', '');
      return `\n## [${nome}]\n${conteudo}`;
    } catch { return ''; }
  }).join('');
}

// ── Formatar dados do BD para o prompt ──────────────────────
function formatarCoberturas(coberturas) {
  if (!coberturas.length) return 'Nenhuma cobertura encontrada.';
  return coberturas.map(c =>
    `${c.plano}: carência ${c.carencia_dias} dias${c.limite_uso ? `, limite ${c.limite_uso}x` : ', ilimitado'}`
  ).join('\n');
}

// Formatter reescrito em 20/04/2026 — mostra as 4 faixas oficiais do BD.
// Serve de "fonte de verdade" pro Brain — qualquer valor citado pela Mari
// deve sair daqui. Preços hardcoded em Obsidian/JS foram eliminados.
function formatarPrecos(precos) {
  if (!precos.length) return '';
  const por_plano = {};
  const fmt = (v) => (v == null || v === '') ? null : `R$${Number(v).toFixed(2).replace('.', ',')}`;

  precos.forEach(p => {
    if (!por_plano[p.slug]) por_plano[p.slug] = { nome: p.nome, modalidades: {} };
    por_plano[p.slug].modalidades[p.modalidade] = {
      tabela:      fmt(p.valor_tabela),
      promocional: fmt(p.valor_promocional),
      oferta:      fmt(p.valor_oferta),
      limite:      fmt(p.valor_limite),
      vigente:     fmt(p.valor),
    };
  });

  // Helper: compara 2 valores numéricos (R$59,99 vs R$59,99) ignorando formato
  const numerico = (s) => s == null ? null : parseFloat(String(s).replace('R$', '').replace(',', '.').trim());
  const iguais = (a, b) => {
    const na = numerico(a), nb = numerico(b);
    if (na == null || nb == null) return false;
    return Math.abs(na - nb) < 0.01;
  };

  const linhas = ['TABELA DE PREÇOS — 4 FAIXAS (fonte única: BD.precos · confirmar sempre):'];
  const alertasMargem = [];
  for (const d of Object.values(por_plano)) {
    linhas.push(`\n${d.nome}:`);
    for (const [modal, v] of Object.entries(d.modalidades)) {
      linhas.push(
        `  ${modal}: tabela ${v.tabela || '—'} | promocional ${v.promocional || '—'} | oferta ${v.oferta || '—'} | limite ${v.limite || '—'}`
      );

      // ⚠️ VALIDAÇÃO DE MARGEM (21/04/2026 — Getúlio):
      // Ao entrar em política de negociação/desconto, verificar se cada faixa
      // tem valor DIFERENTE da próxima. Se forem iguais, PULAR essa etapa de
      // desconto — a Mari não deve "oferecer" uma baixa que não existe.
      const semMargemTabProm = iguais(v.tabela, v.promocional);
      const semMargemPromOfe = iguais(v.promocional, v.oferta);
      const semMargemOfeLim  = iguais(v.oferta, v.limite);
      if (semMargemTabProm || semMargemPromOfe || semMargemOfeLim) {
        const bloqueios = [];
        if (semMargemTabProm) bloqueios.push('Tabela→Promocional (não falar "campanha")');
        if (semMargemPromOfe) bloqueios.push('Promocional→Oferta (NÃO aplicar Efeito WOW)');
        if (semMargemOfeLim)  bloqueios.push('Oferta→Limite (NÃO acionar Supervisora Li)');
        alertasMargem.push(`  ${d.nome} ${modal}: ${bloqueios.join(' · ')}`);
      }
    }
  }

  if (alertasMargem.length) {
    linhas.push('', '🚫 BLOQUEIOS DE DESCONTO (faixas com valor IGUAL — pular essas negociações):');
    linhas.push(...alertasMargem);
    linhas.push('');
    linhas.push('REGRA: quando a faixa atual = próxima faixa, NÃO oferecer o "desconto" que não existe.');
    linhas.push('Exemplo: se Oferta = Limite, NÃO dizer "consegui falar com a Li e ela liberou um valor melhor" — não há margem pra dar.');
  }
  linhas.push(
    '',
    'REGRAS DE USO DAS FAIXAS:',
    '- TABELA: âncora visual riscada. Sempre aparece ao lado do Promocional ("~Tabela~ por *Promocional*"). Nunca ofertada sozinha.',
    '- PROMOCIONAL: primeiro preço que o cliente vê (~10% off Tabela). Formato obrigatório: de ~Tabela~ por *Promocional*.',
    '- OFERTA: revelada via Efeito WOW antes de enviar o link (~15% off). Se cliente já está na Oferta, fecha sem WOW adicional.',
    '- LIMITE: teto absoluto. Só via técnica da Supervisora (Li) OU reengajamento de vácuo.',
    '- NUNCA citar valores que não estejam nesta tabela. NUNCA inventar desconto ou promoção sem base.',
    '- Se faltar uma faixa (campo vazio na tabela): não oferecer essa faixa nessa modalidade.'
  );
  return linhas.join('\n');
}

// ── Montar contexto completo ──────────────────────────────────
async function montar({ conversa, cliente, perfil, historico, decisao, agente, mensagem }) {
  const partes = [];

  // Guard: decisao pode estar undefined/incompleto em fallback paths.
  // Garantimos shape mínimo com .consultar_bd sendo array pra evitar TypeError.
  decisao = decisao || {};
  if (!Array.isArray(decisao.consultar_bd)) decisao.consultar_bd = [];

  // 1. Contexto dinâmico por etapa (menos tokens, mais foco)
  // Contexto dinâmico: base sempre + extras por etapa
  const etapaAtual = conversa?.etapa || 'acolhimento';
  const base       = FIXOS_POR_AGENTE[agente.slug] || BASE_MARI;
  const extras     = ETAPA_ARQUIVOS[etapaAtual] || [];

  // Se o decisor quer apresentar plano e ainda não temos motor de decisão, adicionar
  const arquivosDecisao = (decisao?.proxima_acao === 'apresentar_plano' && !extras.includes('01_LOGICA/motor_decisao.md'))
    ? ['01_LOGICA/motor_decisao.md', '03_PRODUTO/templates_apresentacao.md']
    : [];

  const fixos = [...new Set([...base, ...extras, ...arquivosDecisao])];

  // Tenta banco primeiro; se soul preenchido, usa DB. Caso contrário, Obsidian.
  const dbPrompts = await carregarPromptsBanco(agente.id);
  let core;
  if (dbPrompts.soul && String(dbPrompts.soul).trim()) {
    const partesBanco = [dbPrompts.soul];
    if (dbPrompts.tom)            partesBanco.push(dbPrompts.tom);
    if (dbPrompts.regras)         partesBanco.push(dbPrompts.regras);
    if (dbPrompts.anti_repeticao) partesBanco.push(dbPrompts.anti_repeticao);
    if (dbPrompts.modo_rapido && ['acolhimento','qualificacao'].includes(etapaAtual)) {
      partesBanco.push(dbPrompts.modo_rapido);
    }
    if (dbPrompts.pensamentos)    partesBanco.push(dbPrompts.pensamentos);
    if (dbPrompts.planos && extras.some(e => e.includes('Planos'))) {
      partesBanco.push(dbPrompts.planos);
    }
    core = partesBanco.join('\n\n---\n\n');
  } else {
    core = lerObsidian(agente.obsidian_path, fixos);
  }

  if (core) partes.push('# IDENTIDADE E COMPORTAMENTO\n' + core);

  // 2. Dados do BD (só o que foi solicitado pelo decisor)
  const bdParts = [];

  // Auto-expandir consultar_bd quando cliente pergunta sobre carência/cobertura
  // Evita alucinação tipo "castração 60 dias" quando o BD tem 270 dias.
  const textoLower = (mensagem || '').toLowerCase();
  if (/carência|carencia|quantos dias|quanto tempo|prazo pra|prazo para|libera|liberado/.test(textoLower) && !decisao.consultar_bd.includes('carencias')) {
    decisao.consultar_bd.push('carencias');
  }

  if (decisao.consultar_bd.includes('coberturas') || decisao.consultar_bd.includes('procedimentos') || decisao.consultar_bd.includes('carencias')) {
    // Regex ampliado — inclui castração, fisioterapia, odontologia, oncologia, tumores etc
    const procedimentos = mensagem.match(/castra(?:ção|cao|r|do|da)|cirurgia|consulta|vacina|raio.?x|ultrassom|carência|internação|emergência|exame|anestesia|fisioterapia|odonto|dental|tártaro|tartaro|oncolog|tumor|parto|cesári|hospital|ressonânc|ressonanc|tomograf/gi) || [];
    for (const proc of [...new Set(procedimentos)]) {
      const cobs = await db.buscarCoberturasTodos(proc);
      if (cobs.length) bdParts.push(`Procedimento "${proc}":\n${formatarCoberturas(cobs)}`);
    }
    // Se o cliente perguntou de castração, força busca específica com o termo exato
    // (o match acima pega variações — aqui garantimos a tabela completa).
    if (/castra/i.test(textoLower) && !procedimentos.some(p => /castra/i.test(p))) {
      const cobs = await db.buscarCoberturasTodos('castração');
      if (cobs.length) bdParts.push(`Procedimento "castração":\n${formatarCoberturas(cobs)}`);
    }
  }

  // Preços — SEMPRE injetar (21/04/2026 — fix caso "amo meus filhos"):
  // O Brain tinha que inventar preços no fluxo de acolhimento/aprofundar porque
  // a tabela do BD só entrava no contexto quando proxima_acao = apresentar_plano.
  // Agora injetamos sempre — custo ~1 query, benefício é zero alucinação de preço.
  if (!decisao.consultar_bd.includes('precos')) decisao.consultar_bd.push('precos');

  // Mensagem de oferta padrão — interpolada com preços reais do BD.
  // [21/04/2026] Agora lê de mari_mensagens (slug='oferta_abertura') e sorteia
  // UMA variante aleatória a cada mensagem, pra evitar que a Mari soe sempre
  // igual. Fallback pra mari_config.mensagem_oferta_abertura se tabela vazia.
  try {
    const variantes = await db.query(
      `SELECT conteudo FROM mari_mensagens WHERE slug='oferta_abertura' AND ativo=true`
    ).catch(() => []);
    let tpl = null;
    if (variantes && variantes.length > 0) {
      tpl = variantes[Math.floor(Math.random() * variantes.length)].conteudo;
    } else {
      const tplRow = await db.one(
        `SELECT valor FROM mari_config WHERE chave='mensagem_oferta_abertura'`
      ).catch(() => null);
      tpl = tplRow?.valor || null;
    }
    if (tpl) {
      const precosRows = await db.query(
        `SELECT p.slug, pr.valor_tabela, pr.valor_promocional, pr.valor_oferta, pr.valor_limite
         FROM precos pr JOIN planos p ON p.id = pr.plano_id
         WHERE pr.modalidade = 'cartao' AND pr.ativo = true AND p.ativo = true`
      );
      const fmt = (v) => v == null ? '—' : `R$${Number(v).toFixed(2).replace('.', ',')}`;
      let msgOferta = tpl;
      for (const r of precosRows) {
        msgOferta = msgOferta
          .split(`{tabela_${r.slug}}`).join(fmt(r.valor_tabela))
          .split(`{promocional_${r.slug}}`).join(fmt(r.valor_promocional))
          .split(`{oferta_${r.slug}}`).join(fmt(r.valor_oferta))
          .split(`{limite_${r.slug}}`).join(fmt(r.valor_limite));
      }
      partes.push(`# MENSAGEM DE OFERTA PADRÃO (usar na abertura — valores REAIS do BD)\n${msgOferta}\n\n⚠️ Use esta mensagem EXATA (só pode variar palavras envolta — valores e placeholders não).`);
    }
  } catch (e) { console.warn('[contexto] mensagem_oferta:', e.message); }

  if (decisao.consultar_bd.includes('precos') || decisao.modo === 'negociacao' || decisao.proxima_acao === 'apresentar_plano') {
    const precos = await db.buscarPrecos(decisao.sugestao_plano);
    const txt = formatarPrecos(precos);
    if (txt) bdParts.push(`Preços atuais:\n${txt}`);
  }

  if (bdParts.length) {
    partes.push('# DADOS DO PRODUTO (fonte da verdade — use exatamente)\n' + bdParts.join('\n\n'));
  }

  // 2a.1. Preços de mercado de procedimentos (ancoragem "pode custar até R$X")
  // Fonte: mariv3.precos_mercado (editável via Intelligence V1 → Sistema → Config Mari)
  // Regra: Mari SEMPRE usa o valor MAX ("pode custar até R$X") quando cita custo
  // particular de procedimento pra justificar o plano. Valores atualizados acessíveis
  // em todas as mensagens — a Mari deve CONSULTAR esta lista antes de citar qualquer
  // valor de procedimento e nunca inventar números.
  try {
    const precosMercado = await db.query(
      `SELECT slug, nome, valor_min, valor_max FROM precos_mercado WHERE ativo = true ORDER BY ordem, nome`
    );
    if (precosMercado.length) {
      const linhas = precosMercado.map(r =>
        `- ${r.nome}: particular até R$${r.valor_max} (mín R$${r.valor_min})`
      );
      partes.push(
        `# PREÇOS DE MERCADO · PROCEDIMENTOS (ancoragem obrigatória)\n` +
        `Quando for citar custo particular de qualquer procedimento, CONSULTE esta lista PRIMEIRO e use o valor MAX no formato "pode custar até R$X". NUNCA invente valor. NUNCA use "em torno de" ou "entre R$X e R$Y".\n\n` +
        linhas.join('\n')
      );
    }
  } catch (e) {
    console.warn('[CONTEXTO] precos_mercado indisponível:', e.message);
  }

  // 2b. PDF de coberturas disponível (se houver plano recomendado e não tiver sido oferecido)
  if (conversa?.plano_recomendado && !conversa?.pdf_oferecido) {
    const pdfDisp = await db.one('SELECT plano_slug FROM planos_pdfs WHERE plano_slug=$1', [conversa.plano_recomendado]).catch(() => null);
    if (pdfDisp) {
      partes.push(`# PDF DE COBERTURAS DISPONÍVEL\nO plano ${conversa.plano_recomendado} tem manual de coberturas em PDF disponível.\nSe o cliente perguntar sobre coberturas especificas, ao final da resposta adicione: "Se quiser, posso te mandar o manual completo de coberturas, é só me dizer 📋"\nNao oferecer de forma proativa — só quando coberturas forem mencionadas.`);
    }
  }

  // 3. Contexto relacional (só se ativado)
  if (decisao.consultar_relacional && decisao.tags_relacional?.length) {
    const relacional = await db.buscarContextoRelacional(agente.id, decisao.tags_relacional);
    if (relacional.length) {
      const txt = relacional.map(r =>
        `${r.nome} (${r.relacao}): ${r.historia}`
      ).join('\n');
      partes.push('# CONTEXTO PESSOAL (use naturalmente se for relevante)\n' + txt);
    }
  }

  // 4. Perfil do cliente (dados reais do BD)
  const campoPerfil = [];
  if (cliente?.nome) campoPerfil.push(`Nome: ${cliente.nome}`);
  if (perfil?.nome)  campoPerfil.push(`Pet: ${perfil.nome}${perfil.especie ? ' ('+perfil.especie+')' : ''}${perfil.raca ? ', '+perfil.raca : ''}${perfil.idade_anos ? ', '+perfil.idade_anos+' anos' : ''}`);
  if (conversa?.numero_cotacao) campoPerfil.push(`Cotação: ${conversa.numero_cotacao}`);
  if (campoPerfil.length) partes.push('# DADOS DO CLIENTE\n' + campoPerfil.join('\n'));

  // 5. Instrução ativa do supervisor
  const instrucao = await db.buscarInstrucaoAtiva(conversa.id);
  if (instrucao) partes.push('# INSTRUÇÃO DO SUPERVISOR (PRIORIDADE MÁXIMA)\n' + instrucao.instrucao);

  // 6. Decisão do motor (orientação)
  partes.push(`# ORIENTAÇÃO DO SISTEMA
Modo: ${decisao.modo}
Próxima ação: ${decisao.proxima_acao}
Urgência: ${decisao.nivel_urgencia}/10
${decisao.sugestao_plano ? 'Plano sugerido: '+decisao.sugestao_plano : ''}`);

  // 7. Regras absolutas + formato de saída — FONTE ÚNICA: Mari/Regras-Absolutas.md
  //
  // Esse bloco era hardcoded (contexto.js:163-295). Agora lido do Obsidian com
  // cache de 60s. Editar o .md reflete em no máx 1min sem redeploy.
  // O fallback mínimo abaixo garante que o formato JSON continua válido mesmo
  // se o arquivo sumir do vault.
  const FALLBACK_REGRAS = `# FORMATO DE RESPOSTA
Responda APENAS em JSON válido e COMPACTO:
{"r":"sua mensagem ao cliente","e":"etapa","d":{"nc":null,"np":null,"ep":null,"rp":null,"ip":null,"cp":null,"em":null,"cf":null,"pi":null}}
Chaves: r=resposta, e=etapa, d=dados (nc=nome_cliente, np=nome_pet, ep=especie, rp=raca, ip=idade, cp=cep, em=email, cf=cpf, pi=plano_interesse)
IMPORTANTE: resposta em "r" pode ser longa — nunca corte no meio.
REGRAS ABSOLUTAS: arquivo Mari/Regras-Absolutas.md indisponível — siga comportamento da Identidade.md.`;
  const regrasAbsolutas = vault.carregar(
    'Mari/Regras-Absolutas.md',
    FALLBACK_REGRAS,
    agente?.obsidian_path
  );
  partes.push(`# REGRAS ABSOLUTAS (fonte: Obsidian Mari/Regras-Absolutas.md)\n${regrasAbsolutas}`);
  // Marcador silencioso pra debug — o hardcoded antigo foi removido daqui
  // (se precisar restaurar emergência, veja git log desse arquivo antes de 20/04/2026).

  // Arquivos efetivamente usados nesta mensagem
  const arquivosUsados = [...fixos];
  // Adicionar arquivos dinâmicos se o decisor consultou contexto relacional
  if (decisao.consultar_relacional && decisao.tags_relacional?.length) {
    decisao.tags_relacional.forEach(tag => {
      arquivosUsados.push(`Treinamentos/${tag}.md`);
    });
  }

  return { contexto: partes.join('\n\n'), arquivos: arquivosUsados };
}

module.exports = { montar };
