/**
 * services/chips.js — Gerenciamento automático de chips WhatsApp
 *
 * Responsabilidades:
 * 1. Sincronizar instâncias da Evolution API com o BD a cada 2 minutos
 * 2. Quando uma mensagem chega, identificar qual chip recebeu via BD
 * 3. Garantir que a resposta sai pelo mesmo chip que recebeu
 * 4. Suporta N chips sem configuração manual
 */
require('dotenv').config({ path: '../.env' });
const https = require('https');
const { pool } = require('../db');

const EVO_HOST = 'legendarios-evolution-api.bycpkh.easypanel.host';
const EVO_KEY  = process.env.EVOLUTION_KEY;

// Mapa em memória: numero_whatsapp → nome_instancia
const mapaChips = new Map();

// Nomes amigáveis das instâncias
const nomesInstancias = {
  "mari-plamev-whatsapp": "Mari 011 (legado)",
  "mari011":             "Mari 011",
  "mari-plamev-zap2":    "Mari 031",
  "plamev":              "Bella 021",
  "grione":              "Grione",
  "mari011":             "Mari 011",
};

function nomeAmigavel(instancia) {
  return nomesInstancias[instancia] || instancia;
}

function evoGet(path) {
  return new Promise((resolve, reject) => {
    https.get(`https://${EVO_HOST}${path}`, { headers: { apikey: EVO_KEY } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); }});
    }).on('error', reject);
  });
}

// Buscar todas as instâncias conectadas e montar mapa
async function sincronizar() {
  try {
    const instancias = await evoGet('/instance/fetchInstances');
    if (!Array.isArray(instancias)) return;

    let atualizadas = 0;
    for (const inst of instancias) {
      const nome   = inst.name;
      const status = inst.connectionStatus;
      const jid    = inst.ownerJid || '';
      if (!nome || status !== 'open' || !jid) continue;

      const numero = jid.replace(/@s\.whatsapp\.net$|@c\.us$/, '');
      if (!numero) continue;

      // Atualizar mapa em memória
      mapaChips.set(numero, nome);
      atualizadas++;
    }

    if (atualizadas > 0) {
      console.log(`[CHIPS] Mapa atualizado: ${atualizadas} chips ativos`);
      mapaChips.forEach((inst, num) => console.log(`  +${num} → ${inst}`));

      // Corrigir conversas no BD que estão com instância errada
      await corrigirConversas();
    }
  } catch(e) {
    console.error('[CHIPS] Erro na sincronização:', e.message);
  }
}

// Corrigir instância das conversas baseado no mapa atual
async function corrigirConversas() {
  try {
    const client = await pool.connect();
    // Para cada chip conhecido, atualizar conversas que chegaram por aquele número
    for (const [numero, instancia] of mapaChips.entries()) {
      await client.query(
        `UPDATE conversas 
         SET instancia_whatsapp = $1
         WHERE canal = 'whatsapp'
           AND (
             numero_externo = $2
             OR jid LIKE $3
           )
           AND (instancia_whatsapp IS NULL OR instancia_whatsapp != $1)`,
        [instancia, numero, `%${numero}%`]
      );
    }
    client.release();
  } catch(e) {
    console.error('[CHIPS] Erro ao corrigir conversas:', e.message);
  }
}

// Resolver instância para um número ou JID
function resolverInstancia(phone, jid) {
  const p = String(phone || '').replace(/\D/g, '');

  // Tentar número exato
  if (mapaChips.has(p)) return mapaChips.get(p);

  // Tentar por JID (remover sufixo)
  if (jid) {
    const numJid = jid.replace(/@s\.whatsapp\.net$|@lid$|@c\.us$/, '');
    for (const [num, inst] of mapaChips.entries()) {
      if (numJid.includes(num) || num.includes(numJid)) return inst;
    }
  }

  // Fallback: primeira instância disponível
  if (mapaChips.size > 0) return mapaChips.values().next().value;

  // Último fallback hardcoded
  return 'mari-plamev-whatsapp';
}

// Processar evento CONNECTION_UPDATE da Evolution API
// (quando chip conectar/desconectar via webhook)
function processarConexao(instancia, status, ownerJid) {
  if (status === 'open' && ownerJid) {
    const numero = ownerJid.replace(/@s\.whatsapp\.net$|@c\.us$/, '');
    mapaChips.set(numero, instancia);
    console.log(`[CHIPS] ✅ ${instancia} conectado: +${numero}`);
    corrigirConversas().catch(() => {});
  } else if (status === 'close' || status === 'connecting') {
    // Remover do mapa se desconectou
    for (const [num, inst] of mapaChips.entries()) {
      if (inst === instancia) { mapaChips.delete(num); break; }
    }
    console.log(`[CHIPS] ⚠️ ${instancia} desconectado`);
  }
}

// Iniciar sincronização periódica
function iniciar() {
  sincronizar(); // imediato
  setInterval(sincronizar, 2 * 60 * 1000); // a cada 2 minutos
  console.log('[CHIPS] ✅ Gerenciador de chips iniciado (sync 2min)');
}

module.exports = { iniciar, resolverInstancia, processarConexao, mapaChips };
