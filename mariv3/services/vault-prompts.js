/**
 * services/vault-prompts.js — Carregador de prompts do Obsidian Vault
 *
 * Lê os .md que agora são a FONTE ÚNICA de personalidade/regras da Mari.
 * Cache TTL: 60 segundos (edição no Obsidian reflete em até 1min).
 *
 * Fallback: se o arquivo não existir ou der erro, retorna a string fallback
 * passada. Isso garante que mudanças no vault não quebrem o runtime.
 */
const fs   = require('fs');
const path = require('path');

// Resolvido dinamicamente via agente.obsidian_path ou env
// 21/04/2026 — Getúlio: único vault oficial = workspace (Mari-Knowledge-Base legado arquivado)
const DEFAULT_VAULT = process.env.VAULT_PATH
  || '/Users/geta/Documents/workspace/mari-plamev-sistema/obsidian-knowledge-base';

const CACHE_TTL_MS = 60_000;
const _cache = new Map(); // key = absolutePath → { at, conteudo }

function resolverPath(vaultPath, relativo) {
  return path.join(vaultPath || DEFAULT_VAULT, relativo);
}

/**
 * Carrega um .md do vault. Retorna fallback se não existir.
 * @param {string} relativo — ex: 'Mari/Regras-Absolutas.md'
 * @param {string} fallback — conteúdo usado se o arquivo faltar
 * @param {string} [vaultPath] — opcional, default DEFAULT_VAULT
 */
function carregar(relativo, fallback = '', vaultPath = DEFAULT_VAULT) {
  const abs = resolverPath(vaultPath, relativo);
  const cached = _cache.get(abs);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.conteudo;
  try {
    const conteudo = fs.readFileSync(abs, 'utf8');
    _cache.set(abs, { at: Date.now(), conteudo });
    return conteudo;
  } catch (e) {
    // Só warn uma vez por arquivo — evita poluir log
    if (!cached) console.warn(`[vault-prompts] ⚠️ ${relativo} indisponível — usando fallback`);
    _cache.set(abs, { at: Date.now(), conteudo: fallback });
    return fallback;
  }
}

/**
 * Limpa o cache (chamado em dev/tests).
 */
function invalidar() { _cache.clear(); }

module.exports = { carregar, invalidar, DEFAULT_VAULT };
