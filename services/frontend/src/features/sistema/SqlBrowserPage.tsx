import React, { useEffect, useState } from 'react';
import { Database, Play, RefreshCw, Shield, AlertCircle, Table2 } from 'lucide-react';
import { api } from '@/services/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';

export const SqlBrowserPage: React.FC = () => {
  const [tabelas, setTabelas] = useState<any[]>([]);
  const [tabelaSel, setTabelaSel] = useState<string | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [sql, setSql] = useState('SELECT slug, nome, ativo FROM planos ORDER BY id;');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    api.get<any>('/db/tables').then(d => setTabelas(d.tabelas || []));
  }, []);

  const abrirTabela = async (nome: string) => {
    setTabelaSel(nome); setErro('');
    const d = await api.get<any>(`/db/preview/${nome}?limit=50`);
    setPreview(d);
  };

  const executarSQL = async () => {
    setLoading(true); setErro(''); setResult(null);
    try { setResult(await api.post<any>('/db/query', { sql })); }
    catch (e: any) { setErro(e.message); }
    setLoading(false);
  };

  return (
    <>
      <PageHeader title="SQL Browser" subtitle="Consulta segura ao banco mariv3 · WHITELIST de tabelas · SELECT apenas">
        <Badge variant="green" className="gap-1"><Shield className="w-3 h-3" /> Whitelist ativa</Badge>
      </PageHeader>

      <div className="p-6 flex-1 min-h-0 overflow-hidden flex flex-col">
        <Tabs defaultValue="browse" className="flex-1 min-h-0 flex flex-col">
          <TabsList className="self-start">
            <TabsTrigger value="browse"><Table2 className="w-3.5 h-3.5" /> Navegar</TabsTrigger>
            <TabsTrigger value="query"><Play className="w-3.5 h-3.5" /> Query SQL</TabsTrigger>
          </TabsList>

          {/* Browse tabelas */}
          <TabsContent value="browse" className="flex-1 min-h-0 mt-4 overflow-hidden">
            <div className="grid grid-cols-[260px_1fr] gap-4 h-full">
              <div className="bg-white border border-slate-200 rounded-xl overflow-y-auto">
                <div className="px-3 py-2 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                  <Database className="w-3 h-3" /> {tabelas.length} tabelas
                </div>
                {tabelas.map(t => (
                  <button key={t.nome} onClick={() => abrirTabela(t.nome)}
                    className={`w-full text-left px-3 py-2 text-xs border-b border-slate-100 hover:bg-slate-50 flex items-center justify-between ${tabelaSel === t.nome ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700'}`}>
                    <span className="font-mono truncate">{t.nome}</span>
                    <span className="text-[10px] text-slate-400 flex-shrink-0 ml-2">{t.tamanho}</span>
                  </button>
                ))}
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
                {!preview ? (
                  <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Selecione uma tabela</div>
                ) : (
                  <>
                    <div className="px-4 py-2 border-b border-slate-100 text-xs text-slate-500 flex-shrink-0">
                      <code className="text-indigo-600 font-semibold">{tabelaSel}</code> · {preview.rows?.length || 0} linhas · limite 50
                    </div>
                    <div className="flex-1 overflow-auto">
                      {preview.rows && preview.rows.length > 0 && (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              {Object.keys(preview.rows[0]).map(k => <TableHead key={k} className="whitespace-nowrap">{k}</TableHead>)}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {preview.rows.map((row: any, i: number) => (
                              <TableRow key={i}>
                                {Object.values(row).map((v: any, j: number) => (
                                  <TableCell key={j} className="font-mono text-xs whitespace-nowrap">
                                    {v === null ? <span className="text-slate-300">null</span>
                                      : typeof v === 'object' ? <code className="text-[10px] text-slate-500">{JSON.stringify(v).slice(0, 60)}</code>
                                      : String(v).slice(0, 80)}
                                  </TableCell>
                                ))}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </TabsContent>

          {/* Query SQL */}
          <TabsContent value="query" className="flex-1 min-h-0 mt-4 overflow-y-auto">
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">SQL (SELECT apenas)</label>
                <Textarea value={sql} onChange={e => setSql(e.target.value)}
                  className="font-mono text-sm min-h-[120px]"
                  placeholder="SELECT ..." />
              </div>
              <Button onClick={executarSQL} disabled={loading}>
                {loading ? 'Executando…' : <><Play className="w-3.5 h-3.5" /> Executar</>}
              </Button>

              {erro && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" /> {erro}
                </div>
              )}

              {result && result.rows && (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-2 border-b border-slate-100 text-xs text-slate-500">
                    ✓ {result.count} linha(s) · limit 500 aplicado automaticamente se não especificado
                  </div>
                  <div className="overflow-auto max-h-[50vh]">
                    {result.rows.length === 0 ? <div className="p-6 text-center text-slate-400 text-sm">Sem resultados</div>
                      : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              {Object.keys(result.rows[0]).map((k: string) => <TableHead key={k} className="whitespace-nowrap">{k}</TableHead>)}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {result.rows.map((row: any, i: number) => (
                              <TableRow key={i}>
                                {Object.values(row).map((v: any, j: number) => (
                                  <TableCell key={j} className="font-mono text-xs whitespace-nowrap">
                                    {v === null ? <span className="text-slate-300">null</span>
                                      : typeof v === 'object' ? <code className="text-[10px]">{JSON.stringify(v).slice(0, 80)}</code>
                                      : String(v).slice(0, 100)}
                                  </TableCell>
                                ))}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                  </div>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
};
