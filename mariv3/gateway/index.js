/**
 * gateway/index.js — Ponto de entrada de todos os canais
 *
 * Canais suportados:
 *   WhatsApp — webhook Evolution API (POST /webhook/whatsapp)
 *   Telegram  — polling getUpdates
 *
 * Campos normalizados que saem daqui:
 *   id          — ID único da mensagem
 *   canal       — 'whatsapp' | 'telegram'
 *   phone       — número real do cliente (de senderPn quando disponível)
 *   jid         — JID WhatsApp (pode ser @lid ou @s.whatsapp.net)
 *   senderPn    — número real confirmado pelo WhatsApp (data.key.senderPn)
 *   senderChip  — número do chip que recebeu (body.sender)
 *   instancia   — nome da instância que recebeu (body.instance)
 *   chatId      — ID do chat Telegram
 *   nome        — nome do contato
 *   texto       — conteúdo da mensagem
 *   audio       — objeto de áudio (se for áudio)
 *   agentSlug   — agente responsável ('mari', 'rapha', etc.)
 */
require('dotenv').config({ path: '../.env' });
const express          = require('express');
const https            = require('https');
const { EventEmitter } = require('events');
const redis            = require('redis');
const chips            = require('../services/chips');
const db               = require('../db');

const gateway = new EventEmitter();
const app     = express();
app.use(express.json({ limit: '10mb' }));

// ── Deduplicação via Redis (TTL 24h) ─────────────────────────
const redisClient = redis.createClient({ url: process.env.REDIS_URL });
redisClient.connect().catch(e => console.error('[GW] Redis:', e.message));

// Fallback em memória — garante dedup mesmo se Redis falhar. Limpa a cada 1h.
const _dedupMem = new Set();
setInterval(() => _dedupMem.clear(), 60 * 60 * 1000);

async function jaVi(msgId, canal) {
  const chave = `dedup:${canal}:${msgId}`;

  // 1. Memória local — síncrono, sem falha possível
  if (_dedupMem.has(chave)) {
    console.log(`[GW] ⏭ DEDUP (mem): ${msgId}`);
    return true;
  }
  _dedupMem.add(chave);

  // 2. Redis — persistência entre restarts
  const existe = await redisClient.get(chave).catch(() => null);
  if (existe) {
    console.log(`[GW] ⏭ DEDUP (redis): ${msgId}`);
    return true;
  }
  await redisClient.setEx(chave, 86400, '1').catch(() => {});
  return false;
}

// ── Normalização — formato interno único ──────────────────────
function normalizar(campos) {
  return {
    id:          campos.id,
    canal:       campos.canal,
    phone:       campos.phone       || '',
    jid:         campos.jid         || null,
    senderPn:    campos.senderPn    || null,
    senderChip:  campos.senderChip  || null,
    instancia:   campos.instancia   || null,
    chatId:      campos.chatId      || null,
    nome:        campos.nome        || 'Cliente',
    texto:       campos.texto       || '',
    audio:       campos.audio       || null,
    imagem:      campos.imagem      || null,
    documento:   campos.documento   || null,
    agentSlug:   campos.agentSlug   || 'mari',
    timestamp:   campos.timestamp   || Date.now(),
  };
}

// ── Processar item WhatsApp ────────────────────────────────────
async function processarItemWA(item, body, agentSlug) {

  // ── Comando —reset (teste/apresentação) ──────────────────────────────────
  const textoCmd = (item.message?.conversation || item.message?.extendedTextMessage?.text || '').trim();
  const instanciaCmd = body.instance || body.instanceName || agentSlug;
  const remotoCmd = (item.key?.remoteJid || '');
  // phoneReset = quem enviou a mensagem (o contato que queremos resetar)
  // senderPn = número real do remetente quando disponível
  const senderPnReset = item.key?.senderPn || '';
  const phoneReset = senderPnReset
    ? senderPnReset.replace(/@s\.whatsapp\.net$|@c\.us$/g, '')
    : remotoCmd.replace(/@s\.whatsapp\.net$|@lid$|@c\.us$/g, '');

  // ── Comando --parar / --pausar — silencia a Mari globalmente ─────────────
  // [COMPORTAMENTO MARI] Pausa global da IA — 16/04/2026 19:07
  if (textoCmd === '--parar' || textoCmd === '—parar' || textoCmd === '--pausar' || textoCmd === '—pausar') {
    const db2    = require('../db');
    const sender = require('../services/sender');

    // Silenciar TODAS as conversas ativas
    const r = await db2.run(
      `UPDATE conversas SET ia_silenciada=true WHERE status='ativa' AND ia_silenciada=false`
    ).catch(() => ({ rowCount: 0 }));

    // Cancelar todos os reengajamentos pendentes
    await db2.run(
      `DELETE FROM followup_agendado WHERE status='pendente'`
    ).catch(() => {});

    // Limpar locks e buffers em memória
    if (global._mariLock)   global._mariLock.clear();
    if (global._mariBuffer) {
      for (const [k, v] of global._mariBuffer.entries()) {
        if (v?.timer) clearTimeout(v.timer);
      }
      global._mariBuffer.clear();
    }

    console.log(`[GW] ⏸️ MARI PAUSADA GLOBALMENTE — ${r.rowCount || '?'} conversas silenciadas`);
    await sender.enviarDireto(instanciaCmd, remotoCmd,
      `⏸️ *Mari pausada*\n\nIA silenciada em todas as conversas ativas.\nNenhuma mensagem será respondida até reativar.\n\nPara reativar: *--reativar*`,
      phoneReset
    ).catch(() => {});
    return;
  }

  // ── Comando --reativar — reativa a Mari globalmente ──────────────────────
  if (textoCmd === '--reativar' || textoCmd === '—reativar') {
    const db2    = require('../db');
    const sender = require('../services/sender');

    const r = await db2.run(
      `UPDATE conversas SET ia_silenciada=false WHERE status='ativa' AND ia_silenciada=true`
    ).catch(() => ({ rowCount: 0 }));

    console.log(`[GW] ▶️ MARI REATIVADA — ${r.rowCount || '?'} conversas reativadas`);
    await sender.enviarDireto(instanciaCmd, remotoCmd,
      `▶️ *Mari reativada*\n\nIA ativa em todas as conversas novamente.`,
      phoneReset
    ).catch(() => {});
    return;
  }

  // ── Comando --update — commit e push para GitHub ─────────────────────────
  // [COMPORTAMENTO MARI] Comando de sincronização GitHub — 16/04/2026 18:50
  if (textoCmd === '--update' || textoCmd === '—update') {
    const { exec } = require('child_process');
    const sender = require('../services/sender');

    await sender.enviarDireto(instanciaCmd, remotoCmd,
      '🔄 Sincronizando com GitHub...', phoneReset
    ).catch(() => {});

    exec('/Users/geta/.openclaw/workspace/scripts/update-github.sh', { timeout: 60000 }, async (err, stdout, stderr) => {
      const resultado = (stdout || '').trim() || (err?.message || 'erro');
      const ok = !err && resultado.includes('✅');
      await sender.enviarDireto(instanciaCmd, remotoCmd,
        ok ? resultado : `❌ Erro: ${resultado}`,
        phoneReset
      ).catch(() => {});
      console.log(`[GW] --update: ${ok ? 'OK' : 'ERRO'}`);
    });
    return;
  }

  // ── Comando —ajuda supervisor — pausa IA e passa para modo manual ──────────
  // [COMPORTAMENTO MARI] Supervisor assume conversa — IA silenciada — 16/04/2026 17:45
  if (textoCmd === '—ajuda supervisor' || textoCmd === '--ajuda supervisor' || textoCmd === '—ajuda' && textoCmd.includes('supervisor')) {
    const db2    = require('../db');
    const sender = require('../services/sender');

    // Buscar conversa pelo número
    const convRow2 = await db2.one(
      `SELECT id FROM conversas WHERE numero_externo=$1 ORDER BY ultima_interacao DESC LIMIT 1`,
      [phoneReset]
    ).catch(() => null);

    if (convRow2) {
      // Silenciar IA
      await db2.run(
        `UPDATE conversas SET ia_silenciada=true, etapa='supervisor' WHERE id=$1`,
        [convRow2.id]
      ).catch(() => {});

      // Cancelar todos os reengajamentos pendentes
      await db2.run(
        `DELETE FROM followup_agendado WHERE conversa_id=$1 AND status='pendente'`,
        [convRow2.id]
      ).catch(() => {});

      // Limpar lock de processamento
      if (global._mariLock) {
        const chaves = [...global._mariLock].filter(k => k.includes(phoneReset));
        chaves.forEach(k => global._mariLock.delete(k));
      }
      if (global._mariBuffer) {
        const chaves = [...global._mariBuffer.keys()].filter(k => k.includes(phoneReset));
        chaves.forEach(k => {
          const entry = global._mariBuffer.get(k);
          if (entry?.timer) clearTimeout(entry.timer);
          global._mariBuffer.delete(k);
        });
      }

      console.log(`[GW] 🧑‍💼 SUPERVISOR: IA silenciada para ${phoneReset}`);

      // Confirmar para o supervisor
      await sender.enviarDireto(instanciaCmd, remotoCmd,
        `✅ *Modo supervisor ativado*

A Mari foi pausada para este contato.
Você pode responder normalmente.

Para reativar a Mari: *—reativar mari*`,
        phoneReset
      ).catch(() => {});
    } else {
      await sender.enviarDireto(instanciaCmd, remotoCmd,
        `⚠️ Conversa não encontrada para ${phoneReset}`, phoneReset
      ).catch(() => {});
    }
    return;
  }

  // ── Comando —reativar mari — volta IA ao modo automático ─────────────────
  if (textoCmd === '—reativar mari' || textoCmd === '--reativar mari') {
    const db2    = require('../db');
    const sender = require('../services/sender');

    const convRow3 = await db2.one(
      `SELECT id FROM conversas WHERE numero_externo=$1 ORDER BY ultima_interacao DESC LIMIT 1`,
      [phoneReset]
    ).catch(() => null);

    if (convRow3) {
      await db2.run(
        `UPDATE conversas SET ia_silenciada=false, etapa='qualificacao' WHERE id=$1`,
        [convRow3.id]
      ).catch(() => {});
      console.log(`[GW] 🤖 MARI REATIVADA para ${phoneReset}`);
      await sender.enviarDireto(instanciaCmd, remotoCmd,
        `✅ *Mari reativada*

A IA voltou a responder automaticamente para este contato.`,
        phoneReset
      ).catch(() => {});
    }
    return;
  }

  // Passo 1: —reset → pedir confirmação
  if (textoCmd === '—reset' || textoCmd === '--reset') {
    const sender = require('../services/sender');
    const msgConfirm = `⚠️ *Confirmar reset?*

Isso vai apagar TODOS os dados desse contato:
- Histórico de mensagens
- Perfil do pet
- Etapa do funil
- Follow-ups agendados

O contato voltará a ser tratado como novo cliente.

Digite *—confirmar* para confirmar ou qualquer outra mensagem para cancelar.`;
    await sender.enviarDireto(instanciaCmd, remotoCmd, msgConfirm, phoneReset).catch(() => {});
    return;
  }

  // Passo 2: —confirmar → executar reset
  if (textoCmd === '—confirmar' || textoCmd === '--confirmar') {
    const db2    = require('../db');
    const sender = require('../services/sender');

    // Buscar cliente pelo número — via conversas (numero_externo)
    const convRow = await db2.one(
      `SELECT cv.client_id FROM conversas cv
       LEFT JOIN identificadores_cliente ic ON ic.client_id = cv.client_id AND ic.tipo = 'phone'
       WHERE cv.numero_externo = $1 OR ic.valor = $1
       ORDER BY cv.ultima_interacao DESC LIMIT 1`,
      [phoneReset]
    ).catch(() => null);

    if (convRow) {
      const cid = convRow.client_id;
      // Apagar cascata completa respeitando todas as FKs
      const convIds = (await db2.query('SELECT id FROM conversas WHERE client_id=$1', [cid]).catch(()=>[])).map(r=>r.id);
      for (const cvId of convIds) {
        await db2.run('DELETE FROM mensagens             WHERE conversa_id=$1', [cvId]).catch(()=>{});
        await db2.run('DELETE FROM followup_agendado     WHERE conversa_id=$1', [cvId]).catch(()=>{});
        await db2.run('DELETE FROM funil_conversao       WHERE conversa_id=$1', [cvId]).catch(()=>{});
        await db2.run('DELETE FROM agendamentos          WHERE conversa_id=$1', [cvId]).catch(()=>{});
        await db2.run('DELETE FROM decisoes_orquestrador WHERE conversa_id=$1', [cvId]).catch(()=>{});
        await db2.run('DELETE FROM instrucoes_ativas     WHERE conversa_id=$1', [cvId]).catch(()=>{});
        await db2.run('DELETE FROM conversa_obsidian     WHERE conversa_id=$1', [cvId]).catch(()=>{});
        await db2.run('DELETE FROM transferencias        WHERE conversa_id=$1', [cvId]).catch(()=>{});
        await db2.run('DELETE FROM custos_ia             WHERE conversa_id=$1', [cvId]).catch(()=>{});
      }
      await db2.run('DELETE FROM conversas               WHERE client_id=$1', [cid]).catch(()=>{});
      await db2.run('DELETE FROM perfil_pet              WHERE client_id=$1', [cid]).catch(()=>{});
      await db2.run('DELETE FROM identificadores_cliente WHERE client_id=$1', [cid]).catch(()=>{});
      await db2.run('DELETE FROM clientes                WHERE id=$1',        [cid]).catch(()=>{});
      console.log(`[GW] 🧹 RESET confirmado: ${phoneReset} apagado`);
    } else {
      console.log(`[GW] 🧹 RESET: ${phoneReset} não encontrado no BD`);
    }

    // Limpar lock de processamento também
    if (global._mariLock) {
      for (const chave of global._mariLock) {
        if (chave.startsWith(phoneReset)) global._mariLock.delete(chave);
      }
    }
    // Limpar buffer em memória — qualquer chave que contenha o phone
    if (global._mariBuffer) {
      for (const [chave, entry] of global._mariBuffer.entries()) {
        if (chave.startsWith(phoneReset)) {
          clearTimeout(entry.timer);
          global._mariBuffer.delete(chave);
          console.log(`[GW] 🧹 RESET buffer limpo: ${chave}`);
        }
      }
    }

    const msgOk = `✅ *Reset concluído!*

Todos os dados foram apagados. O próximo contato será tratado como novo cliente. 🐾`;
    await sender.enviarDireto(instanciaCmd, remotoCmd, msgOk, phoneReset).catch(() => {});
    return;
  }

  // Ignorar mensagens enviadas pelo próprio chip (evita looping)
  if (item.key?.fromMe === true) return;
  if (body.event === 'messages.upsert' && item.key?.fromMe) return;
  // Ignorar se o remoteJid é o próprio número do chip
  const senderNum = (body.sender || '').replace(/@.*/, '');
  const remoto = (item.key?.remoteJid || '').replace(/@.*/, '');
  if (senderNum && remoto && senderNum === remoto) return;

  // [COMPORTAMENTO MARI] Ignorar mensagens de sincronização de histórico — 16/04/2026 20:29
  // Mensagens com timestamp anterior a 120s do boot são sincronizações, não mensagens novas
  const msgTimestamp = item.messageTimestamp || item.message?.messageContextInfo?.messageTimestamp || 0;
  const agora = Math.floor(Date.now() / 1000);
  if (msgTimestamp && (agora - msgTimestamp) > 120) {
    console.log(`[GW] ⏭️ Ignorando msg histórica (${agora - msgTimestamp}s atrás) instance:${body.instance || ''}`);
    return;
  }

  const jidRaw = item.key?.remoteJid || '';
  if (!jidRaw || jidRaw.includes('@g.us') || jidRaw.includes('@broadcast')) return;

  const msgId = item.key?.id || '';
  if (!msgId || await jaVi(msgId, 'whatsapp')) return;

  // Extrair campos do payload Evolution API
  const instancia   = body.instance || body.instanceName || agentSlug;
  const senderChip  = body.sender   || null;  // número do chip ex: 5511914956623@s.whatsapp.net
  const senderPn    = item.key?.senderPn || null; // número real do cliente ex: 5512997328912@s.whatsapp.net

  // phone = número real do cliente (prioridade: senderPn > jidRaw)
  const phone = senderPn
    ? senderPn.replace(/@s\.whatsapp\.net$|@c\.us$/g, '')
    : jidRaw.replace(/@s\.whatsapp\.net$|@lid$|@c\.us$/g, '');

  const msgObj    = item.message || {};
  const msgType   = item.messageType || '';
  const texto     = msgObj.conversation || msgObj.extendedTextMessage?.text || '';

  // Áudio: PTT (voz) ou audioMessage
  const isAudio   = !!(msgObj.audioMessage || msgObj.pttMessage)
                    || msgType === 'audioMessage' || msgType === 'pttMessage';
  // Detectar se é PTT para passar o messageType correto para a Evolution
  const isPtt     = !!(msgObj.pttMessage) || msgObj.audioMessage?.ptt === true || msgType === 'pttMessage';
  const audio     = isAudio ? { _type: isPtt ? 'pttMessage' : 'audioMessage', _msgId: msgId } : null;

  // Imagem
  const isImagem  = !!(msgObj.imageMessage) || msgType === 'imageMessage';
  const imagem    = isImagem ? { _type: 'imageMessage', _msgId: msgId } : null;

  // Documento (PDF, Word, Excel, etc.)
  const docMsg    = msgObj.documentMessage || msgObj.documentWithCaptionMessage?.message?.documentMessage || null;
  const isDoc     = !!(docMsg) || msgType === 'documentMessage' || msgType === 'documentWithCaptionMessage';
  const documento = isDoc ? {
    _type: msgType || 'documentMessage',
    _msgId: msgId,
    fileName: docMsg?.fileName || docMsg?.title || 'documento',
    mimetype: docMsg?.mimetype || '',
    caption: docMsg?.caption || msgObj.documentWithCaptionMessage?.message?.documentMessage?.caption || '',
  } : null;

  if (!texto && !audio && !imagem && !documento) {
    if (msgType) console.log(`[GW] Tipo ignorado: ${msgType}`);
    return;
  }

  // Gravar rota de retorno: JID + instância que recebeu
  db.run(
    'INSERT INTO contatos_instancia (phone, jid, instancia) VALUES ($1,$2,$3) ON CONFLICT (jid, instancia) DO UPDATE SET phone=$1, ultimo_contato=NOW()',
    [phone, jidRaw, instancia]
  ).catch(() => {});

  const msg = normalizar({
    id: msgId, canal: 'whatsapp',
    phone, jid: jidRaw, senderPn, senderChip, instancia,
    nome: item.pushName, texto, audio, imagem, documento, agentSlug,
  });

  console.log(`[GW] 📱 ${instancia} | ${phone} | "${texto.substring(0, 50)}"`);
  gateway.emit('mensagem', msg);
}

// ══════════════════════════════════════════════════════════════
// CANAL WhatsApp — webhook Evolution API
// ══════════════════════════════════════════════════════════════
app.post('/webhook/whatsapp/:agente', async (req, res) => {
  res.json({ ok: true });
  const agentSlug = req.params.agente || 'mari';
  const body  = req.body || {};
  const lista = Array.isArray(body.data) ? body.data : body.data ? [body.data] : [];
  for (const item of lista) {
    await processarItemWA(item, body, agentSlug).catch(e => console.error('[GW] WA erro:', e.message));
  }
});

// Rota sem agente — normaliza para /webhook/whatsapp/:agente
app.post('/webhook/whatsapp', async (req, res) => {
  res.json({ ok: true });
  const body      = req.body || {};
  const instancia = body.instance || body.instanceName || '';

  // Detectar agentSlug pela instância
  const agentSlug = instancia.includes('rapha') ? 'rapha' : 'mari';

  const rawType = (Array.isArray(body.data) ? body.data[0] : body.data)?.messageType || body.event || '?';
  console.log(`[GW] WEBHOOK RAW event:${body.event||'?'} type:${rawType} instance:${instancia}`);

  const lista = Array.isArray(body.data) ? body.data : body.data ? [body.data] : [];
  for (const item of lista) {
    await processarItemWA(item, body, agentSlug).catch(e => console.error('[GW] WA erro:', e.message));
  }
});

// ── QR Code temporário para pareamento ───────────────────────────────────
app.get('/download/reengajamento-v2', (req, res) => {
  const fs = require('fs');
  const f = '/Users/geta/.openclaw/workspace/mariv3/services/reengajamento_v2.js';
  res.setHeader('Content-Disposition', 'attachment; filename="reengajamento_v2.js"');
  res.setHeader('Content-Type', 'application/javascript');
  res.send(fs.readFileSync(f, 'utf8'));
});

app.get('/download/reengajamento-v2-corrigido', (req, res) => {
  const fs = require('fs');
  const f = '/Users/geta/.openclaw/workspace/mariv3/services/reengajamento_v2_corrigido.js';
  res.setHeader('Content-Disposition', 'attachment; filename="reengajamento_v2_corrigido.js"');
  res.setHeader('Content-Type', 'application/javascript');
  res.send(fs.readFileSync(f, 'utf8'));
});

app.get('/download/relatorio-vacuo', (req, res) => {
  const fs = require('fs');
  const f = '/Users/geta/.openclaw/workspace/RELATORIO-MUDANCAS-VACUO.md';
  res.setHeader('Content-Disposition', 'attachment; filename="RELATORIO-MUDANCAS-VACUO.md"');
  res.setHeader('Content-Type', 'text/markdown');
  res.send(fs.readFileSync(f, 'utf8'));
});

app.get('/qr-mari011', (req, res) => {
  const fs = require('fs');
  const f = '/Users/geta/.openclaw/workspace/qr_mari011.html';
  try {
    const html = fs.readFileSync(f, 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch(e) {
    res.send('<h2 style="font-family:sans-serif;padding:40px">QR expirado — tente novamente</h2>');
  }
});

// Recebe eventos de conexão/desconexão da Evolution API
app.post('/webhook/connection', (req, res) => {
  res.json({ ok: true });
  const { instance, data } = req.body || {};
  if (instance && data?.state) chips.processarConexao(instance, data.state, data.wuid);
});

// ══════════════════════════════════════════════════════════════
// CANAL Telegram — polling
// ══════════════════════════════════════════════════════════════
const TG_TOKEN = process.env.TELEGRAM_TOKEN;
let tgOffset   = 0;
let tgAtivo    = false;

function tgGet(path) {
  return new Promise((resolve, reject) => {
    https.get(`https://api.telegram.org/bot${TG_TOKEN}${path}`, { timeout: 25000 }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    }).on('error', reject).on('timeout', () => reject(new Error('timeout')));
  });
}

async function tgPolling() {
  await tgGet('/deleteWebhook').catch(() => {});
  console.log('[GW] 💬 Telegram polling iniciado');
  tgAtivo = true;

  while (tgAtivo) {
    try {
      const res = await tgGet(`/getUpdates?offset=${tgOffset}&timeout=20&allowed_updates=["message"]`);
      if (res.ok && res.result?.length) {
        for (const update of res.result) {
          tgOffset = update.update_id + 1;
          const msg = update.message;
          if (!msg?.text) continue;
          if (msg.text.startsWith('/') && msg.text !== '/start') continue;

          const msgId = `tg_${update.update_id}`;
          if (await jaVi(msgId, 'telegram')) continue;

          const phone = String(msg.from?.id || msg.chat.id);
          const m = normalizar({
            id: msgId, canal: 'telegram',
            phone, chatId: msg.chat.id,
            nome: msg.from?.first_name || msg.from?.username,
            texto: msg.text, agentSlug: 'mari',
          });
          console.log(`[GW] 💬 Telegram | ${phone} | "${msg.text.substring(0, 50)}"`);
          gateway.emit('mensagem', m);
        }
      }
    } catch(e) {
      if (e.message !== 'timeout') console.error('[GW] TG erro:', e.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}


// ── Confirmação de pagamento (boleto/débito) ──────────────────────────────────
app.post('/webhook/pagamento', async (req, res) => {
  res.json({ ok: true });
  const { phone, nome_pet, nome_cliente, plano, canal, instancia, jid } = req.body || {};
  if (!phone) return;

  const sender = require('../services/sender');
  const db2    = require('../db');

  const nomeP     = nome_pet     || 'seu pet';
  const nomeC     = nome_cliente || '';
  const nomePlano = plano ? ` (Plano ${plano})` : '';

  const msg1 = `${nomeC ? nomeC + ', r' : 'R'}ecebi a confirmação do seu pagamento${nomePlano}! 🎉💛\n\nFico muito feliz que o ${nomeP} agora está protegido!\n\nEm até 24 horas você vai receber o contrato no seu email. Qualquer dúvida estou aqui! 😊`;
  const msg2 = `Ah, você conhece alguém que também tem um bichinho e ainda não tem plano? Me passa o contato que eu cuido com o mesmo carinho! 🐾`;
  const msg3 = `Uma última coisa: posso te mandar uma mensagem ainda hoje com mais detalhes do plano ou prefere que eu te procure amanhã? 😊`;

  const msgObj = { phone, canal: canal || 'whatsapp', instancia, jid };
  await sender.enviar(msgObj, msg1).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  await sender.enviar(msgObj, msg2).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  await sender.enviar(msgObj, msg3).catch(() => {});

  await db2.run(
    `UPDATE conversas SET etapa='pos_venda' WHERE numero_externo=$1`,
    [phone]
  ).catch(() => {});

  console.log(`[GW] 💳 Pagamento confirmado: ${phone}`);
});


// ── Envio de mensagem de indicação ───────────────────────────────────────────
app.post('/webhook/indicacao', async (req, res) => {
  res.json({ ok: true });
  const {
    phone_indicado,        // número do indicado
    nome_indicado,         // nome do indicado (opcional)
    nome_cliente,          // quem indicou
    nome_pet,              // pet de quem indicou
    instancia,             // chip a usar
    jid                    // jid do indicado (opcional)
  } = req.body || {};

  if (!phone_indicado || !nome_cliente) return;

  const sender = require('../services/sender');

  // Saudação por horário (America/Sao_Paulo)
  const hora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false });
  const h = parseInt(hora);
  const saudacao = h >= 5 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite';

  const nomePet   = nome_pet    || 'o pet';
  const nomeInd   = nome_indicado ? `, ${nome_indicado.split(' ')[0]}` : '';

  const texto = `${saudacao}${nomeInd}! 😊🐾

Eu sou a Mari, consultora de saúde pet da Plamev!

*${nome_cliente}* acabou de fazer o plano pra *${nomePet}* e me indicou você!

Ele(a) acredita que cuidar da saúde do pet é uma preocupação que todos deveriam ter, e quis te apresentar pra gente 💛

Me conta, você tem pet? 😊`;

  const msgObj = { phone: phone_indicado, canal: 'whatsapp', instancia, jid };
  await sender.enviar(msgObj, texto).catch(e => console.error('[GW] Indicação erro:', e.message));

  // Salvar indicação no BD
  const db2 = require('../db');
  await db2.run(
    'INSERT INTO indicacoes (phone_indicado, nome_indicado, phone_indicador, nome_indicador, nome_pet, status) VALUES ($1,$2,$3,$4,$5,$6)',
    [phone_indicado, nome_indicado || null, null, nome_cliente, nomePet, 'contatado']
  ).catch(() => {});

  console.log(`[GW] 🐾 Indicação enviada: ${nome_cliente} → ${phone_indicado}`);
});


// ── API pública: buscar clínicas por CEP ─────────────────────────────────────
app.get('/api/clinicas', async (req, res) => {
  const cepRaw = (req.query.cep || '').replace(/\D/g, '');
  if (cepRaw.length !== 8) return res.json({ ok: false, erro: 'CEP inválido' });

  try {
    const cepSvc = require('../services/cep');
    const raio   = parseInt(req.query.raio || '40', 10);
    const result = await cepSvc.buscarClinicas(cepRaw, raio);
    if (!result || !result.total) return res.json({ ok: true, total: 0 });

    res.json({
      ok:      true,
      total:   result.total,
      raio:    result.raio || raio,
      cidade:  result.cidade || '',
      estado:  result.estado || '',
      clinicas: result.todas || result.top3 || [],
    });
  } catch(e) {
    res.json({ ok: false, erro: e.message });
  }
});

// ── Health ────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ ok: true, canais: ['whatsapp', 'telegram'], versao: 'v3' }));

// ── Iniciar ──────────────────────────────────────────────────
function iniciar(porta) {
  porta = porta || parseInt(process.env.GATEWAY_PORT) || 3401;
  app.listen(porta, () => console.log(`[GW] ✅ Porta ${porta} | canais: WhatsApp + Telegram`));
  if (TG_TOKEN) tgPolling();
  else console.warn('[GW] TELEGRAM_TOKEN não definido');
}

process.on('SIGTERM', () => { tgAtivo = false; redisClient.quit(); });
process.on('SIGINT',  () => { tgAtivo = false; redisClient.quit(); });

module.exports = { gateway, iniciar };
