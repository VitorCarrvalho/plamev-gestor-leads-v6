import { VoyageAIClient } from 'voyageai';
import { Pool } from 'pg';
import { RagResult } from '@plamev/shared';

const voyage = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY || '' });

// Singleton DB connection for Agent AI
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function searchKnowledge(
  query: string, 
  orgId: string, 
  agentId: string, 
  limit = 5
): Promise<RagResult[]> {
  try {
    // 1. Gerar embedding da query
    const embedResponse = await voyage.embed({
      input: [query],
      model: 'voyage-3',
      inputType: 'query'
    });
    
    const queryEmbedding = embedResponse.data?.[0]?.embedding;
    if (!queryEmbedding) return [];

    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    // 2. Busca vetorial no pgvector
    const result = await pool.query(`
      SELECT content, source, 1 - (embedding <=> $1::vector) AS similarity
      FROM knowledge_chunks
      WHERE org_id = $2 AND agent_id = $3
      ORDER BY embedding <=> $1::vector
      LIMIT $4
    `, [embeddingStr, orgId, agentId, limit * 2]); // Busca o dobro para o rerank

    if (result.rows.length === 0) return [];

    const chunks = result.rows.map(row => row.content);

    // 3. Reranking com Voyage
    const rerankResponse = await voyage.rerank({
      query: query,
      documents: chunks,
      model: 'rerank-2',
      topK: limit
    });

    const finalResults: RagResult[] = [];
    if (rerankResponse.data) {
      for (const rank of rerankResponse.data) {
        const originalRow = result.rows[rank.index];
        finalResults.push({
          text: originalRow.content,
          source: originalRow.source,
          score: rank.relevanceScore || 0
        });
      }
    }

    return finalResults;
  } catch (error) {
    console.error('[AGENT-AI] Erro no RAG:', error);
    return [];
  }
}
