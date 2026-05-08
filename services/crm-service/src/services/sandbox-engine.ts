/**
 * services/sandbox-engine.ts
 * Motor autônomo do Chat Simulator — chama Anthropic diretamente sem depender
 * do Intelligence V1 (que não existe neste monorepo).
 */
import Anthropic from '@anthropic-ai/sdk';
import { query, queryOne } from '../config/db';
import { env } from '../config/env';

// Lazy singleton
let _client: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_client) {
    const key = env.anthropicKey;
    if (!key) throw new Error('ANTHROPIC_API_KEY não configurada.');
    _client = new Anthropic({ apiKey: key });
  }
  return _client;
}

// Custo estimado por 1k tokens (input / output) — Anthropic pricing
const COST_PER_1K: Record<string, { i: number; o: number }> = {
  'claude-haiku-4-5':           { i: 0.00025, o: 0.00125 },
  'claude-haiku-4-5-20251001':  { i: 0.00025, o: 0.00125 },
  'claude-sonnet-4-6':          { i: 0.003,   o: 0.015   },
  'claude-opus-4-5':            { i: 0.015,   o: 0.075   },
  'claude-opus-4-7':            { i: 0.015,   o: 0.075   },
};

// Normaliza aliases de modelo
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

// ── Carregamento de dados ─────────────────────────────────────────────────────

async function carregarPrompts(agentId: number): Promise<Record<string, string>> {
  const rows = await query<any>(
    `SELECT tipo, conteudo FROM agente_prompts WHERE agent_id=$1 AND ativo=true ORDER BY ordem`,
    [agentId]
  ).catch(() => []);
  const result: Record<string, string> = {};
  for (const row of rows) {
    if (row.conteudo?.trim()) result[row.tipo] = row.conteudo;
  }
  return result;
}

async function carregarPrecos(): Promise<any[]> {
  return query<any>(
    `SELECT p.slug, p.nome, pr.modalidade,
            pr.valor_tabela, pr.valor_promocional, pr.valor_oferta, pr.valor_limite
     FROM precos pr
     JOIN planos p ON p.id = pr.plano_id
     WHERE pr.ativo = true AND p.ativo = true
     ORDER BY p.ordem, pr.modalidade`
  ).catch(() => []);
}

// ── Montagem do prompt do sistema ─────────────────────────────────────────────

function formatarTabPrecos(precos: any[]): string {
  if (!precos.length) return '';
  const fmt = (v: any) => (v == null || v === '') ? '—' : `R$${Number(v).toFixed(2).replace('.', ',')}`;
  const lines = ['TABELA DE PRECOS (fonte: banco de dados):'];
  for (const p of precos) {
    lines.push(`  ${p.nome} (${p.modalidade}): tabela ${fmt(p.valor_tabela)} | promocional ${fmt(p.valor_promocional)} | oferta ${fmt(p.valor_oferta)} | limite ${fmt(p.valor_limite)}`);
  }
  return lines.join('\n');
}

interface PromptResult { prompt: string; arquivos: string[] }

function montarPrompt(
  prompts: Record<string, string>,
  precos: any[],
  etapa: string,
  canal: string,
  perfil: SandboxInput['perfil_lead'],
): PromptResult {
  const partes: string[] = [];
  const arquivos: string[] = [];

  if (prompts.soul) {
    partes.push('# IDENTIDADE E COMPORTAMENTO\n' + prompts.soul);
    arquivos.push('agente_prompts/soul');
  }
  if (prompts.tom) {
    partes.push(prompts.tom);
    arquivos.push('agente_prompts/tom');
  }
  if (prompts.regras) {
    partes.push(prompts.regras);
    arquivos.push('agente_prompts/regras');
  }
  if (prompts.anti_repeticao) {
    partes.push(prompts.anti_repeticao);
    arquivos.push('agente_prompts/anti_repeticao');
  }
  if (prompts.pensamentos) {
    partes.push(prompts.pensamentos);
    arquivos.push('agente_prompts/pensamentos');
  }
  if (prompts.modo_rapido && ['acolhimento', 'qualificacao'].includes(etapa)) {
    partes.push(prompts.modo_rapido);
    arquivos.push('agente_prompts/modo_rapido');
  }
  if (prompts.planos && ['apresentacao_planos', 'negociacao', 'objecao', 'pre_fechamento', 'fechamento'].includes(etapa)) {
    partes.push('# PLANOS DISPONIVEIS\n' + prompts.planos);
    arquivos.push('agente_prompts/planos');
  }

  const tabelaPrecos = formatarTabPrecos(precos);
  if (tabelaPrecos) {
    partes.push('# ' + tabelaPrecos);
    arquivos.push('db/precos');
  }

  // Contexto da sessão atual
  const ctx: string[] = [`Canal: ${canal}`, `Etapa atual: ${etapa}`];
  if (perfil.nome)           ctx.push(`Pet: ${perfil.nome}`);
  if (perfil.especie)        ctx.push(`Especie: ${perfil.especie}`);
  if (perfil.raca)           ctx.push(`Raca: ${perfil.raca}`);
  if (perfil.idade_anos)     ctx.push(`Idade: ${perfil.idade_anos} anos`);
  if (perfil.cep)            ctx.push(`CEP: ${perfil.cep}`);
  if (perfil.email)          ctx.push(`Email: ${perfil.email}`);
  if (perfil.problema_saude) ctx.push(`Problema de saude: ${perfil.problema_saude}`);
  partes.push('# CONTEXTO DA CONVERSA\n' + ctx.join('\n'));

  // Fallback de identidade minima se nenhum prompt foi carregado
  if (!prompts.soul) {
    partes.unshift(
      '# IDENTIDADE\nVoce e a Mari, consultora de planos pet da Plamev Brasil. ' +
      'Responda em portugues, de forma natural e acolhedora, sem ser robotica. ' +
      'Seu objetivo e qualificar o lead e fechar a venda do plano mais adequado para o pet do cliente.'
    );
  }

  partes.push(`# FORMATO DE RESPOSTA
Responda APENAS em JSON valido com exatamente estes campos:
{"r":"mensagem ao cliente","e":"etapa","d":{"nc":null,"cp":null,"em":null,"cf":null,"pi":null},"pet":{"nome":null,"especie":null,"raca":null,"idade":null,"sexo":null,"castrado":null}}

Campos:
- r  = sua resposta ao cliente (texto direto, sem markdown complexo)
- e  = etapa atual: acolhimento | qualificacao | apresentacao_planos | validacao_cep | negociacao | objecao | pre_fechamento | fechamento
- d  = dados do CLIENTE: nc=nome_cliente, cp=cep, em=email, cf=cpf, pi=plano_de_interesse
- pet = dados do PET (so o que o cliente mencionou explicitamente): nome | especie | raca | idade (numero) | sexo (M ou F) | castrado (true/false)
Deixe null qualquer campo nao mencionado.
NAO use em dash (--) na resposta. NAO invente informacoes.`);

  return { prompt: partes.join('\n\n'), arquivos };
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
      if (pet.nome     != null && pet.nome     !== '') perfil.nome          = pet.nome;
      if (pet.especie  != null && pet.especie  !== '') perfil.especie       = pet.especie;
      if (pet.raca     != null && pet.raca     !== '') perfil.raca          = pet.raca;
      if (pet.idade    != null && pet.idade    !== '') perfil.idade_anos    = pet.idade;
      if (d.cp         != null && d.cp         !== '') perfil.cep           = d.cp;
      if (d.em         != null && d.em         !== '') perfil.email         = d.em;

      return {
        resposta: raw.r || raw.resposta || clean,
        etapa: raw.e || raw.etapa || etapaInicial,
        perfil_extraido: perfil,
      };
    } catch { /* fallthrough to plain text */ }
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

  const [prompts, precos] = await Promise.all([
    carregarPrompts(agente.id),
    carregarPrecos(),
  ]);

  const { prompt, arquivos } = montarPrompt(prompts, precos, input.etapa, input.canal, input.perfil_lead);

  const messages: Anthropic.MessageParam[] = [
    ...input.mensagens.map(m => ({
      role: (m.role === 'agent' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: m.conteudo,
    })),
    { role: 'user' as const, content: input.mensagem_teste },
  ];

  const modelo = resolverModelo(input.modelo_override || '');

  const response = await getAnthropic().messages.create({
    model: modelo,
    max_tokens: 1500,
    system: prompt,
    messages,
  });

  const duracao_ms = Date.now() - t0;
  const rawText = (response.content[0] as any).text || '';
  const { resposta, etapa: etapaEfetiva, perfil_extraido } = parsearResposta(rawText, input.etapa);

  const tokensIn  = response.usage.input_tokens;
  const tokensOut = response.usage.output_tokens;

  const arquivosMeta = arquivos.map(a => ({ caminho: a, atualizado_em: null, tamanho: 0 }));

  return {
    resposta,
    etapa_efetiva:    etapaEfetiva,
    etapa_mudou:      etapaEfetiva !== input.etapa,
    perfil_extraido,
    tokens_input:     tokensIn,
    tokens_output:    tokensOut,
    custo_usd:        calcularCusto(modelo, tokensIn, tokensOut),
    duracao_ms,
    arquivos_carregados: arquivos,
    arquivos_meta:       arquivosMeta,
    ...(input.mostrar_prompt ? { prompt_sistema: prompt } : {}),
  };
}
