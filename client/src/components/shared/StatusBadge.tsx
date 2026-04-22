import React from 'react';
import { Badge, BadgeProps } from '@/components/ui/badge';

const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  ativo: 'green', ok: 'green', aprovado: 'green', aplicado: 'green', online: 'green',
  conectado: 'green', open: 'green',
  inativo: 'red', erro: 'red', descartado: 'red', offline: 'red', disconnected: 'red',
  pendente: 'purple', analisando: 'purple',
  classificado: 'blue', info: 'blue',
  alto: 'red', major: 'red',
  medio: 'amber', warn: 'amber', connecting: 'amber',
  baixo: 'green', patch: 'green',
  minor: 'default',
};

export const StatusBadge: React.FC<{ status: string; className?: string }> = ({ status, className }) => {
  const variant = STATUS_VARIANT[status.toLowerCase()] || 'outline';
  return <Badge variant={variant} className={className}>{status}</Badge>;
};
