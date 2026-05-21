import React, { useEffect, useState } from 'react';
import { Bookmark, Download, Trash2, RefreshCw, Eye, Sparkles, FlaskConical, Loader2 } from 'lucide-react';
import { api } from '@/services/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { AnaliseModal, type AnaliseConversa } from './components/AnaliseModal';

// ── Badge de tipo de resultado ────────────────────────────────────
function TipoResultadoBadge({ tipo }: { tipo: string }) {
  if (tipo === 'sucesso') return <Badge variant="green" className="text-[10px]">🏆 Venda</Badge>;
  if (tipo === 'falha') return <Badge variant="red" className="text-[10px]">❌ Falha</Badge>;
  return <Badge variant="secondary" className="text-[10px]">📋 Análise</Badge>;
}

export const SalvasPage: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecionada, setSelecionada] = useState<any | null>(null);

  // Estado de análise IA
  const [analiseLoading, setAnaliseLoading] = useState<Set<string>>(new Set());
  const [analiseAberta, setAnaliseAberta] = useState<{ id: string; titulo: string; tipoResultado: string; analise: AnaliseConversa } | null>(null);

  const carregar = async () => {
    setLoading(true);
    try { setItems((await api.get<any>('/api/analisar/salvas')).conversas || []); }
    catch (e: any) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { carregar(); }, []);

  const abrir = async (id: string) => {
    const d = await api.get<any>(`/api/analisar/salvas/${id}`);
    setSelecionada(d.conversa);
  };

  const exportarJSON = (c: any) => {
    const blob = new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversa-${c.id}-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const excluir = async (id: string) => {
    if (!confirm('Excluir esta conversa salva?')) return;
    await api.delete(`/api/analisar/salvas/${id}`);
    carregar();
  };

  const pollAnalise = async (item: any, tentativas = 0): Promise<void> => {
    if (tentativas > 40) {
      setAnaliseLoading(prev => { const s = new Set(prev); s.delete(item.id); return s; });
      alert('Tempo limite excedido. Tente novamente em instantes.');
      return;
    }
    try {
      const r = await api.get<any>(`/api/analisar/salvas/${item.id}/status-analise`);
      if (r.status === 'concluida' && r.analise) {
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, tem_analise: true } : i));
        setAnaliseLoading(prev => { const s = new Set(prev); s.delete(item.id); return s; });
        setAnaliseAberta({
          id: item.id,
          titulo: item.titulo || '—',
          tipoResultado: item.tipo_resultado || 'analise',
          analise: r.analise,
        });
      } else if (r.status === 'erro') {
        setAnaliseLoading(prev => { const s = new Set(prev); s.delete(item.id); return s; });
        alert('Erro ao processar análise. Verifique os logs do servidor.');
      } else {
        setTimeout(() => pollAnalise(item, tentativas + 1), 3000);
      }
    } catch (e: any) {
      setAnaliseLoading(prev => { const s = new Set(prev); s.delete(item.id); return s; });
      alert(`Erro ao verificar análise: ${e.message}`);
    }
  };

  const analisar = async (item: any) => {
    setAnaliseLoading(prev => new Set(prev).add(item.id));
    try {
      const r = await api.post<any>(`/api/analisar/salvas/${item.id}/analisar`, {});
      if (r.status === 'concluida' && r.analise) {
        // Resultado cached — exibe direto
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, tem_analise: true } : i));
        setAnaliseLoading(prev => { const s = new Set(prev); s.delete(item.id); return s; });
        setAnaliseAberta({ id: item.id, titulo: item.titulo || '—', tipoResultado: item.tipo_resultado || 'analise', analise: r.analise });
      } else {
        // Processando em background → inicia polling
        pollAnalise(item, 0);
      }
    } catch (e: any) {
      setAnaliseLoading(prev => { const s = new Set(prev); s.delete(item.id); return s; });
      alert(`Erro ao analisar: ${e.message}`);
    }
  };

  const verAnalise = async (item: any) => {
    setAnaliseLoading(prev => new Set(prev).add(item.id));
    try {
      const r = await api.post<any>(`/api/analisar/salvas/${item.id}/analisar`, {});
      if (r.status === 'concluida' && r.analise) {
        setAnaliseLoading(prev => { const s = new Set(prev); s.delete(item.id); return s; });
        setAnaliseAberta({ id: item.id, titulo: item.titulo || '—', tipoResultado: item.tipo_resultado || 'analise', analise: r.analise });
      } else {
        pollAnalise(item, 0);
      }
    } catch (e: any) {
      setAnaliseLoading(prev => { const s = new Set(prev); s.delete(item.id); return s; });
      alert(`Erro ao carregar análise: ${e.message}`);
    }
  };

  return (
    <>
      <PageHeader title="Conversas Salvas" subtitle="Histórico de conversas arquivadas para análise">
        <Button variant="outline" size="sm" onClick={carregar}>
          <RefreshCw className="w-3.5 h-3.5" /> Atualizar
        </Button>
      </PageHeader>

      <div className="p-6 flex-1 min-h-0 overflow-y-auto">
        {loading ? <LoadingSpinner />
          : items.length === 0 ? <EmptyState icon={Bookmark} title="Nenhuma conversa salva" description="Conversas salvas em 'Atender' aparecem aqui." />
          : (
            <div className="bg-surface rounded-xl border border-border shadow-sm overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Título</TableHead>
                    <TableHead>Cliente/Pet</TableHead>
                    <TableHead>Tipo / Tags</TableHead>
                    <TableHead>Salva em</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map(c => {
                    const isLoading = analiseLoading.has(c.id);
                    return (
                      <TableRow key={c.id}>
                        <TableCell>
                          <div className="font-medium text-text text-sm">{c.titulo || '—'}</div>
                          {c.motivo && <div className="text-xs text-text-muted mt-0.5">{c.motivo.slice(0, 80)}</div>}
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="text-text">{c.nome_cliente || '—'}</div>
                          {c.nome_pet && <div className="text-text-muted">🐾 {c.nome_pet}</div>}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            <Badge
                              variant={c.tipo === 'sandbox' ? 'blue' : 'green'}
                              className="text-[10px]"
                            >
                              {c.tipo === 'sandbox' ? '🧪 Simulator' : '💬 Chat Real'}
                            </Badge>
                            {c.tipo === 'real' && (
                              <TipoResultadoBadge tipo={c.tipo_resultado || 'analise'} />
                            )}
                            {(c.tags || []).filter((t: string) => t !== 'simulator').slice(0, 2).map((t: string) => (
                              <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-text-faint">{new Date(c.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex gap-1 flex-wrap justify-end">
                            {/* Botão de análise IA (apenas conversas reais) */}
                            {c.tipo === 'real' && (
                              c.tem_analise ? (
                                <Button size="sm" variant="outline" onClick={() => verAnalise(c)} disabled={isLoading}>
                                  {isLoading
                                    ? <Loader2 className="w-3 h-3 animate-spin" />
                                    : <FlaskConical className="w-3 h-3" />}
                                  Ver Análise
                                </Button>
                              ) : (
                                <Button size="sm" variant="outline" onClick={() => analisar(c)} disabled={isLoading}>
                                  {isLoading
                                    ? <><Loader2 className="w-3 h-3 animate-spin" /> Analisando…</>
                                    : <><Sparkles className="w-3 h-3" /> Analisar</>}
                                </Button>
                              )
                            )}
                            <Button size="sm" variant="outline" onClick={() => abrir(c.id)}>
                              <Eye className="w-3 h-3" /> Ver
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => abrir(c.id).then(() => selecionada && exportarJSON(selecionada))}>
                              <Download className="w-3 h-3" />
                            </Button>
                            <Button size="sm" variant="danger-outline" onClick={() => excluir(c.id)}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
      </div>

      {/* Modal: ver conversa (existente) */}
      <Dialog open={!!selecionada} onOpenChange={v => !v && setSelecionada(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{selecionada?.titulo}</DialogTitle>
          </DialogHeader>
          {selecionada && (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              {selecionada.motivo && (
                <div>
                  <div className="text-xs font-semibold text-text-muted uppercase mb-1">Motivo</div>
                  <div className="text-sm text-text">{selecionada.motivo}</div>
                </div>
              )}
              {selecionada.snapshot_msgs && (
                <div>
                  <div className="text-xs font-semibold text-text-muted uppercase mb-1">Mensagens</div>
                  <pre className="bg-surface-2 border border-border rounded-lg p-3 text-xs font-mono max-h-64 overflow-y-auto">{JSON.stringify(selecionada.snapshot_msgs, null, 2).slice(0, 5000)}</pre>
                </div>
              )}
              {selecionada.snapshot_perfil && (
                <div>
                  <div className="text-xs font-semibold text-text-muted uppercase mb-1">Perfil</div>
                  <pre className="bg-surface-2 border border-border rounded-lg p-3 text-xs font-mono">{JSON.stringify(selecionada.snapshot_perfil, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelecionada(null)}>Fechar</Button>
            <Button onClick={() => selecionada && exportarJSON(selecionada)}>
              <Download className="w-3.5 h-3.5" /> Exportar JSON
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: análise IA */}
      {analiseAberta && (
        <AnaliseModal
          open={!!analiseAberta}
          onClose={() => setAnaliseAberta(null)}
          titulo={analiseAberta.titulo}
          tipoResultado={analiseAberta.tipoResultado}
          analise={analiseAberta.analise}
        />
      )}
    </>
  );
};
