import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

const SECRET = process.env.JWT_SECRET_DASH_V5 || 'dashv5-secret';

export function autenticar(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.slice(7);
  if (!token) { res.status(401).json({ erro: 'Token ausente' }); return; }
  try { (req as any).user = jwt.verify(token, SECRET); next(); }
  catch { res.status(401).json({ erro: 'Token inválido' }); }
}

export function soAdmin(req: Request, res: Response, next: NextFunction): void {
  autenticar(req, res, () => {
    if ((req as any).user?.role !== 'admin') {
      res.status(403).json({ erro: 'Requer admin' });
      return;
    }
    next();
  });
}

export function verificarJWT(token: string): any {
  return jwt.verify(token, SECRET);
}

export function gerarJWT(payload: object): string {
  return jwt.sign(payload, SECRET, { expiresIn: '30d' });
}

/** Valida token Socket.IO — retorna payload ou null */
export function validarTokenSocket(token: string): any | null {
  try { return jwt.verify(token, SECRET); }
  catch { return null; }
}
