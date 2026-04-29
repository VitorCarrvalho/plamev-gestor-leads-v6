/**
 * vault.ts — Carregador de prompts via vault-server (HTTP interna Railway)
 *
 * Busca arquivos .md do vault-server. Cache TTL 60s para arquivos carregados com sucesso.
 * Falhas NÃO são cacheadas — cada requisição retenta o vault-server.
 */

const VAULT_SERVER_URL =
  process.env.VAULT_SERVER_URL || 'http://plamev-gestor-leads-v6-fda4.railway.internal:8080';

// Loga a URL no boot para confirmar qual endpoint está sendo usado
console.log(`[vault] 🔧 VAULT_SERVER_URL=${VAULT_SERVER_URL} (VAULT_SERVER_URL env=${process.env.VAULT_SERVER_URL || 'não definido — usando default'})`);

const CACHE_TTL_MS = 60_000;
const _cache = new Map<string, { at: number; conteudo: string }>();
let _listaCache: { at: number; lista: string[] } | null = null;

export async function carregar(relativo: string, fallback = ''): Promise<string> {
  const cached = _cache.get(relativo);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.conteudo;

  try {
    const url = `${VAULT_SERVER_URL}/file?path=${encodeURIComponent(relativo)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const conteudo = await res.text();
    _cache.set(relativo, { at: Date.now(), conteudo });
    console.log(`[vault] ✅ ${relativo} (${conteudo.length} chars)`);
    return conteudo;
  } catch (e: any) {
    // Falhas NÃO cacheadas — próxima requisição retenta o vault-server
    console.warn(`[vault] ⚠️ ${relativo} falhou em ${VAULT_SERVER_URL}: ${e.message}`);
    return fallback;
  }
}

export async function listar(): Promise<string[]> {
  if (_listaCache && Date.now() - _listaCache.at < CACHE_TTL_MS) return _listaCache.lista;
  try {
    const url = `${VAULT_SERVER_URL}/files`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { files: string[] };
    const lista = data.files || [];
    _listaCache = { at: Date.now(), lista };
    console.log(`[vault] ✅ lista: ${lista.length} arquivos`);
    return lista;
  } catch (e: any) {
    console.warn(`[vault] ⚠️ listar() falhou em ${VAULT_SERVER_URL}: ${e.message}`);
    return _listaCache?.lista || [];
  }
}

export function invalidar(relativo?: string) {
  if (relativo) _cache.delete(relativo);
  else { _cache.clear(); _listaCache = null; }
}
