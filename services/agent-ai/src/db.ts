/**
 * db/index.ts — Wrapper PostgreSQL (Agent AI)
 * Multi-tenancy habilitado (orgId obrigatório).
 */
import { config } from 'dotenv';
import { Pool } from 'pg';
import path from 'path';

config({ path: path.join(__dirname, '../.env') });

const DB_URL = process.env.DATABASE_URL || 'postgresql://geta@localhost:5432/mariv3';
export const pool = new Pool({ connectionString: DB_URL });

pool.on('error', (err) => console.error('[DB] Erro no pool:', err.message));

// ── Primitivos ──────────────────────────────────────────────
export const query = (sql: string, params?: any[]) => pool.query(sql, params).then(r => r.rows);
export const one   = (sql: string, params?: any[]) => pool.query(sql, params).then(r => r.rows[0] || null);
export const run   = (sql: string, params?: any[]) => pool.query(sql, params).then(r => r);

// ── Clientes ─────────────────────────────────────────────────
export async function buscarOuCriarCliente(orgId: string, identificador: string, tipo = 'phone', nome: string | null = null, origem: string | null = null) {
  const ident = await one(
    'SELECT client_id FROM identificadores_cliente WHERE tipo=$1 AND valor=$2',
    [tipo, identificador]
  );
  if (ident) return one('SELECT * FROM clientes WHERE id=$1 AND org_id=$2', [ident.client_id, orgId]);

  const cliente = await one(
    'INSERT INTO clientes (org_id, nome, origem) VALUES ($1, $2, $3) RETURNING *',
    [orgId, nome || 'Cliente', origem || 'direto']
  );
  await run(
    'INSERT INTO identificadores_cliente (client_id, tipo, valor) VALUES ($1, $2, $3)',
    [cliente.id, tipo, identificador]
  );
  return cliente;
}

// ── Conversas ─────────────────────────────────────────────────
export async function buscarOuCriarConversa(orgId: string, clientId: string, agentId: string, canal: string, numeroExterno: string, jid: string | null = null, instancia: string | null = null) {
  const existente = await one(
    `SELECT * FROM conversas 
     WHERE org_id=$1 AND client_id=$2 AND agent_id=$3 AND canal=$4 AND status='ativa'
       AND (instancia_whatsapp=$5 OR (instancia_whatsapp IS NULL AND $5 IS NULL))
     ORDER BY criado_em DESC
     LIMIT 1`,
    [orgId, clientId, agentId, canal, instancia || null]
  );
  if (existente) return existente;

  const dt = new Date();
  const yymmdd = String(dt.getFullYear()).slice(-2) +
    String(dt.getMonth()+1).padStart(2,'0') +
    String(dt.getDate()).padStart(2,'0');
  const numeroCotacao = 'PLM-' + yymmdd + '-' + (Math.floor(Math.random()*9000)+1000);

  return one(
    `INSERT INTO conversas (org_id, client_id, agent_id, canal, numero_externo, jid, numero_cotacao, instancia_whatsapp, sender_chip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [orgId, clientId, agentId, canal, numeroExterno, jid, numeroCotacao, instancia, null]
  );
}

export async function buscarHistorico(orgId: string, conversaId: string, limite: number | null = null) {
  if (!limite) {
    return query(
      `SELECT role, conteudo, enviado_por, timestamp
       FROM mensagens m
       JOIN conversas c ON c.id = m.conversa_id
       WHERE m.conversa_id=$1 AND c.org_id=$2
       ORDER BY timestamp ASC`,
      [conversaId, orgId]
    );
  }
  return query(
    `SELECT role, conteudo, enviado_por, timestamp
     FROM mensagens m
     JOIN conversas c ON c.id = m.conversa_id
     WHERE m.conversa_id=$1 AND c.org_id=$2
     ORDER BY timestamp DESC LIMIT $3`,
    [conversaId, orgId, limite]
  ).then((rows: any[]) => rows.reverse());
}

export async function salvarMensagem(orgId: string, conversaId: string, role: string, conteudo: string, enviadoPor = 'ia', msgIdExterno: string | null = null, obsidianArquivos: any = null) {
  return one(
    `INSERT INTO mensagens (conversa_id, role, conteudo, enviado_por, msg_id_externo, obsidian_arquivos)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [conversaId, role, conteudo, enviadoPor, msgIdExterno, obsidianArquivos || null]
  );
}

export async function atualizarConversa(orgId: string, conversaId: string, dados: Record<string, any>) {
  const chaves = Object.keys(dados);
  if (chaves.length === 0) return null;
  const campos = chaves.map((k, i) => `${k}=$${i+3}`).join(', ');
  return run(
    `UPDATE conversas SET ${campos}, ultima_interacao=NOW() WHERE id=$1 AND org_id=$2`,
    [conversaId, orgId, ...Object.values(dados)]
  );
}

// ── Perfil ─────────────────────────────────────────────────────
export async function buscarOuCriarPerfil(orgId: string, clientId: string) {
  const existe = await one('SELECT p.* FROM perfil_pet p JOIN clientes c ON c.id = p.client_id WHERE p.client_id=$1 AND c.org_id=$2', [clientId, orgId]);
  if (existe) return existe;
  return one(
    'INSERT INTO perfil_pet (client_id) VALUES ($1) RETURNING *',
    [clientId]
  );
}

export async function atualizarPerfil(orgId: string, clientId: string, dados: Record<string, any>, conversaId?: string) {
  const chaves = Object.keys(dados);
  if (chaves.length === 0) return null;
  const campos = chaves.map((k, i) => `${k}=$${i+3}`).join(', ');
  const existe = await one('SELECT id FROM perfil_pet WHERE client_id=$1', [clientId]);
  if (existe) {
    return run(
      `UPDATE perfil_pet SET ${campos}, atualizado_em=NOW() WHERE client_id=$1`,
      [clientId, orgId, ...Object.values(dados)]
    );
  }
  const keys = ['client_id', ...Object.keys(dados)].join(', ');
  const phs  = Array(Object.keys(dados).length + 1).fill(0).map((_,i)=>`$${i+1}`).join(', ');
  return run(
    `INSERT INTO perfil_pet (${keys}) VALUES (${phs})`,
    [clientId, ...Object.values(dados)]
  );
}

// ── Agente ─────────────────────────────────────────────────────
export async function buscarAgente(orgId: string, slug: string) {
  return one('SELECT * FROM agentes WHERE org_id=$1 AND slug=$2 AND ativo=true', [orgId, slug]);
}

// ── Outros (Simplificados para compilar) ──────────────────────
export async function registrarCusto(orgId: string, conversaId: string, agentId: string, modelo: string, inputTok: number, outputTok: number) {
  const custo = ((inputTok * 0.0008) + (outputTok * 0.004)) / 1000;
  return run(
    `INSERT INTO custos_ia (conversa_id, agent_id, modelo, input_tokens, output_tokens, custo_usd)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [conversaId, agentId, modelo, inputTok, outputTok, custo]
  );
}

export async function buscarOuCriarContato(orgId: string, phone: string, nome: string) {
  return buscarOuCriarCliente(orgId, phone, 'phone', nome);
}

export async function getConfig(orgId: string, chave: string, valorPadrao: any = null) {
  const config = await one('SELECT valor FROM mari_config WHERE org_id=$1 AND chave=$2', [orgId, chave]);
  return config ? config.valor : valorPadrao;
}

export async function buscarConfig(orgId: string) {
  const rows = await query('SELECT chave, valor FROM mari_config WHERE org_id=$1', [orgId]);
  return rows.reduce((acc: any, row: any) => ({...acc, [row.chave]: row.valor}), {});
}

export async function buscarCoberturasTodos(orgId: string, proc: string) {
  // Simples stub
  return [];
}

export async function buscarPrecos(orgId: string, planoSlug?: string) {
  return [];
}

export async function buscarContextoRelacional(orgId: string, agentId: string, tags: string[]) {
  return [];
}

export async function buscarInstrucaoAtiva(orgId: string, conversaId: string) {
  return null;
}

export async function buscarPrompts(agentId: number): Promise<Record<string, string>> {
  const rows = await query(
    `SELECT tipo, conteudo FROM agente_prompts WHERE agent_id=$1 AND ativo=TRUE AND conteudo <> ''`,
    [agentId]
  );
  return rows.reduce((acc: any, row: any) => ({ ...acc, [row.tipo]: row.conteudo }), {});
}

export interface KbDoc { pasta: string; arquivo: string; conteudo: string; }

export async function buscarKnowledge(agentId: number, etapa: string, extrasPath: string[]): Promise<KbDoc[]> {
  const rows = await query(
    `SELECT pasta, arquivo, conteudo
     FROM knowledge_base_docs
     WHERE agent_id = $1
       AND ativo = TRUE
       AND conteudo <> ''
       AND (
         sempre_ativo = TRUE
         OR $2 = ANY(etapas)
         OR (pasta || '/' || arquivo) = ANY($3::text[])
       )
     ORDER BY sempre_ativo DESC, ordem ASC, pasta ASC`,
    [agentId, etapa, extrasPath]
  ) as any[];
  return rows;
}
