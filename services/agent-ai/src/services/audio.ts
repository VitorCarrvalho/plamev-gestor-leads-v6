/**
 * audio.ts — Transcrição de áudio WhatsApp via OpenAI Whisper API
 *
 * Fluxo:
 *   1. Baixa áudio da Evolution API como base64
 *   2. Escreve em arquivo .ogg temporário
 *   3. Envia para OpenAI Whisper API (aceita ogg/opus nativamente)
 *   4. Retorna texto transcrito
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import http from 'http';
import OpenAI from 'openai';

const EVO_URL = process.env.EVOLUTION_URL || '';
const EVO_KEY = process.env.EVOLUTION_KEY || '';

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
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

export async function transcreverAudio(instancia: string, messageId: string, messageType?: string): Promise<string | null> {
  const tmpPath = path.join(os.tmpdir(), `mari_audio_${Date.now()}.ogg`);
  try {
    console.log(`[AUDIO] 🎤 Baixando áudio msg:${messageId} inst:${instancia}`);
    const base64 = await baixarBase64(instancia, messageId, messageType || 'audioMessage');
    fs.writeFileSync(tmpPath, Buffer.from(base64, 'base64'));
    console.log(`[AUDIO] Arquivo salvo: ${tmpPath} (${Math.round(fs.statSync(tmpPath).size / 1024)}KB)`);

    const transcription = await getOpenAI().audio.transcriptions.create({
      file: fs.createReadStream(tmpPath) as any,
      model: 'whisper-1',
      language: 'pt',
    });

    const texto = transcription.text?.trim() || null;
    console.log(`[AUDIO] ✅ Transcrito: "${(texto || '').slice(0, 80)}"`);
    return texto;
  } catch (e: any) {
    console.error('[AUDIO] ❌ Erro:', e.message);
    return null;
  } finally {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
  }
}

module.exports = { transcreverAudio };
