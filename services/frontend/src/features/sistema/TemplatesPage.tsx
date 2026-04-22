import React, { useEffect, useState } from 'react';
import { FileCode2, Plus, Pencil, Trash2, RefreshCw, Keyboard } from 'lucide-react';
import { api, isAdmin } from '@/services/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';

export const TemplatesPage: React.FC = () => {
  const admin = isAdmin();
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<any | null>(null);

  const carregar = async () => {
    setLoading(true);
    try { setTemplates((await api.get<any>('/api/templates')).templates || []); }
    catch (e: any) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { carregar(); }, []);

  const salvar = async () => {
    try {
      const body = { categoria: modal.categoria, atalho: modal.atalho, titulo: modal.titulo, corpo: modal.corpo };
      if (modal.id) await api.patch(`/api/templates/${modal.id}`, body);
      else          await api.post('/api/templates', body);
      setModal(null);
      carregar();
    } catch (e: any) { alert(e.message); }
  };

  const excluir = async (id: number) => {
    if (!confirm('Excluir este template?')) return;
    await api.delete(`/api/templates/${id}`);
    carregar();
  };

  return (
    <>
      <PageHeader title="Templates" subtitle="Respostas pré-prontas · use Ctrl+T no Chat ou digite /atalho">
        <Button variant="outline" size="sm" onClick={carregar}>
          <RefreshCw className="w-3.5 h-3.5" /> Atualizar
        </Button>
        {admin && (
          <Button size="sm" onClick={() => setModal({ categoria: 'geral', atalho: '', titulo: '', corpo: '' })}>
            <Plus className="w-3.5 h-3.5" /> Novo template
          </Button>
        )}
      </PageHeader>

      <div className="p-6 flex-1 min-h-0 overflow-y-auto">
        <div className="mb-4 flex gap-3 p-4 bg-indigo-50 border border-indigo-200 rounded-xl text-sm">
          <Keyboard className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-indigo-900 mb-1">Como usar</div>
            <div className="text-indigo-700 text-xs leading-relaxed">
              Dentro de <strong>Atender → Conversa Ativa</strong>, aperte <kbd className="px-1.5 py-0.5 bg-white border border-indigo-200 rounded text-[10px] font-mono">Ctrl+T</kbd>
              {' '}ou digite o atalho (ex: <code className="bg-white px-1 rounded">/oi</code>) nos campos de mensagem. O texto vai ser inserido automaticamente.
            </div>
          </div>
        </div>

        {loading ? <LoadingSpinner />
          : templates.length === 0 ? <EmptyState icon={FileCode2} title="Sem templates" description="Crie o primeiro para economizar tempo" />
          : (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Atalho</TableHead>
                    <TableHead>Título</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Corpo</TableHead>
                    <TableHead className="text-right">Usos</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.map(t => (
                    <TableRow key={t.id}>
                      <TableCell><code className="text-xs bg-slate-100 px-2 py-0.5 rounded font-mono text-indigo-600">{t.atalho || '—'}</code></TableCell>
                      <TableCell className="font-medium text-slate-900 text-sm">{t.titulo}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{t.categoria}</Badge></TableCell>
                      <TableCell className="text-xs text-slate-600 max-w-[320px] truncate" title={t.corpo}>{t.corpo}</TableCell>
                      <TableCell className="text-right font-mono text-sm tabular-nums">{t.uso_count}</TableCell>
                      <TableCell className="text-right">
                        {admin && (
                          <div className="inline-flex gap-1">
                            <Button size="sm" variant="outline" onClick={() => setModal({ ...t })}><Pencil className="w-3 h-3" /></Button>
                            <Button size="sm" variant="danger-outline" onClick={() => excluir(t.id)}><Trash2 className="w-3 h-3" /></Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
      </div>

      <Dialog open={!!modal} onOpenChange={v => !v && setModal(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{modal?.id ? 'Editar' : 'Novo'} Template</DialogTitle></DialogHeader>
          {modal && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Título</label>
                <Input value={modal.titulo} onChange={e => setModal({ ...modal, titulo: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Categoria</label>
                  <Input value={modal.categoria} onChange={e => setModal({ ...modal, categoria: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Atalho (ex: /oi)</label>
                  <Input value={modal.atalho || ''} onChange={e => setModal({ ...modal, atalho: e.target.value })} placeholder="/atalho" className="font-mono" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Corpo da mensagem</label>
                <Textarea value={modal.corpo} onChange={e => setModal({ ...modal, corpo: e.target.value })} className="min-h-[120px]" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setModal(null)}>Cancelar</Button>
            <Button onClick={salvar}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
