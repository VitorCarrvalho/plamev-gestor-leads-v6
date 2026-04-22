/**
 * services/sender.js — Envia mensagens pelo canal correto
 * Roteia para WhatsApp ou Telegram baseado no canal da mensagem
 */
require('dotenv').config({ path: '../.env' });
const chips = require('./chips');
const https = require('https');

const EVO_HOST = 'legendarios-evolution-api.bycpkh.easypanel.host';
const EVO_KEY  = process.env.EVOLUTION_KEY;
const TG_TOKEN = process.env.TELEGRAM_TOKEN;

// ── Roteamento outbound por prefixo DDD — EXCLUSIVO ──────────
// [COMPORTAMENTO MARI] Mapa explícito de instâncias por DDD — 16/04/2026 21:32
const ROTEAMENTO_CHIPS = {
  '5511': 'mari011',          // DDD 11 → Mari 011
  '5531': 'mari-plamev-zap2', // DDD 31 → Mari 031
};
const CHIP_FALLBACK = 'mari-plamev-zap2'; // fallback explícito

function getInstancia(phone) {
  const p = String(phone).replace(/\D/g, '');
  for (const [prefix, inst] of Object.entries(ROTEAMENTO_CHIPS)) {
    if (p.startsWith(prefix)) return inst;
  }
  console.warn(`[SENDER] ⚠️ Sem rota para ${p.slice(0,6)}... — usando fallback ${CHIP_FALLBACK}`);
  return CHIP_FALLBACK;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function calcMs(texto) {
  const db      = require('../db');
  const cfg     = await db.buscarConfig().catch(() => ({}));
  const wpm     = parseInt(cfg.tempo_digitacao_wpm || '38', 10);
  const digMin  = parseInt(cfg.tempo_digitacao_min || '3000', 10);
  const digMax  = parseInt(cfg.tempo_digitacao_max || '12000', 10);
  const palavras = texto.split(/\s+/).length;
  const ms = (palavras / wpm) * 60000;
  return Math.min(Math.max(ms, digMin), digMax);
}

async function calcLeitura(texto) {
  const db      = require('../db');
  const cfg     = await db.buscarConfig().catch(() => ({}));
  const leitMin = parseInt(cfg.tempo_leitura_min || '3', 10) * 1000;
  const leitMax = parseInt(cfg.tempo_leitura_max || '8', 10) * 1000;
  const palavras = texto.split(/\s+/).length;
  return 0;
}

// ── WhatsApp ─────────────────────────────────────────────────
function wppPost(path, body) {
  return new Promise((resolve, reject) => {
    const b = JSON.stringify(body);
    const req = https.request({
      hostname: EVO_HOST, path, method: 'POST',
      headers: { apikey: EVO_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    req.write(b); req.end();
  });
}

function normalizarNumero(phone) {
  let p = String(phone).replace(/[^0-9]/g, '');
  // Garantir código BR (55)
  if (!p.startsWith('55')) p = '55' + p;
  // Celular BR: 55 + DDD(2) + 9 + número(8) = 13 dígitos → adicionar 9
  // 5511XXXXXXXX (12 dígitos sem 9) → 55119XXXXXXXX (13 com 9) — ERRADO
  // Formato correto BR celular: 55 + DDD(2) + 9(1) + 8dígitos = 13 total
  if (p.startsWith('55') && p.length === 12) {
    // DDD + 8 dígitos — adicionar 9 após DDD
    p = p.slice(0,4) + '9' + p.slice(4);
  }
  return p;
}

function normalizarJID(phone, jid) {
  if (jid && jid.includes('@')) {
    // Mesmo JID do webhook — usar como veio
    return jid;
  }
  return normalizarNumero(phone) + '@s.whatsapp.net';
}

async function enviarWA(phone, jid, texto, instanciaExplicita) {
  // [COMPORTAMENTO MARI] Resposta sempre sai pela instância que recebeu — 16/04/2026 20:17
  // Se instanciaExplicita está definida: usar SEMPRE ela, sem fallback por JID
  let inst = instanciaExplicita;
  if (!inst) {
    // Só consultar rota inversa se não tem instância explícita
    if (jid) {
      const { pool } = require('../db');
      try {
        const r = await pool.query('SELECT instancia FROM contatos_instancia WHERE jid=$1 ORDER BY ultimo_contato DESC LIMIT 1', [jid]);
        if (r.rows[0]) { inst = r.rows[0].instancia; console.log('[SENDER] rota inversa:', inst, 'para', jid); }
      } catch(e) {}
    }
    inst = inst || getInstancia(phone);
  }
  console.log('[SENDER] instancia final:', inst, 'jid:', jid);
  const numero = normalizarJID(phone, jid);

  // 1. Simular leitura — HARDCODE (arquitetural: sempre 3-8s, proporcional ao tamanho da mensagem)
  // NÃO mover para BD nem Obsidian — é como o sistema funciona, não como a Mari se comporta
  // Sem simulação de leitura

  // 2. Mostrar 'digitando...' após a leitura
  await wppPost(`/chat/sendPresence/${inst}`, { number: numero, options: { presence: 'composing' } }).catch(() => {});

  // 3. Simular digitacão (baseado no tamanho da resposta)
  // Sem simulação de digitação

  // 4. Enviar (resposta já estava pronta desde o Brain)

  const numNorm = normalizarNumero(phone);
  // Tentar em ordem: s.whatsapp.net primeiro (mais confiável), depois JID original, depois @lid
  const tentativas = [
    numNorm + '@s.whatsapp.net',
    jid && jid.includes('@s.whatsapp.net') ? null : (jid || null), // JID original só se não for @s.whatsapp.net já
    numNorm + '@lid',
  ].filter(Boolean);

  for (const num of tentativas) {
    const r = await wppPost(`/message/sendText/${inst}`, { number: num, text: texto }).catch(()=>({}));
    if (r.key || r.id) {
      console.log(`[SENDER] ✅ WA ${inst} → ${num}`);
      return true;
    }
  }

  console.log(`[SENDER] ❌ WA falhou para ${phone}`);
  return false;
}

// ── Telegram ─────────────────────────────────────────────────
function tgPost(path, body) {
  return new Promise((resolve, reject) => {
    const b = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${TG_TOKEN}${path}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    req.write(b); req.end();
  });
}

async function enviarTG(chatId, texto) {
  await tgPost('/sendChatAction', { chat_id: chatId, action: 'typing' });
  await sleep(200);
  const r = await tgPost('/sendMessage', { chat_id: chatId, text: texto, parse_mode: 'Markdown' });
  if (r.ok) { console.log(`[SENDER] ✅ TG → ${chatId}`); return true; }
  console.log(`[SENDER] ❌ TG: ${JSON.stringify(r).substring(0, 80)}`);
  return false;
}

// ── API pública ───────────────────────────────────────────────
// Rastrear últimas mensagens enviadas por conversa (evitar duplicatas em rajada)
const _ultimasEnviadas = new Map();

async function enviar(msg, resposta) {
  if (!resposta) return;

  // Filtrar "Deixa eu checar" duplicado — verificar últimas 3 mensagens enviadas
  const chave = msg.phone || msg.chatId;
  const ultimas = _ultimasEnviadas.get(chave) || [];
  const ehChecagem = /deixa eu checar|um segundo 🔍/i.test(resposta);
  if (ehChecagem && ultimas.some(u => /deixa eu checar|um segundo 🔍/i.test(u))) {
    console.log('[SENDER] ⚡ "Deixa eu checar" duplicado bloqueado');
    return;
  }
  // Registrar mensagem enviada
  ultimas.unshift(resposta.slice(0, 100));
  if (ultimas.length > 3) ultimas.pop();
  _ultimasEnviadas.set(chave, ultimas);
  // Limpar após 5min
  setTimeout(() => _ultimasEnviadas.delete(chave), 300000);
  // Sem limite de blocos — envia a resposta completa
  // (mensagens longas são divididas em parágrafos para parecer natural)
  const blocos = resposta.split(/\n\n+/).filter(b => b.trim());

  for (let i = 0; i < blocos.length; i++) {
    const bloco = blocos[i].trim();
    if (msg.canal === 'telegram') {
      await enviarTG(msg.chatId || msg.phone, bloco);
    } else {
      // Usar instância explícita se disponível (garante chip correto)
      await enviarWA(msg.phone, msg.jid, bloco, msg.instancia);
    }
    if (i < blocos.length - 1) {
      // Intervalo proporcional ao tamanho do bloco (2.5s a 5s)
      const palavras = blocos[i].split(/\s+/).length;
      const intervalo = Math.min(Math.max(palavras * 120, 2500), 5000);
      await sleep(intervalo);
    }
  }
}

// ── Enviar imagem (base64) via Evolution API ──────────────────────
async function enviarImagem(msg, caminhoArquivo, legenda) {
  const fs = require('fs');
  const inst   = msg.instancia || getInstancia(msg.phone);
  const numNorm = normalizarNumero(msg.phone);
  const numero  = msg.jid && msg.jid.includes('@s.whatsapp.net') ? msg.jid : numNorm + '@s.whatsapp.net';

  if (!fs.existsSync(caminhoArquivo)) {
    console.error('[SENDER] ❌ Imagem não encontrada:', caminhoArquivo);
    return false;
  }

  const base64 = fs.readFileSync(caminhoArquivo).toString('base64');

  const r = await wppPost(`/message/sendMedia/${inst}`, {
    number:   numero,
    mediatype: 'image',
    mimetype:  'image/png',
    media:     base64,
    caption:   legenda || '',
  }).catch(() => ({}));

  if (r.key || r.id) {
    console.log(`[SENDER] ✅ Imagem WA ${inst} → ${numero}`);
    // Limpar arquivo temp
    fs.unlink(caminhoArquivo, () => {});
    return true;
  }
  console.error('[SENDER] ❌ Imagem falhou:', JSON.stringify(r).slice(0, 120));
  return false;
}

module.exports = { enviar, enviarImagem };

async function enviarDocumento(msg, caminhoPdf, nomeArquivo) {
  const fs = require('fs');
  const inst    = msg.instancia || getInstancia(msg.phone);
  const numNorm = normalizarNumero(msg.phone);
  const numero  = msg.jid && msg.jid.includes('@s.whatsapp.net') ? msg.jid : numNorm + '@s.whatsapp.net';

  if (!fs.existsSync(caminhoPdf)) {
    console.error('[SENDER] ❌ PDF não encontrado:', caminhoPdf);
    return false;
  }

  const base64 = fs.readFileSync(caminhoPdf).toString('base64');
  const r = await wppPost(`/message/sendMedia/${inst}`, {
    number:    numero,
    mediatype: 'document',
    mimetype:  'application/pdf',
    media:     base64,
    caption:   '',
    fileName:  nomeArquivo,
  }).catch(() => ({}));

  if (r.key || r.id) {
    console.log(`[SENDER] ✅ PDF WA ${inst} → ${numero}`);
    return true;
  }
  console.error('[SENDER] ❌ PDF falhou:', JSON.stringify(r).slice(0, 120));
  return false;
}
module.exports = Object.assign(module.exports || {}, { enviarDocumento });

// ── Envio direto (sem delay de leitura) — para reengajamento ──
async function enviarDireto(instancia, jid, texto, phone) {
  const numNorm = normalizarNumero(phone);
  const inst = instancia || getInstancia(phone);

  // Mostrar digitando por tempo proporcional ao texto
  await wppPost(`/chat/sendPresence/${inst}`, { number: jid, options: { presence: 'composing' } }).catch(() => {});
  await sleep(200);

  // Tentar 3 formatos de JID
  const tentativas = [
    jid,
    numNorm + '@s.whatsapp.net',
    numNorm + '@lid',
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  for (const num of tentativas) {
    const r = await wppPost(`/message/sendText/${inst}`, { number: num, text: texto }).catch(() => ({}));
    if (r.key || r.id) {
      console.log(`[SENDER] ✅ direto ${inst} → ${num}`);
      return true;
    }
  }
  console.log(`[SENDER] ❌ direto falhou ${phone}`);
  return false;
}

module.exports = Object.assign(module.exports || {}, { enviarDireto });
