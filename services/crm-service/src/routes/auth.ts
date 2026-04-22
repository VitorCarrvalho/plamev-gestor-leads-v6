/**
 * routes/auth.ts — login admin com email+senha via env.
 */
import { Router } from 'express';
import { gerarJWT, verificarJWT } from '../middleware/auth';

const router = Router();

router.post('/login', (req, res) => {
  const { email, senha } = req.body || {};
  const OK_EMAIL = process.env.ADMIN_EMAIL || 'geta.hubcenter@gmail.com';
  const OK_PASS  = process.env.ADMIN_PASS  || 'Plamev@2026';

  if (email === OK_EMAIL && senha === OK_PASS) {
    const token = gerarJWT({ id: 1, email, nome: 'Admin', role: 'admin' });
    res.json({ token, email, role: 'admin', nome: 'Admin' });
    return;
  }
  res.status(401).json({ erro: 'Credenciais inválidas' });
});

router.get('/me', (req, res) => {
  const token = req.headers.authorization?.slice(7);
  if (!token) { res.status(401).json({ erro: 'Token ausente' }); return; }
  try { res.json({ ok: true, user: verificarJWT(token) }); }
  catch { res.status(401).json({ erro: 'Token inválido' }); }
});

export default router;
