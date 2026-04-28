import React, { useEffect, useState, useCallback } from 'react';
import { Activity, RefreshCw, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '@/services/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';

const PAGE_SIZE = 50;

function ms(v: number | null | undefined) {
  if (!v) return '—';
  return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`;
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export const PipelineLogsPage: React.FC = () => {
  const [logs, setLogs]       = useState<any[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(0);
  const [phone, setPhone]     = useState('');
  const [search, setSearch]   = useState('');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const carregar = useCallback(async (p = page, q = search) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(p * PAGE_SIZE) });
      if (q.trim()) qs.set('phone', q.trim());
      const d = await api.get<any>(`/api/pipeline-logs?${qs}`);
      setLogs(d.logs || []);
      setTotal(d.total || 0);
    } catch (e: any) { console.error(e); }
    setLoading(false);
  }, [page, search]);

  useEffect(() => { carregar(page, search); }, [page]);

  const handleSearch = () => { setPage(0); setSearch(phone); carregar(0, phone); };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader title="Logs de Pipeline IA" subtitle="Rastreio de cada mensagem processada pelo agente">
        <Button variant="outline" size="sm" onClick={() => carregar()}>
          <RefreshCw className="w-3.5 h-3.5 mr-1" /> Atualizar
        </Button>
      </PageHeader>

      <div className="p-6 space-y-4 flex-1 min-h-0 overflow-y-auto">
        {/* Filtro */}
        <div className="flex gap-3 items-center flex-wrap">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Filtrar por telefone…"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              className="pl-9"
            />
          </div>
          <Button size="sm" onClick={handleSearch}>Buscar</Button>
          <span className="text-xs text-slate-500 ml-auto">{total} registros · página {page + 1}/{totalPages}</span>
        </div>

        {/* Cards de resumo */}
        {!loading && logs.length > 0 && (() => {
          const ragUsed    = logs.filter(l => l.rag_docs_count > 0).length;
          const rewritten  = logs.filter(l => l.was_rewritten).length;
          const avgLatency = Math.round(logs.reduce((s, l) => s + (l.total_latency_ms || 0), 0) / logs.length);
          return (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Com RAG ativo', value: `${ragUsed} / ${logs.length}`, color: ragUsed > 0 ? 'text-emerald-600' : 'text-slate-400' },
                { label: 'Respostas reescritas', value: rewritten, color: rewritten > 0 ? 'text-amber-600' : 'text-slate-400' },
                { label: 'Latência média', value: ms(avgLatency), color: 'text-indigo-600' },
              ].map(c => (
                <div key={c.label} className="bg-white rounded-xl border border-slate-200 p-4">
                  <p className="text-xs text-slate-500">{c.label}</p>
                  <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Tabela */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {loading
            ? <LoadingSpinner />
            : logs.length === 0
              ? <EmptyState icon={Activity} title="Sem logs" description="Nenhuma interação registrada ainda. Envie uma mensagem para o agente." />
              : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Quando</TableHead>
                      <TableHead>Telefone</TableHead>
                      <TableHead>Guard</TableHead>
                      <TableHead>RAG</TableHead>
                      <TableHead>Histórico</TableHead>
                      <TableHead>Tokens</TableHead>
                      <TableHead>Latência</TableHead>
                      <TableHead>Reescrito?</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map(l => (
                      <React.Fragment key={l.id}>
                        <TableRow
                          className="cursor-pointer hover:bg-slate-50"
                          onClick={() => setExpanded(expanded === l.id ? null : l.id)}
                        >
                          <TableCell className="text-xs whitespace-nowrap">{fmt(l.criado_em)}</TableCell>
                          <TableCell className="text-xs font-mono">{l.thread_id}</TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-0.5">
                              {l.input_guard_intent && (
                                <span className="text-[10px] text-slate-500 font-mono">{l.input_guard_intent}</span>
                              )}
                              <Badge variant={l.input_guard_action === 'pass' ? 'green' : l.input_guard_action === 'drop' ? 'red' : 'amber'}
                                className="text-[10px] w-fit">
                                {l.input_guard_action || '—'}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell>
                            {l.rag_docs_count > 0 ? (
                              <div className="flex flex-col gap-0.5">
                                <Badge variant="green" className="text-[10px] w-fit">{l.rag_docs_count} doc{l.rag_docs_count !== 1 ? 's' : ''}</Badge>
                                <span className="text-[10px] text-slate-400">{l.kb_chars_injected} chars</span>
                              </div>
                            ) : (
                              <Badge variant="outline" className="text-[10px]">Sem RAG</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-slate-600">
                            {l.history_msgs_count > 0 ? `${l.history_msgs_count} msgs` : <span className="text-slate-300">—</span>}
                          </TableCell>
                          <TableCell className="text-xs text-slate-500 font-mono">
                            {l.generation_tokens_in ?? 0}↑ {l.generation_tokens_out ?? 0}↓
                          </TableCell>
                          <TableCell className="text-xs">
                            <div className="flex flex-col">
                              <span className="font-medium">{ms(l.total_latency_ms)}</span>
                              {l.generation_latency_ms > 0 && (
                                <span className="text-[10px] text-slate-400">LLM {ms(l.generation_latency_ms)}</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {l.was_rewritten
                              ? <Badge variant="amber" className="text-[10px]">Reescrito</Badge>
                              : <span className="text-slate-300 text-xs">—</span>}
                          </TableCell>
                        </TableRow>
                        {expanded === l.id && (
                          <TableRow>
                            <TableCell colSpan={8} className="bg-slate-50 px-6 py-3">
                              <div className="space-y-1 text-xs font-mono text-slate-600">
                                <p><span className="text-slate-400">modelo:</span> {l.provider}/{l.model}</p>
                                <p><span className="text-slate-400">rag_sources:</span> {l.rag_sources || '—'}</p>
                                <p><span className="text-slate-400">kb_chars:</span> {l.kb_chars_injected || 0}</p>
                                <p><span className="text-slate-400">rag_latency:</span> {ms(l.rag_latency_ms)}</p>
                                <p><span className="text-slate-400">guard_intent:</span> {l.input_guard_intent || '—'}</p>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    ))}
                  </TableBody>
                </Table>
              )}
        </div>

        {/* Paginação */}
        {totalPages > 1 && (
          <div className="flex items-center gap-2 justify-end">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-xs text-slate-500">{page + 1} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </>
  );
};
