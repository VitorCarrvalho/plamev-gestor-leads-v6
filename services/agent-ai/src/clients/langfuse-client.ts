import { Langfuse } from 'langfuse';

// SDK lê LANGFUSE_PUBLIC_KEY e LANGFUSE_SECRET_KEY automaticamente das env vars.
// Não passamos strings vazias para não sobrescrever a leitura automática.
export const langfuse = new Langfuse({
  baseUrl:       process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com',
  flushAt:       10,
  flushInterval: 5000,
  release:       process.env.RAILWAY_GIT_COMMIT_SHA || 'local',
});

if (langfuse.enabled) {
  console.log('[LANGFUSE] ✅ Observabilidade ativa');
} else {
  console.warn('[LANGFUSE] ⚠️ Desabilitado — adicione LANGFUSE_PUBLIC_KEY e LANGFUSE_SECRET_KEY nas variáveis do Railway');
}

langfuse.on('error', (err: any) => {
  console.warn('[LANGFUSE] Erro ao enviar evento:', err?.message ?? err);
});
