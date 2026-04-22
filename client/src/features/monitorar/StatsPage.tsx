import React, { useEffect, useState } from 'react';
import {
  BarChart3, Users, MessageSquare, DollarSign, Radio, RefreshCw, Calendar, TrendingUp,
} from 'lucide-react';
import { api } from '@/services/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { KpiCard } from '@/components/shared/KpiCard';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { Button } from '@/components/ui/button';

export const StatsPage: React.FC = () => {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const carregar = async () => {
    setLoading(true);
    try { setStats(await api.get<any>('/api/stats')); }
    catch (e: any) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <PageHeader title="Estatísticas" subtitle="Métricas operacionais em tempo real · atualiza a cada 60s">
        <Button variant="outline" size="sm" onClick={carregar}>
          <RefreshCw className="w-3.5 h-3.5" /> Atualizar
        </Button>
      </PageHeader>

      <div className="p-6 space-y-6 flex-1 min-h-0 overflow-y-auto">
        {loading && !stats ? <LoadingSpinner />
          : stats && (
            <>
              <section>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5" /> Hoje
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <KpiCard label="Clientes novos" value={stats.clientes_hoje || 0}    icon={Users}         iconColor="text-indigo-600" iconBg="bg-indigo-100" />
                  <KpiCard label="Mensagens"       value={stats.msgs_hoje || 0}        icon={MessageSquare} iconColor="text-blue-600"   iconBg="bg-blue-100" />
                  <KpiCard label="Custo IA"        value={`$${parseFloat(stats.custo_hoje || '0').toFixed(parseFloat(stats.custo_hoje || '0') === 0 ? 2 : 4)}`} icon={DollarSign} iconColor="text-emerald-600" iconBg="bg-emerald-100" />
                  <KpiCard label="Conversas ativas" value={stats.conversas_ativas || 0} icon={Radio}        iconColor="text-red-600"    iconBg="bg-red-100" />
                </div>
              </section>

              <section>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <TrendingUp className="w-3.5 h-3.5" /> Mês
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <KpiCard label="Clientes novos"  value={stats.clientes_mes || 0}    icon={Users}         iconColor="text-indigo-600" iconBg="bg-indigo-100" />
                  <KpiCard label="Mensagens"        value={stats.msgs_mes || 0}        icon={MessageSquare} iconColor="text-blue-600"   iconBg="bg-blue-100" />
                  <KpiCard label="Custo IA"         value={`$${parseFloat(stats.custo_mes || '0').toFixed(2)}`} icon={DollarSign} iconColor="text-emerald-600" iconBg="bg-emerald-100" />
                  <KpiCard label="Vendas fechadas"  value={stats.fechamentos_mes || 0} icon={BarChart3}     iconColor="text-purple-600" iconBg="bg-purple-100" />
                </div>
              </section>
            </>
          )}
      </div>
    </>
  );
};
