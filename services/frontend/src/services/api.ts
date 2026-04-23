/**
 * services/api.ts — HTTP client do Dashboard V5.
 * Em produção aponta para o Gateway via VITE_API_URL.
 * Em dev usa proxy do Vite (paths relativos).
 */
const TOKEN_KEY = 'dash_v5_token';
// Em produção, VITE_API_URL vem do env-config.js gerado em runtime pelo entrypoint.sh
// Em dev, usa path relativo (proxy do Vite)
const BASE_URL = (window as any).__ENV__?.VITE_API_URL
  || (import.meta as any).env?.VITE_API_URL
  || '';

function getToken() { return localStorage.getItem(TOKEN_KEY); }

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.erro || `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  get:    <T>(path: string)               => request<T>(path),
  post:   <T>(path: string, body: object) => request<T>(path, { method: 'POST',   body: JSON.stringify(body) }),
  patch:  <T>(path: string, body: object) => request<T>(path, { method: 'PATCH',  body: JSON.stringify(body) }),
  put:    <T>(path: string, body: object) => request<T>(path, { method: 'PUT',    body: JSON.stringify(body) }),
  delete: <T>(path: string)               => request<T>(path, { method: 'DELETE' }),
};

export async function login(email: string, senha: string): Promise<string> {
  const { token } = await api.post<{ token: string }>('/auth/login', { email, senha });
  localStorage.setItem(TOKEN_KEY, token);
  return token;
}

export function logout()     { localStorage.removeItem(TOKEN_KEY); }
export function isLoggedIn() { return !!getToken(); }
export function getTokenForSocket() { return getToken(); }

export function getUser(): any {
  const t = getToken();
  if (!t) return null;
  try {
    const payload = JSON.parse(atob(t.split('.')[1]));
    if (payload.exp && payload.exp * 1000 < Date.now()) { logout(); return null; }
    return payload;
  } catch { return null; }
}
export function getRole(): string { return getUser()?.role || 'editor'; }
export function isAdmin(): boolean { return getRole() === 'admin'; }
