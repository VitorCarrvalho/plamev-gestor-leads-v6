/**
 * hooks/useSocket.ts — hook auxiliar para registrar/desregistrar handlers.
 */
import { useEffect } from 'react';
import { getSocket } from '../services/socket';

export function useSocket() {
  const socket = getSocket();
  return socket;
}

export function useSocketEvent<T = any>(event: string, handler: (data: T) => void) {
  useEffect(() => {
    const socket = getSocket();
    socket.on(event, handler);
    return () => { socket.off(event, handler); };
  }, [event, handler]);
}
