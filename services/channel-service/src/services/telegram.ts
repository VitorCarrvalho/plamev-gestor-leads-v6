import https from 'https';
import { isDuplicate, messageQueue } from '../utils/redis';
import { normalizeMessage } from '../utils/normalizer';

interface BotRunner {
  token: string;
  agentSlug: string;
  offset: number;
  ativo: boolean;
}

const _botRunners = new Map<string, BotRunner>();

function tgGet(path: string, token: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(`https://api.telegram.org/bot${token}${path}`, { timeout: 25000 }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    }).on('error', reject).on('timeout', () => reject(new Error('timeout')));
  });
}

async function runPolling(runner: BotRunner): Promise<void> {
  await tgGet('/deleteWebhook', runner.token).catch(() => {});
  console.log(`[TG] 💬 Polling iniciado — agente ${runner.agentSlug}`);

  while (runner.ativo) {
    try {
      const res = await tgGet(`/getUpdates?offset=${runner.offset}&timeout=20&allowed_updates=["message"]`, runner.token);

      if (res.ok && res.result?.length) {
        for (const update of res.result) {
          runner.offset = update.update_id + 1;
          const msgObj = update.message;

          if (!msgObj?.text) continue;
          if (msgObj.text.startsWith('/') && msgObj.text !== '/start') continue;

          const msgId = `tg_${update.update_id}`;
          if (await isDuplicate(msgId, 'telegram')) continue;

          const phone = String(msgObj.from?.id || msgObj.chat.id);

          const m = normalizeMessage({
            id: msgId,
            canal: 'telegram',
            phone,
            chatId: msgObj.chat.id,
            nome: msgObj.from?.first_name || msgObj.from?.username || 'Cliente',
            texto: msgObj.text,
            agentSlug: runner.agentSlug,
          });

          console.log(`[TG] 💬 Enfileirando: ${phone} | "${msgObj.text.substring(0, 30)}..."`);

          await messageQueue.add('process-message', { message: m }, {
            jobId: `msg:${m.canal}:${m.id}`,
            delay: 5000,
            removeOnComplete: true,
            removeOnFail: false
          });
        }
      }
    } catch(e: any) {
      if (e.message !== 'timeout') console.error(`[TG] ❌ ${runner.agentSlug}:`, e.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  console.log(`[TG] 🔴 Polling encerrado — agente ${runner.agentSlug}`);
}

export function startBotPolling(token: string, agentSlug: string): void {
  if (_botRunners.has(token)) return;
  const runner: BotRunner = { token, agentSlug, offset: 0, ativo: true };
  _botRunners.set(token, runner);
  runPolling(runner).catch(e => console.error(`[TG] ❌ Erro fatal ${agentSlug}:`, e.message));
}

export function stopAllBots(): void {
  for (const runner of _botRunners.values()) runner.ativo = false;
  _botRunners.clear();
}

export function recarregarBots(bots: { token: string; agentSlug: string }[]): void {
  // Para bots removidos
  for (const [token, runner] of _botRunners.entries()) {
    if (!bots.some(b => b.token === token)) {
      runner.ativo = false;
      _botRunners.delete(token);
    }
  }
  // Inicia novos bots
  for (const bot of bots) {
    if (!_botRunners.has(bot.token)) {
      startBotPolling(bot.token, bot.agentSlug);
    }
  }
}

// Compat: polling único para o env var TELEGRAM_TOKEN (transição)
export async function startTelegramPolling() {
  const token = process.env.TELEGRAM_TOKEN;
  if (token) startBotPolling(token, 'mari');
}

export function stopTelegramPolling() {
  stopAllBots();
}
