import React, { useEffect, useState, useMemo } from 'react';
import { Users, RefreshCw, Phone, Clock } from 'lucide-react';
import { api } from '@/services/api';
import { useSocket } from '@/hooks/useSocket';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';

function fmtTempo(iso: string | null): string {
  if (!iso) return '—';
  const delta = Date.now() - new Date(iso).getTime();
  const min = Math.floor(delta / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

export const FilaPage: React.FC = () => {
  const socket = useSocket();
  const [conversas, setConversas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const carregar = async () => {
    setLoading(true);
    try { setConversas(await api.get<any[]>('/api/conversas')); }
    catch (e: any) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { carregar(); }, []);
  useEffect(() => {
    const h = () => carregar();
    socket.on('nova_msg', h); socket.on('conversa_atualizada', h);
    return () => { socket.off('nova_msg', h); socket.off('conversa_atualizada', h); };
  }, [socket]);

  // Fila = novos leads sem etapa definida ou em acolhimento/qualificação com poucas msgs
  const fila = useMemo(() => conversas.filter(c =>
    !c.etapa || c.etapa === 'acolhimento' || (c.etapa === 'qualificacao' && (c.total_msgs || 0) < 3)
  ), [conversas]);

  return (
    <>
      <PageHeader title="Fila de Leads" subtitle="Novos leads aguardando ou em qualificação inicial">
        <Badge variant="amber">{fila.length} na fila</Badge>
        <Button variant="outline" size="sm" onClick={carregar}>
          <RefreshCw className="w-3.5 h-3.5" /> Atualizar
        </Button>
      </PageHeader>

      <div className="p-6 flex-1 min-h-0 overflow-y-auto">
        {loading ? <LoadingSpinner />
          : fila.length === 0 ? <EmptyState icon={Users} title="Fila vazia" description="Todos os leads já estão sendo trabalhados." />
          : (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente / Pet</TableHead>
                    <TableHead>Canal</TableHead>
                    <TableHead>Etapa</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Última msg</TableHead>
                    <TableHead>Agente</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fila.map(c => {
                    const abrir = () => window.dispatchEvent(new CustomEvent('dashv5-navegar', {
                      detail: { pilar: 'atender', subPage: 'conversa', conversaId: c.conversa_id },
                    }));
                    return (
                    <TableRow
                      key={c.conversa_id}
                      onClick={abrir}
                      className="cursor-pointer hover:bg-indigo-50/60 transition-colors"
                      title="Clique para abrir a conversa"
                    >
                      <TableCell>
                        <div className="font-medium text-slate-900">{c.nome_cliente || '—'}</div>
                        <div className="text-xs text-slate-500 flex items-center gap-1.5">
                          {c.nome_pet && <>🐾 {c.nome_pet} · </>}
                          <Phone className="w-3 h-3" /> {c.phone || '—'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={c.canal === 'whatsapp' ? 'green' : 'blue'}>{c.canal}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">{c.etapa || '—'}</TableCell>
                      <TableCell>
                        <span className="text-xs font-bold tabular-nums">{c.score ?? '—'}</span>
                      </TableCell>
                      <TableCell className="text-xs text-slate-500 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {fmtTempo(c.ultima_msg_ts)}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">{c.agente_slug || '—'}</TableCell>
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
