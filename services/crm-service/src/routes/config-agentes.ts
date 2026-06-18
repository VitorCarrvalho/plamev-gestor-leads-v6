/**
 * routes/config-agentes.ts — CRUD dinâmico de agentes, prompts e canais.
 * Montado em /api/config/agentes (autenticado) e /api/internal (secret header).
 */
import { Router } from 'express';
import https from 'https';
import http from 'http';
import { autenticar, soAdmin } from '../middleware/auth';
import { query, execute, queryOne } from '../config/db';
import { resetarClientePorTelefone } from '../repositories/conversations.repository';

function httpPost(url: string, body: any, headers: Record<string, string> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const b = JSON.stringify(body);
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port) : undefined,
      path: parsed.pathname + (parsed.search || ''),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b), ...headers },
      timeout: 8000,
    }, res => {
      let d = '';
      res.on('data', (c: string) => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(b);
    req.end();
  });
}

export const agenteRouter = Router();

// ── Recarregar configuração no channel-service ────────────────
agenteRouter.post('/reload', autenticar, async (_req, res) => {
  try {
    const CHANNEL_SERVICE_URL = process.env.CHANNEL_SERVICE_URL || 'http://channel-service.railway.internal:8080';
    const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'plamev-internal';
    const result = await httpPost(
      `${CHANNEL_SERVICE_URL}/internal/reload-config`,
      {},
      { 'x-internal-secret': INTERNAL_SECRET }
    );
    res.json({ ok: true, ...result });
  } catch (e: any) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// ── Lista agentes ─────────────────────────────────────────────
agenteRouter.get('/', autenticar, async (_req, res) => {
  try {
    const rows = await query<any>(`SELECT * FROM agentes ORDER BY id ASC`);
    res.json({ ok: true, agentes: rows });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Detalhe completo (agente + prompts + canais) ──────────────
agenteRouter.get('/:id', autenticar, async (req, res) => {
  try {
    const agente = await queryOne<any>(`SELECT * FROM agentes WHERE id=$1`, [req.params.id]);
    if (!agente) { res.status(404).json({ erro: 'Agente não encontrado' }); return; }

    const prompts     = await query<any>(`SELECT tipo, titulo, conteudo, ativo, ordem FROM agente_prompts WHERE agent_id=$1 ORDER BY ordem`, [req.params.id]);
    const whatsapps   = await query<any>(
      `SELECT id, instancia_nome, instancia_label, ddd_prefixos, chip_fallback, ativo,
              provider, evolution_url, twilio_account_sid, twilio_phone_from,
              CASE WHEN LENGTH(evolution_api_key) > 0 THEN '••••••••' || RIGHT(evolution_api_key,4) ELSE '' END AS evolution_api_key,
              CASE WHEN LENGTH(twilio_auth_token) > 0 THEN '••••••••' || RIGHT(twilio_auth_token,4) ELSE '' END AS twilio_auth_token
       FROM canais_whatsapp WHERE agent_id=$1 ORDER BY criado_em`,
      [req.params.id]
    );
    const telegrams   = await query<any>(`SELECT id, bot_nome, ativo, criado_em FROM canais_telegram WHERE agent_id=$1 ORDER BY criado_em`, [req.params.id]);

    res.json({ ok: true, agente: { ...agente, prompts, canais_whatsapp: whatsapps, canais_telegram: telegrams } });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Atualiza campos do agente ─────────────────────────────────
agenteRouter.patch('/:id', soAdmin, async (req, res) => {
  try {
    const allowed = ['nome', 'descricao', 'modelo_principal', 'temperatura', 'ativo', 'avatar_url'];
    const sets: string[] = [];
    const vals: any[] = [];
    for (const k of allowed) {
      if (req.body[k] !== undefined) { sets.push(`${k}=$${vals.length + 1}`); vals.push(req.body[k]); }
    }
    if (!sets.length) { res.status(400).json({ erro: 'Nada para atualizar' }); return; }
    sets.push(`atualizado_em=NOW()`);
    vals.push(req.params.id);
    await execute(`UPDATE agentes SET ${sets.join(',')} WHERE id=$${vals.length}`, vals);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Upsert prompt ─────────────────────────────────────────────
agenteRouter.put('/:id/prompts/:tipo', soAdmin, async (req, res) => {
  try {
    const { conteudo, titulo, ativo } = req.body || {};
    if (conteudo === undefined) { res.status(400).json({ erro: 'conteudo obrigatório' }); return; }
    await execute(
      `INSERT INTO agente_prompts (agent_id, tipo, titulo, conteudo, ativo, atualizado_em)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (agent_id, tipo) DO UPDATE
         SET conteudo=EXCLUDED.conteudo,
             titulo=COALESCE(EXCLUDED.titulo, agente_prompts.titulo),
             ativo=EXCLUDED.ativo,
             atualizado_em=NOW()`,
      [req.params.id, req.params.tipo, titulo || null, conteudo, ativo !== false]
    );
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

function maskSecret(s: string): string {
  if (!s || s.length < 4) return s ? '••••' : '';
  return '••••••••' + s.slice(-4);
}
function isMasked(v: unknown): boolean {
  return typeof v === 'string' && v.includes('•');
}

// ── WhatsApp: lista (campos sensíveis mascarados) ─────────────
agenteRouter.get('/:id/canais/whatsapp', autenticar, async (req, res) => {
  try {
    const rows = await query<any>(
      `SELECT id, instancia_nome, instancia_label, ddd_prefixos, chip_fallback, ativo,
              provider, evolution_url, twilio_account_sid, twilio_phone_from,
              CASE WHEN LENGTH(evolution_api_key) > 0 THEN '••••••••' || RIGHT(evolution_api_key,4) ELSE '' END AS evolution_api_key,
              CASE WHEN LENGTH(twilio_auth_token) > 0 THEN '••••••••' || RIGHT(twilio_auth_token,4) ELSE '' END AS twilio_auth_token
       FROM canais_whatsapp WHERE agent_id=$1 ORDER BY criado_em`,
      [req.params.id]
    );
    res.json({ ok: true, canais: rows });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── WhatsApp: criar ───────────────────────────────────────────
agenteRouter.post('/:id/canais/whatsapp', soAdmin, async (req, res) => {
  try {
    const {
      instancia_nome, instancia_label, ddd_prefixos = [], chip_fallback = false, ativo = true,
      provider = 'evolution', evolution_url = '', evolution_api_key = '',
      twilio_account_sid = '', twilio_auth_token = '', twilio_phone_from = '',
    } = req.body || {};
    if (!instancia_nome) { res.status(400).json({ erro: 'instancia_nome obrigatório' }); return; }
    const rows = await query<any>(
      `INSERT INTO canais_whatsapp
         (agent_id, instancia_nome, instancia_label, ddd_prefixos, chip_fallback, ativo,
          provider, evolution_url, evolution_api_key, twilio_account_sid, twilio_auth_token, twilio_phone_from)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, instancia_nome, instancia_label, ddd_prefixos, chip_fallback, ativo, provider, evolution_url, twilio_account_sid, twilio_phone_from`,
      [req.params.id, instancia_nome, instancia_label || null, ddd_prefixos, chip_fallback, ativo,
       provider, evolution_url, evolution_api_key, twilio_account_sid, twilio_auth_token, twilio_phone_from]
    );
    res.json({ ok: true, canal: rows[0] });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── WhatsApp: atualizar ───────────────────────────────────────
agenteRouter.patch('/:id/canais/whatsapp/:canalId', soAdmin, async (req, res) => {
  try {
    const textFields = ['instancia_nome', 'instancia_label', 'ddd_prefixos', 'chip_fallback', 'ativo',
                        'provider', 'evolution_url', 'twilio_account_sid', 'twilio_phone_from'];
    const secretFields = ['evolution_api_key', 'twilio_auth_token'];
    const sets: string[] = [];
    const vals: any[] = [];
    for (const k of textFields) {
      if (req.body[k] !== undefined) { sets.push(`${k}=$${vals.length + 1}`); vals.push(req.body[k]); }
    }
    for (const k of secretFields) {
      if (req.body[k] !== undefined && !isMasked(req.body[k])) {
        sets.push(`${k}=$${vals.length + 1}`); vals.push(req.body[k]);
      }
    }
    if (!sets.length) { res.status(400).json({ erro: 'Nada para atualizar' }); return; }
    vals.push(req.params.canalId, req.params.id);
    await execute(`UPDATE canais_whatsapp SET ${sets.join(',')} WHERE id=$${vals.length - 1} AND agent_id=$${vals.length}`, vals);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── WhatsApp: remover ─────────────────────────────────────────
agenteRouter.delete('/:id/canais/whatsapp/:canalId', soAdmin, async (req, res) => {
  try {
    await execute(`DELETE FROM canais_whatsapp WHERE id=$1 AND agent_id=$2`, [req.params.canalId, req.params.id]);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── WhatsApp: testar envio + configurar webhook ───────────────
agenteRouter.post('/:id/canais/whatsapp/:canalId/test', soAdmin, async (req, res) => {
  try {
    const { telefone, webhook_url } = req.body || {};
    if (!telefone) { res.status(400).json({ erro: 'telefone obrigatório' }); return; }

    const canal = await queryOne<any>(
      `SELECT instancia_nome, evolution_url, evolution_api_key, provider
       FROM canais_whatsapp WHERE id=$1 AND agent_id=$2`,
      [req.params.canalId, req.params.id]
    );
    if (!canal) { res.status(404).json({ erro: 'Canal não encontrado' }); return; }
    if (canal.provider !== 'evolution') {
      res.status(400).json({ erro: 'Teste disponível apenas para Evolution API' }); return;
    }

    const baseUrl = (canal.evolution_url || '').trim().replace(/\/$/, '');
    const apiKey = (canal.evolution_api_key || '').trim();
    if (!baseUrl || !apiKey) {
      res.status(400).json({ erro: 'URL do servidor e API Key são obrigatórios para realizar o teste' }); return;
    }

    const instancia = canal.instancia_nome;
    const steps: string[] = [];

    // 1. Configurar webhook automaticamente se a URL foi enviada
    if (webhook_url) {
      try {
        await httpPost(
          `${baseUrl}/webhook/set/${instancia}`,
          { url: webhook_url, webhook_by_events: false, webhook_base64: false, events: ['MESSAGES_UPSERT'] },
          { apikey: apiKey }
        );
        steps.push('✅ Webhook configurado');
      } catch {
        steps.push('⚠️ Webhook: falha ao configurar (verifique a URL manualmente)');
      }
    }

    // 2. Enviar mensagem de teste
    let phone = String(telefone).replace(/\D/g, '');
    if (!phone.startsWith('55')) phone = '55' + phone;
    if (phone.startsWith('55') && phone.length === 12) phone = phone.slice(0, 4) + '9' + phone.slice(4);
    const number = phone + '@s.whatsapp.net';

    const result = await httpPost(
      `${baseUrl}/message/sendText/${instancia}`,
      { number, text: `🔍 Teste da instância *${instancia}* — configuração funcionando! ✅` },
      { apikey: apiKey }
    );

    if (result?.key || result?.id) {
      steps.push('✅ Mensagem enviada');
      res.json({ ok: true, mensagem: steps.join(' • ') });
    } else {
      steps.push('❌ Mensagem não enviada');
      const detalhe = JSON.stringify(result).slice(0, 300);
      res.status(502).json({ ok: false, erro: steps.join(' • '), detalhe });
    }
  } catch (e: any) { res.status(500).json({ ok: false, erro: e.message }); }
});

// ── Telegram: lista ───────────────────────────────────────────
agenteRouter.get('/:id/canais/telegram', autenticar, async (req, res) => {
  try {
    const rows = await query<any>(`SELECT id, bot_nome, ativo, criado_em FROM canais_telegram WHERE agent_id=$1 ORDER BY criado_em`, [req.params.id]);
    res.json({ ok: true, canais: rows });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Telegram: criar ───────────────────────────────────────────
agenteRouter.post('/:id/canais/telegram', soAdmin, async (req, res) => {
  try {
    const { bot_token, bot_nome, ativo = true } = req.body || {};
    if (!bot_token) { res.status(400).json({ erro: 'bot_token obrigatório' }); return; }
    const rows = await query<any>(
      `INSERT INTO canais_telegram (agent_id, bot_token, bot_nome, ativo)
       VALUES ($1,$2,$3,$4) RETURNING id, bot_nome, ativo, criado_em`,
      [req.params.id, bot_token, bot_nome || null, ativo]
    );
    res.json({ ok: true, canal: rows[0] });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Telegram: atualizar ───────────────────────────────────────
agenteRouter.patch('/:id/canais/telegram/:canalId', soAdmin, async (req, res) => {
  try {
    const allowed = ['bot_token', 'bot_nome', 'ativo'];
    const sets: string[] = [];
    const vals: any[] = [];
    for (const k of allowed) {
      if (req.body[k] !== undefined) { sets.push(`${k}=$${vals.length + 1}`); vals.push(req.body[k]); }
    }
    if (!sets.length) { res.status(400).json({ erro: 'Nada para atualizar' }); return; }
    vals.push(req.params.canalId, req.params.id);
    await execute(`UPDATE canais_telegram SET ${sets.join(',')} WHERE id=$${vals.length - 1} AND agent_id=$${vals.length}`, vals);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Telegram: remover ─────────────────────────────────────────
agenteRouter.delete('/:id/canais/telegram/:canalId', soAdmin, async (req, res) => {
  try {
    await execute(`DELETE FROM canais_telegram WHERE id=$1 AND agent_id=$2`, [req.params.canalId, req.params.id]);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── Endpoint interno (channel-service → CRM) ─────────────────
export const internalRouter = Router();

function checkInternalSecret(req: any, res: any): boolean {
  const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'plamev-internal';
  if (req.headers['x-internal-secret'] !== INTERNAL_SECRET) {
    res.status(401).json({ erro: 'Não autorizado' });
    return false;
  }
  return true;
}

// Salva interação completa (cliente + conversa + mensagens) disparado pelo agent-ai
internalRouter.post('/salvar-interacao', async (req, res) => {
  if (!checkInternalSecret(req, res)) return;
  const { message, resposta } = req.body || {};
  if (!message || !message.phone || !message.canal) {
    res.status(400).json({ erro: 'message com phone e canal são obrigatórios' });
    return;
  }
  res.json({ ok: true }); // responde antes de salvar para não bloquear

  // Extraídos antes do try para ficarem acessíveis no finally
  const phone    = String(message.phone);
  const canal    = message.canal;
  const agentSlug = message.agentSlug || 'mari';
  const nome     = message.nome || null;
  const texto    = (req.body?.input_text_override || message.texto || '').toString();
  const instancia = message.instancia || null;
  const senderChip = message.senderChip || null;
  const jid      = message.jid || null;
  const msgIdExterno = message.id || null;
  let conversaId: string | null = null;

  try {
    // 1. Resolve agent_id
    const agente = await queryOne<any>('SELECT id, org_id FROM agentes WHERE slug=$1 LIMIT 1', [agentSlug]);
    const agentId = agente?.id;
    const orgId = agente?.org_id || '00000000-0000-0000-0000-000000000000';
    if (!agentId) { console.warn(`[INTERNAL] agente não encontrado: ${agentSlug}`); return; }

    // 2. Upsert cliente via phone
    let ident = await queryOne<any>(
      `SELECT client_id FROM identificadores_cliente WHERE tipo='phone' AND valor=$1`,
      [phone]
    );
    // Verifica se o cliente existe (pode ser órfão após exclusão manual)
    if (ident) {
      const clienteExiste = await queryOne<any>('SELECT id FROM clientes WHERE id=$1', [ident.client_id]);
      if (!clienteExiste) {
        console.warn(`[INTERNAL] ⚠️ Identificador órfão phone=${phone} → limpando e recriando`);
        await execute(`DELETE FROM identificadores_cliente WHERE tipo='phone' AND valor=$1`, [phone]).catch(() => {});
        ident = null;
      }
    }
    let clientId: string;
    if (ident) {
      clientId = ident.client_id;
      if (nome) await execute(`UPDATE clientes SET nome=COALESCE(nome,$1), atualizado_em=NOW() WHERE id=$2 AND nome IS NULL`, [nome, clientId]);
    } else {
      const novoCliente = await queryOne<any>(
        `INSERT INTO clientes (nome, origem, org_id) VALUES ($1,'whatsapp',$2) RETURNING id`,
        [nome, orgId]
      );
      clientId = novoCliente!.id;
      await execute(
        `INSERT INTO identificadores_cliente (client_id, tipo, valor) VALUES ($1,'phone',$2) ON CONFLICT DO NOTHING`,
        [clientId, phone]
      );
    }

    // 3. Upsert conversa ativa
    let conversa = await queryOne<any>(
      `SELECT id, etapa FROM conversas WHERE client_id=$1 AND agent_id=$2 AND canal=$3 AND org_id=$4 AND status='ativa' ORDER BY criado_em DESC LIMIT 1`,
      [clientId, agentId, canal, orgId]
    );
    if (conversa) {
      conversaId = conversa.id;
    } else {
      const nova = await queryOne<any>(
        `INSERT INTO conversas (client_id, agent_id, canal, numero_externo, jid, instancia_whatsapp, sender_chip, org_id, status, etapa)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ativa','acolhimento') RETURNING id`,
        [clientId, agentId, canal, phone, jid, instancia, senderChip, orgId]
      );
      conversaId = nova!.id;
    }

    // 4. Salva mensagem do usuário (deduplicação por msg_id_externo)
    if (texto) {
      const jaExiste = msgIdExterno
        ? await queryOne<any>('SELECT id FROM mensagens WHERE msg_id_externo=$1', [msgIdExterno])
        : null;
      if (!jaExiste) {
        const mediaBase64Raw: string | null = req.body?.media_base64 || null;
        const mediaMimeType: string | null  = req.body?.media_mime_type || null;
        const mediaFileName: string | null  = req.body?.media_file_name || null;
        const MAX_BASE64 = 5 * 1024 * 1024;
        const base64ToStore = (mediaBase64Raw && mediaBase64Raw.length <= MAX_BASE64) ? mediaBase64Raw : null;
        const normMediaType = (mt: string | null) =>
          mt?.startsWith('image/') ? 'image' : mt?.startsWith('video/') ? 'video' : mt?.startsWith('audio/') ? 'audio' : 'document';
        const metadata = base64ToStore
          ? JSON.stringify({
              mediaType: normMediaType(mediaMimeType),
              mimeType: mediaMimeType,
              fileName: mediaFileName,
              mediaBase64: base64ToStore,
            })
          : (mediaMimeType
              ? JSON.stringify({ mediaType: normMediaType(mediaMimeType), mimeType: mediaMimeType, fileName: mediaFileName })
              : null);

        if (metadata) {
          await execute(
            `INSERT INTO mensagens (conversa_id, role, conteudo, enviado_por, msg_id_externo, metadata)
             VALUES ($1,'user',$2,'humano',$3,$4::jsonb)`,
            [conversaId, texto, msgIdExterno, metadata]
          );
        } else {
          await execute(
            `INSERT INTO mensagens (conversa_id, role, conteudo, enviado_por, msg_id_externo)
             VALUES ($1,'user',$2,'humano',$3)`,
            [conversaId, texto, msgIdExterno]
          );
        }
      }
    }

    // 5. Salva resposta da IA
    if (resposta) {
      const msgIdExternoResp = req.body?.msg_id_externo_resp || null;
      await execute(
        `INSERT INTO mensagens (conversa_id, role, conteudo, enviado_por, msg_id_externo) VALUES ($1,'agent',$2,'ia',$3)`,
        [conversaId, resposta, msgIdExternoResp]
      );
    }

    // 6. Atualiza ultima_interacao e etapa da conversa
    const novaEtapa: string | null = req.body?.etapa || null;
    const etapaAnterior = conversa ? conversa.etapa : null;

    if (novaEtapa) {
      // Buscar etapa atual se não veio da conversa (conversa pode ser nova, sem etapa anterior carregada)
      const convAtual = conversa
        ? null
        : await queryOne<any>('SELECT etapa FROM conversas WHERE id=$1', [conversaId]);
      const etapaOrigem = etapaAnterior || convAtual?.etapa || 'acolhimento';

      await execute(
        `UPDATE conversas SET ultima_interacao=NOW(), etapa=$1,
          instancia_whatsapp=COALESCE(instancia_whatsapp,$2), sender_chip=COALESCE(sender_chip,$3)
         WHERE id=$4`,
        [novaEtapa, instancia, senderChip, conversaId]
      );

      if (novaEtapa !== etapaOrigem) {
        execute(
          'INSERT INTO funil_conversao (conversa_id, etapa_origem, etapa_destino) VALUES ($1,$2,$3)',
          [conversaId, etapaOrigem, novaEtapa]
        ).catch(e => console.warn('[INTERNAL] ⚠️ funil_conversao:', e.message));
      }
    } else {
      await execute(
        `UPDATE conversas SET ultima_interacao=NOW(), instancia_whatsapp=COALESCE(instancia_whatsapp,$1), sender_chip=COALESCE(sender_chip,$2) WHERE id=$3`,
        [instancia, senderChip, conversaId]
      );
    }

    // 7. Atualiza perfil_pet e clientes com dados_extraidos
    const d: Record<string, any> = req.body?.dados_extraidos || {};
    if (Object.keys(d).length > 0) {
      // Atualiza nome do cliente se fornecido
      if (d.nc) {
        execute(
          `UPDATE clientes SET nome=COALESCE(NULLIF(nome,''),$1) WHERE id=$2`,
          [d.nc, clientId]
        ).catch(e => console.warn('[INTERNAL] ⚠️ update clientes.nome:', e.message));
      }

      // Campos do perfil_pet mapeados a partir dos dados extraídos pelo LLM
      const perfilSet: Record<string, any> = {};
      if (d.np) perfilSet.nome         = d.np;
      if (d.ep) perfilSet.especie      = d.ep;
      if (d.rp) perfilSet.raca         = d.rp;
      if (d.ip) perfilSet.idade_anos   = parseFloat(String(d.ip)) || null;
      if (d.sx) perfilSet.sexo         = d.sx;
      // ca = castrado: aceita boolean, 0/1 ou texto sim/não
      if (d.ca !== undefined && d.ca !== null) {
        perfilSet.castrado = (d.ca === 1 || d.ca === true || d.ca === '1' || /^sim$/i.test(String(d.ca)));
      }
      if (d.cp) perfilSet.cep          = d.cp;
      if (d.em) perfilSet.email        = d.em;
      if (d.cf) perfilSet.cpf          = d.cf;
      if (d.dn) perfilSet.data_nascimento = d.dn;
      if (d.pi) {
        execute(
          `UPDATE conversas SET plano_recomendado=COALESCE(plano_recomendado,$1) WHERE id=$2`,
          [d.pi, conversaId]
        ).catch(() => {});
      }
      // Valor negociado (vo): persiste o valor combinado com o cliente para que
      // dispararCotacao() consiga selecionar a CampanhasCoberturasTabelasId correta (Req 4).
      const voRaw = d.vo ?? d.valor_ofertado;
      if (voRaw != null && voRaw !== '') {
        const voNum = typeof voRaw === 'number'
          ? voRaw
          : parseFloat(String(voRaw).replace(',', '.'));
        if (!isNaN(voNum) && voNum > 0) {
          execute(
            `UPDATE conversas SET valor_ofertado=$1 WHERE id=$2`,
            [voNum, conversaId]
          ).catch(e => console.warn('[INTERNAL] ⚠️ update conversas.valor_ofertado:', e.message));
        }
      }

      if (Object.keys(perfilSet).length > 0) {
        const cols = Object.keys(perfilSet);
        const setClauses = cols.map(c => `${c} = COALESCE($${cols.indexOf(c) + 2}, ${c})`).join(', ');
        const jaExiste = await queryOne<any>('SELECT id FROM perfil_pet WHERE client_id=$1', [clientId]);
        if (jaExiste) {
          execute(
            `UPDATE perfil_pet SET ${setClauses}, atualizado_em=NOW() WHERE client_id=$1`,
            [clientId, ...Object.values(perfilSet)]
          ).catch(e => console.warn('[INTERNAL] ⚠️ update perfil_pet:', e.message));
        } else {
          const placeholders = cols.map((_, i) => `$${i + 2}`).join(', ');
          execute(
            `INSERT INTO perfil_pet (client_id, ${cols.join(', ')}, atualizado_em) VALUES ($1, ${placeholders}, NOW())`,
            [clientId, ...Object.values(perfilSet)]
          ).catch(e => console.warn('[INTERNAL] ⚠️ insert perfil_pet:', e.message));
        }
      }
    }

    // 8. Registra custo IA na tabela custos_ia (tokens vindos do agent-ai)
    const custo = req.body?.custo;
    if (custo && custo.input_tokens > 0) {
      const custoUsd = ((custo.input_tokens * 0.0008) + (custo.output_tokens * 0.004)) / 1000;
      execute(
        `INSERT INTO custos_ia (conversa_id, agent_id, modelo, input_tokens, output_tokens, custo_usd)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [conversaId, agentId, custo.model || 'claude-haiku', custo.input_tokens, custo.output_tokens, custoUsd]
      ).catch(e => console.warn('[INTERNAL] ⚠️ custos_ia insert:', e.message));
    }

    // 9. Calcula e persiste score da conversa (0–10)
    //    Baseado na etapa (funil) + bônus por engajamento (msgs do cliente)
    const ETAPA_SCORE: Record<string, number> = {
      acolhimento: 0, qualificacao: 1, apresentacao_planos: 3,
      objecao: 3, negociacao: 5, pre_fechamento: 7,
      fechamento: 8, venda_fechada: 10, pago: 10,
    };
    const etapaEfetiva = novaEtapa || conversa?.etapa || 'acolhimento';
    const baseEtapa = ETAPA_SCORE[etapaEfetiva] ?? 0;
    queryOne<any>(
      `SELECT COUNT(*) AS cnt FROM mensagens WHERE conversa_id=$1 AND role='user'`,
      [conversaId]
    ).then(row => {
      const msgCount  = parseInt(row?.cnt || '0', 10);
      const scoreRaw  = Math.min(10, baseEtapa + Math.min(2, msgCount * 0.25));
      const scoreCalc = Math.round(scoreRaw * 10) / 10;
      execute(`UPDATE conversas SET score=$1 WHERE id=$2`, [scoreCalc, conversaId])
        .catch(e => console.warn('[INTERNAL] ⚠️ score update:', e.message));
    }).catch(() => {});

    // 10. Escalação para humano (negociação fora do limite de preço)
    if (req.body?.silenciar_ia === true) {
      execute(
        `UPDATE conversas SET ia_silenciada = true, etapa = 'negociacao' WHERE id = $1`,
        [conversaId]
      ).catch(e => console.warn('[INTERNAL] ⚠️ silenciar_ia:', e.message));
      console.log(`[INTERNAL] 🙋 Conversa ${conversaId} escalada para humano (negociação de preço)`);
    }

    console.log(`[INTERNAL] ✅ Interação salva — conversa=${conversaId} etapa=${novaEtapa || '(sem mudança)'} msgs=${texto ? 1 : 0}+${resposta ? 1 : 0} custo=${custo ? `${custo.input_tokens}+${custo.output_tokens}tk` : 'n/a'}`);

  } catch (e: any) {
    console.error('[INTERNAL] ❌ Erro ao salvar interação:', e.message);
  } finally {
    // pg_notify dispara o socket event no gateway via PostgreSQL LISTEN/NOTIFY.
    // Mais confiável que HTTP: mesmo banco, zero hops de rede extra.
    if (conversaId) {
      execute(
        "SELECT pg_notify('chat_nova_mensagem', $1)",
        [JSON.stringify({ conversa_id: conversaId, phone, nome: nome || '', msg_cliente: texto || null, msg_mari: resposta || null })],
      ).catch(e => console.warn('[CRM/salvar-interacao] pg_notify:', e.message));
    }
  }
});

// Salva mensagem enviada pelo humano (fromMe=true) quando a IA está silenciada.
// Só persiste se a conversa tiver ia_silenciada=true — evita duplicar mensagens da IA.
internalRouter.post('/salvar-msg-agente-humano', async (req, res) => {
  if (!checkInternalSecret(req, res)) return;
  const { phone, canal, agentSlug, texto, msgIdExterno } = req.body || {};
  if (!phone || !canal || !texto) {
    res.status(400).json({ erro: 'phone, canal e texto são obrigatórios' });
    return;
  }
  res.json({ ok: true });

  try {
    const agente = await queryOne<any>('SELECT id FROM agentes WHERE slug=$1 LIMIT 1', [agentSlug || 'mari']);
    if (!agente) { console.warn(`[INTERNAL/humano] agente não encontrado: ${agentSlug}`); return; }

    const conversa = await queryOne<any>(
      `SELECT id, ia_silenciada FROM conversas
       WHERE numero_externo=$1 AND canal=$2 AND agent_id=$3 AND status='ativa'
       ORDER BY criado_em DESC LIMIT 1`,
      [phone, canal, agente.id]
    );
    if (!conversa) { console.log(`[INTERNAL/humano] nenhuma conversa ativa para ${phone}/${canal}`); return; }
    if (!conversa.ia_silenciada) return; // IA ativa: mensagem já salva pelo pipeline

    const conversaId: string = conversa.id;

    if (msgIdExterno) {
      const jaExiste = await queryOne<any>('SELECT id FROM mensagens WHERE msg_id_externo=$1', [msgIdExterno]);
      if (jaExiste) { console.log(`[INTERNAL/humano] duplicado: ${msgIdExterno}`); return; }
    }

    await execute(
      `INSERT INTO mensagens (conversa_id, role, conteudo, enviado_por, msg_id_externo)
       VALUES ($1,'agent',$2,'humano',$3)`,
      [conversaId, texto, msgIdExterno || null]
    );
    await execute(`UPDATE conversas SET ultima_interacao=NOW() WHERE id=$1`, [conversaId]);

    console.log(`[INTERNAL/humano] ✅ Msg do humano salva — conversa=${conversaId}`);

    execute(
      "SELECT pg_notify('chat_nova_mensagem', $1)",
      [JSON.stringify({ conversa_id: conversaId, phone, nome: '', msg_cliente: null, msg_mari: texto })],
    ).catch(e => console.warn('[CRM/salvar-msg-agente-humano] pg_notify:', e.message));
  } catch (e: any) {
    console.error('[INTERNAL/humano] ❌ Erro:', e.message);
  }
});

internalRouter.post('/reset-contato', async (req, res) => {
  if (!checkInternalSecret(req, res)) return;

  const phone = String(req.body?.phone || '').trim();
  const canal = String(req.body?.canal || 'whatsapp').trim();
  const agentSlug = String(req.body?.agentSlug || 'mari').trim();

  if (!phone) {
    res.status(400).json({ erro: 'phone obrigatório' });
    return;
  }

  try {
    const agente = await queryOne<any>('SELECT org_id FROM agentes WHERE slug=$1 LIMIT 1', [agentSlug]);
    const orgId = agente?.org_id || '00000000-0000-0000-0000-000000000000';
    const removed = await resetarClientePorTelefone(orgId, canal, phone);
    console.log(`[INTERNAL] ♻️ Reset contato phone=${phone} canal=${canal} agent=${agentSlug} removed=${removed}`);
    res.json({ ok: true, removed });
  } catch (e: any) {
    console.error('[INTERNAL] ❌ Falha ao resetar contato:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

internalRouter.post('/atualizar-msg-id-externo', async (req, res) => {
  if (!checkInternalSecret(req, res)) return;
  const { phone, canal, msg_id_externo } = req.body || {};
  if (!phone || !canal || !msg_id_externo) {
    res.status(400).json({ erro: 'phone, canal e msg_id_externo são obrigatórios' }); return;
  }
  try {
    await execute(
      `UPDATE mensagens SET msg_id_externo = $1
       WHERE id = (
         SELECT m.id FROM mensagens m
         JOIN conversas c ON c.id = m.conversa_id
         WHERE c.numero_externo = $2 AND c.canal = $3 AND c.status = 'ativa'
           AND m.role = 'agent' AND m.msg_id_externo IS NULL
         ORDER BY m.timestamp DESC
         LIMIT 1
       )`,
      [msg_id_externo, phone, canal]
    );
    res.json({ ok: true });
  } catch (e: any) {
    console.error('[INTERNAL] ❌ atualizar-msg-id-externo:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

internalRouter.get('/channel-config', async (req, res) => {
  if (!checkInternalSecret(req, res)) return;
  try {
    const instances = await query<any>(
      `SELECT cw.instancia_nome, cw.instancia_label, cw.ddd_prefixos, cw.chip_fallback,
              cw.provider, cw.evolution_url, cw.evolution_api_key,
              a.slug AS agent_slug
       FROM canais_whatsapp cw JOIN agentes a ON a.id = cw.agent_id
       WHERE cw.ativo = TRUE AND a.ativo = TRUE`
    );
    const bots = await query<any>(
      `SELECT ct.bot_token, ct.bot_nome, a.slug AS agent_slug
       FROM canais_telegram ct JOIN agentes a ON a.id = ct.agent_id
       WHERE ct.ativo = TRUE AND a.ativo = TRUE`
    );
    res.json({ ok: true, instances, telegram_bots: bots });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});
