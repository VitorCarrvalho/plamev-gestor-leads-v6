/**
 * routes/config-agentes.ts — CRUD dinâmico de agentes, prompts e canais.
 * Montado em /api/config/agentes (autenticado) e /api/internal (secret header).
 */
import { Router } from 'express';
import { autenticar, soAdmin } from '../middleware/auth';
import { query, execute, queryOne } from '../config/db';

export const agenteRouter = Router();

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

internalRouter.get('/channel-config', async (req, res) => {
  const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'plamev-internal';
  if (req.headers['x-internal-secret'] !== INTERNAL_SECRET) {
    res.status(401).json({ erro: 'Não autorizado' });
    return;
  }
  try {
    const instances = await query<any>(
      `SELECT cw.instancia_nome, cw.instancia_label, cw.ddd_prefixos, cw.chip_fallback, a.slug AS agent_slug
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
