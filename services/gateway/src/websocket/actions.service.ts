const AGENT_AI_URL = process.env.AGENT_AI_URL || 'http://agent-ai.railway.internal:8080';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'plamev-internal';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

// Fallback: chama Claude API diretamente quando agent-ai está inacessível
async function reescreverComClaudeDireto(texto: string): Promise<string> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('agent-ai inacessível e ANTHROPIC_API_KEY não configurado no gateway');
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: `Você é Mari, assistente de vendas da Plamev. Tom: caloroso, humano, direto e natural.
Sua missão é transformar qualquer entrada do supervisor em uma mensagem gentil ao cliente.
REGRAS:
1. NUNCA deixe passar termos pejorativos, palavrões ou gírias.
2. Se o supervisor for agressivo, traduza a intenção para uma pergunta ou afirmação doce.
3. Responda APENAS com a mensagem final para o cliente, sem aspas, sem explicações adicionais.`,
      messages: [{ role: 'user', content: `Reescreva no tom da Mari:\n${texto}` }],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) throw new Error(`Claude API HTTP ${resp.status}`);
  const data = await resp.json() as any;
  const reescrito = data.content?.[0]?.text?.trim();
  if (!reescrito) throw new Error('Claude retornou texto vazio');
  return reescrito;
}

function isNetworkError(e: any): boolean {
  return (
    e?.cause?.code === 'ECONNREFUSED' ||
    e?.cause?.code === 'ENOTFOUND' ||
    e?.cause?.code === 'ETIMEDOUT' ||
    e?.cause?.code === 'ECONNRESET' ||
    e?.message === 'fetch failed' ||
    (e?.name === 'TypeError' && e?.message?.includes('fetch'))
  );
}

export async function reescreverComoMari(
  conversaId: string,
  texto: string,
): Promise<string> {
  // 1ª tentativa: agent-ai (serviço especializado com contexto da conversa)
  try {
    console.log(`[ACTIONS] 📡 Chamando rewrite em: ${AGENT_AI_URL}/internal/rewrite`);
    const resp = await fetch(`${AGENT_AI_URL}/internal/rewrite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ conversa_id: conversaId, texto }),
      signal: AbortSignal.timeout(20000),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => 'sem corpo');
      console.error(`[ACTIONS] ❌ agent-ai rewrite HTTP ${resp.status}: ${errText}`);
      throw new Error(`HTTP ${resp.status}: ${errText}`);
    }

    const data = await resp.json() as any;
    if (!data.texto_reescrito) throw new Error('agent-ai retornou texto vazio');
    console.log(`[ACTIONS] ✅ Texto reescrito via agent-ai`);
    return data.texto_reescrito;
  } catch (agentErr: any) {
    if (!isNetworkError(agentErr)) {
      // Erro HTTP do agent-ai (4xx/5xx) — não faz sentido tentar fallback
      console.error('[ACTIONS] ❌ Erro HTTP do agent-ai:', agentErr.message);
      throw agentErr;
    }
    const code = agentErr?.cause?.code || agentErr.message;
    console.warn(`[ACTIONS] ⚠️ agent-ai inacessível (${code}) — ativando fallback Claude direto`);
  }

  // 2ª tentativa: Claude API diretamente (fallback quando agent-ai está fora)
  try {
    const resultado = await reescreverComClaudeDireto(texto);
    console.log(`[ACTIONS] ✅ Texto reescrito via fallback Claude API direto`);
    return resultado;
  } catch (claudeErr: any) {
    console.error('[ACTIONS] ❌ Fallback Claude também falhou:', claudeErr.message);
    throw new Error(`Reescrita indisponível: agent-ai e fallback falharam. Tente novamente em instantes.`);
  }
}
