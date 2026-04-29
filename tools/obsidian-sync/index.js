/**
 * obsidian-sync — Sincroniza vault Obsidian → services/vault-server/vault/ → git push
 *
 * Uso:
 *   node index.js          → modo watcher (fica rodando, sincroniza ao salvar)
 *   node index.js --once   → copia tudo uma vez e encerra (não faz push automático)
 *
 * Fluxo:
 *   1. Detecta mudança em arquivo .md no OBSIDIAN_VAULT_PATH
 *   2. Copia o arquivo para o caminho equivalente em REPO_VAULT_PATH
 *   3. git add + git commit + git push no repositório
 *   4. Railway detecta o push e rebuilda só o vault-server (~30s)
 *   5. agent-ai busca o arquivo atualizado no próximo request (cache 60s)
 */

require('dotenv').config();
const chokidar  = require('chokidar');
const fs        = require('fs');
const path      = require('path');
const https     = require('https');
const http      = require('http');
const { execSync } = require('child_process');

// ── Configuração ────────────────────────────────────────────────
const OBSIDIAN_VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH;
const REPO_VAULT_PATH     = process.env.REPO_VAULT_PATH;
const AGENT_AI_URL        = process.env.AGENT_AI_URL; // ex: https://agent-ai.railway.app
const INTERNAL_SECRET     = process.env.INTERNAL_SECRET || 'plamev-internal';
const AGENT_ID            = process.env.AGENT_ID || '1';
const ONCE_MODE           = process.argv.includes('--once');

if (!OBSIDIAN_VAULT_PATH || !REPO_VAULT_PATH) {
  console.error('❌ Configure OBSIDIAN_VAULT_PATH e REPO_VAULT_PATH no .env');
  process.exit(1);
}

if (!fs.existsSync(OBSIDIAN_VAULT_PATH)) {
  console.error(`❌ OBSIDIAN_VAULT_PATH não encontrado: ${OBSIDIAN_VAULT_PATH}`);
  process.exit(1);
}

if (!fs.existsSync(REPO_VAULT_PATH)) {
  console.error(`❌ REPO_VAULT_PATH não encontrado: ${REPO_VAULT_PATH}`);
  process.exit(1);
}

function timestamp() {
  return new Date().toLocaleTimeString('pt-BR');
}

// ── Copiar arquivo do Obsidian para o repo ──────────────────────
function copiarArquivo(srcPath) {
  const rel    = path.relative(OBSIDIAN_VAULT_PATH, srcPath);
  const dest   = path.join(REPO_VAULT_PATH, rel);
  const destDir = path.dirname(dest);

  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(srcPath, dest);
  return { rel, dest };
}

// ── Trigger vault-sync no agent-ai ────────────────────────────
function triggerVaultSync() {
  if (!AGENT_AI_URL) return; // opcional — só ativa se AGENT_AI_URL estiver no .env

  const url = new URL('/internal/vault-sync', AGENT_AI_URL);
  const body = JSON.stringify({ agent_id: AGENT_ID });
  const lib = url.protocol === 'https:' ? https : http;

  const req = lib.request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': INTERNAL_SECRET,
    },
  }, res => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      try {
        const r = JSON.parse(data);
        if (r.ok) {
          console.log(`[${timestamp()}] 🤖 vault-sync: ${r.docs_upserted} docs, ${r.chunks_upserted} chunks (${r.duration_ms}ms)`);
        } else {
          console.warn(`[${timestamp()}] ⚠️  vault-sync erro:`, data);
        }
      } catch { console.warn(`[${timestamp()}] ⚠️  vault-sync resposta inválida:`, data); }
    });
  });
  req.on('error', e => console.warn(`[${timestamp()}] ⚠️  vault-sync falhou:`, e.message));
  req.write(body);
  req.end();
}

// ── git commit + push ──────────────────────────────────────────
function gitPush(arquivos, mensagem) {
  try {
    const repoRoot = path.resolve(REPO_VAULT_PATH, '../../..');
    execSync(`git -C "${repoRoot}" add ${arquivos.map(f => `"${f}"`).join(' ')}`, { stdio: 'pipe' });
    execSync(`git -C "${repoRoot}" commit -m "${mensagem}"`, { stdio: 'pipe' });
    execSync(`git -C "${repoRoot}" push origin main`, { stdio: 'pipe' });
    return true;
  } catch (e) {
    // Se não há nada para commitar (arquivo igual), git retorna erro — ignora
    if (e.stdout?.toString().includes('nothing to commit') ||
        e.stderr?.toString().includes('nothing to commit')) {
      console.log(`[${timestamp()}] ℹ️  Nenhuma mudança detectada pelo git`);
      return false;
    }
    console.error(`[${timestamp()}] ❌ git push falhou:`, e.stderr?.toString() || e.message);
    return false;
  }
}

// ── Processar mudança ──────────────────────────────────────────
let pushPendente = null;
const arquivosPendentes = new Set();

function agendarPush() {
  if (pushPendente) clearTimeout(pushPendente);
  // Debounce de 2s: agrupa múltiplas edições rápidas em um único commit
  pushPendente = setTimeout(() => {
    const lista = [...arquivosPendentes];
    arquivosPendentes.clear();
    pushPendente = null;

    const nomes = lista.map(f => path.basename(f)).join(', ');
    const ok = gitPush(lista, `vault: atualizar ${nomes}`);
    if (ok) {
      console.log(`[${timestamp()}] 🚀 Push enviado — Railway rebuilda vault-server (~30s)`);

      // Arquivos de conteúdo (não Mari/) → sincroniza RAG
      const temConteudo = lista.some(f => {
        const rel = path.relative(REPO_VAULT_PATH, f);
        return !rel.startsWith('Mari/');
      });
      if (temConteudo) {
        console.log(`[${timestamp()}] 🔄 Arquivos de conteúdo detectados — disparando vault-sync RAG…`);
        triggerVaultSync();
      }
    }
  }, 2000);
}

async function handleChange(filePath) {
  if (!filePath.endsWith('.md') || !fs.existsSync(filePath)) return;

  try {
    const { rel, dest } = copiarArquivo(filePath);
    console.log(`[${timestamp()}] 📄 Copiado: ${rel}`);
    arquivosPendentes.add(dest);
    agendarPush();
  } catch (e) {
    console.error(`[${timestamp()}] ❌ Erro ao copiar ${path.basename(filePath)}:`, e.message);
  }
}

// ── Modo --once: copia tudo sem fazer push ─────────────────────
function syncAll() {
  const arquivos = [];

  function varrer(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) varrer(full);
      else if (entry.name.endsWith('.md')) arquivos.push(full);
    }
  }

  varrer(OBSIDIAN_VAULT_PATH);
  console.log(`🔄 Copiando ${arquivos.length} arquivo(s)…`);
  arquivos.forEach(f => {
    const { rel } = copiarArquivo(f);
    console.log(`  ✅ ${rel}`);
  });
  console.log(`\n✅ Cópia concluída. Revise os arquivos em:\n   ${REPO_VAULT_PATH}`);
  console.log('\nPara enviar ao Railway, rode no repositório:');
  console.log('  git add services/vault-server/vault && git commit -m "vault: sync inicial" && git push origin main');
}

// ── Modo watcher ───────────────────────────────────────────────
function startWatcher() {
  console.log('👁  Observando vault do Obsidian…');
  console.log(`   Origem  : ${OBSIDIAN_VAULT_PATH}`);
  console.log(`   Destino : ${REPO_VAULT_PATH}`);
  console.log('   Salve qualquer arquivo .md → Railway rebuilda vault-server em ~30s\n');

  chokidar
    .watch(path.join(OBSIDIAN_VAULT_PATH, '**', '*.md'), {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500 },
    })
    .on('add',    handleChange)
    .on('change', handleChange)
    .on('error',  (e) => console.error('❌ Watcher error:', e));
}

// ── Entrada ─────────────────────────────────────────────────────
if (ONCE_MODE) {
  syncAll();
} else {
  startWatcher();
}
