import React, { useState, useRef, useEffect } from 'react';
import { Zap, VolumeX, Volume2, Calendar, Bookmark, DollarSign, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ActionsDropdownProps {
  iaSilenciada: boolean;
  toggleIaLoading: boolean;
  etapa: string;
  onToggleIa: () => void;
  onAgendar: () => void;
  onSalvar: () => void;
  onMarcarPago: () => void;
}

export const ActionsDropdown: React.FC<ActionsDropdownProps> = ({
  iaSilenciada, toggleIaLoading, etapa,
  onToggleIa, onAgendar, onSalvar, onMarcarPago,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const item = (icon: React.ReactNode, label: string, onClick: () => void, danger = false, disabled = false) => (
    <button
      onClick={() => { onClick(); setOpen(false); }}
      disabled={disabled}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-colors text-left',
        danger
          ? 'text-red-600 hover:bg-red-50'
          : 'text-slate-700 hover:bg-slate-100',
        disabled && 'opacity-40 cursor-not-allowed'
      )}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-all',
          open
            ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
        )}
      >
        <Zap className="w-3.5 h-3.5" />
        Ações
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-52 bg-white rounded-xl border border-slate-200 shadow-xl z-30 py-1 overflow-hidden">
          {item(
            iaSilenciada
              ? <Volume2 className="w-4 h-4 text-emerald-600" />
              : <VolumeX className="w-4 h-4 text-amber-500" />,
            iaSilenciada ? 'Ativar IA' : 'Silenciar IA',
            onToggleIa,
            false,
            toggleIaLoading,
          )}
          <div className="h-px bg-slate-100 my-1" />
          {item(<Calendar className="w-4 h-4 text-blue-500" />, 'Agendar mensagem', onAgendar)}
          {item(<Bookmark className="w-4 h-4 text-indigo-500" />, 'Salvar conversa', onSalvar)}
          {etapa !== 'pago' && (
            <>
              <div className="h-px bg-slate-100 my-1" />
              {item(<DollarSign className="w-4 h-4 text-emerald-600" />, 'Marcar como pago', onMarcarPago)}
            </>
          )}
        </div>
      )}
    </div>
  );
};
