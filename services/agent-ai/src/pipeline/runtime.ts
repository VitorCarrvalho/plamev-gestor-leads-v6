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
  const transcricao = await audioSvc.transcreverAudio(msg.instancia, msg.id, msg.audio?._type);
  if (!transcricao) {
    const fallback = 'Oi! Não consegui ouvir seu áudio, pode me enviar em texto? 😊';
    await sendResponse(msg, fallback);
    await persistInteraction(msg, fallback, { inputTextOverride: '[🎤 áudio recebido]' }).catch(() => {});
    return;
  }

  await processMessage({
    ...msg,
    texto: transcricao,
  }, runtimeConfig);
}

async function handleDocumentMessage(msg: InternalMessage, orgId: string) {
  const { perfil, historico } = await buildConversationContext(msg, orgId);
  const ctxPet = perfil?.nome
    ? `Pet: ${perfil.nome}${perfil.especie ? ` (${perfil.especie})` : ''}`
    : null;

  const resposta = await documentSvc.processarDocumento(
    msg.instancia,
    msg.id,
    msg.documento?._type,
    msg.documento?.fileName || 'documento',
    ctxPet,
    historico,
  );

  if (!resposta) return;

  await sendResponse(msg, resposta);
  await persistInteraction(msg, resposta, {
    inputTextOverride: `[📄 ${msg.documento?.fileName || 'documento enviado'}]`,
  }).catch(() => {});
}

async function handleImageMessage(msg: InternalMessage, orgId: string) {
  const { cliente, conversa, perfil, historico } = await buildConversationContext(msg, orgId);
  const resposta = await imageSvc.processarImagem(
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

  if (!resposta) {
    const fallback = 'Que foto linda! 😊 Me conta mais sobre seu pet?';
    await sendResponse(msg, fallback);
    await persistInteraction(msg, fallback, { inputTextOverride: '[📸 imagem enviada]' }).catch(() => {});
    return;
  }

  await sendResponse(msg, resposta);
  await persistInteraction(msg, resposta, { inputTextOverride: '[📸 imagem enviada]' }).catch(() => {});
}

export async function processIncomingMessage(msg: InternalMessage) {
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
