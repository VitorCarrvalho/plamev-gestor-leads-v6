import https from 'https';
import http from 'http';
import { resolverInstanciaPorDDD, tokenTelegramPorAgente, getInstanciaConfig } from './config';

// Fallbacks para quando a instância não tem configuração no banco ainda
const EVO_HOST_DEFAULT = process.env.EVOLUTION_API_HOST || 'legendarios-evolution-api.bycpkh.easypanel.host';
const EVO_KEY_DEFAULT  = process.env.EVOLUTION_API_KEY  || '';

export function getInstancia(phone: string): string | null {
  const inst = resolverInstanciaPorDDD(phone);
  if (!inst) {
    console.error(`[SENDER] ❌ Sem rota para ${String(phone).slice(0, 7)}... e nenhum fallback configurado no banco`);
    return null;
  }
  return inst;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function wppPost(baseUrl: string, path: string, body: any, apiKey: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const fullUrl = `${baseUrl}${path}`;
    let parsed: URL;
    try { parsed = new URL(fullUrl); }
    catch { return reject(new Error(`URL inválida: ${fullUrl}`)); }

    const lib = parsed.protocol === 'https:' ? https : http;
    const b = JSON.stringify(body);
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port) : undefined,
      path: parsed.pathname + (parsed.search || ''),
      method: 'POST',
      headers: {
        apikey: apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(b),
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    req.write(b);
    req.end();
  });
}

function normalizarNumero(phone: string): string {
  let p = String(phone).replace(/[^0-9]/g, '');
  if (!p.startsWith('55')) p = '55' + p;
  if (p.startsWith('55') && p.length === 12) {
    p = p.slice(0, 4) + '9' + p.slice(4);
  }
  return p;
}

function normalizarJID(phone: string, jid?: string | null): string {
  if (jid && jid.includes('@')) return jid;
  return normalizarNumero(phone) + '@s.whatsapp.net';
}

function getEvoConfig(instancia: string): { baseUrl: string; apiKey: string } {
  const cfg = getInstanciaConfig(instancia);
  const baseUrl = cfg?.evolution_url?.trim().replace(/\/$/, '') || `https://${EVO_HOST_DEFAULT}`;
  const apiKey  = cfg?.evolution_api_key?.trim() || EVO_KEY_DEFAULT;
  return { baseUrl, apiKey };
}

export async function enviarWA(phone: string, jid: string | null, texto: string, instanciaExplicita: string | null): Promise<boolean> {
  let inst = instanciaExplicita;
  if (!inst) inst = getInstancia(phone);
  if (!inst) {
    console.error(`[SENDER] ❌ Nenhuma instância disponível para ${String(phone).slice(0, 7)}... — mensagem descartada`);
    return false;
  }

  const { baseUrl, apiKey } = getEvoConfig(inst);
  const numero = normalizarJID(phone, jid);

  console.log(`[SENDER] 📤 WA → instância ${inst} via ${baseUrl}`);

  await wppPost(baseUrl, `/chat/sendPresence/${inst}`, { number: numero, options: { presence: 'composing' } }, apiKey).catch(() => {});

  const numNorm = normalizarNumero(phone);
  const tentativas = [
    numNorm + '@s.whatsapp.net',
    jid && jid.includes('@s.whatsapp.net') ? null : (jid || null),
    numNorm + '@lid',
  ].filter(Boolean);

  for (const num of tentativas) {
    if (!num) continue;
    const r = await wppPost(baseUrl, `/message/sendText/${inst}`, { number: num, text: texto }, apiKey).catch(() => ({}));
    if (r.key || r.id) {
      console.log(`[SENDER] ✅ WA ${inst} → ${num}`);
      return true;
    }
  }

  console.log(`[SENDER] ❌ WA falhou para ${phone}`);
  return false;
}

export async function enviarDocumentoWA(
  phone: string,
  jid: string | null,
  instanciaExplicita: string | null,
  base64: string,
  fileName: string,
  caption = '',
): Promise<boolean> {
  let inst = instanciaExplicita;
  if (!inst) inst = getInstancia(phone);
  if (!inst) {
    console.error(`[SENDER] ❌ Nenhuma instância disponível para doc → ${String(phone).slice(0, 7)}...`);
    return false;
  }

  const { baseUrl, apiKey } = getEvoConfig(inst);
  const numero = normalizarJID(phone, jid);

  const body = {
    number: numero,
    mediatype: 'document',
    mimetype: 'application/pdf',
    caption,
    media: base64,
    fileName,
  };

  console.log(`[SENDER] 📎 Doc WA → instância ${inst} via ${baseUrl} (${Math.round(base64.length / 1024)}KB)`);
  const r = await wppPost(baseUrl, `/message/sendMedia/${inst}`, body, apiKey).catch(() => ({}));
  if (r.key || r.id) {
    console.log(`[SENDER] ✅ Doc WA ${inst} → ${numero}`);
    return true;
  }
  console.log(`[SENDER] ❌ Doc WA falhou para ${phone}:`, JSON.stringify(r).substring(0, 120));
  return false;
}

function tgPost(path: string, body: any, token: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const b = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}${path}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    req.write(b);
    req.end();
  });
}

export async function enviarTG(chatId: string, texto: string, token: string): Promise<boolean> {
  await tgPost('/sendChatAction', { chat_id: chatId, action: 'typing' }, token);
  await sleep(200);
  const r = await tgPost('/sendMessage', { chat_id: chatId, text: texto, parse_mode: 'Markdown' }, token);
  if (r.ok) {
    console.log(`[SENDER] ✅ TG → ${chatId}`);
    return true;
  }
  console.log(`[SENDER] ❌ TG: ${JSON.stringify(r).substring(0, 80)}`);
  return false;
}

const _ultimasEnviadas = new Map<string, string[]>();

export async function enviar(msg: any, resposta: string): Promise<void> {
  if (!resposta) return;

  const chave = msg.phone || msg.chatId;
  const ultimas = _ultimasEnviadas.get(chave) || [];
  const ehChecagem = /deixa eu checar|um segundo 🔍/i.test(resposta);
  if (ehChecagem && ultimas.some(u => /deixa eu checar|um segundo 🔍/i.test(u))) {
    console.log('[SENDER] ⚡ "Deixa eu checar" duplicado bloqueado');
    return;
  }
  ultimas.unshift(resposta.slice(0, 100));
  if (ultimas.length > 3) ultimas.pop();
  _ultimasEnviadas.set(chave, ultimas);
  setTimeout(() => _ultimasEnviadas.delete(chave), 300000);

  const blocos = resposta.split(/\n\n+/).filter(b => b.trim());

  for (let i = 0; i < blocos.length; i++) {
    const bloco = blocos[i].trim();
    if (msg.canal === 'telegram') {
      const token = tokenTelegramPorAgente(msg.agentSlug || 'mari');
      await enviarTG(msg.chatId || msg.phone, bloco, token);
    } else {
      await enviarWA(msg.phone, msg.jid, bloco, msg.instancia);
    }
    if (i < blocos.length - 1) {
      const palavras = blocos[i].split(/\s+/).length;
      const intervalo = Math.min(Math.max(palavras * 120, 2500), 5000);
      await sleep(intervalo);
    }
  }
}
