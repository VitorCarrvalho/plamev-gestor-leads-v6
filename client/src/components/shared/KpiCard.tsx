import React from 'react';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface KpiCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  iconColor?: string;
  iconBg?: string;
  hint?: string;
  trend?: { value: number; positive: boolean };
}

export const KpiCard: React.FC<KpiCardProps> = ({
  label, value, icon: Icon, iconColor = 'text-indigo-600', iconBg = 'bg-indigo-100', hint, trend,
}) => (
  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 hover:shadow-md transition-shadow">
    <div className="flex items-start justify-between gap-3">
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-xs text-slate-500 uppercase tracking-wide font-medium">{label}</span>
        <span className="text-2xl font-bold text-slate-900 tracking-tight mt-1">{value}</span>
        {(hint || trend) && (
          <div className="mt-1.5 flex items-center gap-2">
            {trend && (
              <span className={cn('text-xs font-medium', trend.positive ? 'text-emerald-600' : 'text-red-600')}>
                {trend.positive ? '↑' : '↓'} {Math.abs(trend.value)}%
              </span>
            )}
            {hint && <span className="text-xs text-slate-400">{hint}</span>}
          </div>
        )}
      </div>
      {Icon && (
        <div className={cn('w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0', iconBg)}>
          <Icon className={cn('w-5 h-5', iconColor)} />
        </div>
      )}
    </div>
  </div>
);
