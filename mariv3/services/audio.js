/**
 * services/audio.js
 * Transcrição de áudio WhatsApp para texto.
 *
 * Fluxo:
 *   1. Baixa áudio da Evolution API como base64
 *   2. Salva como .ogg temporário
 *   3. Converte para .wav com ffmpeg
 *   4. Transcreve com Whisper local
 *   5. Retorna texto limpo
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const https   = require('https');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const { exec } = require('child_process');

const EVO_URL = process.env.EVOLUTION_URL;
const EVO_KEY = process.env.EVOLUTION_KEY;

// ── Baixar base64 do áudio via Evolution API ─────────────────
function baixarBase64(instancia, messageId, messageType = 'audioMessage') {
  return new Promise((resolve, reject) => {
    // PTT (voz) = pttMessage, áudio normal = audioMessage
    // Evolution v2 usa messageType diferente para cada um
    const body = JSON.stringify({
      message: { key: { id: messageId }, messageType }
    });
    const url  = new URL(`${EVO_URL}/chat/getBase64FromMediaMessage/${instancia}`);
    const mod  = url.protocol === 'https:' ? https : http;

    const req = mod.request({
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'apikey':         EVO_KEY,
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
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

// ── Converter ogg → wav com ffmpeg ──────────────────────────
function converter(oggPath, wavPath) {
  return new Promise((resolve, reject) => {
    exec(`ffmpeg -y -i "${oggPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${wavPath}" 2>/dev/null`,
      (err) => err ? reject(err) : resolve());
  });
}

// ── Transcrever com Whisper local ────────────────────────────
function transcrever(wavPath) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(wavPath);
    exec(`whisper "${wavPath}" --model tiny --language Portuguese --output_format txt --output_dir "${dir}" 2>/dev/null`,
      (err, stdout, stderr) => {
        if (err) return reject(err);
        // Whisper salva como <arquivo>.txt
        const txtPath = wavPath.replace('.wav', '.txt');
        if (fs.existsSync(txtPath)) {
          const texto = fs.readFileSync(txtPath, 'utf8').trim();
          resolve(texto);
        } else {
          // Tentar extrair do stdout
          const linhas = stdout.split('\n').filter(l => l.trim() && !l.startsWith('['));
          resolve(linhas.join(' ').trim() || 'Não foi possível transcrever o áudio.');
        }
      }
    );
  });
}

// ── Limpar arquivos temporários ──────────────────────────────
function limpar(...arquivos) {
  arquivos.forEach(f => { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {} });
}

// ── Função principal ─────────────────────────────────────────
async function transcreverAudio(instancia, messageId, messageType) {
  const tmpDir  = os.tmpdir();
  const base    = `mari_audio_${Date.now()}`;
  const oggPath = path.join(tmpDir, `${base}.ogg`);
  const wavPath = path.join(tmpDir, `${base}.wav`);
  const txtPath = path.join(tmpDir, `${base}.txt`);

  try {
    console.log(`[AUDIO] Baixando áudio msg:${messageId} inst:${instancia}`);

    // 1. Baixar base64
    const base64 = await baixarBase64(instancia, messageId, messageType || 'audioMessage');
    fs.writeFileSync(oggPath, Buffer.from(base64, 'base64'));
    console.log(`[AUDIO] Salvo: ${oggPath} (${Math.round(fs.statSync(oggPath).size / 1024)}KB)`);

    // 2. Converter
    await converter(oggPath, wavPath);
    console.log(`[AUDIO] Convertido: ${wavPath}`);

    // 3. Transcrever
    const texto = await transcrever(wavPath);
    console.log(`[AUDIO] ✅ Transcrito: "${texto.slice(0, 80)}"`);

    return texto || null;

  } catch (e) {
    console.error('[AUDIO] ❌ Erro:', e.message);
    return null;
  } finally {
    limpar(oggPath, wavPath, txtPath);
  }
}

module.exports = { transcreverAudio };
