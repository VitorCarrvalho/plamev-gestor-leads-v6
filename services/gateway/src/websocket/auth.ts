import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET_DASH_V5 || 'dashv5-secret';

export function validarTokenSocket(token: string): any | null {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}
