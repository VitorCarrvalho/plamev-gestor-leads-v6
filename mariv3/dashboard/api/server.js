/**
 * dashboard/api/server.js — Dashboard Mari V3
 * Express + Socket.IO | JWT Auth | PostgreSQL
 * Exporta: { iniciar, notificar }
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
// Pool dedicado do dashboard — não depende do db/index.js
const { Pool: PgPool } = require('pg');
const pgPool = new PgPool({ connectionString: 'postgresql://geta@localhost:5432/mariv3' });
const dbq = (sql, p=[]) => pgPool.query(sql,p).then(r=>r.rows);
const dbo = (sql, p=[]) => pgPool.query(sql,p).then(r=>r.rows[0]||null);

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const jwt        = require('jsonwebtoken');
const path       = require('path');
const db          = require('../../db');
const https       = require('https');
const sender      = require('../../services/sender');
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL         = process.env.MODEL_AGENTE || 'claude-haiku-4-5';

const JWT_SECRET   = process.env.DASHBOARD_JWT_SECRET || 'mari_dashboard_secret_2025';
const DASHBOARD_EMAIL = process.env.DASHBOARD_EMAIL    || 'geta.hubcenter@gmail.com';
const DASHBOARD_PASS  = process.env.DASHBOARD_PASS     || 'Plamev@2026';

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(path.join(__dirname, '../')));

// ─── Middleware JWT ────────────────────────────────────────────
function autenticar(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ erro: 'Token obrigatório' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ erro: 'Token inválido ou expirado' });
  }
}

// ─── Auth ──────────────────────────────────────────────────────
app.post('/auth/login', (req, res) => {
  const { email, senha } = req.body || {};
  if (email !== DASHBOARD_EMAIL || senha !== DASHBOARD_PASS) {
    return res.status(401).json({ erro: 'Credenciais inválidas' });
  }
  const token = jwt.sign({ email, role: 'supervisor' }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, email });
});

// ─── REST API ──────────────────────────────────────────────────
app.get('/api/conversas', autenticar, async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT
         c.id, c.etapa, c.canal, c.ia_silenciada, c.ultima_interacao,
         c.numero_cotacao, c.numero_externo, c.sender_chip, c.instancia_whatsapp, c.criado_em,
         CASE
           WHEN c.canal = 'telegram' THEN '💬 Telegram'
           WHEN c.instancia_whatsapp = 'mari-plamev-whatsapp' THEN '📱 Mari 011'
           WHEN c.instancia_whatsapp = 'mari-plamev-zap2'    THEN '📱 Mari 031'
           WHEN c.instancia_whatsapp = 'plamev'              THEN '📱 Bella 021'
           WHEN c.instancia_whatsapp = 'grione'              THEN '📱 Grione'
           ELSE '📱 WhatsApp'
         END AS chip,
         cl.nome AS cliente_nome,
         a.slug  AS agente_slug,
         a.nome  AS agente_nome,
         pp.nome AS nome_pet, pp.especie, pp.raca,
         (SELECT COUNT(*) FROM mensagens m WHERE m.conversa_id = c.id) AS total_msgs
       FROM conversas c
       JOIN clientes cl ON cl.id = c.client_id
       JOIN agentes  a  ON a.id  = c.agent_id
       LEFT JOIN perfil_pet pp ON pp.client_id = c.client_id
       WHERE c.status = 'ativa'
       ORDER BY c.ultima_interacao DESC
       LIMIT 50`,
      []
    );
    res.json(rows);
  } catch (e) {
    console.error('[DASH] /api/conversas', e.message);
    res.status(500).json({ erro: e.message });
  }
});

app.get('/api/conversa/:id', autenticar, async (req, res) => {
  try {
    const { id } = req.params;
    const conversa = await db.one(
      `SELECT c.*, cl.nome AS cliente_nome, a.slug AS agente_slug, a.nome AS agente_nome
       FROM conversas c
       JOIN clientes cl ON cl.id = c.client_id
       JOIN agentes  a  ON a.id  = c.agent_id
       WHERE c.id = $1`,
      [id]
    );
    if (!conversa) return res.status(404).json({ erro: 'Conversa não encontrada' });

    const mensagens = await db.query(
      `SELECT role, conteudo, enviado_por, timestamp
       FROM mensagens WHERE conversa_id = $1
       ORDER BY timestamp ASC`,
      [id]
    );

    // Perfil: cliente + melhor perfil_pet disponível
    const cl_row  = await dbo('SELECT nome AS nome_cliente, origem FROM clientes WHERE id=$1', [conversa.client_id]).catch(()=>null);
    const pp_row  = await dbo('SELECT nome AS nome_pet, especie, raca, idade_anos, sexo, castrado, problema_saude, cep, cidade, estado, email, cpf, indicado_por FROM perfil_pet WHERE client_id=$1 ORDER BY atualizado_em DESC LIMIT 1', [conversa.client_id]).catch(()=>null);
    const perfil  = { ...(cl_row||{}), ...(pp_row||{}) };

    // Adicionar chip formatado na conversa
    const chipNomes = {
      'mari011':              '📱 Mari 011',
      'mari-plamev-whatsapp': '📱 Mari 011 (legado)',
      'mari-plamev-zap2':     '📱 Mari 031',
      'plamev':               '📱 Bella 021',
      'grione':               '📱 Grione',
    };
    conversa.chip = conversa.instancia_whatsapp ? (chipNomes[conversa.instancia_whatsapp] || conversa.instancia_whatsapp) : conversa.canal;

    res.json({ conversa, mensagens, perfil });
  } catch (e) {
    console.error('[DASH] /api/conversa/:id', e.message);
    res.status(500).json({ erro: e.message });
  }
});

app.get('/api/stats', autenticar, async (req, res) => {
  try {
    const hoje = new Date().toISOString().slice(0, 10);

    const mes = new Date().toISOString().slice(0, 7); // YYYY-MM

    const [clientes, msgs, custo, custoMes] = await Promise.all([
      db.one(
        `SELECT COUNT(DISTINCT c.client_id) AS total
         FROM conversas c
         WHERE DATE(c.ultima_interacao) = $1 AND c.status = 'ativa'`,
        [hoje]
      ),
      db.one(
        `SELECT COUNT(*) AS total FROM mensagens
         WHERE DATE(timestamp) = $1`,
        [hoje]
      ),
      db.one(
        `SELECT COALESCE(SUM(custo_usd), 0) AS total FROM custos_ia
         WHERE DATE(timestamp) = $1`,
        [hoje]
      ),
      db.one(
        `SELECT COALESCE(SUM(custo_usd), 0) AS total FROM custos_ia
         WHERE TO_CHAR(timestamp, 'YYYY-MM') = $1`,
        [mes]
      ),
    ]);

    res.json({
      clientes_hoje: parseInt(clientes?.total || 0),
      msgs_hoje:     parseInt(msgs?.total     || 0),
      custo_hoje:    parseFloat(custo?.total  || 0).toFixed(4),
      custo_mes:     parseFloat(custoMes?.total || 0).toFixed(2),
    });
  } catch (e) {
    console.error('[DASH] /api/stats', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// ─── Interno — notificação do pipeline ────────────────────────
app.post('/interno/nova-msg', (req, res) => {
  const { conversa_id, phone, nome, msg_cliente, msg_mari } = req.body || {};
  if (!conversa_id) return res.status(400).json({ erro: 'conversa_id obrigatório' });

  io.to(`conversa:${conversa_id}`).emit('nova_msg', {
    conversa_id,
    phone,
    nome,
    msg_cliente,
    msg_mari,
    timestamp: new Date().toISOString(),
  });

  // Atualiza lista geral
  io.emit('conversa_atualizada', { conversa_id, ultima_msg: msg_mari, timestamp: new Date().toISOString() });

  res.json({ ok: true });
});

// ─── Página inicial ────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../index.html'));
});

// ─── Socket.IO ────────────────────────────────────────────────
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Token obrigatório'));
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error('Token inválido'));
  }
});

io.on('connection', (socket) => {
  console.log(`[DASH] Socket conectado: ${socket.id} (${socket.user?.email})`);

  // ── get_conversas ────────────────────────────────────────
  socket.on('get_conversas', async () => {
    try {
      const rows = await db.query(
        `SELECT
           c.id, c.etapa, c.canal, c.ia_silenciada, c.ultima_interacao,
           cl.nome AS cliente_nome,
           a.slug  AS agente_slug,
           pp.nome, pp.especie
         FROM conversas c
         JOIN clientes cl ON cl.id = c.client_id
         JOIN agentes  a  ON a.id  = c.agent_id
         LEFT JOIN perfil_pet pp ON pp.client_id = c.client_id
         WHERE c.status = 'ativa'
         ORDER BY c.ultima_interacao DESC LIMIT 50`,
        []
      );
      socket.emit('conversas_data', rows);
    } catch (e) {
      socket.emit('erro', { msg: e.message });
    }
  });

  // ── get_conversa(id) ─────────────────────────────────────
  socket.on('get_conversa', async (id) => {
    try {
      const chipNomes = {
        'mari011':'📱 Mari 011','mari-plamev-whatsapp':'📱 Mari 011 (legado)','mari-plamev-zap2':'📱 Mari 031',
        'plamev':'📱 Bella 021','grione':'📱 Grione'
      };
      const conversa = await dbo(
        `SELECT c.*, cl.nome AS cliente_nome, a.slug AS agente_slug, a.nome AS agente_nome
         FROM conversas c
         JOIN clientes cl ON cl.id = c.client_id
         JOIN agentes  a  ON a.id  = c.agent_id
         WHERE c.id = $1`, [id]
      );
      if (!conversa) return socket.emit('erro', { msg: 'Conversa não encontrada' });
      conversa.chip = chipNomes[conversa.instancia_whatsapp] || conversa.canal;

      const mensagens = await dbq(
        'SELECT role, conteudo, enviado_por, timestamp FROM mensagens WHERE conversa_id=$1 ORDER BY timestamp ASC',
        [id]
      );

      const cl_row = await dbo('SELECT nome AS nome_cliente, origem FROM clientes WHERE id=$1', [conversa.client_id]).catch(()=>null);
      const pp_row = await dbo(
        'SELECT nome AS nome_pet, especie, raca, idade_anos, sexo, castrado, problema_saude, cep, cidade, estado, email, cpf, indicado_por FROM perfil_pet WHERE client_id=$1 ORDER BY atualizado_em DESC LIMIT 1',
        [conversa.client_id]
      ).catch(()=>null);
      const perfil = { ...(cl_row||{}), ...(pp_row||{}) };

      socket.join(`conversa:${id}`);
      socket.emit('conversa_data', { conversa, mensagens, perfil });
    } catch (e) {
      console.error('[DASH] get_conversa:', e.message);
      socket.emit('erro', { msg: e.message });
    }
  });

  // ── silenciar_ia ─────────────────────────────────────────
  socket.on('silenciar_ia', async (id) => {
    try {
      await db.run(
        'UPDATE conversas SET ia_silenciada = NOT ia_silenciada WHERE id=$1',
        [id]
      );
      const c = await db.one('SELECT ia_silenciada FROM conversas WHERE id=$1', [id]);
      io.emit('ia_status', { conversa_id: id, silenciada: c?.ia_silenciada });
      console.log(`[DASH] IA ${c?.ia_silenciada ? 'silenciada' : 'reativada'} — conversa ${id}`);
    } catch (e) {
      socket.emit('erro', { msg: e.message });
    }
  });

  // ── instrucao ────────────────────────────────────────────
  socket.on('instrucao', async ({ conversa_id, texto }) => {
    try {
      // Gerar mensagem com Claude e enviar ao cliente
      const msg = await gerarEEnviar(conversa_id, texto);
      if (msg) {
        socket.emit('instrucao_ok', { conversa_id, msg });
        io.emit('nova_msg', { conversa_id, msg_mari: msg, timestamp: new Date().toISOString() });
        console.log(`[DASH] Instrução executada para ${conversa_id}: ${msg.substring(0,50)}`);
      } else {
        socket.emit('erro', { msg: 'Não foi possível gerar a mensagem' });
      }
    } catch (e) {
      socket.emit('erro', { msg: e.message });
    }
  });

  // ── transferir ───────────────────────────────────────────
  socket.on('transferir', async ({ conversa_id, agent_slug }) => {
    try {
      const agente = await db.buscarAgente(agent_slug);
      if (!agente) return socket.emit('erro', { msg: `Agente não encontrado: ${agent_slug}` });
      await db.run(
        'UPDATE conversas SET agent_id=$1, ultima_interacao=NOW() WHERE id=$2',
        [agente.id, conversa_id]
      );
      io.emit('conversa_transferida', { conversa_id, agent_slug });
      console.log(`[DASH] Conversa ${conversa_id} transferida para ${agent_slug}`);
    } catch (e) {
      socket.emit('erro', { msg: e.message });
    }
  });

  // ── excluir dados (resetar histórico) ──────────────────────
  socket.on('excluir_dados', async ({ conversa_id }) => {
    try {
      const conv = await db.one('SELECT client_id FROM conversas WHERE id=$1', [conversa_id]);
      if (!conv) return socket.emit('erro', { msg: 'Conversa não encontrada' });

      await db.run('DELETE FROM mensagens WHERE conversa_id=$1', [conversa_id]);
      await db.run('UPDATE perfil_pet SET nome=null,especie=null,raca=null,idade_anos=null,sexo=null,problema_saude=null WHERE client_id=$1', [conv.client_id]);
      await db.run("UPDATE conversas SET etapa='acolhimento', score=0, ultima_interacao=NOW() WHERE id=$1", [conversa_id]);
      await db.run('DELETE FROM instrucoes_ativas WHERE conversa_id=$1', [conversa_id]);
      await db.run('DELETE FROM agendamentos WHERE conversa_id=$1', [conversa_id]);

      socket.emit('excluir_dados_ok', { conversa_id });
      io.emit('conversa_atualizada', { conversa_id });
      console.log(`[DASH] Dados apagados: ${conversa_id}`);
    } catch(e) { socket.emit('erro', { msg: e.message }); }
  });

  // ── excluir contato completo ──────────────────────────────
  socket.on('novo_contato', async ({ nome, phone, origem, historico, indicado_por }) => {
    try {
      const supervisor = require('../../services/supervisor');
      await supervisor.novoContato(phone, nome, origem||'manual', historico||'', indicado_por||'');
      socket.emit('get_conversas');
      toast_emit('✅ Contato criado!');
    } catch(e) { socket.emit('erro', { msg: e.message }); }
  });

  socket.on('excluir_contato', async ({ conversa_id }) => {
    try {
      const conv = await db.one('SELECT client_id FROM conversas WHERE id=$1', [conversa_id]);
      if (!conv) return socket.emit('erro', { msg: 'Conversa não encontrada' });
      const clientId = conv.client_id;

      // Apagar tudo em cascade
      const conversas = await db.query('SELECT id FROM conversas WHERE client_id=$1', [clientId]);
      for (const cv of conversas) {
        await db.run('DELETE FROM mensagens WHERE conversa_id=$1', [cv.id]);
        await db.run('DELETE FROM instrucoes_ativas WHERE conversa_id=$1', [cv.id]);
        await db.run('DELETE FROM agendamentos WHERE conversa_id=$1', [cv.id]);
        await db.run('DELETE FROM funil_conversao WHERE conversa_id=$1', [cv.id]);
        await db.run('DELETE FROM custos_ia WHERE conversa_id=$1', [cv.id]);
        await db.run('DELETE FROM decisoes_orquestrador WHERE conversa_id=$1', [cv.id]);
      }
      await db.run('DELETE FROM conversas WHERE client_id=$1', [clientId]);
      await db.run('DELETE FROM perfil_pet WHERE client_id=$1', [clientId]);
      await db.run('DELETE FROM identificadores_cliente WHERE client_id=$1', [clientId]);
      await db.run('DELETE FROM clientes WHERE id=$1', [clientId]);

      socket.emit('excluir_contato_ok', { conversa_id });
      io.emit('conversa_removida', { conversa_id });
      console.log(`[DASH] Contato removido: ${clientId}`);
    } catch(e) { socket.emit('erro', { msg: e.message }); }
  });

  // ── provocar (atalho direto) ──────────────────────────────
  socket.on('provocar', async ({ conversa_id }) => {
    const instrucao = 'Reative o contato com o cliente de forma calorosa, natural e curiosa. Mencione o pet se souber o nome.';
    try {
      const msg = await gerarEEnviar(conversa_id, instrucao);
      if (msg) {
        socket.emit('provocar_ok', { conversa_id, msg });
        io.emit('nova_msg', { conversa_id, msg_mari: msg, timestamp: new Date().toISOString() });
        console.log(`[DASH] Provocar executado: ${conversa_id}`);
      } else {
        socket.emit('erro', { msg: 'Não foi possível gerar mensagem' });
      }
    } catch(e) { socket.emit('erro', { msg: e.message }); }
  });

  // ── falar_direto ────────────────────────────────────────────
  socket.on('fd_preview', async ({ conversa_id, texto }) => {
    try {
      const msg = await gerarReescrita(conversa_id, texto);
      socket.emit('fd_preview_ok', { msg });
    } catch(e) { socket.emit('fd_preview_ok', { msg: texto }); }
  });

  socket.on('falar_direto', async ({ conversa_id, texto, reescrever }) => {
    try {
      const msgFinal = reescrever ? await gerarReescrita(conversa_id, texto) : texto;
      if (!msgFinal) return socket.emit('falar_direto_err', { erro: 'Sem resposta' });

      const conv = await db.one('SELECT * FROM conversas WHERE id=$1', [conversa_id]);
      await sender.enviar({
        canal:     conv.canal,
        phone:     conv.numero_externo,
        jid:       conv.jid,
        instancia: conv.instancia_whatsapp || null,
        chatId:    conv.canal === 'telegram' ? conv.numero_externo : null
      }, msgFinal);

      await db.salvarMensagem(conversa_id, 'agent', msgFinal, 'supervisora').catch(()=>{});
      io.emit('nova_msg', { conversa_id, msg_mari: msgFinal, timestamp: new Date().toISOString() });
      socket.emit('falar_direto_ok', { msg: msgFinal });
      console.log(`[DASH] Falar Direto → ${conversa_id}: ${msgFinal.substring(0,50)}`);
    } catch(e) { socket.emit('falar_direto_err', { erro: e.message }); }
  });

  // ── salvar_nota ────────────────────────────────────────────
  socket.on('salvar_nota', async ({ conversa_id, texto }) => {
    await db.salvarMensagem(conversa_id, 'supervisor', '[NOTA] ' + texto, 'supervisor').catch(()=>{});
    socket.emit('nota_ok');
  });

  socket.on('disconnect', () => {
    console.log(`[DASH] Socket desconectado: ${socket.id}`);
  });
});

// ─── Helpers IA ──────────────────────────────────────────────
async function gerarReescrita(conversa_id, texto) {
  const conv    = await db.one('SELECT * FROM conversas WHERE id=$1', [conversa_id]).catch(()=>null);
  if (!conv) return texto;
  const perfil  = await db.buscarOuCriarPerfil(conv.client_id).catch(()=>null);
  const cliente = await db.one('SELECT * FROM clientes WHERE id=$1', [conv.client_id]).catch(()=>null);
  const prompt  = `Você é Mariana (Mari), consultora da Plamev. Calorosa, natural, WhatsApp. Sem asteriscos.
Cliente: ${cliente?.nome || ''}${perfil?.nome ? ' | Pet: '+perfil.nome : ''}
Reescreva a mensagem abaixo no seu estilo pessoal e caloroso. Máx 2 frases.
Mensagem: ${texto}`;
  return new Promise((resolve) => {
    const body = JSON.stringify({ model: MODEL, max_tokens: 120, messages: [{ role:'user', content: prompt }] });
    const opts = { hostname:'api.anthropic.com', path:'/v1/messages', method:'POST',
      headers:{'x-api-key':ANTHROPIC_KEY,'anthropic-version':'2023-06-01','content-type':'application/json','content-length':Buffer.byteLength(body)} };
    const req = https.request(opts, res => {
      let d=''; res.on('data',ch=>d+=ch);
      res.on('end',()=>{ try { resolve(JSON.parse(d).content?.[0]?.text?.trim()||texto); } catch { resolve(texto); }});
    });
    req.on('error',()=>resolve(texto));
    req.write(body); req.end();
  });
}

async function gerarEEnviar(conversa_id, instrucao) {
  const conv    = await db.one('SELECT * FROM conversas WHERE id=$1', [conversa_id]).catch(()=>null);
  if (!conv) return null;
  const cliente = await db.one('SELECT * FROM clientes WHERE id=$1', [conv.client_id]).catch(()=>null);
  const perfil  = await db.buscarOuCriarPerfil(conv.client_id).catch(()=>null);
  const hist    = await db.buscarHistorico(conversa_id).catch(()=>[]);
  const nomePet     = perfil?.nome || '';
  const nomeCliente = cliente?.nome || '';
  const historicoTxt = hist.slice(-4).map(h =>
    (h.role === 'user' ? (nomeCliente||'Cliente') : 'Mari') + ': ' + (h.conteudo||'').substring(0,80)
  ).join('\n');
  const prompt = `Você é Mariana (Mari), consultora da Plamev. Calorosa, natural, WhatsApp.
Cliente: ${nomeCliente}${nomePet ? ' | Pet: '+nomePet : ''}
Etapa: ${conv.etapa || 'acolhimento'}
Histórico recente:
${historicoTxt || '(sem histórico)'}

INSTRUÇÃO DO SUPERVISOR: ${instrucao}
Gere UMA mensagem curta (1-2 frases) seguindo a instrução. Natural, sem asteriscos.`;
  return new Promise((resolve) => {
    const body = JSON.stringify({ model: MODEL, max_tokens: 150, messages: [{ role:'user', content: prompt }] });
    const opts = { hostname:'api.anthropic.com', path:'/v1/messages', method:'POST',
      headers:{'x-api-key':ANTHROPIC_KEY,'anthropic-version':'2023-06-01','content-type':'application/json','content-length':Buffer.byteLength(body)} };
    const req = https.request(opts, res => {
      let d=''; res.on('data',ch=>d+=ch);
      res.on('end', async () => {
        try {
          const msg = JSON.parse(d).content?.[0]?.text?.trim();
          if (!msg) return resolve(null);
          await sender.enviar({
            canal:    conv.canal,
            phone:    conv.numero_externo,
            jid:      conv.jid,
            instancia: conv.instancia_whatsapp || null,
            chatId:   conv.canal === 'telegram' ? conv.numero_externo : null
          }, msg);
          await db.salvarMensagem(conversa_id, 'agent', msg, 'supervisora').catch(()=>{});
          resolve(msg);
        } catch(e) { resolve(null); }
      });
    });
    req.on('error',()=>resolve(null));
    req.write(body); req.end();
  });
}

// ─── Exports ──────────────────────────────────────────────────
function iniciar(porta = 3400) {
  server.listen(porta, () => {
    console.log(`[DASH] ✅ Dashboard rodando em http://localhost:${porta}`);
  });
}

function notificar(conversa_id, phone, nome, msg_cliente, msg_mari) {
  io.to(`conversa:${conversa_id}`).emit('nova_msg', {
    conversa_id,
    phone,
    nome,
    msg_cliente,
    msg_mari,
    timestamp: new Date().toISOString(),
  });
  io.emit('conversa_atualizada', {
    conversa_id,
    ultima_msg: msg_mari,
    timestamp: new Date().toISOString(),
  });
}

module.exports = { iniciar, notificar };
