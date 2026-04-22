import React, { useEffect, useState } from 'react';
import { Filter, RefreshCw } from 'lucide-react';
import { api } from '@/services/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';

const ETAPA_LABEL: Record<string, string> = {
  acolhimento: 'Acolhimento',
  qualificacao: 'Qualificação',
  apresentacao_planos: 'Apresentação',
  negociacao: 'Negociação',
  objecao: 'Objeção',
  pre_fechamento: 'Pré-fechamento',
  fechamento: 'Fechamento',
};

const ETAPA_COR: Record<string, string> = {
  acolhimento: 'bg-slate-400',
  qualificacao: 'bg-blue-400',
  apresentacao_planos: 'bg-indigo-400',
  negociacao: 'bg-amber-500',
  objecao: 'bg-orange-500',
  pre_fechamento: 'bg-emerald-500',
  fechamento: 'bg-emerald-600',
};

export const FunilPage: React.FC = () => {
  const [dados, setDados] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const carregar = async () => {
    setLoading(true);
    try { setDados(await api.get<any>('/api/analisar/funil')); }
    catch (e: any) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { carregar(); }, []);

  const max = dados?.funil?.reduce((m: number, f: any) => Math.max(m, f.total), 0) || 1;

  return (
    <>
      <PageHeader title="Funil de Conversão" subtitle="Distribuição de conversas por etapa">
        <Button variant="outline" size="sm" onClick={carregar}>
          <RefreshCw className="w-3.5 h-3.5" /> Atualizar
        </Button>
      </PageHeader>

      <div className="p-6 flex-1 min-h-0 overflow-y-auto">
        {loading ? <LoadingSpinner />
          : dados && (
            <div className="space-y-6 max-w-3xl">
              <div className="text-sm text-slate-600">
                <strong>{dados.total}</strong> conversas no total
              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <div className="space-y-3">
                  {dados.funil.map((f: any, i: number) => {
                    const pct = dados.total > 0 ? (f.total / dados.total) * 100 : 0;
                    const barPct = max > 0 ? (f.total / max) * 100 : 0;
                    const prev = i > 0 ? dados.funil[i - 1].total : dados.funil[0]?.total || 1;
                    const convPct = prev > 0 && i > 0 ? (f.total / prev) * 100 : null;
                    return (
                      <div key={f.etapa}>
                        <div className="flex items-center justify-between mb-1 text-xs">
                          <span className="font-medium text-slate-700">{ETAPA_LABEL[f.etapa]}</span>
                          <span className="text-slate-500">
                            {f.total} conv · {pct.toFixed(1)}%
                            {convPct != null && <span className={`ml-2 ${convPct >= 50 ? 'text-emerald-600' : convPct >= 20 ? 'text-amber-600' : 'text-red-600'}`}>
                              ↓ {convPct.toFixed(0)}%
                            </span>}
                          </span>
                        </div>
                        <div className="h-8 bg-slate-100 rounded-lg overflow-hidden relative">
                          <div className={`h-full ${ETAPA_COR[f.etapa]} transition-all duration-500 flex items-center justify-end px-3`}
                            style={{ width: `${Math.max(barPct, 2)}%` }}>
                            <span className="text-white text-[11px] font-semibold tabular-nums">{f.total}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="text-xs text-slate-500">
                <strong>↓ %</strong> = taxa de permanência na etapa (quanto % da etapa anterior chegou até aqui).
                Valores baixos indicam gargalo.
              </div>
            </div>
          )}
      </div>
    </>
  );
};
