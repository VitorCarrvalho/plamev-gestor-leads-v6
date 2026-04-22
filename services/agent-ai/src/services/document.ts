/**
 * services/documento.js
 * Leitura e interpretação de documentos enviados pelo cliente.
 *
 * Tipos suportados:
 *   - PDF (.pdf)
 *   - Word (.docx, .doc)
 *   - Excel (.xlsx, .xls, .csv)
 *   - Texto (.txt, .md)
 *   - Imagem → já tratado por imagem.js (Claude Vision)
 *
 * Fluxo:
 *   1. Baixar via Evolution API (getBase64FromMediaMessage)
 *   2. Extrair texto do documento
 *   3. Passar para Claude com contexto da conversa
 *   4. Mari responde de forma contextualizada
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

const EVO_URL = process.env.EVOLUTION_URL;
const EVO_KEY = process.env.EVOLUTION_KEY;
const ANT_KEY = process.env.ANTHROPIC_API_KEY;

// ── Baixar documento via Evolution ───────────────────────────
async function baixarDocumento(instancia, messageId, messageType) {
  const body = JSON.stringify({
    message: { key: { id: messageId }, messageType }
  });
  const url = new URL(`${EVO_URL}/chat/getBase64FromMediaMessage/${instancia}`);
  const mod = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = mod.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'apikey': EVO_KEY,
      }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(d);
          if (json.base64) resolve({ base64: json.base64, mimetype: json.mimetype || '', fileName: json.fileName || 'documento' });
          else reject(new Error('base64 não encontrado: ' + d.slice(0, 120)));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// ── Extrair texto do documento ────────────────────────────────
async function extrairTexto(base64, mimetype, fileName) {
  const tmpDir  = os.tmpdir();
  const ext     = path.extname(fileName).toLowerCase() || '.' + (mimetype.split('/')[1] || 'bin');
  const tmpPath = path.join(tmpDir, `mari_doc_${Date.now()}${ext}`);

  try {
    const buf = Buffer.from(base64, 'base64');
    fs.writeFileSync(tmpPath, buf);

    // PDF
    if (ext === '.pdf' || mimetype.includes('pdf')) {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buf);
      return { texto: data.text?.trim().slice(0, 8000) || '', tipo: 'PDF', paginas: data.numpages };
    }

    // Word
    if (ext === '.docx' || mimetype.includes('wordprocessingml') || mimetype.includes('msword')) {
      const mammoth = require('mammoth');
      const r = await mammoth.extractRawText({ path: tmpPath });
      return { texto: r.value?.trim().slice(0, 8000) || '', tipo: 'Word' };
    }

    // Excel / CSV
    if (['.xlsx','.xls','.csv'].includes(ext) || mimetype.includes('spreadsheet') || mimetype.includes('excel')) {
      const XLSX = require('xlsx');
      const wb   = XLSX.readFile(tmpPath);
      let texto  = '';
      wb.SheetNames.slice(0, 3).forEach(sheet => {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheet]);
        texto += `\n=== ${sheet} ===\n${csv.slice(0, 2000)}`;
      });
      return { texto: texto.trim().slice(0, 6000), tipo: 'Planilha' };
    }

    // Texto puro / Markdown
    if (['.txt','.md','.csv'].includes(ext) || mimetype.includes('text')) {
      const texto = buf.toString('utf8').slice(0, 8000);
      return { texto, tipo: 'Texto' };
    }

    return { texto: null, tipo: 'Desconhecido' };
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

// ── Claude analisa o documento ────────────────────────────────
async function analisarComClaude(textoDoc, tipoDoc, fileName, contextoPet, historico) {
  const hist = (historico || []).slice(-4)
    .map(h => `${h.role === 'user' ? 'Cliente' : 'Mari'}: ${h.conteudo.slice(0, 80)}`)
    .join('\n');

  const system = `Você é a Mariana (Mari), consultora de planos de saúde pet da Plamev.
O cliente enviou um documento. Analise e responda de forma natural e contextualizada.
${contextoPet ? `Contexto: ${contextoPet}` : ''}
Tom: caloroso, direto, WhatsApp. Máximo 3 frases.
Se for documento médico/exame do pet: mencionar relevância para o plano.
Se for comprovante/CPF/doc pessoal: confirmar recebimento e dizer que vai processar.
Se não conseguir interpretar: pedir para enviar em outro formato.`;

  const userMsg = `Documento recebido: ${fileName} (${tipoDoc})
Conteúdo:
${textoDoc.slice(0, 4000)}

Histórico da conversa:
${hist || '(início da conversa)'}

Como Mari responderia a este documento?`;

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 300,
      system,
      messages: [{ role: 'user', content: userMsg }]
    });
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'x-api-key': ANT_KEY, 'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d).content?.[0]?.text?.trim() || null); }
        catch { reject(new Error(d.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// ── Função principal ──────────────────────────────────────────
async function processarDocumento(instancia, messageId, messageType, fileName, contextoPet, historico) {
  try {
    console.log(`[DOC] 📄 Documento recebido: ${fileName} (${messageType}) inst:${instancia}`);

    const { base64, mimetype, fileName: fn } = await baixarDocumento(instancia, messageId, messageType);
    const nomeArq = fileName || fn || 'documento';

    const { texto, tipo, paginas } = await extrairTexto(base64, mimetype, nomeArq);

    if (!texto) {
      console.log(`[DOC] ⚠️ Não conseguiu extrair texto de ${nomeArq}`);
      return `Recebi seu documento! 😊 Mas não consegui ler o conteúdo de ${nomeArq}. Pode enviar em PDF ou formato de texto?`;
    }

    console.log(`[DOC] ✅ ${tipo} extraído: ${texto.length} chars${paginas ? ` (${paginas} págs)` : ''}`);

    const resposta = await analisarComClaude(texto, tipo, nomeArq, contextoPet, historico);
    return resposta || `Recebi seu documento ${nomeArq}! 📄 Vou verificar o conteúdo e te retorno em breve. 😊`;

  } catch (e) {
    console.error('[DOC] ❌ Erro:', e.message);
    return null;
  }
}

module.exports = { processarDocumento };
