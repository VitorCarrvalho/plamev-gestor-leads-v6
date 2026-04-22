/**
 * MariV3 — Entry point
 * Inicia gateway, orquestrador e conecta tudo
 */
require('dotenv').config({ path: '.env' });
const { gateway, iniciar } = require('./gateway');
const orquestrador          = require('./orchestrator');
const db                    = require('./db');
const scheduler             = require('./services/scheduler');
const chips                 = require('./services/chips');
const reengSvc              = require('./services/reengajamento');
const dashboard             = require('./dashboard/api/server');

async function main() {
  console.log('\n╔══════════════════════════════════╗');
  console.log('║        MARI V3 — PLAMEV          ║');
  console.log('╚══════════════════════════════════╝\n');

  // 1. Testar BD
  await db.testar();

  // ── BUFFER DE LEITURA — HARDCODE (arquitetural) ─────────────────────────────────────────
  // Comportamento:
  //   1. Primeira mensagem chega → Mari espera entre 3 e 8 segundos (aleatório, simula leitura)
  //   2. Nova mensagem chega enquanto espera → adiciona +4 segundos ao timer
  //   3. Após o tempo, lê TODAS as mensagens acumuladas e responde de uma vez
  // Isso evita respostas duplicadas e simula comportamento humano real.
  // NÃO alterar esses valores via BD — são arquiteturais.
  const LEITURA_MIN_MS  = 2500; // 2.5s mínimo
  const LEITURA_MAX_MS  = 5500; // 5.5s máximo — proporcional ao tamanho da mensagem recebida
  const EXTRA_POR_MSG   = 1000; // +1s por msg adicional (acumula)

  // 2. Pipeline com buffer de leitura
  const buffer = new Map(); // phone+instancia -> { timer, msgs[], delayAtual }
  // [COMPORTAMENTO MARI] Lock de processamento — evita duplicatas simultâneas — 15/04/2026 17:09
  const emProcessamento = new Set(); // chaves que estão sendo processadas agora
  // Expor globalmente para o reset poder limpar
  global._mariBuffer = buffer;
  global._mariLock = emProcessamento;

  gateway.on('mensagem', (msg) => {
    const chave = `${msg.phone}:${msg.instancia||msg.canal}`;
    const existente = buffer.get(chave);

    if (existente) {
      // Nova mensagem chegou enquanto Mari ainda está "lendo" — adiciona +4s
      clearTimeout(existente.timer);
      existente.msgs.push(msg);
      existente.delayAtual += EXTRA_POR_MSG;
      console.log(`[PIPELINE] ⏳ ${chave}: +1 msg (+${EXTRA_POR_MSG/1000}s) → total ${existente.msgs.length} msgs, delay ${existente.delayAtual/1000}s`);
    } else {
      // Primeira mensagem: sorteia tempo de leitura entre 3 e 8s
      // Delay proporcional ao tamanho total das mensagens recebidas
      const totalChars   = (msg.texto || '').length;
      const fatorTamanho = Math.min(totalChars / 100, 1); // 0 a 1 conforme tamanho
      const range        = LEITURA_MAX_MS - LEITURA_MIN_MS; // 3000ms de range
      const delayInicial = LEITURA_MIN_MS + Math.floor(fatorTamanho * range * 0.7) + Math.floor(Math.random() * range * 0.3);
      buffer.set(chave, { msgs: [msg], timer: null, delayAtual: delayInicial });
      console.log(`[PIPELINE] 👁 ${chave}: lendo por ${delayInicial/1000}s...`);
    }

    const delay = buffer.get(chave).delayAtual;
    const entry = buffer.get(chave);

    entry.timer = setTimeout(async () => {
      buffer.delete(chave);
      const msgs = entry.msgs;

      // Lock: se já está processando este número, aguardar e tentar novamente
      if (emProcessamento.has(chave)) {
        console.log(`[PIPELINE] ⏸ ${chave}: processamento em andamento, aguardando...`);
        // Reagendar para daqui 2s
        setTimeout(async () => {
          if (!emProcessamento.has(chave)) {
            console.log(`[PIPELINE] ▶ ${chave}: retomando após lock`);
            await orquestrador.processar(msgs[msgs.length-1]).catch(e => console.error('[PIPELINE] Erro retry:', e.message));
          }
        }, 2000);
        return;
      }
      emProcessamento.add(chave);

      if (msgs.length === 1) {
        // Mensagem única — processar normalmente
        const m = msgs[0];
        console.log(`[PIPELINE] ▶ ${m.canal}/${m.agentSlug} ${m.phone}: "${(m.texto||'[audio]').substring(0,50)}"`);
        await orquestrador.processar(m).catch(e => console.error('[PIPELINE] Erro:', e.message));
      } else {
        // Múltiplas mensagens — concatenar textos e processar como uma só
        const base = msgs[msgs.length - 1]; // usar metadados da última
        const textoConcatenado = msgs
          .map(m => m.texto || '')
          .filter(t => t.trim())
          .join(' ');

        if (textoConcatenado.trim()) {
          const msgMerged = { ...base, texto: textoConcatenado };
          console.log(`[PIPELINE] ▶ MERGE ${msgs.length} msgs de ${base.phone}: "${textoConcatenado.substring(0,80)}"`);
          await orquestrador.processar(msgMerged).catch(e => console.error('[PIPELINE] Erro merge:', e.message));
        } else {
          // Só áudio/imagem — processar a última
          await orquestrador.processar(base).catch(e => console.error('[PIPELINE] Erro:', e.message));
        }
      }
      // Liberar lock após processar
      emProcessamento.delete(chave);
    }, delay);

    buffer.set(chave, entry);
  });

  // 3. Iniciar dashboard
  dashboard.iniciar(parseInt(process.env.DASHBOARD_PORT) || 3400);

  // 4. Iniciar gateway e scheduler
  iniciar(parseInt(process.env.GATEWAY_PORT) || 3401);
  scheduler.iniciar();
  chips.iniciar();

  // Executar reengajamentos pendentes a cada 1 minuto
  setInterval(() => reengSvc.executarPendentes(), 60 * 1000);
  console.log('[REENG] ✅ Sistema de reengajamento iniciado (1min)');

  // Memória operacional — resumos automáticos
  const leadMemory = require('./services/lead-memory');
  leadMemory.iniciarLoopResumos();
}

main().catch(e => { console.error('[MAIN]', e.message); process.exit(1); });
