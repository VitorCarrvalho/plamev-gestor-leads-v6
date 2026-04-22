import React, { useEffect, useState } from 'react';
import { ShieldCheck, RefreshCw, Search } from 'lucide-react';
import { api } from '@/services/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';

const ACAO_VARIANT: Record<string, any> = {
  login: 'blue', logout: 'outline',
  provocar: 'purple', instrucao: 'purple', falar_direto: 'purple',
  silenciar_ia: 'amber', ativar_ia: 'green',
  transferir: 'blue', resetar: 'red', excluir_contato: 'red',
  sql_query: 'outline', template_criar: 'green', template_excluir: 'red',
};

export const AuditoriaPage: React.FC = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [acoes, setAcoes] = useState<any[]>([]);
  const [filtro, setFiltro] = useState({ acao: 'all', ator: '' });
  const [loading, setLoading] = useState(true);

  const carregar = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filtro.acao !== 'all') qs.set('acao', filtro.acao);
      if (filtro.ator.trim()) qs.set('ator', filtro.ator.trim());
      const [l, a] = await Promise.all([
        api.get<any>(`/api/auditoria?${qs}`),
        api.get<any>('/api/auditoria/acoes'),
      ]);
      setLogs(l.logs || []);
      setAcoes(a.acoes || []);
    } catch (e: any) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { carregar(); }, [filtro.acao]);

  return (
    <>
      <PageHeader title="Auditoria" subtitle="Log append-only de ações · rastreável por ator e tempo">
        <Button variant="outline" size="sm" onClick={carregar}>
          <RefreshCw className="w-3.5 h-3.5" /> Atualizar
        </Button>
      </PageHeader>

      <div className="p-6 space-y-4 flex-1 min-h-0 overflow-y-auto">
        <div className="flex gap-3 flex-wrap items-center">
          <Select value={filtro.acao} onValueChange={v => setFiltro(f => ({ ...f, acao: v }))}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas ações ({acoes.reduce((s, a) => s + a.n, 0)})</SelectItem>
              {acoes.map(a => <SelectItem key={a.acao} value={a.acao}>{a.acao} ({a.n})</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input placeholder="Buscar por ator (email)…" value={filtro.ator}
              onChange={e => setFiltro(f => ({ ...f, ator: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && carregar()}
              className="pl-9" />
          </div>
          <span className="text-xs text-slate-500 ml-auto">{logs.length} registros</span>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {loading ? <LoadingSpinner />
            : logs.length === 0 ? <EmptyState icon={ShieldCheck} title="Sem logs" description={filtro.acao !== 'all' ? 'Tente outra ação' : 'Nenhum evento gravado ainda'} />
            : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quando</TableHead>
                    <TableHead>Ator</TableHead>
                    <TableHead>Ação</TableHead>
                    <TableHead>Alvo</TableHead>
                    <TableHead>Detalhe</TableHead>
                    <TableHead>IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map(l => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {new Date(l.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </TableCell>
                      <TableCell className="text-xs">{l.ator_email || '—'}</TableCell>
                      <TableCell><Badge variant={ACAO_VARIANT[l.acao] || 'outline'} className="font-mono text-[10px]">{l.acao}</Badge></TableCell>
                      <TableCell className="text-xs font-mono text-slate-500">{l.alvo_tipo ? `${l.alvo_tipo}:${(l.alvo_id || '').slice(0, 12)}` : '—'}</TableCell>
                      <TableCell className="text-xs max-w-[260px] truncate font-mono text-slate-500" title={JSON.stringify(l.detalhe)}>
                        {l.detalhe && Object.keys(l.detalhe).length > 0 ? JSON.stringify(l.detalhe).slice(0, 80) : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-slate-400 font-mono">{l.ator_ip || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
        </div>
      </div>
    </>
  );
};
