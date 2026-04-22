import React, { useEffect, useState, useMemo } from 'react';
import {
  Radio, Search, Filter, Phone, MessageCircle, Send, RefreshCw,
  Flame, Clock, CircleOff, ScanSearch,
} from 'lucide-react';
import { api } from '@/services/api';
import { useSocket } from '@/hooks/useSocket';
import { PageHeader } from '@/components/layout/PageHeader';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { cn } from '@/lib/utils';

type Canal = 'todos' | 'whatsapp' | 'telegram';

interface Conversa {
  conversa_id: string;
  client_id: string;
  nome_cliente: string | null;
  nome_pet: string | null;
  phone: string | null;
  canal: string;
  etapa: string | null;
  score: number | null;
  status: string | null;
  ia_silenciada: boolean;
  ultima_msg_ts: string | null;
  ultima_msg_conteudo: string | null;
  msgs_hoje: number;
  agente_slug: string | null;
  total_msgs: number;
}

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
  const min = Math.floor(delta / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const ETAPA_COR: Record<string, string> = {
  acolhimento: 'bg-slate-100 text-slate-700',
  qualificacao: 'bg-blue-100 text-blue-700',
  apresentacao_planos: 'bg-indigo-100 text-indigo-700',
  negociacao: 'bg-amber-100 text-amber-700',
  objecao: 'bg-orange-100 text-orange-700',
  pre_fechamento: 'bg-emerald-100 text-emerald-700',
  fechamento: 'bg-emerald-500 text-white',
};

export const LiveFeedPage: React.FC = () => {
  const socket = useSocket();
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [canal, setCanal] = useState<Canal>('todos');
  const [erro, setErro] = useState('');

  const carregar = async () => {
    setLoading(true); setErro('');
    try { setConversas(await api.get<Conversa[]>('/api/conversas')); }
    catch (e: any) { setErro(e.message); }
    setLoading(false);
  };

  useEffect(() => { carregar(); }, []);

  // Escuta nova_msg para refresh automático
  useEffect(() => {
    const handler = () => carregar();
    socket.on('nova_msg', handler);
    socket.on('conversa_atualizada', handler);
    return () => { socket.off('nova_msg', handler); socket.off('conversa_atualizada', handler); };
  }, [socket]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return conversas.filter(c => {
      if (canal !== 'todos' && c.canal !== canal) return false;
      if (!q) return true;
      return (
        (c.nome_cliente || '').toLowerCase().includes(q) ||
        (c.nome_pet || '').toLowerCase().includes(q) ||
        (c.phone || '').includes(q)
      );
    });
  }, [conversas, busca, canal]);

  const stats = useMemo(() => ({
    total: conversas.length,
    whatsapp: conversas.filter(c => c.canal === 'whatsapp').length,
    telegram: conversas.filter(c => c.canal === 'telegram').length,
    quentes: conversas.filter(c => (c.score || 0) >= 7).length,
    silenciadas: conversas.filter(c => c.ia_silenciada).length,
  }), [conversas]);

  return (
    <>
      <PageHeader title="Live Feed" subtitle="Conversas ativas em tempo real">
        <Badge variant="green" className="gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> ao vivo</Badge>
        <BuscaGlobalButton />
        <Button variant="outline" size="sm" onClick={carregar}>
          <RefreshCw className="w-3.5 h-3.5" /> Atualizar
        </Button>
      </PageHeader>

      <div className="p-6 space-y-4 flex-1 min-h-0 overflow-y-auto">
        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <MiniStat label="Total"      valor={stats.total}      cor="text-slate-900"  icon={MessageCircle} />
          <MiniStat label="WhatsApp"   valor={stats.whatsapp}   cor="text-emerald-600" icon={Phone} />
          <MiniStat label="Telegram"   valor={stats.telegram}   cor="text-blue-600"    icon={Send} />
          <MiniStat label="Quentes"    valor={stats.quentes}    cor="text-red-600"     icon={Flame} />
          <MiniStat label="IA muda"    valor={stats.silenciadas} cor="text-amber-600"  icon={CircleOff} />
        </div>

        {/* Filtros */}
        <div className="flex gap-3 flex-wrap items-center">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input placeholder="Buscar por nome, pet ou telefone…" value={busca} onChange={e => setBusca(e.target.value)} className="pl-9" />
          </div>
          <Select value={canal} onValueChange={v => setCanal(v as Canal)}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos canais</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
              <SelectItem value="telegram">Telegram</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-slate-500 ml-auto">{filtradas.length} de {conversas.length}</span>
        </div>

        {/* Lista */}
        {loading ? <LoadingSpinner />
          : erro ? <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{erro}</div>
          : filtradas.length === 0 ? <EmptyState icon={Radio} title="Nenhuma conversa" description={busca ? 'Ajuste a busca ou filtro' : 'Aguardando leads…'} />
          : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {filtradas.map(c => <ConversaCard key={c.conversa_id} conversa={c} />)}
            </div>
          )}
      </div>
    </>
  );
};

// ── MiniStat card ──────────────────────────────────────────────
const MiniStat: React.FC<{ label: string; valor: number; cor: string; icon: any }> = ({ label, valor, cor, icon: Icon }) => (
  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex items-center gap-3">
    <div className="w-9 h-9 rounded-lg bg-slate-50 flex items-center justify-center flex-shrink-0">
      <Icon className="w-4 h-4 text-slate-500" />
    </div>
    <div className="min-w-0">
      <div className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={cn('text-lg font-bold tabular-nums leading-none mt-0.5', cor)}>{valor}</div>
    </div>
  </div>
);

// ── Card de conversa ───────────────────────────────────────────
const ConversaCard: React.FC<{ conversa: Conversa }> = ({ conversa: c }) => {
  const temPet = !!c.nome_pet;
  const quente = (c.score || 0) >= 7;

  // 21/04/2026 — Clicar no card abre a conversa no pilar Atender
  const abrirConversa = () => {
    window.dispatchEvent(new CustomEvent('dashv5-navegar', {
      detail: { pilar: 'atender', subPage: 'conversa', conversaId: c.conversa_id },
    }));
  };

  return (
    <div
      onClick={abrirConversa}
      className={cn(
        'bg-white rounded-xl border shadow-sm p-4 hover:shadow-md transition-all cursor-pointer',
        quente ? 'border-red-200 hover:border-red-300' : 'border-slate-200 hover:border-indigo-200'
      )}
      title="Clique para abrir a conversa"
    >
      <div className="flex items-start gap-3">
        <div className={cn(
          'w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0',
          c.canal === 'whatsapp' ? 'bg-gradient-to-br from-emerald-500 to-emerald-600' : 'bg-gradient-to-br from-blue-500 to-blue-600'
        )}>
          {(c.nome_cliente || c.nome_pet || '?')[0].toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 mb-0.5">
            <div className="font-semibold text-slate-900 text-sm truncate">{c.nome_cliente || fmtFone(c.phone)}</div>
            {quente && <Flame className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
            {c.ia_silenciada && <CircleOff className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />}
          </div>
          <div className="text-xs text-slate-500 truncate">
            {temPet && <span className="text-emerald-700 font-medium">🐾 {c.nome_pet}</span>}
            {temPet && ' · '}
            {fmtFone(c.phone)}
          </div>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-slate-400 flex-shrink-0">
          <Clock className="w-3 h-3" />
          {fmtTempo(c.ultima_msg_ts)}
        </div>
      </div>

      {c.ultima_msg_conteudo && (
        <div className="mt-3 text-xs text-slate-600 line-clamp-2 bg-slate-50 rounded-lg p-2 border border-slate-100">
          {c.ultima_msg_conteudo}
        </div>
      )}

      <div className="mt-3 flex items-center gap-1.5 flex-wrap">
        {c.etapa && (
          <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full', ETAPA_COR[c.etapa] || 'bg-slate-100 text-slate-600')}>
            {c.etapa.replace(/_/g, ' ')}
          </span>
        )}
        {c.score != null && (
          <span className={cn(
            'text-[10px] font-bold px-2 py-0.5 rounded-full tabular-nums',
            quente ? 'bg-red-100 text-red-700' : c.score >= 4 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
          )}>
            {c.score}/10
          </span>
        )}
        <span className="text-[10px] text-slate-400 ml-auto">{c.total_msgs || 0} msgs</span>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// BUSCA GLOBAL — busca full-text em mensagens
// ═══════════════════════════════════════════════════════════════
const BuscaGlobalButton: React.FC = () => {
  const [aberto, setAberto] = useState(false);
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const buscar = async () => {
    if (q.trim().length < 2) return;
    setLoading(true);
    try {
      const r = await api.get<any>(`/api/busca?q=${encodeURIComponent(q)}`);
      setResultados(r.resultados || []);
    } catch (e: any) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setAberto(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setAberto(true)}>
        <ScanSearch className="w-3.5 h-3.5" /> Buscar em mensagens
        <kbd className="ml-2 text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-mono">⌘K</kbd>
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ScanSearch className="w-4 h-4 text-indigo-600" /> Busca global</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input autoFocus value={q} onChange={e => setQ(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && buscar()}
                placeholder="Buscar em todas as mensagens… (min 2 caracteres)" />
              <Button onClick={buscar} disabled={loading || q.trim().length < 2}>
                {loading ? 'Buscando…' : 'Buscar'}
              </Button>
            </div>
            {resultados.length > 0 && (
              <div className="text-xs text-slate-500">{resultados.length} resultado(s)</div>
            )}
            <div className="space-y-2 max-h-[55vh] overflow-y-auto">
              {resultados.map((r, i) => (
                <div key={r.id} className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm">
                  <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                    <Badge variant={r.canal === 'whatsapp' ? 'green' : 'blue'} className="text-[10px]">{r.canal}</Badge>
                    <span className="font-medium text-slate-700">{r.nome_cliente || r.phone || '—'}</span>
                    {r.nome_pet && <span className="text-emerald-600">🐾 {r.nome_pet}</span>}
                    <span className="text-slate-400 ml-auto">{new Date(r.timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div className="text-slate-800 whitespace-pre-wrap break-words">
                    {r.trecho}
                  </div>
                </div>
              ))}
              {!loading && q.trim().length >= 2 && resultados.length === 0 && (
                <div className="text-center text-slate-400 text-sm py-8">Nenhuma mensagem encontrada</div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
