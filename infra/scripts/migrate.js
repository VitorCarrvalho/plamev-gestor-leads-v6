/**
 * db/index.js — Wrapper PostgreSQL
 * Único ponto de acesso ao banco. Nunca chamar pg diretamente fora daqui.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');

// Garantir que DATABASE_URL está definida
const DB_URL = process.env.DATABASE_URL || 'postgresql://geta@localhost:5432/mariv3';
const pool = new Pool({ connectionString: DB_URL });

pool.on('error', (err) => console.error('[DB] Erro no pool:', err.message));

// ── Primitivos ──────────────────────────────────────────────
const query = (sql, params) => pool.query(sql, params).then(r => r.rows);
const one   = (sql, params) => pool.query(sql, params).then(r => r.rows[0] || null);
const run   = (sql, params) => pool.query(sql, params).then(r => r);

// ── Clientes ─────────────────────────────────────────────────
async function buscarOuCriarCliente(identificador, tipo = 'phone', nome = null, origem = null) {
  // 1. Buscar por identificador
  const ident = await one(
    'SELECT client_id FROM identificadores_cliente WHERE tipo=$1 AND valor=$2',
    [tipo, identificador]
  );
  if (ident) return one('SELECT * FROM clientes WHERE id=$1', [ident.client_id]);

  // 2. Criar novo cliente
  const cliente = await one(
    'INSERT INTO clientes (nome, origem) VALUES ($1, $2) RETURNING *',
    [nome || 'Cliente', origem || 'direto']
  );
  await run(
    'INSERT INTO identificadores_cliente (client_id, tipo, valor) VALUES ($1, $2, $3)',
    [cliente.id, tipo, identificador]
  );
  return cliente;
}

// ── Conversas ─────────────────────────────────────────────────
async function buscarOuCriarConversa(clientId, agentId, canal, numeroExterno, jid = null, instancia = null) {
  // [COMPORTAMENTO MARI] Conversa é única por (client, agent, canal, instancia) — 16/04/2026 22:22
  // Cada chip é um canal de venda independente — mesmo número, chips diferentes = conversas diferentes
  const existente = await one(
    `SELECT * FROM conversas 
     WHERE client_id=$1 AND agent_id=$2 AND canal=$3 AND status='ativa'
       AND (instancia_whatsapp=$4 OR (instancia_whatsapp IS NULL AND $4 IS NULL))
     ORDER BY criado_em DESC
     LIMIT 1`,
    [clientId, agentId, canal, instancia || null]
  );
  if (existente) return existente;

  // Criar nova
  const dt = new Date();
  const yymmdd = String(dt.getFullYear()).slice(-2) +
    String(dt.getMonth()+1).padStart(2,'0') +
    String(dt.getDate()).padStart(2,'0');
  const numeroCotacao = 'PLM-' + yymmdd + '-' + (Math.floor(Math.random()*9000)+1000);

  return one(
    `INSERT INTO conversas (client_id, agent_id, canal, numero_externo, jid, numero_cotacao, instancia_whatsapp, sender_chip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [clientId, agentId, canal, numeroExterno, jid, numeroCotacao, instancia, null]
  );
}

async function buscarHistorico(conversaId, limite = null) {
  // limite=0 ou null = sem limite (busca tudo)
  if (!limite) {
    return query(
      `SELECT role, conteudo, enviado_por, timestamp
       FROM mensagens WHERE conversa_id=$1
       ORDER BY timestamp ASC`,
      [conversaId]
    );
  }
  return query(
    `SELECT role, conteudo, enviado_por, timestamp
     FROM mensagens WHERE conversa_id=$1
     ORDER BY timestamp DESC LIMIT $2`,
    [conversaId, limite]
  ).then(rows => rows.reverse());
}

async function salvarMensagem(conversaId, role, conteudo, enviadoPor = 'ia', msgIdExterno = null, obsidianArquivos = null) {
  return one(
    `INSERT INTO mensagens (conversa_id, role, conteudo, enviado_por, msg_id_externo, obsidian_arquivos)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [conversaId, role, conteudo, enviadoPor, msgIdExterno, obsidianArquivos || null]
  );
}

async function atualizarConversa(conversaId, dados) {
  const campos = Object.keys(dados).map((k, i) => `${k}=$${i+2}`).join(', ');
  return run(
    `UPDATE conversas SET ${campos}, ultima_interacao=NOW() WHERE id=$1`,
    [conversaId, ...Object.values(dados)]
  );
}

// ── Perfil ─────────────────────────────────────────────────────
async function buscarOuCriarPerfil(clientId) {
  const existe = await one('SELECT * FROM perfil_pet WHERE client_id=$1', [clientId]);
  if (existe) return existe;
  return one(
    'INSERT INTO perfil_pet (client_id) VALUES ($1) RETURNING *',
    [clientId]
  );
}

async function atualizarPerfil(clientId, dados) {
  const campos = Object.keys(dados).map((k, i) => `${k}=$${i+2}`).join(', ');
  const existe = await one('SELECT id FROM perfil_pet WHERE client_id=$1', [clientId]);
  if (existe) {
    return run(
      `UPDATE perfil_pet SET ${campos}, atualizado_em=NOW() WHERE client_id=$1`,
      [clientId, ...Object.values(dados)]
    );
  }
  const keys = ['client_id', ...Object.keys(dados)].join(', ');
  const phs  = Array(Object.keys(dados).length + 1).fill(0).map((_,i)=>`$${i+1}`).join(', ');
  return run(
    `INSERT INTO perfil_pet (${keys}) VALUES (${phs})`,
    [clientId, ...Object.values(dados)]
  );
}

// ── Produto (consultas para o orquestrador) ─────────────────────
async function buscarCobertura(planoSlug, nomeProcedimento) {
  return one(
    `SELECT p.nome as plano, pr.nome as procedimento,
            c.carencia_dias, c.limite_uso, c.periodicidade
     FROM coberturas c
     JOIN planos p ON p.id = c.plano_id
     JOIN procedimentos pr ON pr.id = c.procedimento_id
     WHERE p.slug = $1
       AND pr.nome ILIKE $2
     LIMIT 1`,
    [planoSlug, `%${nomeProcedimento}%`]
  );
}

async function buscarCoberturasTodos(nomeProcedimento) {
  return query(
    `SELECT p.slug, p.nome as plano,
            c.carencia_dias, c.limite_uso, c.periodicidade
     FROM coberturas c
     JOIN planos p ON p.id = c.plano_id
     JOIN procedimentos pr ON pr.id = c.procedimento_id
     WHERE pr.nome ILIKE $1
     ORDER BY p.id`,
    [`%${nomeProcedimento}%`]
  );
}

// Retorna AS 4 FAIXAS por modalidade (Tabela, Promocional, Oferta, Limite)
// + valor vigente. BD é fonte única — qualquer hardcode em JS/Obsidian foi
// removido em 20/04/2026 por instrução do Getúlio.
async function buscarPrecos(planoSlug = null) {
  const sql = planoSlug
    ? `SELECT p.slug, p.nome, pr.modalidade,
              pr.valor, pr.valor_tabela, pr.valor_promocional,
              pr.valor_oferta, pr.valor_limite
       FROM precos pr JOIN planos p ON p.id=pr.plano_id
       WHERE p.slug=$1 AND pr.ativo=true AND p.ativo=true
       ORDER BY pr.modalidade`
    : `SELECT p.slug, p.nome, pr.modalidade,
              pr.valor, pr.valor_tabela, pr.valor_promocional,
              pr.valor_oferta, pr.valor_limite
       FROM precos pr JOIN planos p ON p.id=pr.plano_id
       WHERE pr.ativo=true AND p.ativo=true
       ORDER BY p.id, pr.modalidade`;
  return query(sql, planoSlug ? [planoSlug] : []);
}

async function buscarRegraComercial(chave) {
  const r = await one('SELECT valor FROM regras_comerciais WHERE chave=$1', [chave]);
  return r?.valor || null;
}

// ── Contexto relacional da Mari ─────────────────────────────────
async function buscarContextoRelacional(agentId, tags = []) {
  if (!tags.length) return [];
  return query(
    `SELECT nome, tipo, relacao, especie, raca, historia, tags
     FROM contexto_relacional
     WHERE agent_id=$1 AND ativo=true
       AND tags && $2::text[]
     LIMIT 2`,
    [agentId, tags]
  );
}

// ── Deduplicação ────────────────────────────────────────────────
async function jaProcessou(msgId, canal) {
  const chave = `${canal}:${msgId}`;
  const existe = await one(
    'SELECT id FROM mensagens WHERE msg_id_externo=$1 LIMIT 1',
    [chave]
  );
  return !!existe;
}

// ── Agente ─────────────────────────────────────────────────────
async function buscarAgente(slug) {
  return one('SELECT * FROM agentes WHERE slug=$1 AND ativo=true', [slug]);
}

// ── Instruções ativas ───────────────────────────────────────────
async function buscarInstrucaoAtiva(conversaId) {
  return one(
    `SELECT instrucao FROM instrucoes_ativas
     WHERE conversa_id=$1 AND ativa=true
       AND (expira_em IS NULL OR expira_em > NOW())
     ORDER BY criado_em DESC LIMIT 1`,
    [conversaId]
  );
}

// ── Custos ─────────────────────────────────────────────────────
async function registrarCusto(conversaId, agentId, modelo, inputTok, outputTok) {
  const custo = ((inputTok * 0.0008) + (outputTok * 0.004)) / 1000;
  return run(
    `INSERT INTO custos_ia (conversa_id, agent_id, modelo, input_tokens, output_tokens, custo_usd)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [conversaId, agentId, modelo, inputTok, outputTok, custo]
  );
}

async function testar() {
  const r = await one('SELECT COUNT(*) as total FROM planos');
  console.log('[DB] ✅ Conectado — planos:', r.total);
}


// ── Indicações ───────────────────────────────────────────────
async function registrarIndicacao(phoneIndicador, nomeIndicador, phoneIndicado, nomeIndicado, opts = {}) {
  return one(
    `SELECT registrar_indicacao($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS id`,
    [phoneIndicador, nomeIndicador, phoneIndicado, nomeIndicado,
     opts.nomePet||null, opts.especie||null, opts.raca||null,
     opts.horario||'agora', opts.origem||null, opts.conversaId||null]
  );
}

async function registrarTentativaIndicacao(id) {
  return run('SELECT registrar_tentativa_indicacao($1)', [id]);
}

async function converterIndicacao(id, plano = null) {
  return run('SELECT converter_indicacao($1,$2)', [id, plano]);
}

async function buscarIndicacoesPendentes() {
  return query(
    `SELECT * FROM indicacoes 
     WHERE status IN ('pendente','contatado') 
       AND tentativas < 5
     ORDER BY criado_em ASC`,
    []
  );
}

module.exports = {
  pool, query, one, run,
  buscarOuCriarCliente, buscarOuCriarConversa, buscarHistorico,
  salvarMensagem, atualizarConversa,
  buscarOuCriarPerfil, atualizarPerfil,
  buscarTemplateApresentacao,
  buscarApresentacaoPlano,
  getConfig, getConfigNum, getConfigBool, buscarConfig,
  buscarCobertura, buscarCoberturasTodos, buscarPrecos, buscarRegraComercial,
  buscarContextoRelacional, jaProcessou,
  buscarAgente, buscarInstrucaoAtiva, registrarCusto, testar,
  registrarIndicacao, registrarTentativaIndicacao, converterIndicacao, buscarIndicacoesPendentes
};

// ── Templates de apresentação de plano ──────────────────────
async function buscarTemplateApresentacao(planoSlug) {
  const tmpl = await one(
    `SELECT pt.template, 
            MAX(CASE WHEN pr.modalidade='cartao' THEN pr.valor END) AS preco_cartao,
            MAX(CASE WHEN pr.modalidade='boleto' THEN pr.valor END) AS preco_boleto,
            MAX(CASE WHEN pr.modalidade='pix'    THEN pr.valor END) AS preco_pix,
            p.nome AS nome_plano
     FROM plano_templates pt
     JOIN planos p ON p.slug = pt.plano_slug
     JOIN precos pr ON pr.plano_id = p.id
     WHERE pt.plano_slug = $1 AND pt.tipo = 'apresentacao' AND pt.ativo = true
     GROUP BY pt.template, p.nome`,
    [planoSlug]
  );
  if (!tmpl) return null;
  return tmpl.template
    .replace(/\{\{preco_cartao\}\}/g, `R$ ${Number(tmpl.preco_cartao).toFixed(2).replace('.',',')}`)
    .replace(/\{\{preco_boleto\}\}/g, `R$ ${Number(tmpl.preco_boleto).toFixed(2).replace('.',',')}`)
    .replace(/\{\{preco_pix\}\}/g,    `R$ ${Number(tmpl.preco_pix).toFixed(2).replace('.',',')}`)
    .replace(/\{\{nome_plano\}\}/g,   tmpl.nome_plano);
}

// ── Texto de apresentação do plano (descricao_whatsapp + preço) ──────────────
// Retorna o texto completo pronto para enviar ao cliente no WhatsApp
async function buscarApresentacaoPlano(planoSlug) {
  const row = await one(
    `SELECT p.slug, p.nome, p.descricao_whatsapp,
            MAX(CASE WHEN pr.modalidade='cartao' THEN pr.valor END) AS preco_cartao,
            MAX(CASE WHEN pr.modalidade='boleto' THEN pr.valor END) AS preco_boleto,
            MAX(CASE WHEN pr.modalidade='pix'    THEN pr.valor END) AS preco_pix
     FROM planos p
     JOIN precos pr ON pr.plano_id = p.id
     WHERE p.slug = $1
     GROUP BY p.slug, p.nome, p.descricao_whatsapp`,
    [planoSlug]
  );
  if (!row || !row.descricao_whatsapp) return null;

  const fmt    = v => v ? `R$ ${Number(v).toFixed(2).replace('.',',')}` : '?';
  // Usar preços reais do BD — não calcular desconto fixo
  const tabela   = row.valor_tabela   || row.preco_cartao;  // preço de tabela (riscado)
  const campanha = row.preco_cartao;                         // preço de campanha (atual)
  const linhaPeco = `\n\n💰 ~~${fmt(tabela)}/mês~~ por *${fmt(campanha)}/mês* no cartão`;

  return row.descricao_whatsapp + linhaPeco;
}

// ── Configurações do sistema (mari_config) ───────────────────
let _configCache = null;
let _configTs    = 0;
const CONFIG_TTL = 60000; // 1 min de cache

async function getConfig(chave, valorPadrao = null) {
  // Renovar cache a cada 1 min
  if (!_configCache || Date.now() - _configTs > CONFIG_TTL) {
    const rows = await query('SELECT chave, valor FROM mari_config').catch(() => []);
    _configCache = {};
    rows.forEach(r => { _configCache[r.chave] = r.valor; });
    _configTs = Date.now();
  }
  const val = _configCache[chave];
  return val !== undefined ? val : valorPadrao;
}

async function getConfigNum(chave, padrao) {
  return parseFloat(await getConfig(chave, String(padrao))) || padrao;
}

async function getConfigBool(chave, padrao = true) {
  const v = await getConfig(chave, String(padrao));
  return v === 'true' || v === '1';
}

// Retorna todas as configs como objeto {chave: valor} — usa mesmo cache do getConfig
async function buscarConfig() {
  if (!_configCache || Date.now() - _configTs > CONFIG_TTL) {
    const rows = await query('SELECT chave, valor FROM mari_config').catch(() => []);
    _configCache = {};
    rows.forEach(r => { _configCache[r.chave] = r.valor; });
    _configTs = Date.now();
  }
  return { ..._configCache };
}
