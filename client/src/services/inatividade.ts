/**
 * inatividade.ts — Logout automático por inatividade (30 min)
 * Monitora mouse, teclado e cliques. Reseta o timer a cada interação.
 */

const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutos
const AVISO_MS   = 29 * 60 * 1000; // aviso 1 min antes

let timerLogout: ReturnType<typeof setTimeout> | null = null;
let timerAviso:  ReturnType<typeof setTimeout> | null = null;
let onLogout: (() => void) | null = null;
let onAviso:  (() => void) | null = null;

function resetar() {
  if (timerLogout) clearTimeout(timerLogout);
  if (timerAviso)  clearTimeout(timerAviso);

  timerAviso = setTimeout(() => {
    onAviso?.();
  }, AVISO_MS);

  timerLogout = setTimeout(() => {
    onLogout?.();
  }, TIMEOUT_MS);
}

export function iniciarMonitorInatividade(cbLogout: () => void, cbAviso?: () => void) {
  onLogout = cbLogout;
  onAviso  = cbAviso || null;

  const eventos = ['mousedown','mousemove','keydown','scroll','touchstart','click'];
  eventos.forEach(e => document.addEventListener(e, resetar, { passive: true }));
  resetar(); // iniciar timer
}

export function pararMonitorInatividade() {
  if (timerLogout) clearTimeout(timerLogout);
  if (timerAviso)  clearTimeout(timerAviso);
  const eventos = ['mousedown','mousemove','keydown','scroll','touchstart','click'];
  eventos.forEach(e => document.removeEventListener(e, resetar));
}
