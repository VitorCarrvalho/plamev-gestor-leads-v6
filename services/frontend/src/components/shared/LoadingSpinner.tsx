import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export const LoadingSpinner: React.FC<{ className?: string; label?: string }> = ({ className, label }) => (
  <div className={cn('flex items-center justify-center gap-2 py-12 text-slate-500', className)}>
    <Loader2 className="w-4 h-4 animate-spin" />
    {label && <span className="text-sm">{label}</span>}
  </div>
);
