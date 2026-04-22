/**
 * services/imagem.js
 * Análise inteligente de imagens — integrada com o fluxo de vendas.
 *
 * Funcionalidades:
 *   - Identifica se é foto de pet, documento ou outra coisa
 *   - Detecta espécie, raça, porte, idade aparente
 *   - Salva dados extraídos no perfil do pet (BD)
 *   - Resposta contextualizada com histórico da conversa
 *   - Usa contexto para avançar na venda
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const https = require('https');
const http  = require('http');

const EVO_URL = process.env.EVOLUTION_URL;
const EVO_KEY = process.env.EVOLUTION_KEY;
const ANT_KEY = process.env.ANTHROPIC_API_KEY;

// ── Baixar imagem como base64 ─────────────────────────────────
function baixarBase64(instancia, messageId) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      message: { key: { id: messageId }, messageType: 'imageMessage' }
    });
    const url = new URL(`${EVO_URL}/chat/getBase64FromMediaMessage/${instancia}`);
    const mod = url.protocol === 'https:' ? https : http;

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
          const j = JSON.parse(d);
          if (j.base64) resolve({ base64: j.base64, mimetype: j.mimetype || 'image/jpeg' });
          else reject(new Error('base64 não encontrado: ' + d.slice(0, 120)));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// ── Análise completa com Claude Vision ───────────────────────
function analisarImagem(base64, mimetype, contexto) {
  const { nomePet, nomeCliente, especie, raca, etapa, historico, captionCliente } = contexto || {};

  const hist = (historico || []).slice(-4)
    .map(h => `${h.role === 'user' ? (nomeCliente||'Cliente') : 'Mari'}: ${h.conteudo.slice(0, 80)}`)
    .join('\n');

  const system = `Você é a Mariana (Mari), consultora de planos de saúde pet da Plamev.
Analise esta imagem com dois objetivos: IDENTIFICAR e RESPONDER.

IDENTIFICAÇÃO (retorne SEMPRE um JSON estruturado):
{
  "tipo": "pet" | "documento" | "outra",
  "especie": "cachorro" | "gato" | "outro" | null,
  "raca": "nome da raça ou null se não identificar",
  "raca_confianca": "alta" | "media" | "baixa",
  "porte": "pequeno" | "medio" | "grande" | null,
  "idade_estimada": "filhote" | "adulto" | "idoso" | null,
  "cor_pelagem": "descrição da cor",
  "condicao_aparente": "saudável" | "precisa atenção" | null,
  "resposta_mari": "sua resposta natural de 2-3 frases como Mari"
}

CONTEXTO DA CONVERSA:
Cliente: ${nomeCliente || 'desconhecido'}
Pet cadastrado: ${nomePet ? `${nomePet} (${especie||'?'}, ${raca||'raça desconhecida'})` : 'não identificado ainda'}
Etapa: ${etapa || 'acolhimento'}
${captionCliente ? `Legenda do cliente: "${captionCliente}"` : ''}
Histórico:
${hist || '(início da conversa)'}

REGRAS DA RESPOSTA:
- Se for foto de pet: seja CALOROSA, mencione características específicas visíveis
- Se identificou raça: mencione com naturalidade ("Que Labrador lindo!")
- Se não sabe a raça: seja honesta mas curiosa ("Que mistura linda, o que é ele?")
- Se for filhote: redoble o carinho, mencione a importância de proteger cedo
- Se o pet parecer ter problema de saúde visível: mencione com cuidado
- Se for documento: confirme recebimento profissionalmente
- NUNCA mencione que é IA ou que está "analisando" a imagem
- Tom: amiga que ama animais, NÃO consultora formal`;

  const body = JSON.stringify({
    model: 'claude-haiku-4-5',
    max_tokens: 500,
    system,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimetype, data: base64 } },
        { type: 'text', text: 'Analise esta imagem e retorne o JSON conforme instruído.' }
      ]
    }]
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'x-api-key': ANT_KEY, 'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const texto = JSON.parse(d).content?.[0]?.text || '';
          const match = texto.match(/\{[\s\S]*\}/);
          if (match) {
            try { resolve(JSON.parse(match[0])); }
            catch { resolve({ tipo: 'outra', resposta_mari: texto.trim().slice(0, 300) }); }
          } else {
            resolve({ tipo: 'outra', resposta_mari: texto.trim().slice(0, 300) });
          }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// ── Função principal — integrada com BD ──────────────────────
async function processarImagem(instancia, messageId, contexto, db) {
  try {
    console.log(`[IMG] 📸 Imagem de ${contexto?.phone} — inst:${instancia}`);

    const { base64, mimetype } = await baixarBase64(instancia, messageId);
    console.log(`[IMG] Base64 recebido (${mimetype}), ${Math.round(base64.length * 0.75 / 1024)}KB`);

    const analise = await analisarImagem(base64, mimetype, contexto);
    console.log(`[IMG] ✅ tipo:${analise.tipo} espécie:${analise.especie||'-'} raça:${analise.raca||'-'} confiança:${analise.raca_confianca||'-'}`);

    // Se é foto de pet e temos DB — atualizar perfil automaticamente
    if (analise.tipo === 'pet' && db && contexto?.clienteId && contexto?.conversaId) {
      const atualizacoes = {};

      if (analise.especie && !contexto.especie)
        atualizacoes.especie = analise.especie;

      if (analise.raca && analise.raca_confianca !== 'baixa' && !contexto.raca)
        atualizacoes.raca = analise.raca;

      if (analise.porte)
        atualizacoes.porte = analise.porte;

      if (Object.keys(atualizacoes).length > 0) {
        await db.atualizarPerfil(contexto.clienteId, atualizacoes, contexto.conversaId).catch(e =>
          console.error('[IMG] Erro ao atualizar perfil:', e.message)
        );
        console.log(`[IMG] 💾 Perfil atualizado:`, atualizacoes);
      }
    }

    return analise.resposta_mari || null;

  } catch (e) {
    console.error('[IMG] ❌ Erro:', e.message);
    return null;
  }
}

// Manter compatibilidade com código antigo
async function analisarImagem_legado(instancia, messageId, contextoPet) {
  try {
    const { base64, mimetype } = await baixarBase64(instancia, messageId);
    const analise = await analisarImagem(base64, mimetype, { nomePet: contextoPet });
    return analise.resposta_mari || null;
  } catch { return null; }
}

module.exports = { processarImagem, analisarImagem: analisarImagem_legado };
