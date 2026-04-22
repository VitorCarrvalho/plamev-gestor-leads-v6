/**
 * hooks/useNotifications.ts — Web Notifications API
 * Pede permissão e dispara alertas quando evento Socket indica lead quente.
 */
import { useEffect, useState } from 'react';
import { useSocket } from './useSocket';

export function useNotifications(enabled: boolean = true) {
  const socket = useSocket();
  const [permissao, setPermissao] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  );

  useEffect(() => {
    if (!enabled) return;
    if (typeof Notification === 'undefined') return;
    if (permissao === 'default') {
      Notification.requestPermission().then(setPermissao);
    }
  }, [enabled, permissao]);

  useEffect(() => {
    if (!enabled || permissao !== 'granted') return;
    const handler = (data: any) => {
      // Dispara apenas para leads identificados ou quentes
      const nome = data?.nome_cliente || data?.nome || data?.phone;
      if (!nome) return;
      try {
        const n = new Notification('📥 Nova mensagem — Mari Plamev', {
          body: `${nome}: ${(data.msg_cliente || data.conteudo || '').slice(0, 100)}`,
          tag: `conv-${data.conversa_id || Math.random()}`,
          icon: '/favicon.ico',
        });
        n.onclick = () => window.focus();
        setTimeout(() => n.close(), 6000);
      } catch {}
    };
    socket.on('nova_msg', handler);
    return () => { socket.off('nova_msg', handler); };
  }, [enabled, permissao, socket]);

  const pedirPermissao = () => {
    if (typeof Notification === 'undefined') return;
    Notification.requestPermission().then(setPermissao);
  };

  return { permissao, pedirPermissao };
}
