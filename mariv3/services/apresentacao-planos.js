/**
 * apresentacao-planos.js — Recomendação direta (não catálogo)
 * [COMPORTAMENTO MARI] Mari recomenda 1 plano, não lista todos — 16/04/2026 11:15
 * [COMPORTAMENTO MARI] Abertura gerada via Haiku — sem frases fixas — 16/04/2026 12:30
 */
const db     = require('../db');
const sender = require('./sender');
const https  = require('https');
const vault  = require('./vault-prompts');

const KEY = process.env.ANTHROPIC_API_KEY;

// System prompt e lógica de recomendação agora moram no Obsidian:
//   - Mari/Apresentacao-Prompt.md  (prompts de abertura + recomendação)
//   - Plamev/Recomendacao-Plano.md (raças sensíveis e regra idade/plano)
// As funções abaixo continuam controlando o FLUXO, mas o CONTEÚDO é lido do vault.
const SYSTEM_APRESENTACAO_FALLBACK = 'Você é a Mari, consultora Plamev. Gere apenas a mensagem, sem aspas, sem explicações, sem observações.';

async function buscarTemplate(tipo) {
  const row = await db.one(
    'SELECT conteudo FROM apresentacao_templates WHERE tipo=$1 AND ativo=true', [tipo]
  ).catch(() => null);
  return row?.conteudo || null;
}

async function buscarPerfil(conversaId) {
  return db.one('SELECT * FROM perfil_pet WHERE conversa_id=$1 LIMIT 1', [conversaId]).catch(() => null);
}

async function salvar(conversaId, texto) {
  if (conversaId) await db.salvarMensagem(conversaId, 'agent', texto, 'ia_planos').catch(() => {});
}

async function enviarEvo(msg, texto, conversaId) {
  const phone  = String(msg.phone).replace(/[^0-9]/g,'');
  const numero = (phone.startsWith('55') ? phone : '55' + phone) + '@s.whatsapp.net';
  const inst   = msg.instancia || 'mari-plamev-zap2';
  const EVO_HOST = process.env.EVOLUTION_URL  || 'https://legendarios-evolution-api.bycpkh.easypanel.host';
  const EVO_KEY  = process.env.EVOLUTION_API_KEY || '429683C4C977415CAAFCCE10F7D57E11';
  const body = JSON.stringify({ number: numero, text: texto });
  const url  = new URL(`${EVO_HOST}/message/sendText/${inst}`);
  await new Promise(resolve => {
    const req = https.request({
      hostname: url.hostname, path: url.pathname, method: 'POST',
      headers: { apikey: EVO_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(d)); });
    req.on('error', resolve);
    req.write(body); req.end();
  });
  await salvar(conversaId, texto);
}

// ── Definir plano pelo perfil ────────────────────────────────────────────
// Lê as raças sensíveis do Obsidian (Plamev/Recomendacao-Plano.md).
// Parseia a seção "## Raças sensíveis (lista única)" e extrai bullets `- `raca``.
// Fallback pra lista embutida caso o arquivo esteja indisponível.
const RACAS_SENSIVEIS_FALLBACK = ['bulldog','buldogue','persa','maine coon','pug','shar-pei','golden','labrador','pastor','dachshund','rottweiler','yorkshire'];

function racasSensiveis() {
  const raw = vault.carregar('Plamev/Recomendacao-Plano.md', '');
  if (!raw) return RACAS_SENSIVEIS_FALLBACK;
  const bloco = raw.match(/##\s*Raças sensíveis[\s\S]*?\n([\s\S]*?)(?=\n##\s|$)/i);
  if (!bloco) return RACAS_SENSIVEIS_FALLBACK;
  const racas = [...bloco[1].matchAll(/^\s*[-*]\s*`?([\p{L}\s/\-]+)`?/gmu)]
    .map(m => m[1].trim().toLowerCase())
    .filter(s => /\p{L}/u.test(s) && s.length > 1 && !s.includes('editar'));
  return racas.length ? racas : RACAS_SENSIVEIS_FALLBACK;
}

function definirPlano(perfil) {
  const idade = parseFloat(perfil?.idade_anos || 0);
  const raca  = (perfil?.raca || '').toLowerCase();
  const saude = perfil?.problema_saude || '';
  const sens  = racasSensiveis();
  if (/doente|cirurgia|internado|alergia|displasia|tratamento/i.test(saude)) return 'platinum';
  if (idade >= 7)  return 'platinum';
  if (sens.some(r => raca.includes(r)) && idade >= 5) return 'platinum';
  return 'advance';
}

// ── Buscar preços reais ──────────────────────────────────────────────────
// BD é ÚNICA fonte (20/04/2026 — Getúlio). Se BD falhar, retornar null;
// o caller decide se envia mensagem sem preço ou aborta. Nada de hardcode.
async function buscarPrecos(slug) {
  const rows = await db.query(
    `SELECT pr.valor, pr.valor_tabela, pr.valor_promocional, pr.valor_oferta, pr.valor_limite, p.nome
     FROM precos pr JOIN planos p ON p.id=pr.plano_id
     WHERE p.slug=$1 AND pr.modalidade='cartao' AND pr.ativo=true AND p.ativo=true`,
    [slug]
  ).catch(() => []);
  if (!rows[0]) return null;

  const fmt = (v) => (v == null || v === '') ? null : `R$${Number(v).toFixed(2).replace('.', ',')}`;
  return {
    nome:        rows[0].nome,
    preco:       fmt(rows[0].valor),
    tabela:      fmt(rows[0].valor_tabela),
    promocional: fmt(rows[0].valor_promocional),
    oferta:      fmt(rows[0].valor_oferta),
    limite:      fmt(rows[0].valor_limite),
  };
}

// ── Gerar mensagem via Haiku — sem texto fixo ────────────────────────────
async function gerarViaHaiku(prompt) {
  // Extrai só o bloco "## SYSTEM" do .md (o resto do arquivo é contexto/templates)
  const raw = vault.carregar('Mari/Apresentacao-Prompt.md', SYSTEM_APRESENTACAO_FALLBACK);
  const matchSystem = raw.match(/##\s*SYSTEM\s*\n([\s\S]*?)(?=\n##\s|$)/i);
  const system = matchSystem ? matchSystem[1].trim() : SYSTEM_APRESENTACAO_FALLBACK;

  const body = JSON.stringify({
    model: 'claude-haiku-4-5', max_tokens: 180,
    system,
    messages: [{ role: 'user', content: prompt }]
  });
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d).content?.[0]?.text || null); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.write(body); req.end();
  });
}

// ── Abertura para lead sem dados do pet ─────────────────────────────────
// [COMPORTAMENTO MARI] Abertura dinâmica por Haiku — nunca frase fixa — 16/04/2026 12:30
// [PREÇOS] BD é única fonte — 20/04/2026
async function construirAberturaValor(nomeCliente) {
  const slim = await buscarPrecos('slim');
  const adv  = await buscarPrecos('advance');

  // Se BD falhou, abrir sem preço — melhor omitir do que inventar.
  if (!slim || !adv) {
    console.warn('[APRESENTACAO] BD não retornou preços — abrindo sem valor');
    const msg = await gerarViaHaiku(`Escreva UMA mensagem curta de abertura para um lead de anúncio de plano de saúde pet.
- NÃO citar preço (BD indisponível no momento)
- Mencionar: planos a partir do básico, sem coparticipação, cobre exames/cirurgia/internação no mais escolhido
- CTA: perguntar raça e idade do pet
- NUNCA nome do cliente. NUNCA travessão. Máx 3 linhas.`);
    return msg || `Oi! 😊 Temos planos sem coparticipação, o mais escolhido já cobre exames, cirurgias e internação.\n\nQual a raça e a idade do seu pet?`;
  }

  const hora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false });
  const periodo = parseInt(hora) < 12 ? 'manhã' : parseInt(hora) < 18 ? 'tarde' : 'noite';

  // Usa os preços reais do BD, no formato de ~tabela~ por *promocional* (WhatsApp single-char)
  const linhaSlim = slim.tabela && slim.promocional
    ? `~${slim.tabela}~ por *${slim.promocional}*/mês`
    : `*${slim.preco}/mês*`;

  const prompt = `Escreva UMA mensagem de abertura para um lead de anúncio de plano de saúde pet.

Dados reais (vindos do BD):
- Planos a partir de ${linhaSlim}, sem coparticipação
- O mais escolhido cobre exames, cirurgias e internação
- Período: ${periodo}

Estrutura obrigatória (máx 3 linhas):
1. Abertura leve e variada
2. "planos a partir de ${linhaSlim}" + sem coparticipação + "o mais escolhido cobre exames, cirurgia e internação"
3. CTA: perguntar raça e idade do pet

Regras OBRIGATÓRIAS:
- NUNCA usar o nome do cliente
- USAR o formato ~~tabela~~ por *promocional* (não omitir o riscado)
- Falar "planos a partir de" — não nomear o plano Slim
- Falar "o mais escolhido" ou "o mais contratado" — não nomear o Advance
- Máximo 3 linhas, casual, sem travessão
- NÃO perguntar "cachorro ou gato?" — perguntar raça e idade`;

  const msg = await gerarViaHaiku(prompt);
  if (msg) return msg;

  // Fallback só se Haiku falhar — usa preços reais do BD
  return `Planos a partir de ${linhaSlim}, sem coparticipação. O mais escolhido já cobre exames, cirurgias e internação.\n\nQual a raça e a idade do seu pet?`;
}

// ── Recomendação com perfil conhecido ────────────────────────────────────
async function construirRecomendacao(perfil, conversaId) {
  const plano   = definirPlano(perfil);
  const p       = await buscarPrecos(plano);
  // Se BD falhou, não inventar — retorna null pro caller pular
  if (!p) {
    console.warn(`[APRESENTACAO] BD não retornou preços pro plano ${plano} — pulando recomendação`);
    return null;
  }
  const nomePet = perfil?.nome && perfil.nome !== '?' ? perfil.nome : null;
  const idade   = parseFloat(perfil?.idade_anos || 0);
  const raca    = perfil?.raca || '';
  const saude   = perfil?.problema_saude || '';

  if (conversaId) {
    await db.run('UPDATE conversas SET plano_recomendado=$1 WHERE id=$2', [plano, conversaId]).catch(() => {});
  }

  // Justificativa baseada em dados reais
  let razao = '';
  if (saude && !/não|nao/i.test(saude))  razao = `com o histórico de saúde`;
  else if (idade >= 7)                   razao = `com ${idade} anos`;
  else if (idade >= 3)                   razao = `na faixa dos ${Math.floor(idade)} anos`;
  else if (raca)                         razao = `pra ${raca}`;
  else                                   razao = '';

  const coberturas = plano === 'platinum'
    ? 'cobre consultas, exames completos, cirurgias, especialistas e muito mais'
    : 'cobre consultas, exames completos, cirurgias e internação';

  const linhaPreco = `~${p.tabela}/mês~ por *${p.preco}/mês* no cartão`;

  const prompt = `Escreva UMA mensagem de recomendação de plano de saúde pet.

Dados reais:
- Pet: ${nomePet || 'sem nome definido'}${raca ? ', ' + raca : ''}${idade ? ', ' + idade + ' anos' : ''}
- Plano recomendado: *${p.nome}*
- Razão: ${razao || 'é o ideal para esse perfil'}
- Coberturas: ${coberturas}
- Preço: ${linhaPreco}

Estrutura obrigatória:
1. Direcionamento com razão (1 frase, use os dados reais)
2. Benefício principal em 1 linha
3. Preço (exatamente como está acima, com riscado)
4. CTA direto ("faz sentido pra você?" ou variação)

Regras:
- Máximo 4 linhas
- Tom casual, WhatsApp, sem travessão
- Use \n para separar linhas dentro da mensagem
- Preço sempre em linha própria: \n*R$XX,XX/mês*\n
- CTA sempre em linha própria no final
- Varie a estrutura e o tom`;

  const msg = await gerarViaHaiku(prompt);
  if (msg) return { plano, mensagem: msg };

  // Fallback
  const abertura = nomePet ? `Pra ${nomePet}${razao ? ', ' + razao : ''}, o *${p.nome}* é o ideal 😊` : `O *${p.nome}* é o ideal${razao ? ', ' + razao : ''} 😊`;
  return { plano, mensagem: `${abertura}\n${coberturas}.\n\n💰 ${linhaPreco}\n\nFaz sentido pra você?` };
}

// ── Apresentar — entrada principal ───────────────────────────────────────
async function apresentarPlanos(msg, score = 0, conversaId = null) {
  const perfil   = conversaId ? await buscarPerfil(conversaId) : null;
  const temDados = perfil && (perfil.nome || perfil.especie || perfil.raca || perfil.idade_anos);

  if (!temDados) {
    // Buscar nome do cliente para personalizar
    const conversa = conversaId ? await db.one('SELECT client_id FROM conversas WHERE id=$1', [conversaId]).catch(() => null) : null;
    const cliente  = conversa ? await db.one('SELECT nome FROM clientes WHERE id=$1', [conversa.client_id]).catch(() => null) : null;
    const nome = cliente?.nome && cliente.nome !== 'Cliente' ? cliente.nome.split(' ')[0] : null;

    const msgAbertura = await construirAberturaValor(nome);
    await enviarEvo(msg, msgAbertura, conversaId);
    console.log(`[PLANOS] ✅ Abertura dinâmica → ${msg.phone}`);
    return;
  }

  const recomendacao = await construirRecomendacao(perfil, conversaId);
  if (!recomendacao) {
    console.warn(`[PLANOS] ❌ Recomendação abortada (BD indisponível) — ${msg.phone}`);
    return;
  }
  const { plano, mensagem } = recomendacao;
  await enviarEvo(msg, mensagem, conversaId);

  // Plus só com gatilho real — valor DELTA sempre do BD
  const precisaCastrar = perfil.castrado === false;
  const temTartaro     = /tártaro|tartar|dental/i.test(perfil?.problema_saude || '');
  if (precisaCastrar || temTartaro) {
    await new Promise(r => setTimeout(r, 4000));
    const nomePet = perfil?.nome || 'seu pet';

    // Busca preço base e plus no BD pra calcular delta real (não hardcoded)
    const precosComparacao = await db.query(
      `SELECT p.slug, pr.valor FROM precos pr JOIN planos p ON p.id=pr.plano_id
       WHERE p.slug IN ($1, $2) AND pr.modalidade='cartao' AND pr.ativo=true AND p.ativo=true`,
      [plano, plano + '_plus']
    ).catch(() => []);

    const valBase = precosComparacao.find(r => r.slug === plano)?.valor;
    const valPlus = precosComparacao.find(r => r.slug === plano + '_plus')?.valor;

    if (valBase && valPlus) {
      const delta = Number(valPlus) - Number(valBase);
      const fmt = v => `R$${Number(v).toFixed(2).replace('.', ',')}`;
      await enviarEvo(msg,
        `Ah, e como ${nomePet} ainda vai castrar: tem o *Plus* que já inclui *castração, limpeza de tártaro e sedação* por *+${fmt(delta)}/mês* (total ${fmt(valPlus)}/mês). Quer incluir?`,
        conversaId
      );
    } else {
      // BD falhou — oferta sem número específico
      await enviarEvo(msg,
        `Ah, e como ${nomePet} ainda vai castrar: tem o *Plus* que já inclui *castração, limpeza de tártaro e sedação*. Quer incluir?`,
        conversaId
      );
    }
  }

  // Oferecer PDF se disponível
  verificarEOferecerPDF(msg, conversaId, plano).catch(() => {});
  console.log(`[PLANOS] ✅ Recomendação dinâmica: ${plano} → ${msg.phone}`);
}

// ── Recomendação pós-dúvidas ─────────────────────────────────────────────
async function gerarRecomendacao(conversaId, msg) {
  const perfil = await buscarPerfil(conversaId);
  const recomendacao = await construirRecomendacao(perfil, conversaId);
  if (!recomendacao) {
    console.warn(`[PLANOS] gerarRecomendacao abortada (BD indisponível)`);
    return;
  }
  const { mensagem } = recomendacao;
  await sender.enviar(msg, mensagem);
  if (conversaId) await db.salvarMensagem(conversaId, 'agent', mensagem, 'ia').catch(() => {});
}


// ── Verificar e oferecer PDF após recomendação ────────────────────────────
async function verificarEOferecerPDF(msg, conversaId, planoSlug) {
  const pdf = await db.one('SELECT * FROM planos_pdfs WHERE plano_slug=$1', [planoSlug]).catch(() => null);
  if (!pdf) return;

  const jaOferecido = await db.one('SELECT pdf_oferecido FROM conversas WHERE id=$1', [conversaId])
    .then(r => r?.pdf_oferecido).catch(() => false);
  if (jaOferecido) return;

  await db.run('UPDATE conversas SET pdf_oferecido=true WHERE id=$1', [conversaId]).catch(() => {});

  const nomesPlanos = { slim: 'Slim', advance: 'Advance', platinum: 'Platinum', diamond: 'Diamond', plus: 'Plus' };
  const nomePlano = nomesPlanos[planoSlug] || planoSlug;

  await new Promise(r => setTimeout(r, 3000));
  await enviarEvo(msg, `Quer que eu te mande o manual completo de coberturas do *${nomePlano}*? 📋`, conversaId);
}

module.exports = { apresentarPlanos, gerarRecomendacao, buscarTemplate, definirPlanoRecomendado: definirPlano, verificarEOferecerPDF };
