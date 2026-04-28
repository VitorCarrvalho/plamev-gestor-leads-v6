import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { isDuplicate, messageQueue, redisClient } from '../utils/redis';
import { normalizeMessage } from '../utils/normalizer';
import { enviar } from '../services/sender';

const router = Router();

const DEBOUNCE_DELAY_MS = 8000; // espera 8s após a última mensagem antes de processar

// Middleware to validate HMAC signature from Gateway
const validateHmac = (req: Request, res: Response, next: any) => {
  const signature = req.headers['x-hub-signature'];
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;

  if (secret && signature) {
    const hmac = crypto.createHmac('sha256', secret);
    const digest = 'sha256=' + hmac.update(JSON.stringify(req.body)).digest('hex');
    if (signature !== digest) {
      console.warn('[CHANNEL-SERVICE] ⚠️ Invalid HMAC signature');
      return res.status(401).send('Unauthorized');
    }
  }
  next();
};

async function processWhatsAppItem(item: any, body: any, agentSlug: string) {
  const logPrefix = `[WH] event=${body.event || '?'} instance=${body.instance || body.instanceName || '?'}`;

  if (item.key?.fromMe === true) {
    console.log(`${logPrefix} → ignorado (fromMe=true)`);
    return;
  }

  const senderNum = (body.sender || '').replace(/@.*/, '');
  const remoto = (item.key?.remoteJid || '').replace(/@.*/, '');
  if (senderNum && remoto && senderNum === remoto) {
    console.log(`${logPrefix} → ignorado (sender==remoto: ${senderNum})`);
    return;
  }

  // Ignorar mensagens históricas — mais de 5 minutos
  const msgTimestamp = item.messageTimestamp || item.message?.messageContextInfo?.messageTimestamp || 0;
  const agora = Math.floor(Date.now() / 1000);
  if (msgTimestamp && (agora - msgTimestamp) > 300) {
    console.log(`${logPrefix} → ignorado (histórico, age=${agora - msgTimestamp}s)`);
    return;
  }

  const jidRaw = item.key?.remoteJid || '';
  if (!jidRaw || jidRaw.includes('@g.us') || jidRaw.includes('@broadcast')) {
    console.log(`${logPrefix} → ignorado (grupo/broadcast: ${jidRaw})`);
    return;
  }

  const msgId = item.key?.id || '';
  if (!msgId) { console.log(`${logPrefix} → ignorado (sem msgId)`); return; }
  if (await isDuplicate(msgId, 'whatsapp')) {
    console.log(`${logPrefix} → ignorado (duplicado: ${msgId})`);
    return;
  }

  const instancia = body.instance || body.instanceName || agentSlug;
  const senderChip = body.sender || null;
  const senderPn = item.key?.senderPn || null;

  const phone = senderPn
    ? senderPn.replace(/@s\.whatsapp\.net$|@c\.us$/g, '')
    : jidRaw.replace(/@s\.whatsapp\.net$|@lid$|@c\.us$/g, '');

  const msgObj = item.message || {};
  const msgType = item.messageType || '';
  const texto = msgObj.conversation || msgObj.extendedTextMessage?.text || '';

  const isAudio = !!(msgObj.audioMessage || msgObj.pttMessage) || msgType === 'audioMessage' || msgType === 'pttMessage';
  const isPtt = !!(msgObj.pttMessage) || msgObj.audioMessage?.ptt === true || msgType === 'pttMessage';
  const audio = isAudio ? { _type: isPtt ? 'pttMessage' : 'audioMessage', _msgId: msgId } : null;

  const isImagem = !!(msgObj.imageMessage) || msgType === 'imageMessage';
  const imagem = isImagem ? { _type: 'imageMessage', _msgId: msgId } : null;

  const docMsg = msgObj.documentMessage || msgObj.documentWithCaptionMessage?.message?.documentMessage || null;
  const isDoc = !!(docMsg) || msgType === 'documentMessage' || msgType === 'documentWithCaptionMessage';
  const documento = isDoc ? {
    _type: msgType || 'documentMessage',
    _msgId: msgId,
    fileName: docMsg?.fileName || docMsg?.title || 'documento',
    mimetype: docMsg?.mimetype || '',
    caption: docMsg?.caption || msgObj.documentWithCaptionMessage?.message?.documentMessage?.caption || '',
  } : null;

  if (!texto && !audio && !imagem && !documento) return;

  const msg = normalizeMessage({
    id: msgId,
    canal: 'whatsapp',
    phone,
    jid: jidRaw,
    senderPn,
    senderChip,
    instancia,
    nome: item.pushName,
    texto,
    audio,
    imagem,
    documento,
    agentSlug,
  });

  // ── DEBOUNCE: acumula mensagens do mesmo usuário numa lista Redis ──
  const listKey = `debounce:msgs:${msg.canal}:${msg.phone}`;
  await redisClient.rpush(listKey, JSON.stringify(msg));
  await redisClient.expire(listKey, 120); // TTL de 2 min

  // Cancela job anterior (se ainda estiver delayed) e cria novo com delay resetado
  const debounceId = `debounce:${msg.canal}:${msg.phone}`;
  try {
    const existing = await messageQueue.getJob(debounceId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'delayed' || state === 'waiting') {
        await existing.remove();
      }
    }
  } catch { /* ignora se não encontrar */ }

  await messageQueue.add('process-message',
    { debounce: true, phone: msg.phone, canal: msg.canal, agentSlug: msg.agentSlug },
    {
      jobId: debounceId,
      delay: DEBOUNCE_DELAY_MS,
      removeOnComplete: true,
      removeOnFail: false,
    }
  );

  console.log(`[CHANNEL-SERVICE] 📱 Acumulado WA: ${phone} | "${texto.substring(0, 40)}" | debounce=${DEBOUNCE_DELAY_MS}ms`);
}

router.post('/whatsapp', validateHmac, async (req: Request, res: Response) => {
  res.json({ ok: true });
  const body = req.body || {};
  const instancia = body.instance || body.instanceName || '';
  const { resolverAgentePorInstancia } = await import('../services/config');
  const agentSlug = resolverAgentePorInstancia(instancia);

  const lista = Array.isArray(body.data) ? body.data : body.data ? [body.data] : [];
  for (const item of lista) {
    try {
      await processWhatsAppItem(item, body, agentSlug);
    } catch (e: any) {
      console.error('[CHANNEL-SERVICE] Erro ao processar item WA:', e.message);
    }
  }
});

// ── Diagnóstico da fila ─────────────────────────────────────────
router.get('/queue-status', async (_req: Request, res: Response) => {
  try {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      messageQueue.getWaitingCount(),
      messageQueue.getActiveCount(),
      messageQueue.getCompletedCount(),
      messageQueue.getFailedCount(),
      messageQueue.getDelayedCount(),
    ]);
    res.json({ ok: true, queue: { waiting, active, completed, failed, delayed } });
  } catch (e: any) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// ── Endpoint interno: agent-ai envia resposta para ser entregue ao usuário ──
const internalRouter = Router();

internalRouter.post('/send', async (req: Request, res: Response) => {
  const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'plamev-internal';
  if (req.headers['x-internal-secret'] !== INTERNAL_SECRET) {
    res.status(401).json({ erro: 'Não autorizado' });
    return;
  }
  const { message, resposta } = req.body || {};
  if (!message || !resposta) {
    res.status(400).json({ erro: 'message e resposta são obrigatórios' });
    return;
  }
  res.json({ ok: true });
  try {
    await enviar(message, resposta);
  } catch (e: any) {
    console.error('[CHANNEL-SERVICE] ❌ Falha ao enviar resposta:', e.message);
  }
});

export function setupRoutes(app: any) {
  app.get('/health', (_req: Request, res: Response) => res.json({ ok: true, service: 'channel-service' }));
  app.get('/debug/runtime', (_req: Request, res: Response) => res.json({
    ok: true,
    service: 'channel-service',
    runtime: {
      webhookEntry: '/webhooks/whatsapp',
      debounceDelayMs: DEBOUNCE_DELAY_MS,
      queue: 'incoming-messages',
      redisListPattern: 'debounce:msgs:{canal}:{phone}',
      sendEndpoint: '/internal/send',
      configSource: 'CRM /api/internal/channel-config',
    },
    notes: [
      'O debounce atual acumula mensagens por telefone/canal em Redis e reseta o delay do job no BullMQ.',
      'Este endpoint e somente diagnostico e nao altera o fluxo do webhook.',
    ],
  }));
  app.use('/webhooks', router);
  app.use('/internal', internalRouter);
}
