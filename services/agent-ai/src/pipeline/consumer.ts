import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { InternalMessage, JobPayload } from '@plamev/shared';
import { processMessage } from './orchestrator';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

export async function startConsumer() {
  console.log('[AGENT-AI] 🎧 Iniciando BullMQ Consumer...');

  const worker = new Worker<JobPayload>('incoming-messages', async (job: Job) => {
    const msg = job.data.message;
    console.log(`[AGENT-AI] 📨 Processando job ${job.id} | Canal: ${msg.canal} | Phone: ${msg.phone}`);
    
    try {
      await processMessage(msg);
      console.log(`[AGENT-AI] ✅ Processamento concluído para ${msg.phone}`);
    } catch (e: any) {
      console.error(`[AGENT-AI] ❌ Erro processando job ${job.id}:`, e.message);
      throw e; // Lança erro para o BullMQ tentar novamente
    }
  }, { 
    connection,
    concurrency: 5, // Processa até 5 mensagens em paralelo
  });

  worker.on('failed', (job, err) => {
    console.error(`[AGENT-AI] 🚨 Job ${job?.id} falhou:`, err.message);
  });

  return worker;
}
