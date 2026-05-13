/**
 * audio.ts — Transcrição de áudio via Groq Whisper API
 *
 * O base64 do áudio é pré-baixado pelo channel-service (que tem acesso ao
 * Evolution API) e passado aqui como parâmetro. Não há chamadas HTTP ao
 * Evolution API neste serviço.
 *
 * Provider: Groq — https://console.groq.com
 * Modelo: whisper-large-v3-turbo
 * Env: GROQ_API_KEY
 */
import OpenAI, { toFile } from 'openai';

let _groq: OpenAI | null = null;
function getGroq(): OpenAI {
  if (!_groq) {
    _groq = new OpenAI({
      apiKey: process.env.GROQ_API_KEY || '',
      baseURL: 'https://api.groq.com/openai/v1',
    });
  }
  return _groq;
}

export interface AudioResult {
  texto: string | null;
  base64: string;
  mimeType: string;
}

export async function transcreverAudio(
  _instancia: string,
  _messageId: string,
  messageType?: string,
  preDownloadedBase64?: string | null,
): Promise<AudioResult> {
  const mimeType = messageType === 'pttMessage' ? 'audio/ogg; codecs=opus' : 'audio/ogg';
  const base64 = preDownloadedBase64 || '';

  if (!base64) {
    console.error('[AUDIO] ❌ base64 não fornecido — channel-service não pré-baixou o áudio');
    return { texto: null, base64: '', mimeType };
  }

  try {
    const audioBuffer = Buffer.from(base64, 'base64');
    console.log(`[AUDIO] 🎤 Transcrevendo ${Math.round(audioBuffer.length / 1024)}KB via Groq`);

    const file = await toFile(audioBuffer, 'audio.ogg', { type: 'audio/ogg' });
    const transcription = await getGroq().audio.transcriptions.create({
      file,
      model: 'whisper-large-v3-turbo',
      language: 'pt',
    });

    const texto = transcription.text?.trim() || null;
    console.log(`[AUDIO] ✅ Transcrito: "${(texto || '').slice(0, 80)}"`);
    return { texto, base64, mimeType };
  } catch (e: any) {
    console.error('[AUDIO] ❌ Erro transcrição:', e.message);
    return { texto: null, base64, mimeType };
  }
}
