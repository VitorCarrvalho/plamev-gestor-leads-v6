import { config } from 'dotenv';
import express from 'express';
import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { runMigrations } from '../../../infra/migrate';
import { startConsumer } from './pipeline/consumer';
import { syncVaultToKb } from './pipeline/vault-sync';
import {
  buscarEstados,
  buscarCoberturasParaUF,
  buscarRacas,
  submeterCotacao,
  type CotacaoPayload,
} from './services/cotacao';

config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let _anthropic: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  if (!_anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada');
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

const CHANNEL_SERVICE_URL = process.env.CHANNEL_SERVICE_URL || 'http://channel-service.railway.internal:8080';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'plamev-internal';
const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000000';

async function getConversaContext(conversaId: string) {
  const convRow = await pool.query(
    `SELECT c.numero_externo, c.jid, c.instancia_whatsapp, c.canal, c.etapa, c.org_id,
            cl.nome AS cliente_nome, a.slug AS agent_slug, a.nome AS agent_nome
     FROM conversas c
     JOIN clientes cl ON cl.id = c.client_id
     JOIN agentes a ON a.id = c.agent_id
     WHERE c.id = $1`,
    [conversaId]
  );
  const conv = convRow.rows[0] || null;

  const msgsRows = await pool.query(
    `SELECT role, conteudo FROM mensagens WHERE conversa_id=$1 ORDER BY timestamp DESC LIMIT 12`,
    [conversaId]
  );
  const historico = msgsRows.rows.reverse();

  return { conv, historico };
}

async function gerarTextoComClaude(system: string, userMsg: string, model = 'claude-haiku-4-5-20251001'): Promise<string> {
  const response = await getAnthropicClient().messages.create({
    model,
    max_tokens: 600,
    system,
    messages: [{ role: 'user', content: userMsg }],
  });
  return ((response.content[0] as any).text || '').trim();
}

const app = express();
app.use(express.json());

app.get('/health', async (_req, res) => {
  const checks: Record<string, any> = { service: 'agent-ai', ok: true };

  // DB conectividade + qual banco está conectado
  try {
    const { rows } = await pool.query('SELECT current_database() AS db, inet_server_addr() AS host');
    checks.db = 'ok';
    checks.db_info = `${rows[0].db} @ ${rows[0].host}`;
  } catch (e: any) { checks.db = `erro: ${e.message}`; checks.ok = false; }

  // Tabelas RAG
  for (const table of ['knowledge_base_docs', 'knowledge_chunks']) {
    try {
      await pool.query(`SELECT 1 FROM ${table} LIMIT 1`);
      checks[table] = 'ok';
    } catch (e: any) {
      checks[table] = e.code === '42P01' ? 'tabela não existe' : `erro: ${e.message}`;
      checks.ok = false;
    }
  }

  // pgvector
  try {
    const { rows } = await pool.query(`SELECT extname FROM pg_extension WHERE extname='vector'`);
    checks.pgvector = rows.length > 0 ? 'ok' : 'não instalado';
    if (!rows.length) checks.ok = false;
  } catch (e: any) { checks.pgvector = `erro: ${e.message}`; }

  // Env vars críticas
  checks.env = {
    DATABASE_URL:     process.env.DATABASE_URL    ? 'definido' : '❌ FALTANDO',
    VAULT_SERVER_URL: process.env.VAULT_SERVER_URL ? 'definido' : 'usando default',
    VOYAGE_API_KEY:   process.env.VOYAGE_API_KEY  ? 'definido' : '⚠️ não definido (RAG vetorial desabilitado)',
    REDIS_URL:        process.env.REDIS_URL        ? 'definido' : '❌ FALTANDO',
  };

  // Vault reachability
  try {
    const vaultUrl = process.env.VAULT_SERVER_URL || 'http://plamev-gestor-leads-v6-fda4.railway.internal:8080';
    const r = await fetch(`${vaultUrl}/health`, { signal: AbortSignal.timeout(3000) });
    checks.vault_server = r.ok ? 'ok' : `HTTP ${r.status}`;
  } catch (e: any) { checks.vault_server = `inacessível: ${e.message}`; checks.ok = false; }

  res.status(checks.ok ? 200 : 503).json(checks);
});
// ── POST /internal/vault-sync ─────────────────────────────────
// Sincroniza arquivos de conteúdo do vault → knowledge_base_docs + knowledge_chunks
// Chamado pelo obsidian-sync após push de arquivos não-Mari/
app.post('/internal/vault-sync', async (req, res) => {
  const secret = process.env.INTERNAL_SECRET || 'plamev-internal';
  if (req.headers['x-internal-secret'] !== secret) {
    res.status(401).json({ erro: 'não autorizado' });
    return;
  }

  const agentId = parseInt(req.body?.agent_id ?? '1', 10);
  const orgId   = req.body?.org_id ?? '00000000-0000-0000-0000-000000000000';

  try {
    // Busca org_id real se não passado
    const resolvedOrgId = orgId === '00000000-0000-0000-0000-000000000000'
      ? (await pool.query('SELECT org_id FROM agentes WHERE id=$1', [agentId])).rows[0]?.org_id ?? orgId
      : orgId;

    console.log(`[VAULT-SYNC] Iniciando sync agent_id=${agentId} org_id=${resolvedOrgId}`);
    const result = await syncVaultToKb(agentId, resolvedOrgId);
    console.log(`[VAULT-SYNC] Concluído: ${JSON.stringify(result)}`);
    res.json({ ok: true, ...result });
  } catch (e: any) {
    console.error('[VAULT-SYNC] ❌', e.message);
    res.status(500).json({ erro: e.message });
  }
});

app.get('/debug/pipeline', (_req, res) => {
  res.json({
    ok: true,
    service: 'agent-ai',
    runtime: {
      entrypoint: 'services/agent-ai/src/index.ts',
      consumer: 'services/agent-ai/src/pipeline/consumer.ts',
      unifiedRuntime: 'services/agent-ai/src/pipeline/runtime.ts',
      activeTextPipeline: 'services/agent-ai/src/pipeline/orchestrator.ts',
      queue: 'incoming-messages',
      debounceSource: 'Redis list debounce:msgs:{canal}:{phone}',
      multimodalHandlers: {
        audio: 'services/agent-ai/src/services/audio.ts',
        image: 'services/agent-ai/src/services/image.ts',
        document: 'services/agent-ai/src/services/document.ts',
      },
      runtimeConfigSource: 'services/agent-ai/src/db.ts::resolverConfigRuntimeAgente(agentes + llm_configs + organizations fallback)',
      inputGuard: 'services/agent-ai/src/pipeline/guards/input-guard.ts',
      rag: 'services/agent-ai/src/pipeline/rag.ts::searchKnowledge(vector+rerank on knowledge_chunks with automatic full-text fallback)',
      llm: 'services/agent-ai/src/clients/llm-client.ts',
      outputGuard: 'services/agent-ai/src/pipeline/guards/output-guard.ts',
      deliveryTarget: `${process.env.CHANNEL_SERVICE_URL || 'http://channel-service.railway.internal:8080'}/internal/send`,
      persistenceTarget: `${process.env.CRM_SERVICE_URL || 'http://crm-service.railway.internal:8080'}/api/internal/salvar-interacao`,
    },
    notes: [
      'Este endpoint descreve o caminho de execucao ativo sem alterar comportamento de negocio.',
      'Capacidades adicionais presentes no repositorio podem existir fora do caminho principal atual.',
    ],
  });
});

// ── Middleware de autenticação interna ────────────────────────────────────
function autenticarInterno(req: express.Request, res: express.Response, next: express.NextFunction) {
  const secret = process.env.INTERNAL_SECRET || 'plamev-internal';
  if (req.headers['x-internal-secret'] !== secret) {
    res.status(401).json({ erro: 'não autorizado' });
    return;
  }
  next();
}

// ── GET /internal/cotacao/estados ────────────────────────────────────────
app.get('/internal/cotacao/estados', autenticarInterno, async (_req, res) => {
  try {
    const estados = await buscarEstados();
    res.json({ ok: true, estados });
  } catch (e: any) {
    res.status(500).json({ erro: e.message });
  }
});

// ── GET /internal/cotacao/coberturas?uf=SP ───────────────────────────────
app.get('/internal/cotacao/coberturas', autenticarInterno, async (req, res) => {
  const uf = String(req.query.uf || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(uf)) {
    res.status(400).json({ erro: 'Parâmetro uf inválido (ex: SP, RJ, MG)' });
    return;
  }
  try {
    const coberturas = await buscarCoberturasParaUF(uf);
    res.json({ ok: true, uf, coberturas });
  } catch (e: any) {
    res.status(500).json({ erro: e.message });
  }
});

// ── GET /internal/cotacao/racas?especie=2 ────────────────────────────────
app.get('/internal/cotacao/racas', autenticarInterno, async (req, res) => {
  const especie = String(req.query.especie || '');
  if (!['1', '2'].includes(especie)) {
    res.status(400).json({ erro: 'especie deve ser "1" (felino) ou "2" (canino)' });
    return;
  }
  try {
    const racas = await buscarRacas(especie as '1' | '2');
    res.json({ ok: true, especie, total: racas.length, racas });
  } catch (e: any) {
    res.status(500).json({ erro: e.message });
  }
});

// ── POST /internal/cotacao ────────────────────────────────────────────────
app.post('/internal/cotacao', autenticarInterno, async (req, res) => {
  const payload = req.body as CotacaoPayload;
  if (!payload?.nome) {
    res.status(400).json({ erro: 'Payload inválido — campo "nome" obrigatório' });
    return;
  }

  try {
    const result = await submeterCotacao(payload);

    // Persiste no banco (best-effort, não bloqueia resposta)
    pool.query(
      `INSERT INTO cotacoes
         (org_id, nome, email, telefone, cep, estado_uf, cidade,
          valor_adesao, valor_mensalidade, composicao, descontos, dados_pets, resposta_api, numero_cotacao, data_fidelidade)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        req.body.orgId ?? null,
        payload.nome, payload.email,
        `${payload.ddd}${payload.telefone}`,
        payload.cep, payload.estadosId, payload.cidadesId,
        result.valorAdesao, result.valorTotalMensalidade,
        JSON.stringify(result.composicaoMensalidade),
        JSON.stringify(result.descontos),
        JSON.stringify(payload.pets),
        JSON.stringify(result),
        result.numeroCotacao, result.dataFidelidade,
      ],
    ).catch(e => console.warn('[COTACAO] ⚠️ Falha ao persistir:', e.message));

    res.json({ ok: true, ...result });
  } catch (e: any) {
    const status = e.status && e.status < 500 ? e.status : 500;
    res.status(status).json({ erro: e.message, detalhes: e.erros ?? e.data ?? undefined });
  }
});

// ── POST /internal/rewrite ────────────────────────────────────────────────
// Reescreve o texto do supervisor no estilo da Mari
app.post('/internal/rewrite', autenticarInterno, async (req, res) => {
  const { conversa_id, texto } = req.body;
  if (!conversa_id || !texto) {
    res.status(400).json({ erro: 'conversa_id e texto são obrigatórios' });
    return;
  }
  try {
    const { conv, historico } = await getConversaContext(conversa_id);
    const agentNome = conv?.agent_nome || 'Mari';
    const clienteNome = conv?.cliente_nome || 'cliente';
    const historicoStr = historico
      .map((m: any) => `${m.role === 'user' ? 'Cliente' : agentNome}: ${m.conteudo}`)
      .join('\n');

    const system = `Você é ${agentNome}, assistente de vendas da Plamev. Seu tom é caloroso, humano, direto e natural.
Sua tarefa é transformar a mensagem bruta (interna) do supervisor em uma mensagem gentil para o cliente "${clienteNome}".

REGRAS DE OURO:
1. NUNCA use gírias internas ou termos pejorativos do supervisor (ex: "zé ruela", "pegar esse cara").
2. Se o supervisor der uma instrução (ex: "pergunta se..."), transforme isso na pergunta direta para o cliente.
3. Use o nome do cliente "${clienteNome}" de forma natural no início ou meio da frase.
4. Mantenha o estilo de conversa de WhatsApp: sem asteriscos, sem formalidades excessivas.
5. Responda APENAS com o texto final para o cliente, sem explicações.`;

    const userMsg = historicoStr
      ? `Histórico recente:\n${historicoStr}\n\nMensagem do supervisor para você formatar e enviar ao cliente: ${texto}`
      : `Mensagem do supervisor para você formatar e enviar ao cliente "${clienteNome}": ${texto}`;

    const textoReescrito = await gerarTextoComClaude(system, userMsg);
    res.json({ ok: true, texto_reescrito: textoReescrito || texto });
  } catch (e: any) {
    console.error('[AGENT-AI] ❌ rewrite:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// ── POST /internal/instrucao ──────────────────────────────────────────────
// Gera uma mensagem nova a partir de uma instrução do supervisor
app.post('/internal/instrucao', autenticarInterno, async (req, res) => {
  const { conversa_id, instrucao } = req.body;
  if (!conversa_id || !instrucao) {
    res.status(400).json({ erro: 'conversa_id e instrucao são obrigatórios' });
    return;
  }
  try {
    const { conv, historico } = await getConversaContext(conversa_id);
    const agentNome = conv?.agent_nome || 'Mari';
    const clienteNome = conv?.cliente_nome || 'cliente';
    const historicoStr = historico
      .map((m: any) => `${m.role === 'user' ? 'Cliente' : agentNome}: ${m.conteudo}`)
      .join('\n');

    const system = `Você é ${agentNome}, assistente de vendas da Plamev. Seu tom é caloroso, humano, direto e natural.
O supervisor lhe passou uma instrução sobre o que deve ser dito ao cliente "${clienteNome}".

REGRAS DE OURO:
1. NUNCA use gírias internas ou termos pejorativos do supervisor (ex: "zé ruela", "pegar esse cara").
2. Gere uma mensagem para o cliente seguindo a instrução do supervisor, considerando o contexto da conversa.
3. Use o nome do cliente "${clienteNome}" de forma natural se couber.
4. Mantenha o estilo de conversa de WhatsApp: sem asteriscos, sem formalidades excessivas.
5. Responda APENAS com a mensagem para o cliente. Sem explicações, sem prefixos.`;

    const userMsg = historicoStr
      ? `Histórico da conversa:\n${historicoStr}\n\nInstrução do supervisor para você: ${instrucao}`
      : `Instrução do supervisor para você sobre o cliente "${clienteNome}": ${instrucao}`;

    const textoGerado = await gerarTextoComClaude(system, userMsg);
    res.json({ ok: true, texto_gerado: textoGerado });
  } catch (e: any) {
    console.error('[AGENT-AI] ❌ instrucao:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// ── POST /internal/provocar ───────────────────────────────────────────────
// Gera mensagem proativa, envia via channel-service e persiste no banco
app.post('/internal/provocar', autenticarInterno, async (req, res) => {
  const { conversa_id } = req.body;
  if (!conversa_id) {
    res.status(400).json({ erro: 'conversa_id é obrigatório' });
    return;
  }
  try {
    const { conv, historico } = await getConversaContext(conversa_id);
    if (!conv) {
      res.status(404).json({ erro: 'Conversa não encontrada' });
      return;
    }

    const agentNome = conv.agent_nome || 'Mari';
    const clienteNome = conv.cliente_nome || 'cliente';
    const etapa = conv.etapa || 'acolhimento';
    const historicoStr = historico
      .map((m: any) => `${m.role === 'user' ? 'Cliente' : agentNome}: ${m.conteudo}`)
      .join('\n');

    const system = `Você é ${agentNome}, assistente de vendas da Plamev (plano de saúde pet).
Tom: caloroso, direto, natural — como uma pessoa real no WhatsApp. Sem asteriscos.
O supervisor quer reativar a conversa com "${clienteNome}" (etapa: ${etapa}).
Gere uma mensagem curta e natural de acompanhamento/reativação, levando em conta o contexto.
Responda APENAS com a mensagem. Sem explicações.`;

    const userMsg = historicoStr
      ? `Histórico da conversa:\n${historicoStr}\n\nGere uma mensagem de reativação.`
      : `Gere uma mensagem de reativação para iniciar uma conversa sobre plano de saúde pet.`;

    const mensagem = await gerarTextoComClaude(system, userMsg);

    // Enviar via channel-service
    await fetch(`${CHANNEL_SERVICE_URL}/internal/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({
        message: {
          phone: conv.numero_externo,
          jid: conv.jid,
          instancia: conv.instancia_whatsapp,
          canal: conv.canal,
          agentSlug: conv.agent_slug,
        },
        resposta: mensagem,
      }),
      signal: AbortSignal.timeout(15000),
    });

    // Persistir no banco
    await pool.query(
      `INSERT INTO mensagens (conversa_id, role, conteudo, enviado_por) VALUES ($1, $2, $3, $4)`,
      [conversa_id, 'agent', mensagem, 'supervisora']
    );

    console.log(`[AGENT-AI] ✅ provocar → conversa=${conversa_id} mensagem="${mensagem.slice(0, 60)}"`);
    res.json({ ok: true, mensagem });
  } catch (e: any) {
    console.error('[AGENT-AI] ❌ provocar:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

const INTERNAL_PORT = 8080;
const PORT = process.env.PORT || INTERNAL_PORT;

async function bootstrap() {
  // 1. Subir HTTP IMEDIATAMENTE (healthcheck Railway)
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[AGENT-AI] 🧠 HTTP Server ready on port ${PORT}`);
  });

  try {
    // 2. Migrations
    console.log('[AGENT-AI] 🔄 Iniciando migrations...');
    await runMigrations(pool);
    // 3. Subir consumer BullMQ
    await startConsumer();
    console.log('[AGENT-AI] ✅ Inicialização completa.');
  } catch (err: any) {
    console.error('[AGENT-AI] ❌ Erro na inicialização:', err.message);
  }

  // 4. Vault → RAG sync automático (não-bloqueante, não impede o boot)
  autoVaultSync().catch(e => console.error('[VAULT-AUTO-SYNC] ❌ Falha inesperada:', e.message));
}

async function autoVaultSync() {
  // Pequeno delay para vault-server ficar disponível após deploy simultâneo
  await new Promise(r => setTimeout(r, 8000));

  let agentes: Array<{ id: number; org_id: string }>;
  try {
    const { rows } = await pool.query('SELECT id, org_id FROM agentes WHERE ativo = true');
    agentes = rows;
  } catch (e: any) {
    console.warn('[VAULT-AUTO-SYNC] Não foi possível listar agentes:', e.message);
    return;
  }

  if (agentes.length === 0) {
    console.log('[VAULT-AUTO-SYNC] Nenhum agente ativo — sync ignorado.');
    return;
  }

  for (const agente of agentes) {
    try {
      console.log(`[VAULT-AUTO-SYNC] Sincronizando agente ${agente.id}…`);
      const result = await syncVaultToKb(agente.id, agente.org_id);
      console.log(
        `[VAULT-AUTO-SYNC] ✅ Agente ${agente.id}: ${result.docs_upserted} docs, ` +
        `${result.chunks_upserted} chunks em ${result.duration_ms}ms` +
        (result.errors.length ? ` | erros: ${result.errors.join(', ')}` : '')
      );
    } catch (e: any) {
      console.error(`[VAULT-AUTO-SYNC] ❌ Agente ${agente.id}:`, e.message);
    }
  }
}

bootstrap();
