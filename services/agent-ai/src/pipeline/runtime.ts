import { InternalMessage } from '@plamev/shared';
import { PipelineRuntimeContext, processMessage } from './orchestrator';
import { sendResponse, persistInteraction } from './delivery';
import * as db from '../db';

const audioSvc = require('../services/audio');
const documentSvc = require('../services/document');
const imageSvc = require('../services/image');

function buildDbAdapter(orgId: string) {
  return {
    atualizarPerfil: (clientId: string, dados: Record<string, any>, conversaId?: string) =>
      db.atualizarPerfil(orgId, clientId, dados, conversaId),
  };
}

async function resolveRuntimeConfig(msg: InternalMessage) {
  const agentSlug = msg.agentSlug || 'mari';
  const agentConfig = await db.resolverConfigRuntimeAgente(agentSlug);
  return {
    orgId: agentConfig.org_id,
    agentConfig,
  };
}

async function buildConversationContext(msg: InternalMessage, orgId: string) {
  const agentSlug = msg.agentSlug || 'mari';
  const agente = await db.buscarAgente(orgId, agentSlug);
  if (!agente) throw new Error(`Agente não encontrado: ${agentSlug}`);

  const cliente = await db.buscarOuCriarCliente(orgId, msg.phone, 'phone', msg.nome || null);
  const conversa = await db.buscarOuCriarConversa(
    orgId,
    cliente.id,
    agente.id,
    msg.canal,
    msg.phone,
    msg.jid,
    msg.instancia,
  );
  const perfil = await db.buscarOuCriarPerfil(orgId, cliente.id).catch(() => null);
  const historico = await db.buscarHistorico(orgId, conversa.id, 10).catch(() => []);

  return { agente, cliente, conversa, perfil, historico };
}

async function handleAudioMessage(msg: InternalMessage, runtimeConfig: PipelineRuntimeContext) {
  const { texto: transcricao, base64: audioBase64, mimeType: audioMimeType } =
    await audioSvc.transcreverAudio(msg.instancia, msg.id, msg.audio?._type);

  if (!transcricao) {
    const fallback = 'Oi! Não consegui ouvir seu áudio, pode me enviar em texto? 😊';
    const sendResult = await sendResponse(msg, fallback);
    await persistInteraction(msg, fallback, {
      inputTextOverride: '[🎤 áudio recebido]',
      mediaBase64: audioBase64 || undefined,
      mediaMimeType: audioMimeType || 'audio/ogg',
      mediaFileName: 'audio.ogg',
      msgIdExternoResp: sendResult?.msg_id_externo ?? null,
    }).catch(() => {});
    return;
  }

  // Pre-save the audio message with base64 so it renders in the UI.
  // salvar-interacao deduplicates by msg_id_externo, so processMessage won't re-save the user message.
  await persistInteraction(msg, '', {
    inputTextOverride: '[🎤 áudio recebido]',
    mediaBase64: audioBase64 || undefined,
    mediaMimeType: audioMimeType || 'audio/ogg',
    mediaFileName: 'audio.ogg',
  }).catch(() => {});

  await processMessage({ ...msg, texto: transcricao }, runtimeConfig);
}

async function handleDocumentMessage(msg: InternalMessage, orgId: string) {
  const { perfil, historico } = await buildConversationContext(msg, orgId);
  const ctxPet = perfil?.nome
    ? `Pet: ${perfil.nome}${perfil.especie ? ` (${perfil.especie})` : ''}`
    : null;

  const docFileName = msg.documento?.fileName || 'documento';
  const docMimetypeOriginal: string | undefined = msg.documento?.mimetype || undefined;

  // Save the user's document immediately so it appears in the chat even if processing fails
  await persistInteraction(msg, '', {
    inputTextOverride: `[📄 ${docFileName}]`,
    mediaMimeType: docMimetypeOriginal,
    mediaFileName: docFileName,
  }).catch(() => {});

  const { resposta, mimeType: docMimeType, fileName: resolvedFileName } =
    await documentSvc.processarDocumento(
      msg.instancia,
      msg.id,
      msg.documento?._type,
      docFileName,
      ctxPet,
      historico,
    );

  if (!resposta) return;

  const sendDocResult = await sendResponse(msg, resposta);
  // User message already saved above; dedup will skip it, only agent response is saved
  await persistInteraction(msg, resposta, {
    mediaMimeType: docMimeType || docMimetypeOriginal,
    mediaFileName: resolvedFileName || docFileName,
    msgIdExternoResp: sendDocResult?.msg_id_externo ?? null,
  }).catch(() => {});
}

const MAX_IMG_BASE64 = 5 * 1024 * 1024; // 5 MB cap to avoid bloating DB

async function handleImageMessage(msg: InternalMessage, orgId: string) {
  const { cliente, conversa, perfil, historico } = await buildConversationContext(msg, orgId);
  const { resposta, base64: imgBase64, mimeType: imgMimeType } = await imageSvc.processarImagem(
    msg.instancia,
    msg.id,
    {
      phone: msg.phone,
      clienteId: cliente.id,
      conversaId: conversa.id,
      nomeCliente: cliente.nome,
      nomePet: perfil?.nome,
      especie: perfil?.especie,
      raca: perfil?.raca,
      etapa: conversa.etapa,
      historico,
      captionCliente: msg.imagem?.caption || '',
    },
    buildDbAdapter(orgId),
  );

  const mediaOpts = {
    inputTextOverride: '[📸 imagem enviada]',
    mediaBase64: (imgBase64 && imgBase64.length <= MAX_IMG_BASE64) ? imgBase64 : undefined,
    mediaMimeType: imgMimeType || 'image/jpeg',
    mediaFileName: 'imagem.jpg',
  };

  if (!resposta) {
    const fallback = 'Que foto linda! 😊 Me conta mais sobre seu pet?';
    const sendImgResult = await sendResponse(msg, fallback);
    await persistInteraction(msg, fallback, { ...mediaOpts, msgIdExternoResp: sendImgResult?.msg_id_externo ?? null }).catch(() => {});
    return;
  }

  const sendImgResult2 = await sendResponse(msg, resposta);
  await persistInteraction(msg, resposta, { ...mediaOpts, msgIdExternoResp: sendImgResult2?.msg_id_externo ?? null }).catch(() => {});
}

export async function processIncomingMessage(msg: InternalMessage) {
  // ── Verificar IA silenciada ANTES de qualquer processamento ──
  // Cobre todos os tipos: texto, áudio, documento e imagem.
  // Sem esse check aqui, mídia bypassa a verificação do orchestrator.
  const silenciada = await db.verificarIaSilenciada(msg.phone, msg.canal);
  if (silenciada) {
    console.log(`[RUNTIME] 🔇 IA silenciada para ${msg.phone}/${msg.canal} — mensagem recebida mas agente não responde`);
    const inputText = msg.documento ? `[📄 ${msg.documento?.fileName || 'documento'}]`
      : msg.imagem   ? '[📸 imagem enviada]'
      : msg.audio    ? '[🎤 áudio recebido]'
      : msg.texto    || '';
    await persistInteraction(msg, '', { inputTextOverride: inputText || undefined }).catch(() => {});
    return;
  }

  const runtimeConfig = await resolveRuntimeConfig(msg);
  const { orgId } = runtimeConfig;

  if (!msg.texto && msg.audio && msg.instancia) {
    await handleAudioMessage(msg, runtimeConfig);
    return;
  }

  if (!msg.texto && msg.documento && msg.instancia) {
    await handleDocumentMessage(msg, orgId);
    return;
  }

  if (!msg.texto && msg.imagem && msg.instancia) {
    await handleImageMessage(msg, orgId);
    return;
  }

  await processMessage(msg, runtimeConfig);
}
