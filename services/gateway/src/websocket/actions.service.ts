const AGENT_AI_URL = process.env.AGENT_AI_URL || 'http://agent-ai.railway.internal:8080';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'plamev-internal';

export async function reescreverComoMari(
  conversaId: string,
  texto: string,
): Promise<string> {
  try {
    const resp = await fetch(`${AGENT_AI_URL}/internal/rewrite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ conversa_id: conversaId, texto }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => 'sem corpo');
      console.error(`[ACTIONS] ❌ Falha no rewrite: ${resp.status} - ${errText}`);
      throw new Error(`HTTP ${resp.status}`);
    }
    const data = await resp.json() as any;
    console.log(`[ACTIONS] ✅ Texto reescrito com sucesso (tamanho: ${data.texto_reescrito?.length})`);
    return data.texto_reescrito || texto;
  } catch (e: any) {
    console.error('[ACTIONS] ⚠️ Erro ao reescrever (usando original):', e.message);
    return texto;
  }
}
