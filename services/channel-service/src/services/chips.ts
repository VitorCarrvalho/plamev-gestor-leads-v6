import https from 'https';

const EVO_HOST = 'legendarios-evolution-api.bycpkh.easypanel.host';
const EVO_KEY = process.env.EVOLUTION_API_KEY || '';

export const mapaChips = new Map<string, string>();

const nomesInstancias: Record<string, string> = {
  "mari-plamev-whatsapp": "Mari 011 (legado)",
  "mari011": "Mari 011",
  "mari-plamev-zap2": "Mari 031",
  "plamev": "Bella 021",
  "grione": "Grione",
};

export function nomeAmigavel(instancia: string): string {
  return nomesInstancias[instancia] || instancia;
}

function evoGet(path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(`https://${EVO_HOST}${path}`, { headers: { apikey: EVO_KEY } }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch { resolve(null); }
      });
    }).on('error', reject);
  });
}

export async function sincronizar(): Promise<void> {
  try {
    const instancias = await evoGet('/instance/fetchInstances');
    if (!Array.isArray(instancias)) return;

    let atualizadas = 0;
    for (const inst of instancias) {
      const nome = inst.name;
      const status = inst.connectionStatus;
      const jid = inst.ownerJid || '';
      if (!nome || status !== 'open' || !jid) continue;

      const numero = jid.replace(/@s\.whatsapp\.net$|@c\.us$/, '');
      if (!numero) continue;

      mapaChips.set(numero, nome);
      atualizadas++;
    }

    if (atualizadas > 0) {
      console.log(`[CHIPS] Mapa atualizado: ${atualizadas} chips ativos`);
    }
  } catch(e: any) {
    console.error('[CHIPS] Erro na sincronização:', e.message);
  }
}

export function resolverInstancia(phone: string, jid?: string | null): string {
  const p = String(phone || '').replace(/\D/g, '');

  if (mapaChips.has(p)) return mapaChips.get(p)!;

  if (jid) {
    const numJid = jid.replace(/@s\.whatsapp\.net$|@lid$|@c\.us$/, '');
    for (const [num, inst] of mapaChips.entries()) {
      if (numJid.includes(num) || num.includes(numJid)) return inst;
    }
  }

  if (mapaChips.size > 0) return mapaChips.values().next().value!;

  return 'mari-plamev-whatsapp';
}

export function processarConexao(instancia: string, status: string, ownerJid: string | null): void {
  if (status === 'open' && ownerJid) {
    const numero = ownerJid.replace(/@s\.whatsapp\.net$|@c\.us$/, '');
    mapaChips.set(numero, instancia);
    console.log(`[CHIPS] ✅ ${instancia} conectado: +${numero}`);
  } else if (status === 'close' || status === 'connecting') {
    for (const [num, inst] of mapaChips.entries()) {
      if (inst === instancia) {
        mapaChips.delete(num);
        break;
      }
    }
    console.log(`[CHIPS] ⚠️ ${instancia} desconectado`);
  }
}

export function iniciar(): void {
  sincronizar();
  setInterval(sincronizar, 2 * 60 * 1000);
  console.log('[CHIPS] ✅ Gerenciador de chips iniciado (sync 2min)');
}
