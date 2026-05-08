/**
 * services/sandbox-engine.ts
 * Replica EXATAMENTE o context-builder do agent-ai para o Chat Simulator.
 *
 * Prioridade de conhecimento (igual à produção):
 *  1. knowledge_base_docs (vault sincronizado, mesma tabela mariv3)
 *  2. agente_prompts (edição manual via painel)
 *  3. vault-server HTTP (para Regras-Absolutas e outros arquivos avulsos)
 */
import Anthropic from '@anthropic-ai/sdk';
import { query, queryOne } from '../config/db';
import { env } from '../config/env';

// ── Lazy Anthropic singleton ──────────────────────────────────────────────────
let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) {
    if (!env.anthropicKey) throw new Error('ANTHROPIC_API_KEY não configurada.');
    _anthropic = new Anthropic({ apiKey: env.anthropicKey });
  }
  return _anthropic;
}

// ── Custo estimado por 1k tokens ──────────────────────────────────────────────
const COST_PER_1K: Record<string, { i: number; o: number }> = {
  'claude-haiku-4-5':           { i: 0.00025, o: 0.00125 },
  'claude-haiku-4-5-20251001':  { i: 0.00025, o: 0.00125 },
  'claude-sonnet-4-6':          { i: 0.003,   o: 0.015   },
  'claude-opus-4-5':            { i: 0.015,   o: 0.075   },
  'claude-opus-4-7':            { i: 0.015,   o: 0.075   },
};
const MODEL_ALIAS: Record<string, string> = {
  'claude-haiku-4-5': 'claude-haiku-4-5-20251001',
};

function resolverModelo(raw: string): string {
  const m = (raw || env.claudeModel || 'claude-haiku-4-5-20251001').trim();
  return MODEL_ALIAS[m] ?? m;
}

function calcularCusto(model: string, tokensIn: number, tokensOut: number): number {
  const rate = COST_PER_1K[model] ?? COST_PER_1K['claude-haiku-4-5-20251001'];
  return (tokensIn / 1000) * rate.i + (tokensOut / 1000) * rate.o;
}

// ── Arquivos do vault por etapa (IDÊNTICO ao context-builder do agent-ai) ─────
const BASE_MARI = [
  'Mari/Identidade.md', 'Mari/Anti-Repeticao.md', 'Mari/Modo-Rapido.md',
  'Mari/Qualificacao.md', 'Mari/Apresentacao.md', 'Mari/Exemplos-Alta-Conversao.md',
  'Plamev/Empresa.md',
];
const ETAPA_ARQUIVOS: Record<string, string[]> = {
  acolhimento:         ['Mari/Modo-Rapido.md'],
  qualificacao:        ['Mari/Modo-Rapido.md', 'Plamev/Empresa.md'],
  apresentacao_planos: ['Plamev/Planos.md', 'Mari/Apresentacao.md', 'Plamev/Recomendacao-Plano.md', 'Plamev/Precos-Estrategia.md', 'Plamev/Planos-Plus.md'],
  validacao_cep:       ['Plamev/Planos.md'],
  negociacao:          ['Plamev/Planos.md', 'Vendas/Objecoes.md', 'Mari/Closer-Psicologica.md', 'Vendas/Negociacao-Inteligente.md', 'Vendas/Conduta-Vendas.md', 'Plamev/Recomendacao-Plano.md', 'Plamev/Precos-Estrategia.md', 'Plamev/Planos-Plus.md'],
  objecao:             ['Vendas/Objecoes.md', 'Mari/Closer-Psicologica.md', 'Plamev/Planos.md', 'Vendas/Conduta-Vendas.md', 'Plamev/Precos-Estrategia.md'],
  pre_fechamento:      ['Plamev/Planos.md', 'Vendas/Fechamento.md', 'Vendas/Negociacao-Inteligente.md', 'Vendas/Conduta-Vendas.md', 'Plamev/Precos-Estrategia.md', 'Plamev/Planos-Plus.md'],
  fechamento:          ['Vendas/Fechamento.md', 'Vendas/Conduta-Vendas.md', 'Mari/Apresentacao.md', 'Plamev/Precos-Estrategia.md'],
};

// ── Tipos públicos ────────────────────────────────────────────────────────────
export interface SandboxInput {
  etapa: string;
  canal: string;
  perfil_lead: {
    nome?: string; especie?: string; raca?: string; idade_anos?: number | '';
    cep?: string; email?: string; problema_saude?: string;
  };
  mensagens: Array<{ role: 'user' | 'agent'; conteudo: string }>;
  mensagem_teste: string;
  mostrar_prompt?: boolean;
  modelo_override?: string;
}

export interface SandboxResult {
  resposta: string;
  etapa_efetiva: string;
  etapa_mudou: boolean;
  perfil_extraido: Record<string, any>;
  tokens_input: number;
  tokens_output: number;
  custo_usd: number;
  duracao_ms: number;
  prompt_sistema?: string;
  arquivos_carregados: string[];
  arquivos_meta: Array<{ caminho: string; atualizado_em: string | null; tamanho: number }>;
}

// ── Carregamento de conhecimento (PRIORIDADE 1: knowledge_base_docs) ──────────
// Query IDÊNTICA ao buscarKnowledge do agent-ai/src/db.ts
async function lerKnowledgeBase(agentId: number, etapa: string, paths: string[]): Promise<string | null> {
  const rows = await query<any>(
    `SELECT pasta, arquivo, conteudo, atualizado_em, LENGTH(conteudo) AS tamanho
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
    [agentId, etapa, paths]
  ).catch(() => []);

  if (!rows.length) return null;
  return rows.map((d: any) => `\n## [${d.arquivo}]\n${d.conteudo}`).join('');
}

// Versão que retorna metadados junto (para arquivos_meta)
async function lerKnowledgeBaseComMeta(agentId: number, etapa: string, paths: string[]): Promise<{
  core: string | null;
  arquivos: string[];
  meta: Array<{ caminho: string; atualizado_em: string | null; tamanho: number }>;
}> {
  const rows = await query<any>(
    `SELECT pasta, arquivo, conteudo, atualizado_em, LENGTH(conteudo) AS tamanho
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
    [agentId, etapa, paths]
  ).catch(() => []);

  if (!rows.length) return { core: null, arquivos: [], meta: [] };

  const core = rows.map((d: any) => `\n## [${d.arquivo}]\n${d.conteudo}`).join('');
  const arquivos = rows.map((d: any) => `${d.pasta}/${d.arquivo}`);
  const meta = rows.map((d: any) => ({
    caminho:      `${d.pasta}/${d.arquivo}`,
    atualizado_em: d.atualizado_em ? new Date(d.atualizado_em).toISOString() : null,
    tamanho:      Number(d.tamanho) || 0,
  }));

  return { core, arquivos, meta };
}

// PRIORIDADE 2: agente_prompts (fallback se knowledge_base_docs estiver vazio)
async function lerAgentPrompts(agentId: number, etapa: string): Promise<{ core: string | null; arquivos: string[] }> {
  const rows = await query<any>(
    `SELECT tipo, conteudo FROM agente_prompts WHERE agent_id=$1 AND ativo=true AND conteudo<>'' ORDER BY ordem`,
    [agentId]
  ).catch(() => []);

  if (!rows.length) return { core: null, arquivos: [] };

  const p: Record<string, string> = {};
  for (const r of rows) p[r.tipo] = r.conteudo;

  const partes: string[] = [];
  const arquivos: string[] = [];

  const pushPrompt = (tipo: string, label?: string) => {
    if (p[tipo]) {
      partes.push(label ? `## [${label}]\n${p[tipo]}` : p[tipo]);
      arquivos.push(`agente_prompts/${tipo}`);
    }
  };

  pushPrompt('soul', 'Identidade');
  pushPrompt('tom', 'Tom');
  pushPrompt('regras', 'Regras');
  pushPrompt('anti_repeticao', 'Anti-Repeticao');
  pushPrompt('pensamentos', 'Pensamentos');
  if (['acolhimento', 'qualificacao'].includes(etapa)) pushPrompt('modo_rapido', 'Modo-Rapido');
  if (['apresentacao_planos', 'negociacao', 'objecao', 'pre_fechamento', 'fechamento'].includes(etapa)) {
    pushPrompt('planos', 'Planos');
  }

  return { core: partes.join('\n\n'), arquivos };
}

// PRIORIDADE 3: vault-server (para Regras-Absolutas e arquivos avulsos)
async function lerVault(relativo: string, fallback: string): Promise<string> {
  const vaultUrl = process.env.VAULT_SERVER_URL;
  if (!vaultUrl) return fallback;
  try {
    const url = `${vaultUrl}/file?path=${encodeURIComponent(relativo)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return fallback;
    return await res.text();
  } catch {
    return fallback;
  }
}

// ── Formatação de preços (IDÊNTICA ao context-builder do agent-ai) ─────────────
function formatarPrecos(precos: any[]): string {
  if (!precos.length) return '';

  const fmt = (v: any) => (v == null || v === '') ? null : `R$${Number(v).toFixed(2).replace('.', ',')}`;
  const numerico = (s: any) => s == null ? null : parseFloat(String(s).replace('R$', '').replace(',', '.').trim());
  const iguais = (a: any, b: any) => {
    const na = numerico(a), nb = numerico(b);
    if (na == null || nb == null) return false;
    return Math.abs(na - nb) < 0.01;
  };

  const por_plano: Record<string, any> = {};
  precos.forEach(p => {
    if (!por_plano[p.slug]) por_plano[p.slug] = { nome: p.nome, modalidades: {} };
    por_plano[p.slug].modalidades[p.modalidade] = {
      tabela:      fmt(p.valor_tabela),
      promocional: fmt(p.valor_promocional),
      oferta:      fmt(p.valor_oferta),
      limite:      fmt(p.valor_limite),
    };
  });

  const linhas = ['TABELA DE PREÇOS — 4 FAIXAS (fonte única: BD.precos · confirmar sempre):'];
  const alertasMargem: string[] = [];

  for (const d of Object.values(por_plano)) {
    linhas.push(`\n${d.nome}:`);
    for (const [modal, v] of Object.entries<any>(d.modalidades)) {
      linhas.push(`  ${modal}: tabela ${v.tabela || '—'} | promocional ${v.promocional || '—'} | oferta ${v.oferta || '—'} | limite ${v.limite || '—'}`);
      const bloqueios: string[] = [];
      if (iguais(v.tabela, v.promocional)) bloqueios.push('Tabela→Promocional (não falar "campanha")');
      if (iguais(v.promocional, v.oferta)) bloqueios.push('Promocional→Oferta (NÃO aplicar Efeito WOW)');
      if (iguais(v.oferta, v.limite))      bloqueios.push('Oferta→Limite (NÃO acionar Supervisora Li)');
      if (bloqueios.length) alertasMargem.push(`  ${d.nome} ${modal}: ${bloqueios.join(' · ')}`);
    }
  }

  if (alertasMargem.length) {
    linhas.push('', '🚫 BLOQUEIOS DE DESCONTO (faixas com valor IGUAL — pular essas negociações):');
    linhas.push(...alertasMargem);
    linhas.push('', 'REGRA: quando a faixa atual = próxima faixa, NÃO oferecer o "desconto" que não existe.');
  }

  linhas.push(
    '', 'REGRAS DE USO DAS FAIXAS:',
    '- TABELA: âncora visual riscada. Sempre aparece ao lado do Promocional ("~Tabela~ por *Promocional*"). Nunca ofertada sozinha.',
    '- PROMOCIONAL: primeiro preço que o cliente vê (~10% off Tabela). Formato obrigatório: de ~Tabela~ por *Promocional*.',
    '- OFERTA: revelada via Efeito WOW antes de enviar o link (~15% off). Se cliente já está na Oferta, fecha sem WOW adicional.',
    '- LIMITE: teto absoluto. Só via técnica da Supervisora (Li) OU reengajamento de vácuo.',
    '- NUNCA citar valores que não estejam nesta tabela. NUNCA inventar desconto ou promoção sem base.',
  );

  return linhas.join('\n');
}

// ── Fallback de regras absolutas (usado quando vault/knowledge_base não tem o arquivo) ──
const FALLBACK_REGRAS = `# FORMATO DE RESPOSTA
Responda APENAS em JSON válido com exatamente estes 4 campos:
{"r":"mensagem ao cliente","e":"etapa","d":{"nc":null,"cp":null,"em":null,"cf":null,"pi":null},"pet":{"nome":null,"especie":null,"raca":null,"idade":null,"sexo":null,"castrado":null}}

Descrição dos campos:
- r  = sua resposta para o cliente (texto livre, pode ser longa — NUNCA corte no meio)
- e  = etapa atual da conversa (acolhimento | qualificacao | apresentacao_planos | validacao_cep | negociacao | objecao | pre_fechamento | fechamento)
- d  = dados do CLIENTE: nc=nome_cliente, cp=cep, em=email, cf=cpf, pi=plano_de_interesse
- pet = dados do PET (preencha APENAS o que o cliente mencionou explicitamente):
    nome=nome do pet  |  especie=cachorro/gato/outro  |  raca=raça exata
    idade=número em anos  |  sexo=M ou F  |  castrado=true ou false

Deixe null qualquer campo não mencionado pelo cliente.
NÃO use em dash (—) nas respostas. NÃO invente planos, preços ou procedimentos.`;

// ── Montagem do prompt (replica context-builder.ts do agent-ai) ────────────────
async function montarContexto(
  agentId: number,
  etapa: string,
  canal: string,
  perfil: SandboxInput['perfil_lead'],
): Promise<{ prompt: string; arquivos: string[]; meta: Array<{ caminho: string; atualizado_em: string | null; tamanho: number }> }> {
  const partes: string[] = [];

  // 1. Base + extras por etapa (MESMO CONJUNTO DO AGENT-AI)
  const extras = ETAPA_ARQUIVOS[etapa] || [];
  const fixos  = [...new Set([...BASE_MARI, ...extras])];
  const paths  = fixos.map(f => f.replace(/\.md$/, '')); // 'Mari/Identidade.md' → 'Mari/Identidade'

  // PRIORIDADE 1: knowledge_base_docs
  const { core, arquivos, meta } = await lerKnowledgeBaseComMeta(agentId, etapa, paths);

  if (core) {
    partes.push('# IDENTIDADE E COMPORTAMENTO\n' + core);
  } else {
    // PRIORIDADE 2: agente_prompts
    const { core: corePrompts, arquivos: arqPrompts } = await lerAgentPrompts(agentId, etapa);
    if (corePrompts) {
      partes.push('# IDENTIDADE E COMPORTAMENTO\n' + corePrompts);
      arquivos.push(...arqPrompts);
      meta.push(...arqPrompts.map(a => ({ caminho: a, atualizado_em: null, tamanho: 0 })));
    }
  }

  // 2. Preços do BD (SEMPRE, igual ao agent-ai após 21/04/2026)
  const precos = await query<any>(
    `SELECT p.slug, p.nome, pr.modalidade,
            pr.valor, pr.valor_tabela, pr.valor_promocional, pr.valor_oferta, pr.valor_limite
     FROM precos pr JOIN planos p ON p.id = pr.plano_id
     WHERE pr.ativo = true AND p.ativo = true
     ORDER BY p.ordem, p.id, pr.modalidade`
  ).catch(() => []);

  const txtPrecos = formatarPrecos(precos);
  if (txtPrecos) {
    partes.push('# DADOS DO PRODUTO (fonte da verdade — use exatamente)\nPreços atuais:\n' + txtPrecos);
    arquivos.push('db/precos');
    meta.push({ caminho: 'db/precos', atualizado_em: new Date().toISOString(), tamanho: txtPrecos.length });
  }

  // 3. Preços de mercado de procedimentos (ancoragem)
  const precosMercado = await query<any>(
    `SELECT slug, nome, valor_min, valor_max FROM precos_mercado WHERE ativo = true ORDER BY ordem, nome`
  ).catch(() => []);
  if (precosMercado.length) {
    const linhas = precosMercado.map((r: any) =>
      `- ${r.nome}: particular até R$${r.valor_max} (mín R$${r.valor_min})`
    );
    partes.push(
      `# PREÇOS DE MERCADO · PROCEDIMENTOS (ancoragem obrigatória)\n` +
      `Quando for citar custo particular de qualquer procedimento, CONSULTE esta lista PRIMEIRO e use o valor MAX no formato "pode custar até R$X". NUNCA invente valor.\n\n` +
      linhas.join('\n')
    );
  }

  // 4. Perfil do lead (dados do simulador)
  const campoPerfil: string[] = [];
  if (perfil.nome)           campoPerfil.push(`Pet: ${perfil.nome}`);
  if (perfil.especie)        campoPerfil.push(`Espécie: ${perfil.especie}`);
  if (perfil.raca)           campoPerfil.push(`Raça: ${perfil.raca}`);
  if (perfil.idade_anos)     campoPerfil.push(`Idade: ${perfil.idade_anos} anos`);
  if (perfil.cep)            campoPerfil.push(`CEP: ${perfil.cep}`);
  if (perfil.email)          campoPerfil.push(`Email: ${perfil.email}`);
  if (perfil.problema_saude) campoPerfil.push(`Problema de saúde: ${perfil.problema_saude}`);
  if (campoPerfil.length) partes.push('# DADOS DO CLIENTE\n' + campoPerfil.join('\n'));

  // 5. Orientação do sistema (simplificada — sem decisor real)
  partes.push(`# ORIENTAÇÃO DO SISTEMA
Modo: ${etapa}
Canal: ${canal}
Etapa atual: ${etapa}
[SANDBOX — simulação de atendimento real, sem gravar em banco de produção]`);

  // 6. Regras absolutas + formato de saída
  // Tenta carregar Mari/Regras-Absolutas do knowledge_base_docs primeiro
  const regrasKB = await lerKnowledgeBase(agentId, etapa, ['Mari/Regras-Absolutas']).catch(() => null);
  const regrasAbsolutas = regrasKB || await lerVault('Mari/Regras-Absolutas.md', FALLBACK_REGRAS);
  partes.push(`# REGRAS ABSOLUTAS\n${regrasAbsolutas}`);

  return { prompt: partes.join('\n\n'), arquivos, meta };
}

// ── Parser da resposta LLM ────────────────────────────────────────────────────
function parsearResposta(
  text: string,
  etapaInicial: string,
): { resposta: string; etapa: string; perfil_extraido: Record<string, any> } {
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);

  if (match) {
    try {
      const raw = JSON.parse(match[0]);
      const d: Record<string, any> = raw.d || {};
      const pet: Record<string, any> = raw.pet || {};

      const perfil: Record<string, any> = {};
      if (pet.nome    != null && pet.nome    !== '') perfil.nome       = pet.nome;
      if (pet.especie != null && pet.especie !== '') perfil.especie    = pet.especie;
      if (pet.raca    != null && pet.raca    !== '') perfil.raca       = pet.raca;
      if (pet.idade   != null && pet.idade   !== '') perfil.idade_anos = pet.idade;
      if (d.cp        != null && d.cp        !== '') perfil.cep        = d.cp;
      if (d.em        != null && d.em        !== '') perfil.email      = d.em;

      return {
        resposta: raw.r || raw.resposta || clean,
        etapa:    raw.e || raw.etapa || etapaInicial,
        perfil_extraido: perfil,
      };
    } catch { /* fallthrough */ }
  }

  return { resposta: clean, etapa: etapaInicial, perfil_extraido: {} };
}

// ── Entry point ───────────────────────────────────────────────────────────────
export async function processarMensagem(input: SandboxInput): Promise<SandboxResult> {
  const t0 = Date.now();

  const agente = await queryOne<any>(
    `SELECT id FROM agentes WHERE ativo=true ORDER BY id LIMIT 1`
  ).catch(() => null);
  if (!agente) throw new Error('Nenhum agente ativo encontrado no banco de dados.');

  const { prompt, arquivos, meta } = await montarContexto(
    agente.id, input.etapa, input.canal, input.perfil_lead
  );

  const messages: Anthropic.MessageParam[] = [
    ...input.mensagens.map(m => ({
      role: (m.role === 'agent' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: m.conteudo,
    })),
    { role: 'user' as const, content: input.mensagem_teste },
  ];

  const modelo = resolverModelo(input.modelo_override || '');

  const response = await getAnthropic().messages.create({
    model:      modelo,
    max_tokens: 1500,
    system:     prompt,
    messages,
  });

  const duracao_ms = Date.now() - t0;
  const rawText = (response.content[0] as any).text || '';
  const { resposta, etapa: etapaEfetiva, perfil_extraido } = parsearResposta(rawText, input.etapa);

  const tokensIn  = response.usage.input_tokens;
  const tokensOut = response.usage.output_tokens;

  return {
    resposta,
    etapa_efetiva:     etapaEfetiva,
    etapa_mudou:       etapaEfetiva !== input.etapa,
    perfil_extraido,
    tokens_input:      tokensIn,
    tokens_output:     tokensOut,
    custo_usd:         calcularCusto(modelo, tokensIn, tokensOut),
    duracao_ms,
    arquivos_carregados: arquivos,
    arquivos_meta:       meta,
    ...(input.mostrar_prompt ? { prompt_sistema: prompt } : {}),
  };
}
