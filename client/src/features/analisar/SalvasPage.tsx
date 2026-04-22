import React, { useEffect, useState } from 'react';
import { Bookmark, Download, Trash2, RefreshCw, Eye } from 'lucide-react';
import { api } from '@/services/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';

export const SalvasPage: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecionada, setSelecionada] = useState<any | null>(null);

  const carregar = async () => {
    setLoading(true);
    try { setItems((await api.get<any>('/api/analisar/salvas')).conversas || []); }
    catch (e: any) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { carregar(); }, []);

  const abrir = async (id: number) => {
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

  const excluir = async (id: number) => {
    if (!confirm('Excluir esta conversa salva?')) return;
    await api.delete(`/api/analisar/salvas/${id}`);
    carregar();
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
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Título</TableHead>
                    <TableHead>Cliente/Pet</TableHead>
                    <TableHead>Tags</TableHead>
                    <TableHead>Salva em</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map(c => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="font-medium text-slate-900 text-sm">{c.titulo || '—'}</div>
                        {c.motivo && <div className="text-xs text-slate-500 mt-0.5">{c.motivo.slice(0, 80)}</div>}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div>{c.nome_cliente || '—'}</div>
                        {c.nome_pet && <div className="text-slate-500">🐾 {c.nome_pet}</div>}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {(c.tags || []).slice(0, 3).map((t: string) => <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>)}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">{new Date(c.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => abrir(c.id)}>
                            <Eye className="w-3 h-3" /> Ver
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => abrir(c.id).then(() => {
                            api.get<any>(`/api/analisar/salvas/${c.id}`).then(d => exportarJSON(d.conversa));
                          })}>
                            <Download className="w-3 h-3" />
                          </Button>
                          <Button size="sm" variant="danger-outline" onClick={() => excluir(c.id)}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
      </div>

      <Dialog open={!!selecionada} onOpenChange={v => !v && setSelecionada(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{selecionada?.titulo}</DialogTitle>
          </DialogHeader>
          {selecionada && (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              {selecionada.motivo && (
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase mb-1">Motivo</div>
                  <div className="text-sm text-slate-700">{selecionada.motivo}</div>
                </div>
              )}
              {selecionada.snapshot_msgs && (
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase mb-1">Mensagens</div>
                  <pre className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs font-mono max-h-64 overflow-y-auto">{JSON.stringify(selecionada.snapshot_msgs, null, 2).slice(0, 5000)}</pre>
                </div>
              )}
              {selecionada.snapshot_perfil && (
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase mb-1">Perfil</div>
                  <pre className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs font-mono">{JSON.stringify(selecionada.snapshot_perfil, null, 2)}</pre>
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
    </>
  );
};
