/**
 * services/config.ts — Carrega configuração dinâmica de agentes/canais do CRM service.
 * Substitui os hardcodes de instâncias e DDDs do chips.ts e sender.ts.
 * Recarrega automaticamente a cada 2 minutos via poll HTTP interno.
 */
import https from 'https';
import http from 'http';

const CRM_URL = process.env.CRM_SERVICE_URL || 'http://crm-service.railway.internal:8080';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'plamev-internal';

export interface WaInstance {
  instancia_nome: string;
  instancia_label: string;
  ddd_prefixos: string[];
  chip_fallback: boolean;
  agent_slug: string;
  provider: string;
  evolution_url: string;
  evolution_api_key: string;
}

export interface TelegramBot {
  bot_token: string;
  bot_nome: string;
  agent_slug: string;
}

export interface ChannelConfig {
  instances: WaInstance[];
  telegram_bots: TelegramBot[];
}

let _config: ChannelConfig = { instances: [], telegram_bots: [] };

function fetchJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(
      { hostname: parsed.hostname, port: parsed.port || undefined, path: parsed.pathname + (parsed.search || ''), method: 'GET', headers, timeout: 5000 },
      res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('JSON parse error')); } });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

export async function recarregar(): Promise<void> {
  const data = await fetchJson(
    `${CRM_URL}/api/internal/channel-config`,
    { 'x-internal-secret': INTERNAL_SECRET }
  );
  if (data?.ok) {
    _config = { instances: data.instances || [], telegram_bots: data.telegram_bots || [] };
    console.log(`[CONFIG] ✅ ${_config.instances.length} instâncias WA, ${_config.telegram_bots.length} bots TG`);
  }
}

export function getConfig(): ChannelConfig { return _config; }

export function resolverAgentePorInstancia(instancia: string): string {
  const found = _config.instances.find(i => i.instancia_nome === instancia);
  return found?.agent_slug || (instancia.includes('rapha') ? 'rapha' : 'mari');
}

export function resolverInstanciaPorDDD(phone: string): string | null {
  const p = String(phone).replace(/\D/g, '');
  // Strip Brazil country code (55) so matching works regardless of whether phone includes it
  const pLocal = p.startsWith('55') && p.length >= 12 ? p.slice(2) : p;

  for (const inst of _config.instances) {
    for (const ddd of (inst.ddd_prefixos || [])) {
      // Normalize stored prefix: remove non-digits and leading zeros
      const prefix = ddd.replace(/\D/g, '').replace(/^0+/, '');
      if (prefix && pLocal.startsWith(prefix)) return inst.instancia_nome;
    }
  }

  // Single instance configured: always route to it
  if (_config.instances.length === 1) return _config.instances[0].instancia_nome;

  const fallback = _config.instances.find(i => i.chip_fallback);
  return fallback?.instancia_nome || null;
}

export function nomeAmigavelInstancia(instancia: string): string {
  const found = _config.instances.find(i => i.instancia_nome === instancia);
  return found?.instancia_label || instancia;
}

export function getInstanciaConfig(instancia: string): WaInstance | null {
  return _config.instances.find(i => i.instancia_nome === instancia) || null;
}

export function tokenTelegramPorAgente(agentSlug: string): string {
  const bot = _config.telegram_bots.find(b => b.agent_slug === agentSlug);
  return bot?.bot_token || process.env.TELEGRAM_TOKEN || '';
}

export async function iniciar(): Promise<void> {
  // Tenta carregar com retries antes de iniciar o servidor
  for (let i = 0; i < 6; i++) {
    try {
      await recarregar();
      break;
    } catch (e: any) {
      const delay = Math.min(5000 * (i + 1), 30000);
      console.warn(`[CONFIG] ⏳ Tentativa ${i + 1}/6 falhou (${e.message}), aguardando ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  // Recarrega a cada 2 minutos
  setInterval(() => recarregar().catch(e => console.warn('[CONFIG] ⚠️ Falha ao recarregar:', e.message)), 2 * 60 * 1000);
}
