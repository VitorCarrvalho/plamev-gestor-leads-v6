import React, { useEffect, useState } from 'react';
import { Phone, CircleOff } from 'lucide-react';
import { api } from '@/services/api';
import { useSocket } from '@/hooks/useSocket';
import { PageHeader } from '@/components/layout/PageHeader';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { cn } from '@/lib/utils';

function fmtFone(p: string | null): string {
  if (!p) return '—';
  const d = p.replace(/\D/g, '');
  if (d.length === 13) return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return p;
}

function fmtTempo(iso: string | null): string {
  if (!iso) return '—';
  const delta = Date.now() - new Date(iso).getTime();
  const m = Math.floor(delta / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const ETAPA_LABEL: Record<string, string> = {
  acolhimento: 'Acolhimento',
  qualificacao: 'Qualificação',
  apresentacao_planos: 'Apresentação',
  validacao_cep: 'CEP',
  negociacao: 'Negociação',
  objecao: 'Objeção',
  pre_fechamento: 'Pré-fech.',
  fechamento: 'Fechando',
  venda_fechada: '✓ Venda',
  pago: '💰 Pago',
};

const etapaCor = (etapa: string) =>
  etapa === 'pago'           ? 'from-emerald-500 to-emerald-600' :
  etapa === 'venda_fechada'  ? 'from-indigo-500 to-indigo-600' :
  etapa === 'fechamento' || etapa === 'pre_fechamento' ? 'from-amber-500 to-orange-500' :
  etapa === 'negociacao' || etapa === 'objecao' ? 'from-rose-500 to-pink-500' :
  'from-slate-400 to-slate-500';

const CardCliente: React.FC<{ conversa: any; onClick: () => void }> = ({ conversa: c, onClick }) => {
  const score = c.score || 0;
  const petDesc = [c.nome_pet, c.raca, c.idade_anos ? `${c.idade_anos}a` : null].filter(Boolean).join(' · ');

  return (
    <button onClick={onClick}
      className="w-full text-left rounded-xl border bg-white p-3 transition-all hover:shadow-md hover:border-indigo-300 border-slate-200">
      <div className="flex items-center gap-2.5 mb-1.5">
        <div className={cn(
          'w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-sm',
          c.canal === 'whatsapp' ? 'bg-gradient-to-br from-emerald-500 to-emerald-600' : 'bg-gradient-to-br from-blue-500 to-blue-600'
        )}>
          {(c.nome_cliente || c.nome_pet || '?')[0].toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-900 truncate">
            {c.nome_cliente || fmtFone(c.phone)}
          </div>
          <div className="text-[10px] text-slate-500 flex items-center gap-1">
            <Phone className="w-2.5 h-2.5" /> {fmtFone(c.phone)}
            {c.ia_silenciada && <CircleOff className="w-2.5 h-2.5 text-amber-500 ml-1" />}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {score >= 7 && (
            <div className="flex items-center gap-1 bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-[10px] font-bold">
              🔥 {score}
            </div>
          )}
          <span className="text-[10px] text-slate-400">{fmtTempo(c.ultima_msg_ts)}</span>
        </div>
      </div>

      {petDesc && (
        <div className="text-[11px] text-emerald-700 mb-1.5 truncate">🐾 {petDesc}</div>
      )}

      <div className="flex items-center gap-1 flex-wrap">
        <span className={cn(
          'px-2 py-0.5 rounded-md text-[10px] font-semibold text-white bg-gradient-to-r shadow-sm',
          etapaCor(c.etapa || '')
        )}>
          {ETAPA_LABEL[c.etapa] || c.etapa || '—'}
        </span>
        {c.plano_recomendado && (
          <span className="px-2 py-0.5 rounded-md bg-purple-100 text-purple-700 text-[10px] font-medium">
            📦 {c.plano_recomendado}
          </span>
        )}
        {c.temperatura_lead && (
          <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 text-[10px] font-medium">
            🌡️ {c.temperatura_lead}
          </span>
        )}
      </div>

      {c.ultima_msg_conteudo && (
        <div className="mt-1.5 text-[11px] text-slate-600 italic line-clamp-1 border-t border-slate-100 pt-1.5">
          "{c.ultima_msg_conteudo.slice(0, 70)}"
        </div>
      )}
    </button>
  );
};

interface PerfilPageProps {
  onAbrirConversa?: () => void;
}

export const PerfilPage: React.FC<PerfilPageProps> = ({ onAbrirConversa }) => {
  const socket = useSocket();
  const [conversas, setConversas] = useState<any[]>([]);
  const [busca, setBusca] = useState('');
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<'todos' | 'quentes' | 'fechando'>('todos');

  useEffect(() => {
    api.get<any[]>('/api/conversas').then(cs => { setConversas(cs); setLoading(false); });
  }, []);

  useEffect(() => {
    const refresh = () => api.get<any[]>('/api/conversas').then(setConversas);
    socket.on('nova_msg', refresh);
    socket.on('conversa_atualizada', refresh);
    return () => { socket.off('nova_msg', refresh); socket.off('conversa_atualizada', refresh); };
  }, [socket]);

  const filtradas = conversas.filter(c => {
    const matchBusca = !busca.trim() ||
      (c.nome_cliente || '').toLowerCase().includes(busca.toLowerCase()) ||
      (c.nome_pet || '').toLowerCase().includes(busca.toLowerCase()) ||
      (c.phone || '').includes(busca);

    const matchFiltro =
      filtro === 'todos'    ? true :
      filtro === 'quentes'  ? (c.score || 0) >= 7 :
      filtro === 'fechando' ? ['pre_fechamento', 'fechamento', 'venda_fechada', 'pago'].includes(c.etapa) :
      true;

    return matchBusca && matchFiltro;
  });

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <PageHeader title="Perfil do Lead" subtitle="Cards completos de todos os leads ativos">
        <Badge variant="default" className="text-[11px]">{conversas.length} leads</Badge>
      </PageHeader>

      {/* Filtros + busca */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <div className="flex gap-1">
          {(['todos', 'quentes', 'fechando'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFiltro(f)}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                filtro === f
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              )}
            >
              {f === 'todos' ? 'Todos' : f === 'quentes' ? '🔥 Quentes' : '⚡ Fechando'}
            </button>
          ))}
        </div>
        <div className="flex-1 relative">
          <Input
            placeholder="Buscar por nome, pet ou telefone…"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <span className="text-xs text-slate-400 whitespace-nowrap">{filtradas.length} resultado{filtradas.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Grid de cards */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-slate-50 p-4">
        {loading ? (
          <LoadingSpinner />
        ) : filtradas.length === 0 ? (
          <div className="text-center text-slate-400 text-sm py-16">Nenhum lead encontrado</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtradas.map(c => (
              <CardCliente
                key={c.conversa_id}
                conversa={c}
                onClick={() => onAbrirConversa?.()}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
