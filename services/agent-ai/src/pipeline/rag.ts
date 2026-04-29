import { Pool } from 'pg';
import { RagResult } from '@plamev/shared';
import { VoyageAIClient } from 'voyageai';
import { buscarKnowledge as buscarKnowledgeEstruturado } from '../db';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const KB_CHAR_LIMIT = 8000;

type RagMode = 'vector_rerank' | 'full_text_fallback' | 'structured_fallback' | 'none';

const BASE_PATHS = [
  'Mari/Identidade',
  'Mari/Anti-Repeticao',
  'Plamev/Empresa',
];

const STAGE_PATHS: Record<string, string[]> = {
  acolhimento: ['Mari/Modo-Rapido', 'Mari/Qualificacao', 'Vendas/Etapas'],
  qualificacao: ['Mari/Qualificacao', 'Vendas/Etapas'],
  apresentacao_planos: ['Plamev/Planos', 'Plamev/Recomendacao-Plano', 'Plamev/Precos-Estrategia', 'Plamev/Planos-Plus', 'Mari/Apresentacao', 'Vendas/Etapas'],
  validacao_cep: ['Plamev/Planos', 'Plamev/Empresa', 'Vendas/Etapas'],
  negociacao: ['Vendas/Negociacao', 'Vendas/Negociacao-Inteligente', 'Vendas/Objecoes', 'Plamev/Precos-Estrategia', 'Vendas/Etapas'],
  objecao: ['Vendas/Objecoes', 'Vendas/Negociacao-Inteligente', 'Plamev/Precos-Estrategia', 'Vendas/Etapas'],
  pre_fechamento: ['Plamev/Planos', 'Plamev/Recomendacao-Plano', 'Vendas/Negociacao', 'Vendas/Etapas'],
  fechamento: ['Plamev/Planos', 'Plamev/Recomendacao-Plano', 'Vendas/Etapas'],
};

function inferExtraPaths(query: string) {
  const text = query.toLowerCase();
  const extras = new Set<string>();

  if (/(plano|planos|pre[cç]o|precos|valor|quanto custa|quais vc tem|quais vocês têm|me explica quais)/i.test(text)) {
    extras.add('Plamev/Planos');
    extras.add('Plamev/Recomendacao-Plano');
    extras.add('Plamev/Precos-Estrategia');
    extras.add('Plamev/Planos-Plus');
    extras.add('Mari/Apresentacao');
  }

  if (/(cobertura|car[eê]ncia|rede|cl[ií]nica|veterin[aá]rio|hospital)/i.test(text)) {
    extras.add('Plamev/Empresa');
    extras.add('Plamev/Planos');
  }

  if (/(desconto|caro|condi[cç][aã]o|fecha hoje|promo[cç][aã]o)/i.test(text)) {
    extras.add('Vendas/Objecoes');
    extras.add('Vendas/Negociacao');
    extras.add('Vendas/Negociacao-Inteligente');
  }

  return [...extras];
}

export interface KnowledgeContextResult {
  conteudo: string;
  fontes: string[];
  docs: RagResult[];
  mode: RagMode;
  latencyMs: number;
}

let voyageClient: VoyageAIClient | null = null;

function getVoyageClient(): VoyageAIClient | null {
  if (!process.env.VOYAGE_API_KEY) return null;
  if (!voyageClient) {
    voyageClient = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY });
  }
  return voyageClient;
}

function formatKnowledgeDocs(docs: Array<{ text: string; source: string }>, charLimit = KB_CHAR_LIMIT) {
  let totalChars = 0;
  const partes: string[] = [];
  const fontes: string[] = [];

  for (const doc of docs) {
    const bloco = `### ${doc.source || 'knowledge_chunk'}\n${doc.text}`;
    if (totalChars + bloco.length > charLimit) break;
    partes.push(bloco);
    fontes.push(doc.source || 'knowledge_chunk');
    totalChars += bloco.length;
  }

  return {
    conteudo: partes.join('\n\n'),
    fontes,
  };
}

async function searchKnowledgeStructured(
  agentId: string,
  stage = 'acolhimento',
  query = '',
): Promise<RagResult[]> {
  try {
    const extrasPaths = [...new Set([
      ...BASE_PATHS,
      ...(STAGE_PATHS[stage] || []),
      ...inferExtraPaths(query),
    ])];

    const docs = await buscarKnowledgeEstruturado(Number(agentId), stage, extrasPaths);
    return docs.map((doc, index) => ({
      text: doc.conteudo,
      source: `${doc.pasta}/${doc.arquivo}`,
      score: docs.length - index,
    }));
  } catch (error: any) {
    if (error?.code !== '42P01') console.warn('[AGENT-AI] RAG estruturado:', error?.message || error);
    return [];
  }
}

export async function searchKnowledgeVector(
  query: string,
  orgId: string,
  agentId: string,
  limit = 5,
): Promise<RagResult[]> {
  const voyage = getVoyageClient();
  if (!voyage || !query.trim()) return [];

  try {
    const embedResponse = await voyage.embed({
      input: [query],
      model: 'voyage-3',
      inputType: 'query',
    });

    const queryEmbedding = embedResponse.data?.[0]?.embedding;
    if (!queryEmbedding) return [];

    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    const result = await pool.query(`
      SELECT content, source, 1 - (embedding <=> $1::vector) AS similarity
      FROM knowledge_chunks
      WHERE org_id = $2 AND agent_id = $3
      ORDER BY embedding <=> $1::vector
      LIMIT $4
    `, [embeddingStr, orgId, agentId, limit * 2]);

    if (result.rows.length === 0) return [];

    const chunks = result.rows.map(row => row.content);

    const rerankResponse = await voyage.rerank({
      query,
      documents: chunks,
      model: 'rerank-2',
      topK: limit,
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
    console.error('[AGENT-AI] Erro no RAG vetorial:', error);
    return [];
  }
}

export async function searchKnowledgeFullText(
  query: string,
  agentId: string,
  limit = 8,
): Promise<RagResult[]> {
  try {
    const { rows: sempre } = await pool.query(`
      SELECT titulo, arquivo, conteudo
      FROM knowledge_base_docs
      WHERE agent_id=$1 AND sempre_ativo=true AND ativo=true
      ORDER BY ordem
    `, [agentId]);

    const queryText = query.trim().slice(0, 200);
    const { rows: relevantes } = queryText
      ? await pool.query(`
          SELECT titulo, arquivo, conteudo
          FROM knowledge_base_docs
          WHERE agent_id=$1 AND ativo=true AND sempre_ativo=false
            AND to_tsvector('portuguese', coalesce(titulo,'') || ' ' || coalesce(conteudo,''))
                @@ plainto_tsquery('portuguese', $2)
          ORDER BY ordem
          LIMIT $3
        `, [agentId, queryText, limit]).catch(() => ({ rows: [] }))
      : { rows: [] as any[] };

    const docs = [...sempre, ...relevantes];
    return docs.map((doc: any, index: number) => ({
      text: doc.conteudo,
      source: doc.arquivo || doc.titulo || `kb_doc_${index + 1}`,
      score: docs.length - index,
    }));
  } catch (error: any) {
    if (error?.code !== '42P01') console.warn('[AGENT-AI] RAG full-text:', error?.message || error);
    return [];
  }
}

export async function searchKnowledge(
  query: string,
  orgId: string,
  agentId: string,
  limit = 5,
  options?: { stage?: string },
): Promise<KnowledgeContextResult> {
  const start = Date.now();
  const stage = options?.stage || 'acolhimento';
  const structuredDocs = await searchKnowledgeStructured(agentId, stage, query);

  const vectorDocs = await searchKnowledgeVector(query, orgId, agentId, limit);
  if (vectorDocs.length > 0) {
    const mergedDocs = [...structuredDocs, ...vectorDocs].filter((doc, index, arr) =>
      arr.findIndex((item) => item.source === doc.source) === index
    );
    const formatted = formatKnowledgeDocs(mergedDocs.map((doc) => ({ text: doc.text, source: doc.source })));
    return {
      ...formatted,
      docs: mergedDocs,
      mode: 'vector_rerank',
      latencyMs: Date.now() - start,
    };
  }

  const fullTextDocs = await searchKnowledgeFullText(query, agentId, 8);
  const fallbackDocs = [...structuredDocs, ...fullTextDocs].filter((doc, index, arr) =>
    arr.findIndex((item) => item.source === doc.source) === index
  );
  if (fallbackDocs.length > 0) {
    const formatted = formatKnowledgeDocs(fallbackDocs.map((doc) => ({ text: doc.text, source: doc.source })));
    return {
      ...formatted,
      docs: fallbackDocs,
      mode: fullTextDocs.length > 0 ? 'full_text_fallback' : 'structured_fallback',
      latencyMs: Date.now() - start,
    };
  }

  return {
    conteudo: '',
    fontes: [],
    docs: [],
    mode: 'none',
    latencyMs: Date.now() - start,
  };
}
