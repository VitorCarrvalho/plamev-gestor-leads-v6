import { Router } from 'express';
import { gerarJWT, verificarJWT, autenticar } from '../middleware/auth';
import { queryOne, execute } from '../config/db';

const router = Router();

router.post('/login', async (req, res) => {
  const { email, senha } = req.body || {};
  const OK_EMAIL = process.env.ADMIN_EMAIL || 'geta.hubcenter@gmail.com';
  const OK_PASS  = process.env.ADMIN_PASS  || 'Plamev@2026';

  if (email === OK_EMAIL && senha === OK_PASS) {
    const usuario = await queryOne<any>(
      `SELECT id, nome, email, perfil, foto_url, preferencias FROM usuarios WHERE email = $1`, [email]
    ).catch(() => null);
    const nome = usuario?.nome || 'Admin';
    const foto_url = usuario?.foto_url || null;
    const preferencias = usuario?.preferencias || {};
    const token = gerarJWT({ id: usuario?.id || 1, email, nome, role: 'admin' });
    res.json({ token, email, role: 'admin', nome, foto_url, preferencias });
    return;
  }
  res.status(401).json({ erro: 'Credenciais inválidas' });
});

router.get('/me', autenticar, async (req, res) => {
  const user = (req as any).user;
  try {
    const usuario = await queryOne<any>(
      `SELECT id, nome, email, perfil, foto_url, preferencias FROM usuarios WHERE email = $1`,
      [user.email]
    );
    res.json({ ok: true, user: { ...user, ...usuario } });
  } catch {
    res.json({ ok: true, user });
  }
});

router.patch('/profile', autenticar, async (req, res) => {
  const user = (req as any).user;
  const { nome, foto_url } = req.body || {};
  try {
    await execute(
      `UPDATE usuarios SET nome = COALESCE($1, nome), foto_url = COALESCE($2, foto_url) WHERE email = $3`,
      [nome || null, foto_url || null, user.email]
    );
    const updated = await queryOne<any>(
      `SELECT nome, email, foto_url, preferencias FROM usuarios WHERE email = $1`, [user.email]
    );
    res.json({ ok: true, user: updated });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

router.patch('/password', autenticar, async (req, res) => {
  const user = (req as any).user;
  const { senha_atual, nova_senha } = req.body || {};
  if (!senha_atual || !nova_senha) {
    res.status(400).json({ erro: 'senha_atual e nova_senha são obrigatórios' }); return;
  }
  try {
    const row = await queryOne<any>(
      `SELECT id FROM usuarios WHERE email = $1 AND senha_hash = crypt($2, senha_hash)`,
      [user.email, senha_atual]
    );
    if (!row) { res.status(401).json({ erro: 'Senha atual incorreta' }); return; }
    await execute(
      `UPDATE usuarios SET senha_hash = crypt($1, gen_salt('bf', 10)) WHERE email = $2`,
      [nova_senha, user.email]
    );
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

router.patch('/notificacoes', autenticar, async (req, res) => {
  const user = (req as any).user;
  const prefs = req.body || {};
  try {
    await execute(
      `UPDATE usuarios SET preferencias = preferencias || $1::jsonb WHERE email = $2`,
      [JSON.stringify(prefs), user.email]
    );
    const updated = await queryOne<any>(
      `SELECT preferencias FROM usuarios WHERE email = $1`, [user.email]
    );
    res.json({ ok: true, preferencias: updated?.preferencias || {} });
  } catch (e: any) { res.status(500).json({ erro: e.message }); }
});

export default router;
