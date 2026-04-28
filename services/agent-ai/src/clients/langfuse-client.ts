import { Langfuse } from 'langfuse';

// O SDK lê LANGFUSE_PUBLIC_KEY e LANGFUSE_SECRET_KEY das env vars automaticamente.
// LANGFUSE_BASEURL também é lido automaticamente; só sobrescrevemos se LANGFUSE_HOST existir.
// Aceita LANGFUSE_BASEURL (SDK nativo), LANGFUSE_BASE_URL (com underscore) ou LANGFUSE_HOST
const LANGFUSE_BASE_URL =
  process.env.LANGFUSE_BASEURL ||
  process.env.LANGFUSE_BASE_URL ||
  process.env.LANGFUSE_HOST ||
  'https://cloud.langfuse.com';

export const langfuse = new Langfuse({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  baseUrl:   LANGFUSE_BASE_URL,
  flushAt:       5,
  flushInterval: 3000,
  release:       process.env.RAILWAY_GIT_COMMIT_SHA || 'local',
});

if (langfuse.enabled) {
  console.log(`[LANGFUSE] ✅ Ativo → ${LANGFUSE_BASE_URL}`);
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
