import { Router } from 'express';
import { autenticar } from '../middleware/auth';
import { queryOne, execute } from '../config/db';
import { pool } from '../config/db';
import crypto from 'crypto';

const router = Router();

// ── Migration inline ─────────────────────────────────────────────
// Executada uma vez ao carregar o router (idempotente via IF NOT EXISTS)
(async () => {
  try {
    await pool.query(`
      ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT true;
      ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ultimo_login TIMESTAMPTZ;
      ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ultima_atividade TIMESTAMPTZ;
      ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ultima_acao TEXT;
      ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS criado_em TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS senha_temp TEXT;
    `);

    // Seed: garante que o admin padrão (via env) existe no banco após a migração.
    // Só insere se não existir nenhum usuário com perfil 'admin'.
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'geta.hubcenter@gmail.com';
    const ADMIN_PASS  = process.env.ADMIN_PASS  || 'Plamev@2026';
    await pool.query(`
      INSERT INTO usuarios (nome, email, senha_hash, perfil, ativo, criado_em)
      SELECT 'Admin', $1, crypt($2, gen_salt('bf', 10)), 'admin', true, NOW()
      WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE email = $1)
    `, [ADMIN_EMAIL, ADMIN_PASS]);

    console.log('[USUARIOS] ✅ Colunas verificadas e seed de admin executado.');
  } catch (e: any) {
    console.warn('[USUARIOS] ⚠️ Não foi possível executar migration inline:', e.message);
  }
})();

// ── GET /api/usuarios ────────────────────────────────────────────
// Lista todos os usuários
router.get('/', autenticar, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, nome, email, perfil, foto_url, ativo,
             ultimo_login, ultima_atividade, ultima_acao, criado_em
      FROM usuarios
      ORDER BY criado_em DESC
    `);
    res.json({ ok: true, usuarios: rows });
  } catch (e: any) {
    res.status(500).json({ erro: e.message });
  }
});

// ── POST /api/usuarios ───────────────────────────────────────────
// Cria novo usuário
router.post('/', autenticar, async (req, res) => {
  const { nome, email, senha, perfil } = req.body || {};
  if (!nome || !email || !senha) {
    res.status(400).json({ erro: 'nome, email e senha são obrigatórios' });
    return;
  }
  try {
    const existente = await queryOne<any>('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (existente) {
      res.status(409).json({ erro: 'Já existe um usuário com este e-mail' });
      return;
    }
    const result = await pool.query(
      `INSERT INTO usuarios (nome, email, senha_hash, perfil, ativo, criado_em)
       VALUES ($1, $2, crypt($3, gen_salt('bf', 10)), $4, true, NOW())
       RETURNING id, nome, email, perfil, ativo, criado_em`,
      [nome, email, senha, perfil || 'operador']
    );
    res.status(201).json({ ok: true, usuario: result.rows[0] });
  } catch (e: any) {
    res.status(500).json({ erro: e.message });
  }
});

// ── PATCH /api/usuarios/:id ──────────────────────────────────────
// Edita nome, email e/ou perfil
router.patch('/:id', autenticar, async (req, res) => {
  const { id } = req.params;
  const { nome, email, perfil } = req.body || {};
  try {
    const usuario = await queryOne<any>('SELECT id FROM usuarios WHERE id = $1', [id]);
    if (!usuario) { res.status(404).json({ erro: 'Usuário não encontrado' }); return; }

    await execute(
      `UPDATE usuarios
       SET nome   = COALESCE($1, nome),
           email  = COALESCE($2, email),
           perfil = COALESCE($3, perfil)
       WHERE id = $4`,
      [nome || null, email || null, perfil || null, id]
    );
    const atualizado = await queryOne<any>(
      'SELECT id, nome, email, perfil, ativo, criado_em FROM usuarios WHERE id = $1', [id]
    );
    res.json({ ok: true, usuario: atualizado });
  } catch (e: any) {
    res.status(500).json({ erro: e.message });
  }
});

// ── PATCH /api/usuarios/:id/status ──────────────────────────────
// Ativa ou desativa usuário
router.patch('/:id/status', autenticar, async (req, res) => {
  const { id } = req.params;
  const { ativo } = req.body;
  if (typeof ativo !== 'boolean') {
    res.status(400).json({ erro: 'Campo "ativo" (boolean) é obrigatório' }); return;
  }
  try {
    const usuario = await queryOne<any>('SELECT id FROM usuarios WHERE id = $1', [id]);
    if (!usuario) { res.status(404).json({ erro: 'Usuário não encontrado' }); return; }
    await execute('UPDATE usuarios SET ativo = $1 WHERE id = $2', [ativo, id]);
    res.json({ ok: true, ativo });
  } catch (e: any) {
    res.status(500).json({ erro: e.message });
  }
});

// ── POST /api/usuarios/:id/reset-senha ──────────────────────────
// Gera e salva uma nova senha temporária aleatória
router.post('/:id/reset-senha', autenticar, async (req, res) => {
  const { id } = req.params;
  try {
    const usuario = await queryOne<any>('SELECT id, nome, email FROM usuarios WHERE id = $1', [id]);
    if (!usuario) { res.status(404).json({ erro: 'Usuário não encontrado' }); return; }

    // Gera senha temporária segura: 3 palavras separadas por traço + número
    const senhaTemp = `${randomWord()}-${randomWord()}-${Math.floor(1000 + Math.random() * 9000)}`;

    await execute(
      `UPDATE usuarios
       SET senha_hash = crypt($1, gen_salt('bf', 10)),
           senha_temp = $1
       WHERE id = $2`,
      [senhaTemp, id]
    );
    res.json({ ok: true, senha_temporaria: senhaTemp });
  } catch (e: any) {
    res.status(500).json({ erro: e.message });
  }
});

// ── DELETE /api/usuarios/:id ─────────────────────────────────────
// Remove usuário permanentemente
router.delete('/:id', autenticar, async (req, res) => {
  const { id } = req.params;
  try {
    const usuario = await queryOne<any>('SELECT id FROM usuarios WHERE id = $1', [id]);
    if (!usuario) { res.status(404).json({ erro: 'Usuário não encontrado' }); return; }
    await execute('DELETE FROM usuarios WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ erro: e.message });
  }
});

// ── GET /api/usuarios/:id/atividade ─────────────────────────────
// Histórico de atividade do usuário
router.get('/:id/atividade', autenticar, async (req, res) => {
  const { id } = req.params;
  try {
    const usuario = await queryOne<any>(
      `SELECT id, nome, email, ultimo_login, ultima_atividade, ultima_acao, criado_em
       FROM usuarios WHERE id = $1`,
      [id]
    );
    if (!usuario) { res.status(404).json({ erro: 'Usuário não encontrado' }); return; }
    res.json({ ok: true, atividade: usuario });
  } catch (e: any) {
    res.status(500).json({ erro: e.message });
  }
});

// ── Helper ───────────────────────────────────────────────────────
function randomWord(): string {
  const words = [
    'coral', 'nexo', 'faro', 'alto', 'mar', 'sol', 'rio', 'pico',
    'onda', 'vale', 'mina', 'arco', 'nova', 'vela', 'ceu', 'lago',
  ];
  return words[Math.floor(Math.random() * words.length)];
}

export default router;
