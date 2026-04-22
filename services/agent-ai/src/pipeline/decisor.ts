/**
 * orchestrator/decisor.js — Motor de decisão leve
 * Roda ANTES do prompt principal.
 * Modelo: Haiku (~150 tokens). Decide o que fazer, não como falar.
 */
require('dotenv').config({ path: '../.env' });
const https = require('https');
const db    = require('../db');
const vault = require('../services/vault-prompts');

const KEY = process.env.ANTHROPIC_API_KEY;

// System prompt agora vem do Obsidian (Mari/Decisor-Prompt.md).
// Fallback mínimo mantido caso o arquivo do vault esteja indisponível —
// garante que o decisor continue operando mesmo em cenários degradados.
const SYSTEM_FALLBACK = `Você é o motor de decisão de uma IA de vendas de plano de saúde pet.
Seu objetivo: decidir a PRÓXIMA AÇÃO para fechar a venda.
Leads vêm de anúncio. Vai DIRETO. Máximo 2 trocas antes de apresentar plano.
Sinais de compra → apresentar_plano | Resistência a preço → negociar | Sem dados → aprofundar.
Retorne APENAS um JSON com { modo, consultar_bd, consultar_relacional, tags_relacional, sugestao_plano, nivel_urgencia, proxima_acao, motivo }.`;

function getSystem() {
  return vault.carregar('Mari/Decisor-Prompt.md', SYSTEM_FALLBACK);
}

const SCHEMA = `{
  "modo": "acolhimento|consultivo|objetivo|negociacao|objecao|follow_up|encerrar",
  "consultar_bd": [],
  "consultar_relacional": false,
  "tags_relacional": [],
  "sugestao_plano": null,
  "nivel_urgencia": 5,
  "proxima_acao": "responder|aprofundar|apresentar_plano|negociar|escalar|aguardar",
  "motivo": "resumo em 1 linha"
}`;

async function decidir(contexto) {
  const cfg     = await db.buscarConfig().catch(() => ({}));
  const modelo  = cfg.modelo_decisor || 'claude-haiku-4-5';
  // max_tokens decisor: 300 fixo — o decisor só retorna um JSON pequeno
  // Aumentado de 200 para 300 para ter margem sem limitar
  const maxTok  = 300;
  const timeout = parseInt(cfg.timeout_decisor_ms || '5000', 10);
  const { mensagem, etapa, score, perfil, historico_resumo } = contexto;

  // Detectar sinais de compra na mensagem
  const saudacaoSimples = /^(oi|olá|ola|boa tarde|bom dia|boa noite|ei|hey|hello|opa|iae|e ai|eai)[!.,\s]*$/i.test(mensagem.trim());
  const sinaisCompra = /quanto custa|qual plano|como funciona|quero|me interessa|proteção|cobr[ae]|carência|plano|emergência|cirurgia|vet|saber mais|informaç/i.test(mensagem);
  const temPet = perfil?.nome && perfil?.nome !== '?' && perfil?.especie && perfil?.especie !== '?';
  const muitasTrocas = (historico_resumo || '').split('|').length >= 3;

  const dica = sinaisCompra
    ? '⚡ SINAL DE COMPRA detectado — use apresentar_plano'
    : saudacaoSimples
    ? '💬 SAUDAÇÃO SIMPLES — não veio de anúncio, use pre_acolhimento para descobrir de onde veio e jogar no fluxo correto'
    : (temPet && muitasTrocas)
    ? '⚡ Pet identificado + 3+ trocas — use apresentar_plano'
    : 'Ainda coletando dados básicos';

  const prompt = `Mensagem: "${mensagem}"
Etapa: ${etapa || 'acolhimento'} | Score: ${score || 0}/10
Pet: ${perfil?.nome || '?'} (${perfil?.especie || '?'}, ${perfil?.raca || '?'}, ${perfil?.idade_anos || '?'} anos)
Histórico: ${historico_resumo || '(sem histórico)'}
Dica: ${dica}

Retorne o JSON:
${SCHEMA}`;

  return new Promise((resolve) => {
    const fallback = {
      modo: 'acolhimento',
      consultar_bd: [],
      consultar_relacional: false,
      tags_relacional: [],
      sugestao_plano: null,
      nivel_urgencia: 5,
      proxima_acao: 'responder',
      motivo: 'fallback padrão'
    };

    const body = JSON.stringify({
      model: modelo, max_tokens: maxTok,
      system: getSystem(),
      messages: [{ role: 'user', content: prompt }]
    });

    const opts = {
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'x-api-key': KEY, 'anthropic-version': '2023-06-01',
        'content-type': 'application/json', 'content-length': Buffer.byteLength(body)
      }
    };

    const timer = setTimeout(() => resolve(fallback), timeout);
    const req = https.request(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        clearTimeout(timer);
        try {
          const texto = JSON.parse(d).content?.[0]?.text || '';
          const match = texto.match(/\{[\s\S]*\}/);
          if (match) resolve({ ...fallback, ...JSON.parse(match[0]) });
          else resolve(fallback);
        } catch(e) { resolve(fallback); }
      });
    });
    req.on('error', () => { clearTimeout(timer); resolve(fallback); });
    req.write(body); req.end();
  });
}

module.exports = { decidir };

// ── Calcular score real baseado no perfil ────────────────────
function calcularScore(perfil, etapa, historico_resumo) {
  let score = 0;
  if (perfil?.nome && perfil.nome !== '?')          score += 1; // nome do pet
  if (perfil?.especie && perfil.especie !== '?')    score += 1; // espécie
  if (perfil?.raca && perfil.raca !== '?')          score += 1; // raça
  if (perfil?.cep)                                  score += 1; // CEP
  if (perfil?.email)                                score += 1; // email
  if (perfil?.problema_saude)                       score += 1; // histórico saúde
  if (etapa === 'negociacao')                        score += 1;
  if (etapa === 'pre_fechamento' || etapa === 'fechamento') score += 2;
  if (/quer|quero|fechar|assinar|quanto|preço|custa/i.test(historico_resumo||'')) score += 1;
  return Math.min(score, 10);
}

module.exports.calcularScore = calcularScore;
