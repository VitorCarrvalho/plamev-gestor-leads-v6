import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { InternalMessage } from '@plamev/shared';
import { processMessage } from './orchestrator';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Conexão BullMQ
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
// Conexão para operações de lista (debounce)
const redisClient = new Redis(redisUrl, { maxRetriesPerRequest: null });

export async function startConsumer() {
  console.log('[AGENT-AI] 🎧 Iniciando BullMQ Consumer...');

  const worker = new Worker('incoming-messages', async (job: Job) => {
    const data = job.data as any;

    // ── Formato novo: debounce com mensagens acumuladas em Redis ──
    if (data.debounce) {
      const { phone, canal, agentSlug } = data;
      const listKey = `debounce:msgs:${canal}:${phone}`;

      const rawMsgs = await redisClient.lrange(listKey, 0, -1);
      if (!rawMsgs.length) {
        console.log(`[AGENT-AI] ⚠️ Job ${job.id} sem msgs acumuladas (já processado?)`);
        return;
      }
      await redisClient.del(listKey);

      const msgs: InternalMessage[] = rawMsgs.map(m => JSON.parse(m));
      const ultimaMsg = msgs[msgs.length - 1];
      const textosCombinados = msgs
        .map(m => m.texto)
        .filter(Boolean)
        .join('\n')
        .trim();

      console.log(`[AGENT-AI] 📦 Debounce: ${msgs.length} msg(s) de ${phone} → "${textosCombinados.substring(0, 60)}"`);

      const msgParaProcessar: InternalMessage = {
        ...ultimaMsg,
        texto: textosCombinados,
        agentSlug: agentSlug || ultimaMsg.agentSlug,
      };

      try {
        await processMessage(msgParaProcessar);
      } catch (e: any) {
        console.error(`[AGENT-AI] ❌ Erro processando job ${job.id}:`, e.message);
        throw e;
      }
      return;
    }

    // ── Formato legado: message direto no payload ──
    if (data.message) {
      const msg = data.message as InternalMessage;
      console.log(`[AGENT-AI] 📨 Processando (legado) job ${job.id} | ${msg.canal} | ${msg.phone}`);
      try {
        await processMessage(msg);
      } catch (e: any) {
        console.error(`[AGENT-AI] ❌ Erro processando job ${job.id}:`, e.message);
        throw e;
      }
    }
  }, {
    connection,
    concurrency: 3,
  });

  worker.on('failed', (job, err) => {
    console.error(`[AGENT-AI] 🚨 Job ${job?.id} falhou definitivamente:`, err.message);
  });

  worker.on('completed', (job) => {
    console.log(`[AGENT-AI] ✅ Job ${job?.id} concluído`);
  });

  return worker;
}
