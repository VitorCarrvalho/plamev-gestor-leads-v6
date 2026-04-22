/**
 * services/juiz.js — Juiz-LLM de alucinações em tempo real
 *
 * Após cada resposta da Mari, o juiz (Haiku) avalia se há alucinação
 * comparando a resposta com o contexto real (system prompt + BD de preços).
 * Roda em BACKGROUND (fire-and-forget) para não adicionar latência à Mari.
 *
 * Grava:
 *  - mari_intelligence.juiz_invocacoes  → toda invocação (com custo)
 *  - mari_intelligence.alucinacoes_mari → só quando detecta alucinação
 *
 * Custo médio esperado: ~$0.001 por mensagem (Haiku 4.5).
 */
require('dotenv').config({ path: '../.env' });
const https = require('https');
const { Pool } = require('pg');

const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL_JUIZ = process.env.MODEL_JUIZ || 'claude-haiku-4-5';
const INTEL_URL = process.env.MARI_INTELLIGENCE_URL
  || 'postgresql://geta@localhost:5432/mari_intelligence';

// Pool dedicado para mari_intelligence (isolado do mariv3 principal)
let _intelPool = null;
function intelPool() {
  if (!_intelPool) {
    _intelPool = new Pool({ connectionString: INTEL_URL, max: 3 });
    _intelPool.on('error', e => console.error('[JUIZ db]', e.message));
  }
  return _intelPool;
}

// ── Baseline de preços vindo do BD (cache 30s) ───────────────────────────
// 20/04/2026 — Getúlio: BD é a ÚNICA fonte. Hardcoded removido.
// O juiz compara a resposta da Mari com esta tabela real.
let _precosCache = null;
let _precosCacheAt = 0;
async function carregarPrecosOficiais() {
  if (_precosCache && Date.now() - _precosCacheAt < 30_000) return _precosCache;
  try {
    const db = require('../db');
    const rows = await db.query(
      `SELECT p.slug, p.nome, pr.modalidade,
              pr.valor, pr.valor_tabela, pr.valor_promocional,
              pr.valor_oferta, pr.valor_limite
       FROM precos pr JOIN planos p ON p.id=pr.plano_id
       WHERE pr.ativo=true AND p.ativo=true
       ORDER BY p.id, pr.modalidade`
    );
    const out = {};
    const fmt = (v) => (v == null || v === '') ? null : `R$${Number(v).toFixed(2).replace('.', ',')}`;
    for (const r of rows) {
      if (!out[r.slug]) out[r.slug] = { nome: r.nome, modalidades: {} };
      out[r.slug].modalidades[r.modalidade] = {
        tabela: fmt(r.valor_tabela),
        promocional: fmt(r.valor_promocional),
        oferta: fmt(r.valor_oferta),
        limite: fmt(r.valor_limite),
        vigente: fmt(r.valor),
      };
    }
    _precosCache = out;
    _precosCacheAt = Date.now();
    return out;
  } catch (e) {
    console.error('[JUIZ] falha ao carregar preços do BD:', e.message);
    return _precosCache || {};
  }
}

// Custo Haiku 4.5 (2026-04): $0.80/MTok input, $4.00/MTok output
const PRICE_IN  = 0.80 / 1_000_000;
const PRICE_OUT = 4.00 / 1_000_000;

// System prompt do juiz — carregado do Obsidian em cache
let _systemJuiz = null;
function getSystemJuiz() {
  if (_systemJuiz) return _systemJuiz;
  _systemJuiz = `Você é o Juiz de Qualidade da Mari — uma IA que avalia RESPOSTAS da Mari (vendedora de plano de saúde pet) e detecta alucinações.

Sua tarefa: dado (a) a mensagem do cliente, (b) o contexto enviado à Mari, (c) a resposta da Mari, e (d) fatos verificáveis (preços oficiais, lista de planos), decidir se a resposta contém ALUCINAÇÃO.

Tipos de alucinação que você deve pegar:
1. **localizacao_inventada** — afirmou cidade/estado/bairro sem evidência no contexto
2. **cobertura_inventada** — afirmou "não temos cobertura em X" quando a API oficial não foi consultada
3. **preco_divergente** — citou preço diferente dos preços oficiais (Slim R$59,99 · Advance R$119,99 · Platinum R$189,99 · Diamond R$359,99)
4. **plano_inexistente** — mencionou plano que não existe
5. **negou_acesso_sistema** — disse "não consigo consultar CEP/sistema" (Mari TEM acesso)
6. **ans_mencionada** — mencionou ANS (proibido)
7. **pediu_ligar** — sugeriu ligação (proibido, só mensagem)
8. **confirmou_ia** — confirmou explicitamente ser IA/bot
9. **carencia_inventada** — citou tempo de carência sem base
10. **clinica_inventada** — citou nome de clínica específica sem consulta

Se NÃO houver alucinação, retorne \`{"alucinou": false}\`. Seja estrito mas justo — se for ambíguo, NÃO marque como alucinação.

Se houver, retorne JSON com:
\`\`\`
{
  "alucinou": true,
  "tipo": "<um dos 10 tipos>",
  "severidade": "baixa|media|alta|critica",
  "trecho_ofensivo": "<snippet exato da resposta da Mari que é a alucinação>",
  "sugestao_leigo": "<1-2 frases em português leigo explicando a causa raiz para um não-técnico>",
  "sugestoes_tecnicas": [
    {
      "descricao_leigo": "<explicação simples do que essa mudança fará>",
      "tipo": "obsidian_patch|config_update|regex_update",
      "arquivo": "<caminho relativo do .md ou chave de config>",
      "patch": "<o texto/regra exato a adicionar ou substituir>"
    }
  ]
}
\`\`\`

Máximo 3 sugestões técnicas por alucinação. Sempre explique em linguagem leiga.
Retorne APENAS o JSON. Sem \`\`\`\`\`.`;
  return _systemJuiz;
}

function chamarJuiz(userPrompt, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: MODEL_JUIZ,
      max_tokens: 800,
      system: getSystemJuiz(),
      messages: [{ role: 'user', content: userPrompt }],
    });

    const opts = {
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'x-api-key': KEY, 'anthropic-version': '2023-06-01',
        'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
      },
    };

    const t0 = Date.now();
    const timer = setTimeout(() => resolve(null), timeoutMs);
    const req = https.request(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        clearTimeout(timer);
        try {
          const parsed = JSON.parse(d);
          const texto = parsed.content?.[0]?.text || '';
          const usage = parsed.usage || {};
          resolve({
            texto,
            input_tokens:  usage.input_tokens  || 0,
            output_tokens: usage.output_tokens || 0,
            duracao_ms: Date.now() - t0,
          });
        } catch { resolve(null); }
      });
    });
    req.on('error', () => { clearTimeout(timer); resolve(null); });
    req.write(body); req.end();
  });
}

function parsearVeredito(texto) {
  if (!texto) return null;
  const m = texto.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/**
 * Avalia uma resposta da Mari. Retorna rápido (fire-and-forget do caller).
 * @param {object} ctx { conversaId, mensagemId, phone, nomeCliente, mensagemCliente, contextoEnviado, respostaMari, precosOficiais }
 */
async function avaliarEmBackground(ctx) {
  try {
    // Sempre puxa do BD (cache 30s) — ignora qualquer valor passado no ctx.
    // Se o caller passou ctx.precosOficiais (compat), é descartado.
    const precos = await carregarPrecosOficiais();

    const userPrompt = [
      `Mensagem do cliente: "${(ctx.mensagemCliente || '').slice(0, 500)}"`,
      '',
      `Resposta da Mari: "${(ctx.respostaMari || '').slice(0, 1500)}"`,
      '',
      `Preços oficiais (BD — fonte única): ${JSON.stringify(precos)}`,
      '',
      `Contexto enviado à Mari (resumo): ${(ctx.contextoEnviado || '').slice(0, 1500)}`,
    ].join('\n');

    const r = await chamarJuiz(userPrompt);
    if (!r) return;

    const custo = (r.input_tokens * PRICE_IN) + (r.output_tokens * PRICE_OUT);
    const veredito = parsearVeredito(r.texto);
    const detectou = veredito?.alucinou === true;

    // Insere alucinação (se houver) — pega ID pra referenciar no log
    let alucinacaoId = null;
    if (detectou && veredito.tipo && veredito.trecho_ofensivo) {
      const ins = await intelPool().query(
        `INSERT INTO alucinacoes_mari
         (conversa_id, mensagem_id, phone, nome_cliente,
          tipo_alucinacao, severidade, texto_alucinado, trecho_ofensivo,
          contexto_enviado, mensagem_cliente, sugestao_leigo, sugestoes_tecnicas,
          analisada_em)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
         RETURNING id`,
        [
          ctx.conversaId || null, ctx.mensagemId || null,
          ctx.phone || null, ctx.nomeCliente || null,
          veredito.tipo,
          veredito.severidade || 'media',
          ctx.respostaMari,
          veredito.trecho_ofensivo,
          (ctx.contextoEnviado || '').slice(0, 8000),
          ctx.mensagemCliente || null,
          veredito.sugestao_leigo || null,
          JSON.stringify(veredito.sugestoes_tecnicas || []),
        ]
      ).catch(e => { console.error('[JUIZ insert alucinacao]', e.message); return { rows: [] }; });
      alucinacaoId = ins.rows?.[0]?.id || null;
      if (alucinacaoId) {
        console.log(`[JUIZ] 🚨 Alucinação #${alucinacaoId} (${veredito.tipo}) — ${ctx.phone || '?'}`);
      }
    }

    // Log da invocação (toda chamada, detectou ou não)
    await intelPool().query(
      `INSERT INTO juiz_invocacoes
       (conversa_id, mensagem_id, input_tokens, output_tokens, custo_usd,
        duracao_ms, detectou_alucinacao, alucinacao_id, modelo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        ctx.conversaId || null, ctx.mensagemId || null,
        r.input_tokens, r.output_tokens, custo,
        r.duracao_ms, detectou, alucinacaoId, MODEL_JUIZ,
      ]
    ).catch(e => console.error('[JUIZ insert log]', e.message));
  } catch (e) {
    console.error('[JUIZ] erro geral:', e.message);
  }
}

module.exports = { avaliarEmBackground };
