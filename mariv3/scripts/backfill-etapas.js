#!/usr/bin/env node
/**
 * backfill-etapas.js — Corrige conversas ativas que ficaram travadas em
 * `acolhimento` / etapa desatualizada por causa do bug de persistência.
 *
 * Estratégia heurística (ordem de prioridade — mais específica primeiro):
 *   1. Mensagens com preço/CEP/cartão/PIX → `pre_fechamento` ou `fechamento`
 *   2. Mensagens com "caro", "alto", "não dá", "pensar", "orçamento" → `objecao`
 *   3. Mensagens com "quanto custa", "plano", "cobertura", "carência" → `negociacao`
 *      se já vimos plano, ou `apresentacao_planos` caso contrário
 *   4. Mensagens com pet identificado + CEP → `validacao_cep`
 *   5. Mensagens com pet identificado → `qualificacao`
 *   6. Caso padrão → mantém `acolhimento`
 *
 * Uso:
 *   node scripts/backfill-etapas.js            # dry-run (só mostra)
 *   node scripts/backfill-etapas.js --apply    # aplica UPDATEs
 */
require('dotenv').config();
const db = require('../db');

const APPLY = process.argv.includes('--apply');

const ETAPAS_ORDEM = ['acolhimento','qualificacao','apresentacao_planos','validacao_cep','negociacao','objecao','pre_fechamento','fechamento'];

function inferirEtapa(conversa, msgs, perfil) {
  const txtAll = msgs.map(m => (m.conteudo || '').toLowerCase()).join(' ');
  const ultimas = msgs.slice(-6).map(m => (m.conteudo || '').toLowerCase()).join(' ');

  const temPet    = !!(perfil?.nome || perfil?.especie);
  const temCep    = !!(perfil?.cep);
  const viuPlano  = /\b(slim|advance|platinum|diamond|plano\s+(básico|b[aá]sico|completo|avan[çc]ado))\b/.test(txtAll);
  const pediuPreco = /quanto custa|qual o valor|valores?|mensalidade|pre[çc]o|mensal/.test(txtAll);
  const pediuCob  = /cobertura|carência|carencia|cobre|inclui|emergência/.test(txtAll);

  // 1. Fechamento — assinou/confirmou pagamento
  if (/conclu[ií]do|confirmei|fechei|pagamento feito|assin(ei|ou)|pronto! fechei/.test(ultimas)) {
    return 'fechamento';
  }

  // 2. Pré-fechamento — dados de pagamento/cadastro sendo trocados
  if (/cart[aã]o|pix|boleto|parcel|n[úu]mero do cart|cpf|nasc|cvv|validade/.test(ultimas)) {
    return 'pre_fechamento';
  }

  // 3. Objeção — resistência clara
  if (/caro|alto|n[aã]o d[aá]|orçamento|vou pensar|n[aã]o agora|sem condi[çc]|sem grana|desconto/.test(ultimas)) {
    return 'objecao';
  }

  // 4. Negociação — viu plano e quer detalhes
  if (viuPlano && (pediuPreco || pediuCob)) {
    return 'negociacao';
  }

  // 5. Validação de CEP
  if (temCep && temPet) {
    return 'validacao_cep';
  }

  // 6. Apresentação — pediu plano ou viu preço
  if (pediuPreco || viuPlano) {
    return 'apresentacao_planos';
  }

  // 7. Qualificação — pet identificado
  if (temPet) {
    return 'qualificacao';
  }

  return 'acolhimento';
}

async function main() {
  console.log(APPLY ? '🔧 MODO APLICAR (UPDATEs vão executar)' : '🧐 MODO DRY-RUN (só mostra — use --apply pra executar)');
  console.log('');

  const conversas = await db.query(`
    SELECT c.id, c.etapa, c.status, c.score, cl.nome AS cliente,
           (SELECT COUNT(*) FROM mensagens m WHERE m.conversa_id = c.id)::int AS total_msgs
    FROM conversas c
    JOIN clientes cl ON cl.id = c.client_id
    WHERE c.status = 'ativa'
    ORDER BY c.ultima_interacao DESC
  `);

  console.log(`Analisando ${conversas.length} conversas ativas…\n`);

  const stats = { inalteradas: 0, atualizadas: 0, erros: 0 };
  const porEtapa = {};

  for (const conv of conversas) {
    try {
      const msgs = await db.query(
        `SELECT role, conteudo, enviado_por FROM mensagens WHERE conversa_id = $1 ORDER BY timestamp ASC`,
        [conv.id]
      );
      const perfil = await db.one(
        `SELECT * FROM perfil_pet pp JOIN conversas c ON c.client_id = pp.client_id
         WHERE c.id = $1 ORDER BY pp.atualizado_em DESC NULLS LAST LIMIT 1`,
        [conv.id]
      ).catch(() => null);

      const etapaInferida = inferirEtapa(conv, msgs, perfil);
      const idxAtual  = ETAPAS_ORDEM.indexOf(conv.etapa || 'acolhimento');
      const idxNovo   = ETAPAS_ORDEM.indexOf(etapaInferida);

      // Só atualiza se avançando (nunca retrocede por erro de heurística)
      const vaiAtualizar = idxNovo > idxAtual;

      porEtapa[etapaInferida] = (porEtapa[etapaInferida] || 0) + 1;

      if (!vaiAtualizar) {
        stats.inalteradas++;
        continue;
      }

      console.log(
        `${vaiAtualizar ? '🔼' : '·'}  ${conv.cliente?.padEnd(30) || '—'.padEnd(30)} ` +
        `${String(conv.total_msgs).padStart(3)} msgs · ` +
        `\x1b[33m${(conv.etapa || 'null').padEnd(20)}\x1b[0m → \x1b[32m${etapaInferida}\x1b[0m`
      );

      if (APPLY) {
        await db.atualizarConversa(conv.id, { etapa: etapaInferida });
        await db.run(
          `INSERT INTO funil_conversao (conversa_id, etapa_origem, etapa_destino) VALUES ($1,$2,$3)`,
          [conv.id, conv.etapa, etapaInferida]
        ).catch(() => {});
      }
      stats.atualizadas++;
    } catch (e) {
      console.error(`[ERR] ${conv.cliente || conv.id}:`, e.message);
      stats.erros++;
    }
  }

  console.log('');
  console.log('════════════════════════════════════════════');
  console.log(`Total:         ${conversas.length}`);
  console.log(`Inalteradas:   ${stats.inalteradas} (etapa atual já >= inferida)`);
  console.log(`${APPLY ? 'Atualizadas' : 'Atualizariam'}:   ${stats.atualizadas}`);
  console.log(`Erros:         ${stats.erros}`);
  console.log('');
  console.log('Distribuição inferida (todas):');
  Object.entries(porEtapa)
    .sort((a, b) => ETAPAS_ORDEM.indexOf(a[0]) - ETAPAS_ORDEM.indexOf(b[0]))
    .forEach(([e, n]) => console.log(`  ${e.padEnd(25)} ${n}`));

  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
