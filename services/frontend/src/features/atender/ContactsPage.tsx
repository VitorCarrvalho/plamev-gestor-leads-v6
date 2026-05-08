import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Users, RefreshCw, Search, Phone, MessageSquare,
  History, ChevronRight, PawPrint, X, Send, Filter,
  Clock, Thermometer,
} from 'lucide-react';
import { api } from '@/services/api';
import { useSocket } from '@/hooks/useSocket';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { cn } from '@/lib/utils';

// ── tipos ─────────────────────────────────────────────────────────────────────
interface Contato {
  id: string;
  nome: string | null;
  telefone: string | null;
  canal: string | null;
  etapa: string | null;
  status: string | null;
  score: number | null;
  ia_silenciada: boolean;
  plano_recomendado: string | null;
  ultima_interacao: string | null;
  conversa_id: string | null;
  numero_externo: string | null;
  pet_nome: string | null;
  pet_especie: string | null;
  pet_raca: string | null;
  pet_idade: string | null;
  pet_problema: string | null;
}

interface ContatoDetalhe extends Contato {
  historico: { role: string; enviado_por: string; conteudo: string; timestamp: string }[];
}

// ── helpers ───────────────────────────────────────────────────────────────────
function fmtTempo(iso: string | null): string {
  if (!iso) return '—';
  const delta = Date.now() - new Date(iso).getTime();
  const min = Math.floor(delta / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

function temperaturaLabel(score: number | null): { label: string; variant: 'red' | 'amber' | 'blue' | 'secondary'; emoji: string } {
  if (score == null) return { label: 'Sem score', variant: 'secondary', emoji: '⚪' };
  if (score >= 80)  return { label: 'Quente',   variant: 'red',       emoji: '🔥' };
  if (score >= 50)  return { label: 'Morno',    variant: 'amber',     emoji: '🌡️' };
  if (score >= 20)  return { label: 'Frio',     variant: 'blue',      emoji: '❄️' };
  return { label: 'Gelado', variant: 'secondary', emoji: '🧊' };
}

function etapaLabel(etapa: string | null): string {
  const map: Record<string, string> = {
    acolhimento: 'Acolhimento', qualificacao: 'Qualificação',
    apresentacao_planos: 'Apresentação', validacao_cep: 'CEP',
    negociacao: 'Negociação', objecao: 'Objeção',
    pre_fechamento: 'Pré-Fechamento', fechamento: 'Fechamento',
    venda_fechada: 'Venda Fechada', pago: 'Pago',
  };
  return etapa ? (map[etapa] ?? etapa) : '—';
}

// ── drawer lateral ────────────────────────────────────────────────────────────
const Drawer: React.FC<{ contato: ContatoDetalhe | null; onClose: () => void }> = ({ contato, onClose }) => {
  const [followupText, setFollowupText] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const enviarFollowup = async () => {
    if (!contato || !followupText.trim()) return;
    setSending(true);
    try {
      await api.post(`/api/contatos/${contato.id}/followup`, { mensagem: followupText.trim() });
      setFollowupText('');
      setSent(true);
      setTimeout(() => setSent(false), 3000);
    } catch (e: any) {
      alert('Erro ao enviar: ' + e.message);
    } finally { setSending(false); }
  };

  if (!contato) return null;
  const temp = temperaturaLabel(contato.score);
  const hasPet = contato.pet_nome || contato.pet_especie;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="fixed inset-0 bg-black/30" />
      <div
        className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div>
            <h2 className="font-semibold text-slate-900">{contato.nome || contato.telefone || '—'}</h2>
            <p className="text-xs text-slate-500">{contato.telefone || contato.numero_externo || '—'}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Info principais */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">Temperatura</p>
              <Badge variant={temp.variant}>{temp.emoji} {temp.label}</Badge>
              {contato.score != null && <p className="text-xs text-slate-500 mt-1">Score: {contato.score}</p>}
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">Etapa</p>
              <p className="text-sm font-medium text-slate-700">{etapaLabel(contato.etapa)}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">Canal</p>
              <Badge variant={contato.canal === 'whatsapp' ? 'green' : 'blue'}>{contato.canal || '—'}</Badge>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">Interesse</p>
              <p className="text-sm font-medium text-slate-700 truncate">{contato.plano_recomendado || '—'}</p>
            </div>
          </div>

          {/* IA silenciada */}
          {contato.ia_silenciada && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
              <Thermometer className="w-4 h-4 flex-shrink-0" />
              <span>IA silenciada — aguardando atendimento humano</span>
            </div>
          )}

          {/* Pet */}
          {hasPet && (
            <div className="border border-slate-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <PawPrint className="w-4 h-4 text-indigo-500" />
                <h4 className="text-sm font-semibold text-slate-700">Dados do Pet</h4>
              </div>
              <dl className="grid grid-cols-2 gap-y-2 text-xs">
                {[
                  ['Nome', contato.pet_nome],
                  ['Espécie', contato.pet_especie],
                  ['Raça', contato.pet_raca],
                  ['Idade', contato.pet_idade],
                  ['Problema', contato.pet_problema],
                ].map(([k, v]) => v ? (
                  <div key={k as string}>
                    <dt className="text-slate-400">{k}</dt>
                    <dd className="font-medium text-slate-700">{v}</dd>
                  </div>
                ) : null)}
              </dl>
            </div>
          )}

          {/* Histórico */}
          {contato.historico.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 flex items-center gap-1">
                <History className="w-3.5 h-3.5" /> Últimas mensagens
              </h4>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {contato.historico.slice(0, 20).map((m, i) => (
                  <div key={i} className={cn('text-xs rounded-lg px-3 py-2',
                    m.role === 'user' ? 'bg-slate-100 text-slate-700' : 'bg-indigo-50 text-indigo-900')}>
                    <span className="font-medium">{m.role === 'user' ? 'Cliente' : m.enviado_por === 'humano' ? 'Supervisor' : 'IA'}: </span>
                    <span className="whitespace-pre-wrap break-words">{m.conteudo.slice(0, 200)}{m.conteudo.length > 200 ? '…' : ''}</span>
                    <div className="text-[10px] text-slate-400 mt-1">{fmtTempo(m.timestamp)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Follow-up */}
        {contato.conversa_id && (
          <div className="border-t border-slate-200 p-4">
            <p className="text-xs font-medium text-slate-600 mb-2">Enviar follow-up</p>
            <div className="flex gap-2">
              <Input
                value={followupText}
                onChange={e => setFollowupText(e.target.value)}
                placeholder="Digite a mensagem..."
                className="flex-1 text-sm"
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && enviarFollowup()}
              />
              <Button size="sm" onClick={enviarFollowup} disabled={sending || !followupText.trim()}>
                <Send className="w-3.5 h-3.5" />
              </Button>
            </div>
            {sent && <p className="text-xs text-emerald-600 mt-1">Mensagem enviada!</p>}
          </div>
        )}

        {/* Ações */}
        <div className="border-t border-slate-200 p-4 flex gap-2">
          <Button variant="outline" size="sm" className="flex-1"
            onClick={() => {
              if (contato.conversa_id) {
                localStorage.setItem('dashv5_conversa_ativa', contato.conversa_id);
                window.dispatchEvent(new CustomEvent('dashv5-navegar', {
                  detail: { pilar: 'atender', subPage: 'chat', conversaId: contato.conversa_id },
                }));
              }
              onClose();
            }}>
            <MessageSquare className="w-3.5 h-3.5" /> Abrir Chat
          </Button>
        </div>
      </div>
    </div>
  );
};

// ── página principal ──────────────────────────────────────────────────────────
export const ContactsPage: React.FC = () => {
  const socket = useSocket();
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [canal, setCanal]       = useState('');
  const [page, setPage]         = useState(1);
  const [detalhe, setDetalhe]   = useState<ContatoDetalhe | null>(null);
  const [loadingDetalhe, setLoadingDetalhe] = useState(false);
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const LIMIT = 50;

  const carregar = useCallback(async (p = page, s = search, c = canal) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(LIMIT) });
      if (s) params.set('search', s);
      if (c) params.set('canal', c);
      const res = await api.get<any>(`/api/contatos?${params}`);
      setContatos(res.contatos ?? []);
      setTotal(res.total ?? 0);
    } catch (e: any) {
      console.error('[ContactsPage]', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { carregar(1, search, canal); }, [canal]);

  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => { setPage(1); carregar(1, search, canal); }, 350);
    return () => { if (searchRef.current) clearTimeout(searchRef.current); };
  }, [search]);

  useEffect(() => {
    const h = () => carregar(page, search, canal);
    socket.on('conversa_atualizada', h);
    return () => { socket.off('conversa_atualizada', h); };
  }, [socket, page, search, canal, carregar]);

  const abrirDetalhe = async (id: string) => {
    setLoadingDetalhe(true);
    try {
      const res = await api.get<any>(`/api/contatos/${id}`);
      setDetalhe({ ...res.contato, historico: res.historico ?? [] });
    } catch (e: any) {
      console.error('[ContactsPage detalhe]', e);
    } finally { setLoadingDetalhe(false); }
  };

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <>
      <PageHeader title="Contatos" subtitle="Todos os clientes e leads do sistema">
        <Badge variant="secondary">{total} contatos</Badge>
        <Button variant="outline" size="sm" onClick={() => carregar(page, search, canal)}>
          <RefreshCw className="w-3.5 h-3.5" /> Atualizar
        </Button>
      </PageHeader>

      <div className="p-6 flex-1 min-h-0 overflow-y-auto space-y-4">

        {/* Filtros */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Buscar por nome ou telefone..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              value={canal}
              onChange={e => { setCanal(e.target.value); setPage(1); }}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              <option value="">Todos os canais</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="telegram">Telegram</option>
            </select>
          </div>
        </div>

        {/* Tabela */}
        {loading ? <LoadingSpinner />
          : contatos.length === 0 ? (
            <EmptyState icon={Users} title="Nenhum contato encontrado" description="Tente ajustar os filtros de busca." />
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Cliente</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Telefone</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Canal</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Temperatura</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Etapa</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Pet</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Interesse</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Último contato</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {contatos.map(c => {
                      const temp = temperaturaLabel(c.score);
                      return (
                        <tr key={c.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="px-4 py-3">
                            <button
                              onClick={() => abrirDetalhe(c.id)}
                              className="flex items-center gap-2 text-left group"
                            >
                              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                                {(c.nome || c.telefone || '?')[0].toUpperCase()}
                              </div>
                              <div>
                                <p className="font-medium text-slate-900 group-hover:text-indigo-700 transition-colors">
                                  {c.nome || '—'}
                                </p>
                                {c.ia_silenciada && (
                                  <span className="text-[10px] text-amber-600 font-medium">aguarda humano</span>
                                )}
                              </div>
                            </button>
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            <div className="flex items-center gap-1">
                              <Phone className="w-3 h-3 text-slate-400" />
                              {c.telefone || c.numero_externo || '—'}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {c.canal
                              ? <Badge variant={c.canal === 'whatsapp' ? 'green' : 'blue'}>{c.canal}</Badge>
                              : <span className="text-slate-400">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={temp.variant}>
                              {temp.emoji} {temp.label}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-600">{etapaLabel(c.etapa)}</td>
                          <td className="px-4 py-3">
                            {c.pet_nome
                              ? <div className="flex items-center gap-1 text-xs text-slate-600">
                                  <PawPrint className="w-3.5 h-3.5 text-indigo-400" />
                                  {c.pet_nome}
                                </div>
                              : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-600 max-w-[120px] truncate">
                            {c.plano_recomendado || '—'}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500">
                            <div className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {fmtTempo(c.ultima_interacao)}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              {c.conversa_id && (
                                <button
                                  title="Abrir Chat"
                                  onClick={() => {
                                    localStorage.setItem('dashv5_conversa_ativa', c.conversa_id!);
                                    window.dispatchEvent(new CustomEvent('dashv5-navegar', {
                                      detail: { pilar: 'atender', subPage: 'chat', conversaId: c.conversa_id },
                                    }));
                                  }}
                                  className="p-1.5 rounded-lg hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 transition-colors"
                                >
                                  <MessageSquare className="w-4 h-4" />
                                </button>
                              )}
                              <button
                                title="Ver detalhes"
                                onClick={() => abrirDetalhe(c.id)}
                                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                              >
                                <ChevronRight className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Paginação */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
                  <span className="text-xs text-slate-500">
                    {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} de {total}
                  </span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={page === 1}
                      onClick={() => { const p = page - 1; setPage(p); carregar(p, search, canal); }}>
                      Anterior
                    </Button>
                    <Button variant="outline" size="sm" disabled={page >= totalPages}
                      onClick={() => { const p = page + 1; setPage(p); carregar(p, search, canal); }}>
                      Próxima
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
      </div>

      {/* Drawer de detalhe */}
      {loadingDetalhe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <LoadingSpinner />
        </div>
      )}
      {detalhe && <Drawer contato={detalhe} onClose={() => setDetalhe(null)} />}
    </>
  );
};
