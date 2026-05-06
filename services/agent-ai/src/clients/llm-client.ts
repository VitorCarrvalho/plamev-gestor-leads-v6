import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { AgentConfig, GenerationResult } from '@plamev/shared';

// Lazy singletons — instanciados apenas na primeira chamada real,
// nunca durante o import/startup (evita crash por env var ausente).
let _anthropic: Anthropic | null = null;
let _openai: OpenAI | null = null;

function getAnthropic(): Anthropic {
  if (!_anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada.');
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

function getOpenAI(): OpenAI {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY não configurada.');
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export async function generateResponse(
  systemPrompt: string,
  messages: ChatMessage[],
  config: AgentConfig,
  retries = 3
): Promise<GenerationResult | null> {
  let attempt = 0;
  
  while (attempt < retries) {
    try {
      if (config.provider === 'openai') {
        return await generateOpenAI(systemPrompt, messages, config.model);
      } else {
        return await generateAnthropic(systemPrompt, messages, config.model);
      }
    } catch (error: any) {
      attempt++;
      console.error(`[LLM-CLIENT] Erro na tentativa ${attempt}/${retries}:`, error.message);
      if (attempt >= retries) throw error;
      // Espera exponencial: 1s, 2s, 4s
      await new Promise(r => setTimeout(r, Math.pow(2, attempt - 1) * 1000));
    }
  }
  return null;
}

async function generateAnthropic(system: string, messages: ChatMessage[], model: string): Promise<GenerationResult> {
  const formattedMessages: Anthropic.MessageParam[] = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content
    }));

  const response = await getAnthropic().messages.create({
    model: model || 'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    system,
    messages: formattedMessages,
  });

  const text = (response.content[0] as any).text || '';
  const parsed = parseLLMResponse(text);
  
  return {
    ...parsed,
    _uso: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens
    }
  };
}

async function generateOpenAI(system: string, messages: ChatMessage[], model: string): Promise<GenerationResult> {
  const response = await getOpenAI().chat.completions.create({
    model: model || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system },
      ...messages
    ] as any,
    max_tokens: 1500,
  });

  const text = response.choices[0]?.message?.content || '';
  const parsed = parseLLMResponse(text);
  
  return {
    ...parsed,
    _uso: {
      input_tokens: response.usage?.prompt_tokens || 0,
      output_tokens: response.usage?.completion_tokens || 0
    }
  };
}

function parseLLMResponse(text: string): Omit<GenerationResult, '_uso'> {
  const cleanText = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  const match = cleanText.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const raw = JSON.parse(match[0]);
      // Dados gerais do cliente (campo "d" com chaves curtas)
      const d: Record<string, any> = { ...(raw.d || raw.dados_extraidos || {}) };

      // Campo "pet" com nomes explícitos — mescla nas chaves curtas que o CRM já lê
      const pet: Record<string, any> = raw.pet || {};
      if (pet.nome     != null) d.np = d.np ?? pet.nome;
      if (pet.especie  != null) d.ep = d.ep ?? pet.especie;
      if (pet.raca     != null) d.rp = d.rp ?? pet.raca;
      if (pet.idade    != null) d.ip = d.ip ?? pet.idade;
      if (pet.idade_anos != null) d.ip = d.ip ?? pet.idade_anos;
      if (pet.sexo     != null) d.sx = d.sx ?? pet.sexo;
      if (pet.castrado != null) d.ca = d.ca ?? pet.castrado;

      return {
        resposta: raw.r || raw.resposta || null,
        etapa: raw.e || raw.etapa || 'acolhimento',
        dados_extraidos: d,
        acoes: raw.acoes || ['salvar_conversa'],
      };
    } catch {}
  }

  // Fallback para texto puro se não conseguir parsear JSON
  return {
    resposta: cleanText,
    etapa: 'acolhimento',
    dados_extraidos: {},
    acoes: ['salvar_conversa'],
  };
}
