/**
 * routes/conhecimento.ts — CRUD da base de conhecimento dinâmica.
 * Cada documento = um arquivo markdown importado do Obsidian vault.
 * Montado em /api/config/agentes/:agenteId/conhecimento
 */
import { Router } from 'express';
import { autenticar, soAdmin } from '../middleware/auth';
import { query, execute, queryOne } from '../config/db';
import fs from 'fs';
import path from 'path';

const router = Router({ mergeParams: true });

const VAULT_SERVER_URL = process.env.VAULT_SERVER_URL || 'http://vault-server.railway.internal:8080';

function splitVaultPath(filePath: string) {
  const normalized = String(filePath || '').replace(/^\/+/, '').trim();
  const parts = normalized.split('/').filter(Boolean);
  const fileName = parts.pop() || '';
  const pasta = parts[0] || 'root';
  const arquivo = fileName.replace(/\.md$/i, '');
  return { pasta, arquivo, fullPath: normalized };
}

async function fetchVaultFiles() {
  const resp = await fetch(`${VAULT_SERVER_URL}/files`, { signal: AbortSignal.timeout(5000) });
  if (!resp.ok) throw new Error(`vault-server HTTP ${resp.status}`);
  const data = await resp.json() as { total: number; files: string[] };
  return data.files || [];
}

async function fetchVaultFile(filePath: string) {
  const url = `${VAULT_SERVER_URL}/file?path=${encodeURIComponent(filePath)}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!resp.ok) throw new Error(`vault-server arquivo HTTP ${resp.status}: ${filePath}`);
  return resp.text();
}

async function syncVaultToKnowledgeBase(agentId: string) {
  const files = await fetchVaultFiles();
  if (!files.length) return { discovered: 0, imported: 0 };

  const existingRows = await query<any>(
    `SELECT id, pasta, arquivo
     FROM knowledge_base_docs
     WHERE agent_id = $1`,
    [agentId]
  );
  const existingKeys = new Set(existingRows.map((row: any) => `${row.pasta}/${row.arquivo}`));

  let imported = 0;
  for (const filePath of files) {
    const { pasta, arquivo } = splitVaultPath(filePath);
    const key = `${pasta}/${arquivo}`;
    if (existingKeys.has(key)) continue;

    const conteudo = await fetchVaultFile(filePath);
    await execute(
      `INSERT INTO knowledge_base_docs (agent_id, pasta, arquivo, titulo, conteudo, etapas, sempre_ativo, ordem, ativo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (agent_id, pasta, arquivo) DO NOTHING`,
      [agentId, pasta, arquivo, arquivo, conteudo, [], false, 0, true]
    );
    existingKeys.add(key);
    imported++;
  }

  return { discovered: files.length, imported };
}

// ── Vault proxy: lista arquivos ───────────────────────────────
router.get('/vault', autenticar, async (_req, res) => {
  try {
    const resp = await fetch(`${VAULT_SERVER_URL}/files`, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) { res.status(resp.status).json({ erro: `vault-server HTTP ${resp.status}` }); return; }
    const data = await resp.json() as { total: number; files: string[] };
    res.json(data);
  } catch (e: any) { res.status(503).json({ erro: `vault-server indisponível: ${e.message}` }); }
});

// ── Vault proxy: conteúdo de um arquivo ──────────────────────
router.get('/vault/arquivo', autenticar, async (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) { res.status(400).json({ erro: 'query param "path" obrigatório' }); return; }
  try {
    const url = `${VAULT_SERVER_URL}/file?path=${encodeURIComponent(filePath)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) { res.status(resp.status).json({ erro: 'arquivo não encontrado' }); return; }
    const conteudo = await resp.text();
    res.json({ conteudo });
  } catch (e: any) { res.status(503).json({ erro: `vault-server indisponível: ${e.message}` }); }
});

// ── Lista todos os docs agrupados por pasta ──────────────────
router.get('/', autenticar, async (req, res) => {
  try {
    const { agenteId } = req.params;
    let vaultSync: { discovered: number; imported: number } | null = null;
    try {
      vaultSync = await syncVaultToKnowledgeBase(agenteId);
    } catch (vaultError: any) {
      console.warn(`[CONHECIMENTO] ⚠️ Falha ao sincronizar vault para agente ${agenteId}: ${vaultError.message}`);
    }

    const rows = await query<any>(
      `SELECT id, pasta, arquivo, titulo, etapas, sempre_ativo, ativo, ordem,
              LENGTH(conteudo) AS chars, atualizado_em
       FROM knowledge_base_docs
       WHERE agent_id = $1
       ORDER BY pasta ASC, ordem ASC, arquivo ASC`,
      [agenteId]
    );

    const grupos: Record<string, any[]> = {};
    for (const r of rows) {
      if (!grupos[r.pasta]) grupos[r.pasta] = [];
      grupos[r.pasta].push(r);
    }

    res.json({ ok: true, grupos, total: rows.length, vaultSync });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Detalhe de um doc (com conteúdo completo) ────────────────
router.get('/:docId', autenticar, async (req, res) => {
  try {
    const doc = await queryOne<any>(
      `SELECT * FROM knowledge_base_docs WHERE id=$1 AND agent_id=$2`,
      [req.params.docId, req.params.agenteId]
    );
    if (!doc) { res.status(404).json({ erro: 'Documento não encontrado' }); return; }
    res.json({ ok: true, doc });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Criar novo doc ────────────────────────────────────────────
router.post('/', soAdmin, async (req, res) => {
  try {
    const { pasta, arquivo, titulo, conteudo = '', etapas = [], sempre_ativo = false, ordem = 0 } = req.body || {};
    if (!pasta || !arquivo) { res.status(400).json({ erro: 'pasta e arquivo obrigatórios' }); return; }
    const rows = await query<any>(
      `INSERT INTO knowledge_base_docs (agent_id, pasta, arquivo, titulo, conteudo, etapas, sempre_ativo, ordem)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, pasta, arquivo, titulo, ativo, sempre_ativo, ordem`,
      [req.params.agenteId, pasta, arquivo, titulo || arquivo, conteudo, etapas, sempre_ativo, ordem]
    );
    res.json({ ok: true, doc: rows[0] });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Atualizar conteúdo / meta ─────────────────────────────────
router.patch('/:docId', soAdmin, async (req, res) => {
  try {
    const allowed = ['titulo', 'conteudo', 'etapas', 'sempre_ativo', 'ativo', 'ordem'];
    const sets: string[] = [];
    const vals: any[] = [];
    for (const k of allowed) {
      if (req.body[k] !== undefined) { sets.push(`${k}=$${vals.length + 1}`); vals.push(req.body[k]); }
    }
    if (!sets.length) { res.status(400).json({ erro: 'Nada para atualizar' }); return; }
    sets.push(`atualizado_em=NOW()`);
    vals.push(req.params.docId, req.params.agenteId);
    await execute(
      `UPDATE knowledge_base_docs SET ${sets.join(',')} WHERE id=$${vals.length - 1} AND agent_id=$${vals.length}`,
      vals
    );
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Remover doc ───────────────────────────────────────────────
router.delete('/:docId', soAdmin, async (req, res) => {
  try {
    await execute(
      `DELETE FROM knowledge_base_docs WHERE id=$1 AND agent_id=$2`,
      [req.params.docId, req.params.agenteId]
    );
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Importar do filesystem local ─────────────────────────────
// Útil em dev: POST com base_path lê todos os .md e faz upsert.
router.post('/importar', async (req, res) => {
  const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'plamev-internal';
  if (req.headers['x-internal-secret'] !== INTERNAL_SECRET) {
    res.status(401).json({ erro: 'Não autorizado' });
    return;
  }
  try {
    const { base_path } = req.body || {};
    if (!base_path) { res.status(400).json({ erro: 'base_path obrigatório' }); return; }

    let importados = 0;
    let erros: string[] = [];

    function walkDir(dir: string, pasta: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const fullPath = path.join(dir, e.name);
        if (e.isDirectory()) {
          walkDir(fullPath, e.name);
        } else if (e.name.endsWith('.md') && !e.name.endsWith('.bak')) {
          try {
            const conteudo = fs.readFileSync(fullPath, 'utf-8');
            const arquivo = e.name.replace('.md', '');
            execute(
              `INSERT INTO knowledge_base_docs (agent_id, pasta, arquivo, titulo, conteudo)
               VALUES ($1,$2,$3,$4,$5)
               ON CONFLICT (agent_id, pasta, arquivo) DO UPDATE
                 SET conteudo=EXCLUDED.conteudo, atualizado_em=NOW()`,
              [req.params.agenteId, pasta, arquivo, arquivo, conteudo]
            );
            importados++;
          } catch (err: any) {
            erros.push(`${pasta}/${e.name}: ${err.message}`);
          }
        }
      }
    }

    walkDir(base_path, 'root');
    res.json({ ok: true, importados, erros });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

export default router;
