import React, { useState } from 'react';
import { Phone, PanelRightOpen, Info, CircleOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ActionsDropdown } from './ActionsDropdown';

const TEMP_BADGE: Record<string, { label: string; cls: string; emoji: string }> = {
  quente:  { label: 'Quente',  cls: 'bg-red-100 text-red-700',    emoji: '🔥' },
  morno:   { label: 'Morno',   cls: 'bg-amber-100 text-amber-700', emoji: '⚡' },
  frio:    { label: 'Frio',    cls: 'bg-sky-100 text-sky-700',     emoji: '❄️' },
  perdido: { label: 'Perdido', cls: 'bg-slate-100 text-slate-600', emoji: '💤' },
  vendido: { label: 'Vendido', cls: 'bg-purple-100 text-purple-700', emoji: '💜' },
};

function fmtFone(p: string | null): string {
  if (!p) return '—';
  const d = p.replace(/\D/g, '');
  if (d.length === 13) return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return p;
}

interface ChatHeaderProps {
  conversa: any;
  iaSilenciada: boolean;
  toggleIaLoading: boolean;
  onToggleIa: () => void;
  onAgendar: () => void;
  onSalvar: () => void;
  onMarcarPago: () => void;
  onAbrirDetalhes: () => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  conversa, iaSilenciada, toggleIaLoading,
  onToggleIa, onAgendar, onSalvar, onMarcarPago, onAbrirDetalhes,
}) => {
  const [expandido, setExpandido] = useState(false);

  const temp = TEMP_BADGE[conversa?.temperatura_lead || 'morno'] || TEMP_BADGE.morno;
  const petDesc = [conversa?.nome_pet, conversa?.raca, conversa?.idade_anos ? `${conversa.idade_anos}a` : null]
    .filter(Boolean).join(' · ');

  return (
    <div className="bg-white border-b border-slate-200 flex-shrink-0">
      <div className="flex items-center gap-3 px-4 py-2.5">
        {/* Avatar */}
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-sm">
          {(conversa?.nome_cliente || '?')[0].toUpperCase()}
        </div>

        {/* Info esquerda — clicável para expandir */}
        <div
          className="flex-1 min-w-0 cursor-pointer"
          onClick={() => setExpandido(v => !v)}
          title={expandido ? 'Recolher detalhes' : 'Ver detalhes do lead'}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-900 text-sm leading-tight">
              {conversa?.nome_cliente || fmtFone(conversa?.phone)}
            </span>
            <span className={cn('inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full', temp.cls)}>
              {temp.emoji} {temp.label}
            </span>
            {conversa?.canal && (
              <span className={cn(
                'inline-flex text-[10px] px-2 py-0.5 rounded-full font-medium',
                conversa.canal === 'whatsapp'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-blue-100 text-blue-700'
              )}>
                {conversa.canal}
              </span>
            )}
            {iaSilenciada && (
              <span className="inline-flex items-center gap-0.5 text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                <CircleOff className="w-2.5 h-2.5" /> IA off
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
            <Phone className="w-3 h-3" />
            {fmtFone(conversa?.phone)}
            {conversa?.etapa && <><span>·</span><span className="font-medium">{conversa.etapa}</span></>}
            {conversa?.score != null && <><span>·</span><span className="font-semibold text-slate-700">{conversa.score}/10</span></>}
          </div>
        </div>

        {/* Ações direita */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <ActionsDropdown
            iaSilenciada={iaSilenciada}
            toggleIaLoading={toggleIaLoading}
            etapa={conversa?.etapa || ''}
            onToggleIa={onToggleIa}
            onAgendar={onAgendar}
            onSalvar={onSalvar}
            onMarcarPago={onMarcarPago}
          />
          <button
            onClick={onAbrirDetalhes}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all bg-white"
            title="Abrir painel de detalhes"
          >
            <PanelRightOpen className="w-3.5 h-3.5" />
            Detalhes
          </button>
        </div>
      </div>

      {/* Painel expandido (pet + plano + custo) */}
      {expandido && (
        <div className="px-4 pb-3 pt-0 flex items-center gap-4 flex-wrap border-t border-slate-100 bg-slate-50/50">
          {petDesc && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Pet</span>
              <span className="text-xs text-slate-700 font-medium">🐾 {petDesc}</span>
            </div>
          )}
          {conversa?.plano_recomendado && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Plano</span>
              <span className="text-xs text-slate-700 font-medium">📋 {conversa.plano_recomendado}</span>
            </div>
          )}
          {conversa?.custo_usd != null && (
            <div className="flex items-center gap-1.5 ml-auto">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Custo IA</span>
              <span className="text-xs text-slate-600 font-mono">
                ${Number(conversa.custo_usd).toFixed(4)}
              </span>
            </div>
          )}
          {conversa?.objecao_principal && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Objeção</span>
              <span className="text-xs text-slate-600">{conversa.objecao_principal}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
