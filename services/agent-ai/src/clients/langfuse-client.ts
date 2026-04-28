import { Langfuse } from 'langfuse';

// Singleton — reutilizado por todo o processo agent-ai
export const langfuse = new Langfuse({
  publicKey:  process.env.LANGFUSE_PUBLIC_KEY  || '',
  secretKey:  process.env.LANGFUSE_SECRET_KEY  || '',
  baseUrl:    process.env.LANGFUSE_HOST        || 'https://cloud.langfuse.com',
  flushAt:    10,    // flush a cada 10 eventos
  flushInterval: 5000, // ou a cada 5s
  release:    process.env.RAILWAY_GIT_COMMIT_SHA || 'local',
  enabled:    !!(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY),
});

langfuse.on('error', (err) => {
  console.warn('[LANGFUSE] Erro ao enviar evento:', err.message);
});
