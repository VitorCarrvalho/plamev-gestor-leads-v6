/**
 * routes/sandbox.ts — Chat Simulator (sandbox autônomo)
 *
 * Substituiu o proxy para Intelligence V1 (porta 3471) que não existia.
 * Agora chama o Anthropic diretamente via sandbox-engine.ts.
 */
import { Router } from 'express';
import { autenticar } from '../middleware/auth';
import { query, queryOne } from '../config/db';
import { processarMensagem } from '../services/sandbox-engine';
import { env } from '../config/env';

const router = Router();

const PLAMEV_CEP_URL = 'https://service.plamev.com.br/Credenciados/BuscarRedeCredenciadaPorLocalidade';
const ETAPAS = [
  'acolhimento', 'qualificacao', 'apresentacao_planos',
  'validacao_cep', 'negociacao', 'objecao', 'pre_fechamento', 'fechamento',
];

// ── POST /chat/mensagem — processa mensagem na Mari ───────────────────────────
router.post('/chat/mensagem', autenticar, async (req, res) => {
  try {
    const result = await processarMensagem(req.body);
    res.json(result);
  } catch (e: any) {
    console.error('[SANDBOX/chat] Erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// ── GET /chat/etapas — lista etapas do funil ──────────────────────────────────
router.get('/chat/etapas', autenticar, (_req, res) => {
  res.json({ etapas: ETAPAS });
});

// ── GET /cenarios — lista cenários salvos ─────────────────────────────────────
router.get('/cenarios', autenticar, async (_req, res) => {
  try {
    const rows = await query<any>(
      `SELECT id, nome, descricao, etapa, canal, criado_em
       FROM sandbox_cenarios ORDER BY criado_em DESC LIMIT 50`
    );
    res.json({ ok: true, cenarios: rows });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── POST /cenarios — salva cenário ────────────────────────────────────────────
router.post('/cenarios', autenticar, async (req, res) => {
  const { nome, descricao, etapa, canal, perfil_lead, mensagens } = req.body || {};
  if (!nome?.trim()) { res.status(400).json({ erro: 'nome é obrigatório' }); return; }
  try {
    const row = await queryOne<any>(
      `INSERT INTO sandbox_cenarios (nome, descricao, etapa, canal, perfil_lead, mensagens)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
       RETURNING id, nome, criado_em`,
      [
        nome.trim(), descricao || null,
        etapa || 'acolhimento', canal || 'whatsapp',
        JSON.stringify(perfil_lead || {}),
        JSON.stringify(mensagens  || []),
      ]
    );
    res.json({ ok: true, cenario: row });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

// ── POST /cep — consulta rede credenciada Plamev ──────────────────────────────
router.post('/cep', autenticar, async (req, res) => {
  const cepLimpo = String(req.body?.cep || '').replace(/\D/g, '');

  if (!/^\d{8}$/.test(cepLimpo)) {
    res.json({ cobertura: false, clinicas: [], texto: null, cep: cepLimpo });
    return;
  }

  const token = env.plamevToken;
  if (!token) {
    res.json({ cobertura: false, clinicas: [], texto: null, cep: cepLimpo,
               aviso: 'PLAMEV_SERVICE_AUTHORIZATION_TOKEN não configurado' });
    return;
  }

  try {
    const apiRes = await fetch(PLAMEV_CEP_URL, {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ Cep: cepLimpo, Raio: '50' }),
      signal: AbortSignal.timeout(10_000),
    });

    const lista: any[] = apiRes.ok
      ? await apiRes.json().catch(() => [])
      : [];

    lista.sort((a, b) => parseFloat(a.DistanciaKm || '0') - parseFloat(b.DistanciaKm || '0'));

    const cobertura = lista.length > 0;
    let texto: string | null = null;

    if (cobertura) {
      const top3 = lista.slice(0, 3);
      const nomeCli = (c: any) =>
        c.CredenciadosNomeCredenciado?.trim() ||
        c.IndividuosNomeFantasia?.trim() ||
        c.IndividuosNome?.trim() || 'Clinica';
      const distFmt = (c: any) => {
        const d = parseFloat(c.DistanciaKm);
        return d < 1 ? `${(d * 1000).toFixed(0)}m` : `${d.toFixed(1)}km`;
      };
      texto =
        `Encontrei ${top3.length} clinica${top3.length !== 1 ? 's' : ''} proxima${top3.length !== 1 ? 's' : ''} ao seu CEP:\n` +
        top3.map((c, i) => `${i + 1}. *${nomeCli(c)}* - ${c.IndividuosEnderecosBairro || ''} (${distFmt(c)})`).join('\n');
    }

    res.json({ cobertura, clinicas: lista, texto, cep: cepLimpo });
  } catch (e: any) {
    console.error('[SANDBOX/cep] Erro:', e.message);
    res.json({ cobertura: false, clinicas: [], texto: null, cep: cepLimpo });
  }
});

export default router;
