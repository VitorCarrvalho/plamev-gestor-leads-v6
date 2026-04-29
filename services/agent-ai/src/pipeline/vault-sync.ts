/**
 * vault-sync.ts — Sincroniza arquivos de conteúdo do vault → knowledge_base_docs + knowledge_chunks
 *
 * Fluxo:
 *   1. Lista arquivos do vault-server excluindo pasta Mari/ (comportamental, fica no vault)
 *   2. Lê conteúdo de cada arquivo
 *   3. Faz upsert em knowledge_base_docs (full-text + structured search)
 *   4. Chunka o conteúdo e computa embeddings via VoyageAI voyage-3
 *   5. Faz upsert em knowledge_chunks (vector search + rerank)
 */

import { pool } from './rag';

const VAULT_SERVER_URL =
  process.env.VAULT_SERVER_URL || 'http://plamev-gestor-leads-v6-fda4.railway.internal:8080';

const CHUNK_SIZE    = 1500; // chars por chunk
const CHUNK_OVERLAP = 200;  // sobreposição entre chunks

// ── Chunking ──────────────────────────────────────────────────
function chunkText(text: string, source: string): Array<{ content: string; source: string }> {
  // Tenta primeiro dividir por separadores markdown (---, headers de nível 2)
  const sections = text.split(/\n(?=#{1,2} |\-{3,})/);
  const chunks: Array<{ content: string; source: string }> = [];

  sections.forEach((section, sIdx) => {
    if (section.trim().length === 0) return;

    if (section.length <= CHUNK_SIZE) {
      chunks.push({ content: section.trim(), source: `${source}#s${sIdx}` });
      return;
    }

    // Seção grande: quebra por tamanho com overlap
    let start = 0;
    let chunkIdx = 0;
    while (start < section.length) {
      const end = Math.min(start + CHUNK_SIZE, section.length);
      const content = section.slice(start, end).trim();
      if (content.length > 50) {
        chunks.push({ content, source: `${source}#s${sIdx}c${chunkIdx}` });
      }
      start += CHUNK_SIZE - CHUNK_OVERLAP;
      chunkIdx++;
    }
  });

  return chunks;
}

// ── Embedding via VoyageAI ─────────────────────────────────────
async function computeEmbeddings(texts: string[]): Promise<number[][]> {
  if (!process.env.VOYAGE_API_KEY || texts.length === 0) return [];

  const { VoyageAIClient } = await import('voyageai');
  const voyage = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY });

  // VoyageAI aceita até 128 inputs por chamada
  const BATCH = 64;
  const all: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const resp = await voyage.embed({ input: batch, model: 'voyage-3', inputType: 'document' });
    const vecs = resp.data?.map((d: any) => d.embedding) ?? [];
    all.push(...vecs);
  }

  return all;
}

// ── Sync principal ─────────────────────────────────────────────
export interface SyncResult {
  arquivos: number;
  docs_upserted: number;
  chunks_upserted: number;
  errors: string[];
  duration_ms: number;
}

export async function syncVaultToKb(agentId: number, orgId: string): Promise<SyncResult> {
  const start = Date.now();
  const errors: string[] = [];
  let docs_upserted = 0;
  let chunks_upserted = 0;

  // 1. Lista arquivos do vault
  const listRes = await fetch(`${VAULT_SERVER_URL}/files`, { signal: AbortSignal.timeout(5000) });
  if (!listRes.ok) throw new Error(`vault-server /files HTTP ${listRes.status}`);
  const { files } = await listRes.json() as { files: string[] };

  // Exclui pasta Mari/ — comportamental, sempre carregada no system prompt via vault
  const arquivosKb = files.filter(f => !f.startsWith('Mari/'));

  // 2. Processa cada arquivo
  for (const arquivo of arquivosKb) {
    try {
      // Lê conteúdo do vault
      const fileRes = await fetch(
        `${VAULT_SERVER_URL}/file?path=${encodeURIComponent(arquivo)}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (!fileRes.ok) { errors.push(`${arquivo}: HTTP ${fileRes.status}`); continue; }
      const conteudo = await fileRes.text();
      if (!conteudo.trim()) continue;

      const partes = arquivo.split('/');
      const pasta   = partes.length > 1 ? partes[0] : 'root';
      const nome    = partes[partes.length - 1].replace('.md', '');

      // 3. Upsert em knowledge_base_docs
      await pool.query(`
        INSERT INTO knowledge_base_docs (agent_id, pasta, arquivo, titulo, conteudo, ativo, sempre_ativo, ordem)
        VALUES ($1, $2, $3, $4, $5, true, false, 0)
        ON CONFLICT (agent_id, pasta, arquivo)
        DO UPDATE SET conteudo = EXCLUDED.conteudo, atualizado_em = NOW()
      `, [agentId, pasta, nome, nome, conteudo]);
      docs_upserted++;

      // 4. Chunka + embeddings + upsert em knowledge_chunks
      const chunks = chunkText(conteudo, arquivo.replace('.md', ''));
      if (chunks.length === 0) continue;

      const embeddings = await computeEmbeddings(chunks.map(c => c.content));

      // Remove chunks antigos deste arquivo antes de reinserir
      await pool.query(
        `DELETE FROM knowledge_chunks WHERE agent_id = $1 AND source LIKE $2`,
        [agentId, `${arquivo.replace('.md', '')}%`]
      );

      for (let i = 0; i < chunks.length; i++) {
        const emb = embeddings[i];
        const embStr = emb ? `[${emb.join(',')}]` : null;

        await pool.query(`
          INSERT INTO knowledge_chunks (org_id, agent_id, content, embedding, source, metadata)
          VALUES ($1, $2, $3, $4::vector, $5, $6)
        `, [
          orgId,
          agentId,
          chunks[i].content,
          embStr,
          chunks[i].source,
          JSON.stringify({ pasta, arquivo: nome }),
        ]);
        chunks_upserted++;
      }
    } catch (e: any) {
      errors.push(`${arquivo}: ${e.message}`);
    }
  }

  return {
    arquivos: arquivosKb.length,
    docs_upserted,
    chunks_upserted,
    errors,
    duration_ms: Date.now() - start,
  };
}
