import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar, RefreshCw, X, Phone, Clock, Search, Pencil, CalendarClock, Save, Loader2,
  ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { api } from '@/services/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';

function fmtFone(p: string | null): string {
  if (!p) return '—';
  const d = p.replace(/\D/g, '');
  if (d.length === 13) return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return p;
}

// Paginação — valores suportados. -1 = "todos"
const OPCOES_PAGINA = [25, 50, 100, -1];

export const AgendaPage: React.FC = () => {
  const [status, setStatus] = useState('pendente');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Busca, ordenação e paginação — 100% client-side
  const [busca, setBusca] = useState('');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [porPagina, setPorPagina] = useState<number>(25);
  const [pagina, setPagina] = useState<number>(1);

  const carregar = async () => {
    setLoading(true);
    try { setItems((await api.get<any>(`/api/agenda?status=${status}`)).agendamentos || []); }
    catch (e: any) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { carregar(); }, [status]);

  // Qualquer mudança de filtro reseta pra pág. 1
  useEffect(() => { setPagina(1); }, [busca, porPagina, status, sortDir]);

  const cancelar = async (id: string) => {
    if (!confirm('Cancelar este agendamento?')) return;
    await api.post(`/api/agenda/${id}/cancelar`, {});
    carregar();
  };

  // Modal unificado: editar mensagem + reagendar. Aberto pelos 2 botões (Editar/Reagendar)
  // e focado no campo apropriado. Envia PATCH /:id com ambos os campos.
  const [editandoItem, setEditandoItem] = useState<any | null>(null);
  const [focoModal, setFocoModal] = useState<'mensagem' | 'data'>('mensagem');
  const [editMsg, setEditMsg] = useState('');
  const [editQuando, setEditQuando] = useState('');
  const [salvandoEdit, setSalvandoEdit] = useState(false);

  const abrirEdicao = (a: any, foco: 'mensagem' | 'data') => {
    setEditandoItem(a);
    setFocoModal(foco);
    setEditMsg(a.mensagem || '');
    // datetime-local precisa de "YYYY-MM-DDTHH:mm" na timezone local
    const dt = new Date(a.executar_em);
    const pad = (n: number) => String(n).padStart(2, '0');
    setEditQuando(
      `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`
    );
  };

  const salvarEdicao = async () => {
    if (!editandoItem) return;
    setSalvandoEdit(true);
    try {
      await api.patch(`/api/agenda/${editandoItem.id}`, {
        mensagem: editMsg,
        executar_em: new Date(editQuando).toISOString(),
      });
      setEditandoItem(null);
      carregar();
    } catch (e: any) {
      alert('Erro ao salvar: ' + (e?.message || 'desconhecido'));
    } finally { setSalvandoEdit(false); }
  };

  // minDateTime pro input: agora + 1 min (não aceitar datas já passadas)
  const minDateTime = (() => {
    const d = new Date(Date.now() + 60_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();

  const variantStatus = (s: string): any =>
    s === 'pendente' ? 'amber' : s === 'executado' ? 'green' : s === 'cancelado' ? 'red' : 'outline';

  // Filtra → Ordena → Pagina
  const itemsFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return items;
    return items.filter(a =>
      (a.nome_cliente || '').toLowerCase().includes(q) ||
      (a.nome_pet     || '').toLowerCase().includes(q) ||
      (a.phone        || '').includes(q) ||
      (a.mensagem     || '').toLowerCase().includes(q) ||
      (a.tipo         || '').toLowerCase().includes(q)
    );
  }, [items, busca]);

  const itemsOrdenados = useMemo(() => {
    const arr = [...itemsFiltrados];
    arr.sort((a, b) => {
      const ta = new Date(a.executar_em).getTime() || 0;
      const tb = new Date(b.executar_em).getTime() || 0;
      return sortDir === 'desc' ? tb - ta : ta - tb;
    });
    return arr;
  }, [itemsFiltrados, sortDir]);

  const totalPaginas = porPagina === -1 ? 1 : Math.max(1, Math.ceil(itemsOrdenados.length / porPagina));
  const inicio = porPagina === -1 ? 0 : (pagina - 1) * porPagina;
  const fim    = porPagina === -1 ? itemsOrdenados.length : inicio + porPagina;
  const itemsPagina = itemsOrdenados.slice(inicio, fim);

  return (
    <>
      <PageHeader title="Agenda" subtitle="Mensagens programadas de reengajamento e follow-up">
        <div className="relative w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <Input
            placeholder="Buscar cliente, pet, telefone, mensagem…"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pendente">Pendentes</SelectItem>
            <SelectItem value="executado">Executados</SelectItem>
            <SelectItem value="cancelado">Cancelados</SelectItem>
            <SelectItem value="todos">Todos</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={carregar}>
          <RefreshCw className="w-3.5 h-3.5" /> Atualizar
        </Button>
      </PageHeader>

      <div className="p-6 flex-1 min-h-0 overflow-y-auto flex flex-col gap-3">
        {/* Contador de resultados */}
        {!loading && (
          <div className="text-xs text-slate-500 flex items-center gap-2">
            <span>
              {itemsOrdenados.length === 0
                ? 'Nenhum resultado'
                : porPagina === -1
                  ? `${itemsOrdenados.length} resultado${itemsOrdenados.length === 1 ? '' : 's'}`
                  : `${inicio + 1}–${Math.min(fim, itemsOrdenados.length)} de ${itemsOrdenados.length}`
              }
            </span>
            {busca && (
              <span className="text-slate-400">
                · filtrado de <b>{items.length}</b> total
              </span>
            )}
          </div>
        )}

        {loading ? <LoadingSpinner />
          : itemsOrdenados.length === 0 ? <EmptyState icon={Calendar} title={busca ? 'Nenhum agendamento encontrado' : `Sem agendamentos ${status}`} />
          : (
            <>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente / Pet</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Mensagem</TableHead>
                      <TableHead>
                        <button
                          onClick={() => setSortDir(d => (d === 'desc' ? 'asc' : 'desc'))}
                          className="flex items-center gap-1 hover:text-indigo-600 transition-colors font-semibold"
                          title={sortDir === 'desc' ? 'Mais recente primeiro (clique para inverter)' : 'Mais antigo primeiro (clique para inverter)'}
                        >
                          Quando
                          {sortDir === 'desc'
                            ? <ArrowDownWideNarrow className="w-3.5 h-3.5 text-indigo-600" />
                            : <ArrowUpNarrowWide  className="w-3.5 h-3.5 text-indigo-600" />
                          }
                        </button>
                      </TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {itemsPagina.map(a => (
                      <TableRow key={a.id}>
                        <TableCell>
                          <div className="font-medium text-slate-900 text-sm">{a.nome_cliente || '—'}</div>
                          <div className="text-xs text-slate-500 flex items-center gap-1.5">
                            {a.nome_pet && <>🐾 {a.nome_pet} · </>}
                            <Phone className="w-3 h-3" /> {fmtFone(a.phone)}
                          </div>
                        </TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{a.tipo || '—'}</Badge></TableCell>
                        <TableCell className="max-w-[300px] text-xs text-slate-600 truncate" title={a.mensagem}>
                          {a.mensagem || '—'}
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="flex items-center gap-1 text-slate-600">
                            <Clock className="w-3 h-3" />
                            {new Date(a.executar_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </TableCell>
                        <TableCell><Badge variant={variantStatus(a.status)}>{a.status}</Badge></TableCell>
                        <TableCell>
                          {a.status === 'pendente' && (
                            <div className="flex gap-1">
                              <Button size="sm" variant="outline" onClick={() => abrirEdicao(a, 'mensagem')} title="Editar mensagem">
                                <Pencil className="w-3 h-3" /> Editar
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => abrirEdicao(a, 'data')} title="Reagendar data/hora">
                                <CalendarClock className="w-3 h-3" /> Reagendar
                              </Button>
                              <Button size="sm" variant="danger-outline" onClick={() => cancelar(a.id)} title="Cancelar agendamento">
                                <X className="w-3 h-3" /> Cancelar
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Rodapé — paginação + seletor de tamanho */}
              <div className="flex items-center justify-between gap-3 text-xs text-slate-600 flex-wrap">
                <div className="flex items-center gap-2">
                  <span>Mostrar</span>
                  <Select
                    value={String(porPagina)}
                    onValueChange={v => setPorPagina(parseInt(v, 10))}
                  >
                    <SelectTrigger className="w-24 h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {OPCOES_PAGINA.map(n => (
                        <SelectItem key={n} value={String(n)}>
                          {n === -1 ? 'todos' : `${n}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span>por página</span>
                </div>

                {porPagina !== -1 && totalPaginas > 1 && (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pagina === 1}
                      onClick={() => setPagina(p => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </Button>
                    <span>
                      Página <b>{pagina}</b> de <b>{totalPaginas}</b>
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pagina === totalPaginas}
                      onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))}
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
      </div>

      {/* ── Modal Editar & Reagendar ──────────────────────────────── */}
      <Dialog open={!!editandoItem} onOpenChange={v => { if (!v) setEditandoItem(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-4 h-4 text-indigo-600" /> Editar & Reagendar
              {editandoItem?.nome_cliente && (
                <span className="text-sm font-normal text-slate-500">· {editandoItem.nome_cliente}</span>
              )}
            </DialogTitle>
          </DialogHeader>

          {editandoItem && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Mensagem</label>
                <Textarea
                  value={editMsg}
                  onChange={e => setEditMsg(e.target.value)}
                  rows={8}
                  className="text-sm font-mono"
                  autoFocus={focoModal === 'mensagem'}
                  placeholder="Texto da mensagem que a Mari enviará…"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  {editMsg.length} caracteres · use `*texto*` para negrito, `~~texto~~` para riscado
                </p>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Quando enviar</label>
                <Input
                  type="datetime-local"
                  value={editQuando}
                  onChange={e => setEditQuando(e.target.value)}
                  min={minDateTime}
                  autoFocus={focoModal === 'data'}
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Horário local do servidor. Não pode ser no passado.
                </p>
              </div>

              {editandoItem.tipo && (
                <div className="text-[11px] text-slate-500">
                  <span className="font-medium">Tipo:</span> <code>{editandoItem.tipo}</code>
                  {editandoItem.phone && <> · <span className="font-medium">Fone:</span> {fmtFone(editandoItem.phone)}</>}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditandoItem(null)} disabled={salvandoEdit}>
              Cancelar
            </Button>
            <Button
              onClick={salvarEdicao}
              disabled={salvandoEdit || !editMsg.trim() || !editQuando}
            >
              {salvandoEdit
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Salvando…</>
                : <><Save className="w-3.5 h-3.5" /> Atualizar</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
