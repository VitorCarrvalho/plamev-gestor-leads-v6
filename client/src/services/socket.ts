/**
 * services/socket.ts — cliente Socket.IO singleton do Dashboard V5.
 */
import { io, Socket } from 'socket.io-client';
import { getTokenForSocket } from './api';

let socketInstance: Socket | null = null;

// Lazy singleton — cria UMA vez por sessão, socket.io cuida de reconectar.
// Bug corrigido 21/04/2026: antes recriávamos o socket quando `.connected`
// era transiente false (entre reconexões), gerando sockets stale e emits
// perdidos. Agora só criamos se instance ainda não existe — deixa socket.io
// fazer reconnect interno (que mantém os listeners e o queueing de emits).
export function getSocket(): Socket {
  if (!socketInstance) {
    const token = getTokenForSocket();
    socketInstance = io('/', {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
    });
    socketInstance.on('connect',       () => console.log('[socket] conectado', socketInstance?.id));
    socketInstance.on('disconnect',    (r: any) => console.log('[socket] desconectado', r));
    socketInstance.on('connect_error', (e: any) => console.warn('[socket] erro', e.message));
  }
  return socketInstance;
}

export function disconnectSocket() {
  socketInstance?.disconnect();
  socketInstance = null;
}
