/**
 * vault.ts — Carregador de prompts via vault-server (HTTP interna Railway)
 *
 * Busca arquivos .md do vault-server. Cache TTL 60s para não sobrecarregar.
 * Fallback: retorna a string de fallback passada se o arquivo não existir
 * ou o vault-server estiver indisponível.
 */

const VAULT_SERVER_URL =
  process.env.VAULT_SERVER_URL || 'http://vault-server.railway.internal:8080';

const CACHE_TTL_MS = 60_000;
const _cache = new Map<string, { at: number; conteudo: string }>();

export async function carregar(relativo: string, fallback = ''): Promise<string> {
  const cached = _cache.get(relativo);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.conteudo;

  try {
    const url = `${VAULT_SERVER_URL}/file?path=${encodeURIComponent(relativo)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });

    if (!res.ok) {
      if (res.status !== 404) {
        console.warn(`[vault] ⚠️ ${relativo} → HTTP ${res.status}`);
      }
      throw new Error(`HTTP ${res.status}`);
    }

    const conteudo = await res.text();
    _cache.set(relativo, { at: Date.now(), conteudo });
    return conteudo;
  } catch (e: any) {
    if (!cached) {
      console.warn(`[vault] ⚠️ ${relativo} indisponível (${e.message}) — usando fallback`);
    }
    _cache.set(relativo, { at: Date.now(), conteudo: fallback });
    return fallback;
  }
}

export function invalidar(relativo?: string) {
  if (relativo) _cache.delete(relativo);
  else _cache.clear();
}
