/**
 * audio.ts — Transcrição de áudio WhatsApp via Groq Whisper API
 *
 * Fluxo:
 *   1. Baixa áudio da Evolution API como base64
 *   2. Converte buffer para File com MIME type explícito
 *   3. Envia para Groq Whisper (whisper-large-v3-turbo)
 *   4. Retorna texto transcrito + base64 para o frontend renderizar o player
 *
 * Provider: Groq — https://console.groq.com
 * Modelo: whisper-large-v3-turbo
 * Env: GROQ_API_KEY, EVOLUTION_API_URL, EVOLUTION_API_KEY
 */
import https from 'https';
import http from 'http';
import OpenAI, { toFile } from 'openai';

const EVO_URL = process.env.EVOLUTION_API_URL || '';
const EVO_KEY = process.env.EVOLUTION_API_KEY  || '';

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

function baixarBase64(instancia: string, messageId: string, messageType = 'audioMessage'): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ message: { key: { id: messageId }, messageType } });
    const url = new URL(`${EVO_URL}/chat/getBase64FromMediaMessage/${instancia}`);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: url.hostname,
      port: url.port ? parseInt(url.port) : (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'apikey': EVO_KEY,
      },
    }, res => {
      let d = '';
      res.on('data', (c: string) => d += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(d);
          if (json.base64) resolve(json.base64);
          else reject(new Error('base64 não encontrado: ' + d.slice(0, 100)));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

export interface AudioResult {
  texto: string | null;
  base64: string;
  mimeType: string;
}

export async function transcreverAudio(instancia: string, messageId: string, messageType?: string): Promise<AudioResult> {
  const mimeType = messageType === 'pttMessage' ? 'audio/ogg; codecs=opus' : 'audio/ogg';
  let base64 = '';
  try {
    console.log(`[AUDIO] 🎤 Baixando áudio msg:${messageId} inst:${instancia}`);
    base64 = await baixarBase64(instancia, messageId, messageType || 'audioMessage');

    const audioBuffer = Buffer.from(base64, 'base64');
    console.log(`[AUDIO] Áudio baixado: ${Math.round(audioBuffer.length / 1024)}KB`);

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
