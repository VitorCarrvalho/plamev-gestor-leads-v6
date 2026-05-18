/**
 * image.ts — Análise de imagens WhatsApp via Claude Vision
 *
 * Fluxo:
 *   1. Baixa imagem da Evolution API como base64
 *   2. Envia para Claude Haiku com contexto da conversa
 *   3. Retorna resposta da Mari + base64 para o frontend renderizar
 *
 * Env: EVOLUTION_API_URL, EVOLUTION_API_KEY, ANTHROPIC_API_KEY
 */
import https from 'https';
import http from 'http';
import Anthropic from '@anthropic-ai/sdk';

const EVO_URL = process.env.EVOLUTION_API_URL || '';
const EVO_KEY = process.env.EVOLUTION_API_KEY  || '';

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

export interface ImageResult {
  resposta: string | null;
  base64: string;
  mimeType: string;
}

function baixarBase64(instancia: string, messageId: string): Promise<{ base64: string; mimetype: string }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      message: { key: { id: messageId }, messageType: 'imageMessage' },
    });
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
          const j = JSON.parse(d);
          if (j.base64) resolve({ base64: j.base64, mimetype: j.mimetype || 'image/jpeg' });
          else reject(new Error('base64 não encontrado: ' + d.slice(0, 120)));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

interface Contexto {
  phone?: string;
  clienteId?: string;
  conversaId?: string;
  nomeCliente?: string;
  nomePet?: string;
  especie?: string;
  raca?: string;
  etapa?: string;
  historico?: Array<{ role: string; conteudo: string }>;
  captionCliente?: string;
}

interface DbAdapter {
  atualizarPerfil: (clienteId: string, dados: Record<string, any>, conversaId?: string) => Promise<any>;
}

async function analisarImagem(base64: string, mimetype: string, contexto: Contexto): Promise<Record<string, any>> {
  const { nomePet, nomeCliente, especie, raca, etapa, historico, captionCliente } = contexto;

  const hist = (historico || []).slice(-4)
    .map(h => `${h.role === 'user' ? (nomeCliente || 'Cliente') : 'Mari'}: ${h.conteudo.slice(0, 80)}`)
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
Pet cadastrado: ${nomePet ? `${nomePet} (${especie || '?'}, ${raca || 'raça desconhecida'})` : 'não identificado ainda'}
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

  const response = await getAnthropic().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    system,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimetype as any, data: base64 } },
        { type: 'text', text: 'Analise esta imagem e retorne o JSON conforme instruído.' },
      ],
    }],
  });

  const texto = (response.content[0] as any).text || '';
  const match = texto.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch { /* fall through */ }
  }
  return { tipo: 'outra', resposta_mari: texto.trim().slice(0, 300) };
}

export async function processarImagem(
  instancia: string,
  messageId: string,
  contexto: Contexto,
  db?: DbAdapter,
): Promise<ImageResult> {
  let base64 = '';
  let mimeType = 'image/jpeg';
  try {
    console.log(`[IMG] 📸 Imagem de ${contexto?.phone} — inst:${instancia}`);
    const dl = await baixarBase64(instancia, messageId);
    base64 = dl.base64;
    mimeType = dl.mimetype;
    console.log(`[IMG] Base64 recebido (${mimeType}), ${Math.round(base64.length * 0.75 / 1024)}KB`);

    const analise = await analisarImagem(base64, mimeType, contexto);
    console.log(`[IMG] ✅ tipo:${analise.tipo} espécie:${analise.especie || '-'} raça:${analise.raca || '-'}`);

    if (analise.tipo === 'pet' && db && contexto?.clienteId && contexto?.conversaId) {
      const patch: Record<string, any> = {};
      if (analise.especie && !contexto.especie) patch.especie = analise.especie;
      if (analise.raca && analise.raca_confianca !== 'baixa' && !contexto.raca) patch.raca = analise.raca;
      if (analise.porte) patch.porte = analise.porte;
      if (Object.keys(patch).length > 0) {
        await db.atualizarPerfil(contexto.clienteId, patch, contexto.conversaId)
          .catch(e => console.error('[IMG] Erro ao atualizar perfil:', e.message));
        console.log('[IMG] 💾 Perfil atualizado:', patch);
      }
    }

    return { resposta: analise.resposta_mari || null, base64, mimeType };
  } catch (e: any) {
    console.error('[IMG] ❌ Erro:', e.message);
    return { resposta: null, base64, mimeType };
  }
}
