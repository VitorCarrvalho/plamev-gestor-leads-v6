const express = require('express');
const fs      = require('fs');
const path    = require('path');

const app        = express();
const VAULT_PATH = path.resolve(__dirname, '../vault');
const PORT       = process.env.PORT || 8080;

// ── Health ────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'vault-server', vault: VAULT_PATH });
});

// ── GET /file?path=Mari%2FSoul.md ─────────────────────────────
// Retorna o conteúdo bruto do arquivo .md em text/plain.
app.get('/file', (req, res) => {
  const relativo = req.query.path;
  if (!relativo || typeof relativo !== 'string') {
    return res.status(400).json({ error: 'query param "path" obrigatório' });
  }

  const resolved = path.resolve(VAULT_PATH, relativo);
  if (!resolved.startsWith(VAULT_PATH)) {
    return res.status(403).json({ error: 'acesso negado' });
  }
  if (!resolved.endsWith('.md')) {
    return res.status(400).json({ error: 'apenas arquivos .md são permitidos' });
  }

  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: 'arquivo não encontrado', path: relativo });
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(fs.readFileSync(resolved, 'utf-8'));
});

// ── GET /files — lista todos os .md disponíveis ───────────────
app.get('/files', (_req, res) => {
  const lista = [];

  function varrer(dir, base = '') {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        varrer(path.join(dir, entry.name), rel);
      } else if (entry.name.endsWith('.md')) {
        lista.push(rel);
      }
    }
  }

  varrer(VAULT_PATH);
  res.json({ total: lista.length, files: lista });
});

// ── Iniciar ───────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[VAULT-SERVER] 🗂️  Rodando na porta ${PORT}`);
  console.log(`[VAULT-SERVER] 📁  Vault: ${VAULT_PATH}`);
  console.log(`[VAULT-SERVER] 📄  Arquivos disponíveis:`);
  try {
    const listagem = [];
    function varrer(dir, base = '') {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = base ? `${base}/${entry.name}` : entry.name;
        if (entry.isDirectory()) varrer(path.join(dir, entry.name), rel);
        else if (entry.name.endsWith('.md')) listagem.push(rel);
      }
    }
    varrer(VAULT_PATH);
    listagem.forEach(f => console.log(`  • ${f}`));
    if (!listagem.length) console.log('  (vault vazio — adicione arquivos .md)');
  } catch {}
});
