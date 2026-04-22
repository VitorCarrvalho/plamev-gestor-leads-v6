import React, { useEffect, useState } from 'react';
import { Award, RefreshCw, DollarSign, MessageSquare, CheckCircle2 } from 'lucide-react';
import { api } from '@/services/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';

export const AgentesPage: React.FC = () => {
  const [agentes, setAgentes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const carregar = async () => {
    setLoading(true);
    try { setAgentes((await api.get<any>('/api/analisar/agentes')).agentes || []); }
    catch (e: any) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { carregar(); }, []);

  return (
    <>
      <PageHeader title="Performance de Agentes" subtitle="Métricas por agente · últimos 30 dias">
        <Button variant="outline" size="sm" onClick={carregar}>
          <RefreshCw className="w-3.5 h-3.5" /> Atualizar
        </Button>
      </PageHeader>

      <div className="p-6 flex-1 min-h-0 overflow-y-auto">
        {loading ? <LoadingSpinner />
          : (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agente</TableHead>
                    <TableHead className="text-right">Total conv</TableHead>
                    <TableHead className="text-right">Conv 30d</TableHead>
                    <TableHead className="text-right">Fechamentos</TableHead>
                    <TableHead className="text-right">Taxa fech.</TableHead>
                    <TableHead className="text-right">Score médio</TableHead>
                    <TableHead className="text-right">Custo 30d</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agentes.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-8 text-slate-400">Sem agentes</TableCell></TableRow>
                  ) : agentes.map(a => {
                    const taxaFech = a.total_conversas > 0 ? (a.fechamentos / a.total_conversas * 100) : 0;
                    return (
                      <TableRow key={a.slug}>
                        <TableCell>
                          <div className="font-medium text-slate-900 text-sm">{a.nome}</div>
                          <code className="text-xs text-slate-500">{a.slug}</code>
                        </TableCell>
                        <TableCell className="text-right font-mono">{a.total_conversas}</TableCell>
                        <TableCell className="text-right font-mono">{a.conv_30d}</TableCell>
                        <TableCell className="text-right font-mono text-emerald-700 font-semibold">{a.fechamentos}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant={taxaFech >= 10 ? 'green' : taxaFech >= 5 ? 'amber' : 'red'}>
                            {taxaFech.toFixed(1)}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">{a.score_medio}/10</TableCell>
                        <TableCell className="text-right font-mono text-xs text-emerald-700">${(a.custo_30d_usd || 0).toFixed(2)}</TableCell>
                        <TableCell><Badge variant={a.ativo ? 'green' : 'red'}>{a.ativo ? 'ativo' : 'inativo'}</Badge></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
      </div>
    </>
  );
};
