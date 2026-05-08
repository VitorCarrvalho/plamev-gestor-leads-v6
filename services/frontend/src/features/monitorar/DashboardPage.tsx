import React, { useEffect, useState, useCallback } from 'react';
import {
  Users, MessageSquare, DollarSign, Activity, TrendingUp,
  RefreshCw, Target, CheckCircle2, AlertTriangle, UserCheck,
  Calendar, Zap, ArrowRight,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell,
  FunnelChart, Funnel, LabelList,
} from 'recharts';
import { api } from '@/services/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { KpiCard } from '@/components/shared/KpiCard';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSocket } from '@/hooks/useSocket';
import { cn } from '@/lib/utils';

// ── tipos ─────────────────────────────────────────────────────────────────────
interface DashData {
  kpis_hoje: { clientes: number; msgs: number; custo: number; ativas: number };
  kpis_mes:  { clientes: number; msgs: number; custo: number; fechamentos: number };
  series_30d: { dia: string; clientes: number; msgs: number }[];
  custos_7d:  { dia: string; custo: number }[];
  funil: { etapa: string; label: string; total: number }[];
  canais: { canal: string; total: number }[];
  qualidade: { taxa_sucesso: number; taxa_silenciada: number; total_30d: number };
  humanos: { id: string; nome_cliente: string; etapa: string; canal: string; numero_externo: string; ultima_msg: string; msgs_pendentes: number }[];
}

// ── paletas ───────────────────────────────────────────────────────────────────
const FUNNEL_COLORS = [
  '#6366f1','#818cf8','#a5b4fc','#c7d2fe',
  '#f43f5e','#fb7185','#fda4af','#fecdd3',
  '#10b981','#34d399',
];
const PIE_COLORS = ['#6366f1','#22d3ee','#f59e0b','#f43f5e'];

function fmtDia(iso: string) {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}
function fmtTempoAtras(iso: string) {
  const delta = Date.now() - new Date(iso).getTime();
  const min = Math.floor(delta / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min}min`;
  return `${Math.floor(min / 60)}h`;
}

// ── ring progress ─────────────────────────────────────────────────────────────
const Ring: React.FC<{ pct: number; color: string; label: string; sub: string }> = ({ pct, color, label, sub }) => {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-24 h-24">
        <svg width="96" height="96" className="-rotate-90">
          <circle cx="48" cy="48" r={r} fill="none" stroke="#e2e8f0" strokeWidth="8" />
          <circle cx="48" cy="48" r={r} fill="none" stroke={color} strokeWidth="8"
            strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
            style={{ transition: 'stroke-dasharray .8s ease' }} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xl font-bold text-slate-800">{pct}%</span>
        </div>
      </div>
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <span className="text-xs text-slate-400">{sub}</span>
    </div>
  );
};

// ── componente principal ──────────────────────────────────────────────────────
export const DashboardPage: React.FC = () => {
  const socket = useSocket();
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [humanBadge, setHumanBadge] = useState(0);
  const META_MES = 30; // vendas como meta do mês — configurável futuramente

  const carregar = useCallback(async () => {
    setLoading(prev => !data ? prev : false);
    try {
      const d = await api.get<DashData>('/api/dashboard');
      setData(d);
      setHumanBadge(d.humanos?.length ?? 0);
    } catch (e: any) {
      console.error('[DashboardPage]', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 60_000);
    return () => clearInterval(t);
  }, [carregar]);

  useEffect(() => {
    const h = () => {
      setHumanBadge(n => n + 1);
      carregar();
    };
    socket.on('atendimento_humano_solicitado', h);
    socket.on('conversa_atualizada', carregar);
    return () => {
      socket.off('atendimento_humano_solicitado', h);
      socket.off('conversa_atualizada', carregar);
    };
  }, [socket, carregar]);

  const navegar = (pilar: string, subPage: string, conversaId?: string) => {
    if (conversaId) localStorage.setItem('dashv5_conversa_ativa', conversaId);
    window.dispatchEvent(new CustomEvent('dashv5-navegar', { detail: { pilar, subPage, conversaId } }));
  };

  if (loading && !data) return <LoadingSpinner />;

  const d = data!;
  const metaPct = Math.min(100, Math.round((d.kpis_mes.fechamentos / META_MES) * 100));
  const funilMax = Math.max(...d.funil.map(f => f.total), 1);
  const funilData = d.funil.filter(f => f.total > 0).map(f => ({
    ...f, value: f.total, fill: FUNNEL_COLORS[d.funil.indexOf(f) % FUNNEL_COLORS.length],
  }));

  return (
    <>
      <PageHeader title="Dashboard" subtitle={`Visão geral do negócio · atualiza a cada 60s`}>
        {humanBadge > 0 && (
          <Badge variant="red" className="animate-pulse">{humanBadge} aguardando humano</Badge>
        )}
        <Button variant="outline" size="sm" onClick={carregar}>
          <RefreshCw className="w-3.5 h-3.5" /> Atualizar
        </Button>
      </PageHeader>

      <div className="p-6 space-y-7 flex-1 min-h-0 overflow-y-auto">

        {/* ── KPIs hoje ──────────────────────────────────────────────── */}
        <section>
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5" /> Hoje
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard label="Clientes novos"    value={d.kpis_hoje.clientes} icon={Users}         iconColor="text-indigo-600" iconBg="bg-indigo-100" />
            <KpiCard label="Mensagens"          value={d.kpis_hoje.msgs}    icon={MessageSquare} iconColor="text-blue-600"   iconBg="bg-blue-100" />
            <KpiCard label="Custo IA"           value={`$${d.kpis_hoje.custo.toFixed(4)}`} icon={DollarSign} iconColor="text-emerald-600" iconBg="bg-emerald-100" />
            <KpiCard label="Conversas ativas"   value={d.kpis_hoje.ativas}  icon={Activity}      iconColor="text-red-500"    iconBg="bg-red-100" />
          </div>
        </section>

        {/* ── KPIs mês ───────────────────────────────────────────────── */}
        <section>
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5" /> Mês atual
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard label="Clientes novos"  value={d.kpis_mes.clientes}    icon={Users}         iconColor="text-indigo-600" iconBg="bg-indigo-100" />
            <KpiCard label="Mensagens"        value={d.kpis_mes.msgs}        icon={MessageSquare} iconColor="text-blue-600"   iconBg="bg-blue-100" />
            <KpiCard label="Custo IA"         value={`$${d.kpis_mes.custo.toFixed(2)}`} icon={DollarSign} iconColor="text-emerald-600" iconBg="bg-emerald-100" />
            <KpiCard label="Vendas fechadas"  value={d.kpis_mes.fechamentos} icon={CheckCircle2}  iconColor="text-purple-600" iconBg="bg-purple-100"
              hint={`meta ${META_MES}`}
              trend={{ value: metaPct, positive: metaPct >= 50 }}
            />
          </div>
        </section>

        {/* ── Gráficos de série ──────────────────────────────────────── */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Novos clientes 30d */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Novos clientes — últimos 30 dias</h3>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={d.series_30d.map(s => ({ ...s, dia: fmtDia(s.dia) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="dia" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }} />
                <Line type="monotone" dataKey="clientes" stroke="#6366f1" strokeWidth={2.5} dot={false}
                  activeDot={{ r: 5, fill: '#6366f1' }} name="Clientes" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Custo IA 7d */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Custo IA — últimos 7 dias (USD)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={d.custos_7d.map(s => ({ ...s, dia: fmtDia(s.dia) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="dia" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                  formatter={(v: any) => [`$${Number(v).toFixed(4)}`, 'Custo']} />
                <Bar dataKey="custo" fill="#10b981" radius={[4, 4, 0, 0]} name="Custo" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* ── Funil + Pizza canais ───────────────────────────────────── */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Funil de vendas */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <Target className="w-4 h-4 text-indigo-500" /> Funil de vendas
            </h3>
            {funilData.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-10">Sem dados de funil</p>
            ) : (
              <div className="space-y-2">
                {d.funil.filter(f => f.total > 0).map((f, i) => {
                  const pct = Math.round((f.total / funilMax) * 100);
                  const colors = FUNNEL_COLORS;
                  return (
                    <div key={f.etapa} className="flex items-center gap-3">
                      <span className="text-xs text-slate-500 w-24 truncate">{f.label}</span>
                      <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                        <div
                          className="h-5 rounded-full flex items-center justify-end pr-2 transition-all duration-700"
                          style={{ width: `${pct}%`, backgroundColor: colors[i % colors.length] }}
                        >
                          <span className="text-[10px] text-white font-semibold">{f.total}</span>
                        </div>
                      </div>
                      <span className="text-xs text-slate-400 w-8 text-right">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Distribuição canal */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Canal</h3>
            {d.canais.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-10">Sem dados</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie data={d.canais} dataKey="total" nameKey="canal" cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={3}>
                      {d.canais.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col gap-1 mt-2">
                  {d.canais.map((c, i) => (
                    <div key={c.canal} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span className="text-slate-600 capitalize">{c.canal}</span>
                      </div>
                      <span className="font-medium text-slate-700">{c.total}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>

        {/* ── Qualidade IA + Meta ────────────────────────────────────── */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Ring taxa de sucesso */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col items-center justify-center">
            <Ring
              pct={d.qualidade.taxa_sucesso}
              color="#6366f1"
              label="Taxa de Sucesso"
              sub={`${d.kpis_mes.fechamentos} vendas nos últimos 30d`}
            />
          </div>

          {/* Ring IA silenciada */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col items-center justify-center">
            <Ring
              pct={d.qualidade.taxa_silenciada}
              color="#f59e0b"
              label="IA Silenciada"
              sub={`de ${d.qualidade.total_30d} conversas (30d)`}
            />
          </div>

          {/* Meta do mês */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col justify-between">
            <div className="flex items-center gap-2 mb-4">
              <Zap className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-semibold text-slate-700">Meta do Mês</h3>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-slate-600">{d.kpis_mes.fechamentos} vendas</span>
                <span className="text-slate-400">meta {META_MES}</span>
              </div>
              <div className="h-4 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-4 rounded-full transition-all duration-700',
                    metaPct >= 100 ? 'bg-emerald-500' : metaPct >= 60 ? 'bg-indigo-500' : 'bg-amber-400'
                  )}
                  style={{ width: `${metaPct}%` }}
                />
              </div>
              <p className="text-xs text-slate-400 mt-2 text-right">{metaPct}% atingido</p>
            </div>
            <button
              onClick={() => navegar('atender', 'contatos')}
              className="mt-4 text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1 font-medium"
            >
              Ver contatos <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </section>

        {/* ── Painel atendimento humano ──────────────────────────────── */}
        {d.humanos.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <h3 className="text-sm font-semibold text-slate-700">Aguardando atendimento humano</h3>
                <Badge variant="amber">{d.humanos.length}</Badge>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden">
              <div className="divide-y divide-slate-100">
                {d.humanos.map(h => (
                  <div key={h.id} className="flex items-center gap-4 px-5 py-3 hover:bg-amber-50 transition-colors">
                    <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                      <UserCheck className="w-4 h-4 text-amber-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{h.nome_cliente || h.numero_externo}</p>
                      <p className="text-xs text-slate-400">
                        {h.etapa} · {h.canal} · {h.msgs_pendentes} msg{h.msgs_pendentes !== 1 ? 's' : ''} · aguardando há {fmtTempoAtras(h.ultima_msg)}
                      </p>
                    </div>
                    <button
                      onClick={() => navegar('atender', 'chat', h.id)}
                      className="flex-shrink-0 text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors font-medium"
                    >
                      Assumir
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

      </div>
    </>
  );
};
