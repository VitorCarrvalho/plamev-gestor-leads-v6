import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

const SECRET = process.env.JWT_SECRET_DASH_V5 || 'dashv5-secret';

export function autenticar(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.slice(7);
  if (!token) { res.status(401).json({ erro: 'Token ausente' }); return; }
  try { (req as any).user = jwt.verify(token, SECRET); next(); }
  catch { res.status(401).json({ erro: 'Token inválido' }); }
}
