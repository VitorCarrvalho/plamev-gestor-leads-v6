/**
 * obsidian-sync — Sincroniza vault Obsidian → banco Plamev
 *
 * Uso:
 *   node index.js          → modo watcher (fica rodando, sincroniza ao salvar)
 *   node index.js --once   → sincroniza tudo uma vez e encerra
 *
 * Estrutura esperada no vault:
 *
 *   {PROMPTS_FOLDER}/
 *     Soul.md              → agente_prompts tipo=soul
 *     Tom e Fluxo.md       → agente_prompts tipo=tom
 *     Regras Gerais.md     → agente_prompts tipo=regras
 *     Anti-Repeticao.md    → agente_prompts tipo=anti_repeticao
 *     Pensamentos.md       → agente_prompts tipo=pensamentos
 *     Modo Rapido.md       → agente_prompts tipo=modo_rapido
 *
 *   {KB_FOLDER}/
 *     Carencia.md          → knowledge_base_docs pasta=KB_FOLDER_NAME arquivo=Carencia
 *     SubPasta/
 *       Documento.md       → knowledge_base_docs pasta=SubPasta arquivo=Documento
 *
 * Metadados opcionais via frontmatter YAML no topo do arquivo .md:
 *   ---
 *   etapas: ["acolhimento", "apresentacao_planos"]
 *   sempre_ativo: true
 *   titulo: Título do documento
 *   ordem: 10
 *   ---
 */

require('dotenv').config();
const chokidar = require('chokidar');
const { Pool }  = require('pg');
const fs        = require('fs');
const path      = require('path');

// ── Configuração ────────────────────────────────────────────────
const DATABASE_URL   = process.env.DATABASE_URL;
const VAULT_PATH     = process.env.OBSIDIAN_VAULT_PATH;
const AGENT_ID       = Number(process.env.AGENT_ID);
const PROMPTS_FOLDER = process.env.PROMPTS_FOLDER || 'Plamev/Mari';
const KB_FOLDER      = process.env.KB_FOLDER      || 'Plamev/Base de Conhecimento';
const ONCE_MODE      = process.argv.includes('--once');

if (!DATABASE_URL || !VAULT_PATH || !AGENT_ID) {
  console.error('❌ Configure DATABASE_URL, OBSIDIAN_VAULT_PATH e AGENT_ID no .env');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ── Mapeamento filename → tipo no banco ─────────────────────────
const PROMPT_MAP = {
  'Soul.md':            'soul',
  'Tom e Fluxo.md':     'tom',
  'Regras Gerais.md':   'regras',
  'Anti-Repeticao.md':  'anti_repeticao',
  'Anti-Repetição.md':  'anti_repeticao',
  'Pensamentos.md':     'pensamentos',
  'Modo Rapido.md':     'modo_rapido',
  'Modo Rápido.md':     'modo_rapido',
};

// ── Parseia frontmatter YAML simples ────────────────────────────
function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };

  const meta = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (!kv) continue;
    const [, key, val] = kv;
    if (val.startsWith('[')) {
      try { meta[key] = JSON.parse(val); } catch { meta[key] = val; }
    } else if (val === 'true')  meta[key] = true;
    else if (val === 'false') meta[key] = false;
    else if (!isNaN(Number(val))) meta[key] = Number(val);
    else meta[key] = val.replace(/^["']|["']$/g, '');
  }
  return { meta, body: match[2] };
}

function timestamp() {
  return new Date().toLocaleTimeString('pt-BR');
}

// ── Sync: prompt (soul, tom, regras…) ──────────────────────────
async function syncPrompt(filePath) {
  const filename = path.basename(filePath);
  const tipo = PROMPT_MAP[filename];
  if (!tipo) return false;

  const raw = fs.readFileSync(filePath, 'utf-8');
  const { body } = parseFrontmatter(raw);
  const conteudo = body.trim();
  if (!conteudo) return false;

  await pool.query(
    `INSERT INTO agente_prompts (agent_id, tipo, conteudo, ativo, atualizado_em)
     VALUES ($1, $2, $3, TRUE, NOW())
     ON CONFLICT (agent_id, tipo) DO UPDATE
       SET conteudo = EXCLUDED.conteudo, ativo = TRUE, atualizado_em = NOW()`,
    [AGENT_ID, tipo, conteudo],
  );
  console.log(`[${timestamp()}] ✅ PROMPT  ${filename} → tipo=${tipo} (${conteudo.length} chars)`);
  return true;
}

// ── Sync: knowledge base doc ────────────────────────────────────
async function syncKbDoc(filePath) {
  const kbRoot  = path.join(VAULT_PATH, KB_FOLDER);
  const rel     = path.relative(kbRoot, filePath);
  const parts   = rel.split(path.sep);
  const arquivo = path.basename(parts[parts.length - 1], '.md');
  const pasta   = parts.length > 1 ? parts[parts.length - 2] : path.basename(KB_FOLDER);

  const raw = fs.readFileSync(filePath, 'utf-8');
  const { meta, body } = parseFrontmatter(raw);
  const conteudo = body.trim();
  if (!conteudo) return false;

  const titulo       = meta.titulo    || arquivo;
  const etapas       = meta.etapas    || [];
  const sempreAtivo  = meta.sempre_ativo !== false; // default true
  const ordem        = meta.ordem     || 0;

  await pool.query(
    `INSERT INTO knowledge_base_docs
       (agent_id, pasta, arquivo, titulo, conteudo, etapas, sempre_ativo, ordem, ativo, atualizado_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, NOW())
     ON CONFLICT (agent_id, pasta, arquivo) DO UPDATE
       SET titulo       = EXCLUDED.titulo,
           conteudo     = EXCLUDED.conteudo,
           etapas       = EXCLUDED.etapas,
           sempre_ativo = EXCLUDED.sempre_ativo,
           ordem        = EXCLUDED.ordem,
           ativo        = TRUE,
           atualizado_em = NOW()`,
    [AGENT_ID, pasta, arquivo, titulo, conteudo, etapas, sempreAtivo, ordem],
  );
  console.log(`[${timestamp()}] ✅ KB DOC  ${pasta}/${arquivo} (${conteudo.length} chars, sempre_ativo=${sempreAtivo})`);
  return true;
}

// ── Roteador: decide qual sync chamar ───────────────────────────
const promptsRoot = path.join(VAULT_PATH, PROMPTS_FOLDER);
const kbRoot      = path.join(VAULT_PATH, KB_FOLDER);

async function handleFile(filePath) {
  if (!filePath.endsWith('.md') || !fs.existsSync(filePath)) return;

  try {
    if (filePath.startsWith(promptsRoot)) {
      await syncPrompt(filePath);
    } else if (filePath.startsWith(kbRoot)) {
      await syncKbDoc(filePath);
    }
  } catch (e) {
    console.error(`[${timestamp()}] ❌ Erro ao sincronizar ${path.basename(filePath)}:`, e.message);
  }
}

// ── Modo --once: sincroniza tudo e encerra ──────────────────────
async function syncAll() {
  const glob = (dir) => fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(f => f.isFile() && f.name.endsWith('.md'))
    .map(f => path.join(f.parentPath || f.path || dir, f.name));

  const allFiles = [
    ...(fs.existsSync(promptsRoot) ? glob(promptsRoot) : []),
    ...(fs.existsSync(kbRoot)      ? glob(kbRoot)      : []),
  ];

  console.log(`🔄 Sincronizando ${allFiles.length} arquivo(s)…`);
  for (const f of allFiles) await handleFile(f);
  console.log('✅ Sincronização completa.');
  await pool.end();
}

// ── Modo watcher: observa mudanças em tempo real ────────────────
function startWatcher() {
  const watchPaths = [
    path.join(promptsRoot, '*.md'),
    path.join(kbRoot, '**', '*.md'),
  ];

  console.log('👁  Observando vault do Obsidian…');
  console.log(`   Prompts : ${promptsRoot}`);
  console.log(`   KB      : ${kbRoot}`);
  console.log('   Salve qualquer arquivo .md para sincronizar automaticamente.\n');

  chokidar
    .watch(watchPaths, { ignoreInitial: false, awaitWriteFinish: { stabilityThreshold: 400 } })
    .on('add',    handleFile)
    .on('change', handleFile)
    .on('error',  (e) => console.error('❌ Watcher error:', e));
}

// ── Entrada ─────────────────────────────────────────────────────
if (ONCE_MODE) {
  syncAll().catch((e) => { console.error(e); process.exit(1); });
} else {
  startWatcher();
}
