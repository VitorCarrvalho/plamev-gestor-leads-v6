import React from 'react';

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function formatarData(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

export const DateSeparator: React.FC<{ date: Date }> = ({ date }) => {
  const hoje = new Date();
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);

  const label = isSameDay(date, hoje) ? 'Hoje'
    : isSameDay(date, ontem) ? 'Ontem'
    : formatarData(date);

  return (
    <div className="flex items-center gap-3 my-4 px-2">
      <div className="flex-1 h-px bg-black/10" />
      <span className="text-[11px] font-medium text-slate-500 bg-[#e5ddd5] px-3 py-1 rounded-full shadow-sm whitespace-nowrap">
        {label}
      </span>
      <div className="flex-1 h-px bg-black/10" />
    </div>
  );
};
