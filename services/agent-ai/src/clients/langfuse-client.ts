import { Langfuse } from 'langfuse';

// O SDK lê LANGFUSE_PUBLIC_KEY e LANGFUSE_SECRET_KEY das env vars automaticamente.
// LANGFUSE_BASEURL também é lido automaticamente; só sobrescrevemos se LANGFUSE_HOST existir.
export const langfuse = new Langfuse({
  baseUrl:       process.env.LANGFUSE_BASEURL || process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com',
  flushAt:       5,
  flushInterval: 3000,
  release:       process.env.RAILWAY_GIT_COMMIT_SHA || 'local',
});

if (langfuse.enabled) {
  console.log(`[LANGFUSE] ✅ Ativo → ${process.env.LANGFUSE_BASEURL || process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com'}`);
  // Envia um evento de teste para validar conectividade no startup
  const startupTrace = langfuse.trace({ name: 'startup-check', tags: ['system'] });
  langfuse.flushAsync()
    .then(() => console.log('[LANGFUSE] ✅ Conectividade confirmada'))
    .catch((e: any) => console.error('[LANGFUSE] ❌ Falha no startup-check:', e?.message ?? e));
} else {
  console.warn('[LANGFUSE] ⚠️ Desabilitado — configure LANGFUSE_PUBLIC_KEY e LANGFUSE_SECRET_KEY no Railway');
}

langfuse.on('error', (err: any) => {
  console.error('[LANGFUSE] ❌ Erro ao enviar evento:', err?.message ?? err);
});
