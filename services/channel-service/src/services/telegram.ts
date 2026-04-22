import https from 'https';
import { isDuplicate, messageQueue } from '../utils/redis';
import { normalizeMessage } from '../utils/normalizer';

let tgOffset = 0;
let tgAtivo = false;

function tgGet(path: string): Promise<any> {
  const token = process.env.TELEGRAM_TOKEN;
  if (!token) return Promise.reject(new Error('No token'));

  return new Promise((resolve, reject) => {
    https.get(`https://api.telegram.org/bot${token}${path}`, { timeout: 25000 }, res => {
      let d = ''; 
      res.on('data', c => d += c);
      res.on('end', () => { 
        try { 
          resolve(JSON.parse(d)); 
        } catch(e) { 
          reject(e); 
        } 
      });
    }).on('error', reject).on('timeout', () => reject(new Error('timeout')));
  });
}

export async function startTelegramPolling() {
  await tgGet('/deleteWebhook').catch(() => {});
  console.log('[CHANNEL-SERVICE] 💬 Telegram polling iniciado');
  tgAtivo = true;

  while (tgAtivo) {
    try {
      const res = await tgGet(`/getUpdates?offset=${tgOffset}&timeout=20&allowed_updates=["message"]`);
      
      if (res.ok && res.result?.length) {
        for (const update of res.result) {
          tgOffset = update.update_id + 1;
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
            agentSlug: 'mari',
          });
          
          console.log(`[CHANNEL-SERVICE] 💬 Enfileirando TG: ${phone} | "${msgObj.text.substring(0, 30)}..."`);
          
          await messageQueue.add('process-message', { message: m }, {
            jobId: `msg:${m.canal}:${m.id}`,
            delay: 5000,
            removeOnComplete: true,
            removeOnFail: false
          });
        }
      }
    } catch(e: any) {
      if (e.message !== 'timeout') console.error('[CHANNEL-SERVICE] TG erro:', e.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

export function stopTelegramPolling() {
  tgAtivo = false;
}
