/**
 * services/analise-ia.ts
 * Análise de conversas via Claude Sonnet 4.6.
 * A Mari se auto-avalia comparando a conversa com toda a sua documentação.
 */
import Anthropic from '@anthropic-ai/sdk';
import http from 'http';
import https from 'https';
import { query, execute } from '../config/db';

// ── Cliente Anthropic (lazy) ────────────────────────────────────
let _anthropic: Anthropic | null = null;
function getAnthropic() {
  if (!_anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada');
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

// ── Vault HTTP helper (reutiliza padrão de conhecimento.ts) ─────
const VAULT_BASE = process.env.VAULT_SERVER_URL || 'http://plamev-gestor-leads-v6-fda4.railway.internal:8080';

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(
      { hostname: parsed.hostname, port: parsed.port ? parseInt(parsed.port) : undefined,
        path: parsed.pathname + (parsed.search || ''), method: 'GET', timeout: 8000 },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d)); }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

async function fetchVaultFile(path: string): Promise<string | null> {
  try {
    const body = await httpGet(`${VAULT_BASE}/file?path=${encodeURIComponent(path)}`);
    return body || null;
  } catch {
    return null;
  }
}

// ── Tipos ───────────────────────────────────────────────────────
export interface AnaliseConversa {
  resumo_executivo: string;
  score_geral: number;
  acertos: {
    descricao: string;
    arquivo_referencia: string;
    trecho_conversa?: string;
    impacto: 'alto' | 'medio' | 'baixo';
  }[];
  erros: {
    descricao: string;
    gravidade: 'critica' | 'importante' | 'leve';
    regra_violada: string;
    arquivo_referencia: string;
    trecho_conversa?: string;
    como_deveria_ser: string;
  }[];
  documentos_atualizar: {
    arquivo: string;
    tipo_acao: 'adicionar_regra' | 'adicionar_exemplo' | 'corrigir_regra' | 'adicionar_guarda';
    descricao: string;
    trecho_sugerido: string;
    secao_alvo?: string;
  }[];
  onde_salvar_comportamento?: {
    arquivo: string;
    secao: string;
    instrucao: string;
    trecho_exemplo: string;
  };
  modelo_usado: string;
  tokens_usados: { input: number; output: number };
}

// ── Tool definition para output estruturado ─────────────────────
const ANALISE_TOOL: Anthropic.Tool = {
  name: 'registrar_analise',
  description: 'Registra a análise completa da performance da Mari nessa conversa',
  input_schema: {
    type: 'object' as const,
    required: ['resumo_executivo', 'score_geral', 'acertos', 'erros', 'documentos_atualizar'],
    properties: {
      resumo_executivo: { type: 'string', description: 'Resumo executivo da performance em 2-4 frases' },
      score_geral: { type: 'number', description: 'Score de 0 a 100 da performance geral' },
      acertos: {
        type: 'array',
        items: {
          type: 'object',
          required: ['descricao', 'arquivo_referencia', 'impacto'],
          properties: {
            descricao: { type: 'string' },
            arquivo_referencia: { type: 'string', description: 'Arquivo do vault que define este comportamento esperado' },
            trecho_conversa: { type: 'string', description: 'Trecho da conversa que exemplifica o acerto' },
            impacto: { type: 'string', enum: ['alto', 'medio', 'baixo'] },
          },
        },
      },
      erros: {
        type: 'array',
        items: {
          type: 'object',
          required: ['descricao', 'gravidade', 'regra_violada', 'arquivo_referencia', 'como_deveria_ser'],
          properties: {
            descricao: { type: 'string' },
            gravidade: { type: 'string', enum: ['critica', 'importante', 'leve'] },
            regra_violada: { type: 'string', description: 'Qual regra ou princípio foi violado' },
            arquivo_referencia: { type: 'string', description: 'Arquivo do vault que define a regra violada' },
            trecho_conversa: { type: 'string', description: 'Trecho da conversa que mostra o erro' },
            como_deveria_ser: { type: 'string', description: 'Como a Mari deveria ter respondido' },
          },
        },
      },
      documentos_atualizar: {
        type: 'array',
        items: {
          type: 'object',
          required: ['arquivo', 'tipo_acao', 'descricao', 'trecho_sugerido'],
          properties: {
            arquivo: { type: 'string', description: 'Caminho relativo no vault, ex: Mari/Regras-Absolutas.md' },
            tipo_acao: { type: 'string', enum: ['adicionar_regra', 'adicionar_exemplo', 'corrigir_regra', 'adicionar_guarda'] },
            descricao: { type: 'string', description: 'O que deve ser adicionado/corrigido e por quê' },
            trecho_sugerido: { type: 'string', description: 'Texto markdown exato para copiar no Obsidian' },
            secao_alvo: { type: 'string', description: 'Nome da seção onde inserir (opcional)' },
          },
        },
      },
      onde_salvar_comportamento: {
        type: 'object',
        description: 'Apenas quando a conversa fechou venda (tipo_resultado=sucesso)',
        properties: {
          arquivo: { type: 'string' },
          secao: { type: 'string' },
          instrucao: { type: 'string' },
          trecho_exemplo: { type: 'string', description: 'Trecho da conversa formatado como exemplo positivo' },
        },
        required: ['arquivo', 'secao', 'instrucao', 'trecho_exemplo'],
      },
    },
  },
};

// ── Montar prompt do sistema ────────────────────────────────────
async function buildSystemPrompt(): Promise<string> {
  const vaultFiles = [
    'Mari/Identidade.md',
    'Mari/Regras-Absolutas.md',
    'Mari/Personalidade-Vendas.md',
    'Mari/Modo-Rapido.md',
    'Mari/Anti-Repeticao.md',
    'Plamev/Empresa.md',
    'Plamev/Planos.md',
    'Vendas/Objecoes.md',
  ];

  const docs: string[] = [];
  for (const filePath of vaultFiles) {
    const content = await fetchVaultFile(filePath);
    if (content?.trim()) {
      docs.push(`\n---\n## 📄 ${filePath}\n\n${content.trim()}`);
    }
  }

  // Prompts dinâmicos do banco (soul, regras, etc.)
  try {
    const prompts = await query<any>(
      `SELECT tipo, conteudo FROM agente_prompts
       WHERE conteudo IS NOT NULL AND conteudo != ''
       ORDER BY tipo`
    );
    if (prompts.length > 0) {
      docs.push('\n---\n## 🗄️ Prompts Dinâmicos (Banco de Dados)\n');
      for (const p of prompts) {
        docs.push(`\n### Prompt: ${p.tipo}\n${p.conteudo}`);
      }
    }
  } catch { /* ignora se não tiver */ }

  // Planos e preços
  try {
    const planos = await query<any>(
      `SELECT p.slug, p.nome, p.descricao,
              json_agg(json_build_object('modalidade', pr.modalidade, 'valor', pr.valor, 'valor_tabela', pr.valor_tabela, 'valor_promocional', pr.valor_promocional) ORDER BY pr.modalidade) AS precos
       FROM planos p
       LEFT JOIN precos pr ON pr.plano_id = p.id AND pr.ativo = true
       WHERE p.ativo = true
       GROUP BY p.id, p.slug, p.nome, p.descricao
       ORDER BY p.nome`
    );
    if (planos.length > 0) {
      docs.push('\n---\n## 💰 Planos e Preços Oficiais\n');
      for (const pl of planos) {
        docs.push(`\n### ${pl.nome} (${pl.slug})\n${pl.descricao || ''}`);
        if (pl.precos?.length) {
          docs.push('Preços: ' + pl.precos.map((pr: any) =>
            `${pr.modalidade}: R$${pr.valor} (tabela R$${pr.valor_tabela}, promo R$${pr.valor_promocional})`
          ).join(' | '));
        }
      }
    }
  } catch { /* ignora */ }

  return `Você é um coach especialista em vendas da Plamev analisando a performance da Mari, consultora de saúde pet.

Sua missão é avaliar objetivamente o que a Mari fez certo e errado nessa conversa, comparando cada resposta com a documentação oficial de identidade, regras, personalidade e conhecimento de produto.

Seja específico: cite trechos reais da conversa, aponte qual regra/documento foi seguido ou violado, e sugira como corrigi-la ou reforçá-la na documentação.

DOCUMENTAÇÃO COMPLETA DA MARI:
${docs.join('\n')}

INSTRUÇÕES PARA A ANÁLISE:
- Score 0-100: considere gravidade dos erros (erros críticos custam mais pontos)
- Erros críticos = violam regras absolutas ou prejudicam a venda diretamente
- Erros importantes = desvios de personalidade ou boas práticas
- Erros leves = oportunidades de melhoria
- Para documentos a atualizar: gere o trecho markdown EXATO que o usuário pode copiar no Obsidian
- Se a conversa fechou venda (tipo_resultado=sucesso): identifique ONDE e COMO salvar como exemplo positivo`;
}

// ── Montar prompt do usuário ─────────────────────────────────────
function buildUserPrompt(conversa: any): string {
  const tipoLabel = {
    sucesso: '✅ FECHOU VENDA (conversa de sucesso)',
    falha: '❌ NÃO CONVERTEU (conversa com falha)',
    analise: '📋 ANÁLISE NEUTRA',
  }[conversa.tipo_resultado as string] || '📋 ANÁLISE NEUTRA';

  const perfil = conversa.snapshot_perfil || {};
  const msgs: any[] = conversa.snapshot_msgs || [];

  const transcricao = msgs.map((m: any) => {
    const hora = m.timestamp ? new Date(m.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
    const quem = m.role === 'assistant' ? 'MARI' : 'CLIENTE';
    return `[${hora}] ${quem}: ${m.conteudo}`;
  }).join('\n');

  return `TIPO DE RESULTADO: ${tipoLabel}

PERFIL DO LEAD:
${JSON.stringify(perfil, null, 2)}

TRANSCRIÇÃO DA CONVERSA:
${transcricao || '(sem mensagens)'}

Analise esta conversa e chame a função registrar_analise com o resultado completo.`;
}

// ── Função principal ────────────────────────────────────────────
export async function runAnalise(salvaId: number): Promise<AnaliseConversa> {
  const rows = await query<any>(
    `SELECT id, titulo, motivo, tipo_resultado, snapshot_msgs, snapshot_perfil, analise_resultado
     FROM conversas_salvas WHERE id = $1`, [salvaId]
  );
  if (!rows[0]) throw new Error('Conversa salva não encontrada');

  const conversa = rows[0];

  const systemPrompt = await buildSystemPrompt();
  const userPrompt = buildUserPrompt(conversa);

  await execute(
    `UPDATE conversas_salvas SET analise_status = 'processando' WHERE id = $1`, [salvaId]
  );

  let analise: AnaliseConversa;
  try {
    const response = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      tools: [ANALISE_TOOL],
      tool_choice: { type: 'any' },
    });

    const toolUse = response.content.find(b => b.type === 'tool_use') as Anthropic.ToolUseBlock | undefined;
    if (!toolUse) throw new Error('Claude não retornou tool_use');

    const input = toolUse.input as Omit<AnaliseConversa, 'modelo_usado' | 'tokens_usados'>;
    analise = {
      ...input,
      modelo_usado: 'claude-sonnet-4-6',
      tokens_usados: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
    };
  } catch (err) {
    await execute(`UPDATE conversas_salvas SET analise_status = 'erro' WHERE id = $1`, [salvaId]);
    throw err;
  }

  await execute(
    `UPDATE conversas_salvas
     SET analise_resultado = $1, analise_status = 'concluida'
     WHERE id = $2`,
    [JSON.stringify(analise), salvaId]
  );

  return analise;
}
