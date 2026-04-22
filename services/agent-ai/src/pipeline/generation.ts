/**
 * brain/index.js — Único ponto de chamada ao Claude
 * Recebe contexto montado pelo orquestrador, retorna JSON estruturado
 */
require('dotenv').config({ path: '../.env' });
const https = require('https');
const KEY   = process.env.ANTHROPIC_API_KEY;
const db    = require('../db');

function parsear(texto, etapaAtual) {
  // Estratégia 1: texto limpo sem markdown
  let textoLimpo = texto.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  
  // Estratégia 2: tentar pegar o JSON mais externo (pode ter texto antes/depois)
  const match = textoLimpo.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const raw = JSON.parse(match[0]);

      // Formato compacto: {r, e, d} ou formato antigo: {resposta, etapa, dados_extraidos}
      const resposta = raw.r || raw.resposta;
      const etapa    = raw.e || raw.etapa || etapaAtual;
      const d        = raw.d || raw.dados_extraidos || {};

      // Expandir chaves compactas para o formato que o sistema espera
      const dados_extraidos = {
        nome_cliente:  d.nc || d.nome_cliente  || null,
        nome_pet:      d.np || d.nome_pet      || null,
        especie_pet:   d.ep || d.especie_pet   || null,
        raca_pet:      d.rp || d.raca_pet      || null,
        idade_pet:     d.ip || d.idade_pet     || null,
        cep:           d.cp || d.cep           || null,
        email:         d.em || d.email         || null,
        cpf:           d.cf || d.cpf           || null,
        plano_interesse: d.pi || d.plano_interesse || null,
      };

      if (resposta && typeof resposta === 'string') {
        return {
          resposta,
          etapa,
          dados_extraidos,
          acoes: raw.acoes || ['salvar_conversa'],
          escalonar: raw.escalonar || false,
        };
      }
    } catch {}
  }

  // Fallback de último recurso — Claude às vezes retorna texto solto sem JSON.
  // Ao invés de silenciar o cliente, usamos o texto cru como resposta — é melhor
  // um "boa noite, qual a raça do seu pet?" solto que nenhuma mensagem.
  // Limpa markdown comum (```json\n{"r":"texto...) que às vezes vem truncado.
  const textoLimpoFallback = (textoLimpo || texto)
    .replace(/^```json\s*\{\s*"r"\s*:\s*"?/i, '')
    .replace(/"\s*,\s*"e".*$/i, '')
    .replace(/```$/g, '')
    .trim();

  // BLOQUEIO ANTI-ALUCINAÇÃO DE LOCALIZAÇÃO (caso Francine 19/04/2026):
  // Claude costuma "adivinhar" cidade a partir do CEP e afirmar que não há
  // cobertura. Só bloqueamos se o texto contém DOIS sinais juntos:
  //   (a) menção explícita de cidade/estado E
  //   (b) afirmação de ausência de cobertura ("ainda não chegamos", "sem rede", etc.)
  // "cobertura" sozinha é termo legítimo do produto — NÃO bloquear.
  const mencionaLocalizacao = /\b(porto\s+alegre|curitiba|são\s+paulo|sao\s+paulo|brasília|brasilia|salvador|fortaleza|belo\s+horizonte|manaus|recife|goiânia|goiania|belém|belem|rio\s+grande\s+do\s+sul|santa\s+catarina|paraná|parana|minas\s+gerais|bahia|pernambuco|ceará|ceara|amazonas|goiás|goias)\b/i;
  const negaCobertura = /\b(ainda\s+não\s+(?:chegamos|temos|atende|atendemos)|não\s+(?:chegamos|temos\s+rede|tem\s+rede)|sem\s+(?:cobertura|rede\s+credenciada|atendimento)|não\s+(?:atende|atendemos)\s+(?:ainda|nessa|essa|em))\b/i;
  const textoViavel = textoLimpoFallback.length >= 5 && textoLimpoFallback.length <= 1500 && !/^\{/.test(textoLimpoFallback);
  const textoPerigoso = mencionaLocalizacao.test(textoLimpoFallback) && negaCobertura.test(textoLimpoFallback);

  if (textoViavel && !textoPerigoso) {
    console.warn('[BRAIN] ⚠️ JSON ausente — usando texto cru como resposta:', textoLimpoFallback.slice(0, 80));
    return {
      resposta: textoLimpoFallback,
      etapa: etapaAtual,
      dados_extraidos: {},
      acoes: ['salvar_conversa'],
      escalonar: false,
      _jsonAusente: true,
    };
  }
  if (textoViavel && textoPerigoso) {
    console.warn('[BRAIN] 🚫 JSON ausente + alucinação de localização detectada — silenciando:', textoLimpoFallback.slice(0, 120));
  }

  console.warn('[BRAIN] ⚠️ Não conseguiu extrair JSON nem usar texto cru:', texto.slice(0, 100));
  return {
    resposta: null, // retornar null força o sistema a não enviar nada
    etapa: etapaAtual,
    dados_extraidos: {},
    acoes: ['salvar_conversa'],
    escalonar: false
  };
}

async function pensar(mensagem, historico, sistema, modelo) {
  const cfg2   = await db.buscarConfig().catch(() => ({}));
  modelo = modelo || cfg2.modelo_agente || 'claude-haiku-4-5';

  // ── Janela deslizante de histórico ────────────────────────────────────
  // Envia as últimas 12 mensagens completas.
  // Mensagens mais antigas são resumidas em 1 linha no contexto (system prompt).
  // Isso mantém o input estável independente do tamanho da conversa.
  const JANELA = 10; // últimas 10 mensagens — contexto suficiente, input enxuto
  const todas  = historico.filter(h => h.conteudo?.trim());
  const antigas = todas.slice(0, -JANELA);
  const recentes = todas.slice(-JANELA);

  // Injetar resumo das mensagens antigas no sistema (se houver)
  if (antigas.length > 0) {
    const resumoAntigo = antigas
      .slice(-8) // pegar no máx 8 das antigas para o resumo
      .map(h => `${h.role === 'user' ? 'Cliente' : 'Mari'}: ${h.conteudo.slice(0, 60)}`)
      .join(' | ');
    sistema = sistema + '\n\n# CONTEXTO ANTERIOR DA CONVERSA\n' + resumoAntigo;
  }

  // Montar messages com as recentes
  const messages = recentes.map(h => ({
    role: h.role === 'user' ? 'user' : 'assistant',
    content: h.conteudo
  }));

  // Filtrar vazias e garantir alternância
  const msgsFiltradas = [];
  for (const m of messages) {
    if (!m.content?.trim()) continue;
    const ultimo = msgsFiltradas[msgsFiltradas.length - 1];
    if (ultimo && ultimo.role === m.role) continue;
    msgsFiltradas.push(m);
  }
  while (msgsFiltradas.length && msgsFiltradas[0].role !== 'user') msgsFiltradas.shift();

  msgsFiltradas.push({ role: 'user', content: mensagem });

  const fallback = {
    resposta: null, // fallback silencioso — não enviar mensagem genérica
    etapa: 'acolhimento',
    dados_extraidos: {},
    acoes: ['salvar_conversa'],
    escalonar: false
  };

  if (!sistema || sistema.trim().length < 50) {
    console.error('[BRAIN] Sistema vazio — abortando');
    return fallback;
  }

  // max_tokens: sem limite artificial — Claude decide a resposta ideal
  // O modelo para quando termina a resposta, não quando atinge um número
  const maxTok    = 1500;  // tokens suficientes para resposta + JSON sem truncar
  const timeoutMs = 25000; // 25s timeout de rede

  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: modelo, max_tokens: maxTok,
      system: sistema,
      messages: msgsFiltradas
    });

    const opts = {
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'x-api-key': KEY, 'anthropic-version': '2023-06-01',
        'content-type': 'application/json', 'content-length': Buffer.byteLength(body)
      }
    };

    const timer = setTimeout(() => { console.log('[BRAIN] Timeout'); resolve(fallback); }, timeoutMs);

    const req = https.request(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        clearTimeout(timer);
        try {
          const resp = JSON.parse(d);
          if (resp.error) { console.error('[BRAIN] API:', resp.error.message); resolve(fallback); return; }
          const texto = resp.content?.[0]?.text || '';
          if (!texto) { resolve(fallback); return; }
          const stopReason = resp.stop_reason;
          if (stopReason === 'max_tokens') {
            console.warn(`[BRAIN] ⚠️ TRUNCADO por max_tokens (${maxTok}) — considere aumentar max_tokens_agente`);
          }
          const resultado = parsear(texto, 'acolhimento');
          resultado._uso = resp.usage;
          resultado._truncado = stopReason === 'max_tokens';
          console.log(`[BRAIN] OK | stop:${stopReason} | input:${resp.usage?.input_tokens} out:${resp.usage?.output_tokens} | max:${maxTok}`);
          resolve(resultado);
        } catch(e) { console.error('[BRAIN] Parse:', e.message); resolve(fallback); }
      });
    });
    req.on('error', e => { clearTimeout(timer); console.error('[BRAIN] Req:', e.message); resolve(fallback); });
    req.write(body); req.end();
  });
}

module.exports = { pensar };
