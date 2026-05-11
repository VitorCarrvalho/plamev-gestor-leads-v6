import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Database, Play, RefreshCw, Shield, AlertCircle, Table2,
  Pencil, Check, X, ChevronLeft, ChevronRight, Search,
} from 'lucide-react';
import { api } from '@/services/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { Input } from '@/components/ui/input';

// ── Tipos ──────────────────────────────────────────────────────────────────
interface TabelaInfo { nome: string; tamanho: string; colunas: number }
interface PreviewData { rows: any[]; limit: number; offset: number; pks: string[] }

// ── Editor inline de célula ────────────────────────────────────────────────
interface CellEditorProps {
  value: any;
  onSave: (val: string) => void;
  onCancel: () => void;
}
const CellEditor: React.FC<CellEditorProps> = ({ value, onSave, onCancel }) => {
  const [v, setV] = useState(value === null ? '' : String(value));
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <div className="flex items-start gap-1 min-w-[160px]">
      <textarea ref={ref} value={v} onChange={e => setV(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSave(v); } if (e.key === 'Escape') onCancel(); }}
        className="font-mono text-xs border border-indigo-400 rounded px-1 py-0.5 w-full min-h-[32px] resize-y bg-white outline-none focus:ring-1 focus:ring-indigo-500" />
      <button onClick={() => onSave(v)} className="p-1 text-green-600 hover:text-green-800"><Check className="w-3.5 h-3.5" /></button>
      <button onClick={onCancel} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>
    </div>
  );
};

// ── Formatação de valor ────────────────────────────────────────────────────
const FmtVal: React.FC<{ v: any }> = ({ v }) => {
  if (v === null) return <span className="text-slate-300 italic">null</span>;
  if (typeof v === 'object') return <code className="text-[10px] text-slate-500">{JSON.stringify(v).slice(0, 80)}</code>;
  const s = String(v);
  const isUrl = s.startsWith('http');
  const isLong = s.length > 80;
  return <span title={isLong ? s : undefined}>{isLong ? s.slice(0, 80) + '…' : s}</span>;
};

// ── Página principal ───────────────────────────────────────────────────────
export const SqlBrowserPage: React.FC = () => {
  const [tabelas, setTabelas]     = useState<TabelaInfo[]>([]);
  const [filtro, setFiltro]       = useState('');
  const [tabelaSel, setTabelaSel] = useState<string | null>(null);
  const [preview, setPreview]     = useState<PreviewData | null>(null);
  const [offset, setOffset]       = useState(0);
  const LIMIT = 50;

  // Estado de edição: { rowIndex, colKey }
  const [editando, setEditando]   = useState<{ row: number; col: string } | null>(null);
  const [salvando, setSalvando]   = useState(false);
  const [editErro, setEditErro]   = useState('');

  const [sql, setSql]     = useState('SELECT slug, nome, ativo FROM planos ORDER BY id;');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro]     = useState('');

  // Carrega lista de tabelas
  useEffect(() => {
    api.get<any>('/db/tables').then(d => setTabelas(d.tabelas || []));
  }, []);

  const tabelasFiltradas = filtro
    ? tabelas.filter(t => t.nome.toLowerCase().includes(filtro.toLowerCase()))
    : tabelas;

  // Abre/recarrega preview de uma tabela
  const abrirTabela = useCallback(async (nome: string, off = 0) => {
    setTabelaSel(nome); setErro(''); setEditando(null); setEditErro(''); setOffset(off);
    const d = await api.get<any>(`/db/preview/${nome}?limit=${LIMIT}&offset=${off}`);
    setPreview(d);
  }, []);

  const trocarTabela = (nome: string) => { setPreview(null); abrirTabela(nome, 0); };

  // Salva edição de célula
  const salvarCelula = async (row: any, col: string, novoValor: string) => {
    if (!tabelaSel || !preview) return;
    setSalvando(true); setEditErro('');
    try {
      const pk = preview.pks.length ? preview.pks : ['id'];
      const pkObj: Record<string, any> = {};
      pk.forEach(k => { pkObj[k] = row[k]; });

      const valorFinal: any = novoValor === '' ? null : novoValor;
      await api.patch(`/db/record/${tabelaSel}`, { pk: pkObj, fields: { [col]: valorFinal } });

      // Atualiza localmente sem recarregar tudo
      setPreview(prev => {
        if (!prev) return prev;
        const rows = prev.rows.map(r => {
          const match = pk.every(k => String(r[k]) === String(pkObj[k]));
          return match ? { ...r, [col]: valorFinal } : r;
        });
        return { ...prev, rows };
      });
      setEditando(null);
    } catch (e: any) {
      setEditErro(e.message || 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  };

  const executarSQL = async () => {
    setLoading(true); setErro(''); setResult(null);
    try { setResult(await api.post<any>('/db/query', { sql })); }
    catch (e: any) { setErro(e.message); }
    setLoading(false);
  };

  const podePaginar = preview && preview.rows.length === LIMIT;
  const podeVoltar  = offset > 0;

  return (
    <>
      <PageHeader title="SQL Browser" subtitle="Todas as tabelas · SELECT livre · Edição via UI (admin)">
        <Badge variant="outline" className="gap-1 text-slate-600">
          <Shield className="w-3 h-3" /> {tabelas.length} tabelas
        </Badge>
      </PageHeader>

      <div className="p-6 flex-1 min-h-0 overflow-hidden flex flex-col">
        <Tabs defaultValue="browse" className="flex-1 min-h-0 flex flex-col">
          <TabsList className="self-start">
            <TabsTrigger value="browse"><Table2 className="w-3.5 h-3.5" /> Navegar</TabsTrigger>
            <TabsTrigger value="query"><Play className="w-3.5 h-3.5" /> Query SQL</TabsTrigger>
          </TabsList>

          {/* ── Navegar ─────────────────────────────────────────────── */}
          <TabsContent value="browse" className="flex-1 min-h-0 mt-4 overflow-hidden">
            <div className="grid grid-cols-[220px_1fr] gap-4 h-full">

              {/* Sidebar de tabelas */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
                <div className="px-3 py-2 border-b border-slate-100 flex-shrink-0">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
                    <input
                      value={filtro} onChange={e => setFiltro(e.target.value)}
                      placeholder="Filtrar tabelas…"
                      className="w-full pl-6 pr-2 py-1 text-xs border border-slate-200 rounded bg-slate-50 focus:outline-none focus:border-indigo-400"
                    />
                  </div>
                </div>
                <div className="overflow-y-auto flex-1">
                  {tabelasFiltradas.map(t => (
                    <button key={t.nome} onClick={() => trocarTabela(t.nome)}
                      className={`w-full text-left px-3 py-1.5 text-xs border-b border-slate-50 hover:bg-slate-50 flex items-center justify-between gap-2 ${tabelaSel === t.nome ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-700'}`}>
                      <span className="font-mono truncate">{t.nome}</span>
                      <span className="text-[10px] text-slate-400 flex-shrink-0">{t.tamanho}</span>
                    </button>
                  ))}
                  {!tabelasFiltradas.length && (
                    <div className="p-4 text-xs text-slate-400 text-center">Nenhuma tabela</div>
                  )}
                </div>
              </div>

              {/* Painel principal */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
                {!tabelaSel ? (
                  <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
                    Selecione uma tabela
                  </div>
                ) : !preview ? (
                  <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>
                ) : (
                  <>
                    {/* Header do painel */}
                    <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
                      <div className="text-xs text-slate-500">
                        <code className="text-indigo-600 font-semibold">{tabelaSel}</code>
                        {' · '}{preview.rows.length} linhas
                        {offset > 0 && ` (offset ${offset})`}
                        {preview.pks.length > 0 && <span className="ml-2 text-slate-400">PK: {preview.pks.join(', ')}</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        {editErro && <span className="text-xs text-red-500">{editErro}</span>}
                        <button onClick={() => abrirTabela(tabelaSel, offset)}
                          className="p-1 text-slate-400 hover:text-slate-700" title="Recarregar">
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                        <button disabled={!podeVoltar} onClick={() => abrirTabela(tabelaSel, Math.max(0, offset - LIMIT))}
                          className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" title="Página anterior">
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        <button disabled={!podePaginar} onClick={() => abrirTabela(tabelaSel, offset + LIMIT)}
                          className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" title="Próxima página">
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Tabela */}
                    <div className="flex-1 overflow-auto">
                      {preview.rows.length === 0 ? (
                        <div className="p-8 text-center text-slate-400 text-sm">Tabela vazia</div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-8 sticky left-0 bg-white z-10" />
                              {Object.keys(preview.rows[0]).map(k => (
                                <TableHead key={k} className="whitespace-nowrap text-xs">{k}</TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {preview.rows.map((row, i) => {
                              const isEditingRow = editando?.row === i;
                              return (
                                <TableRow key={i} className={isEditingRow ? 'bg-indigo-50/40' : 'group'}>
                                  {/* Botão editar linha */}
                                  <TableCell className="w-8 sticky left-0 bg-white group-hover:bg-slate-50 p-0 text-center">
                                    {preview.pks.length > 0 && (
                                      isEditingRow ? (
                                        <button onClick={() => setEditando(null)}
                                          className="p-1 text-slate-400 hover:text-slate-600">
                                          <X className="w-3 h-3" />
                                        </button>
                                      ) : (
                                        <button onClick={() => { setEditando({ row: i, col: '' }); setEditErro(''); }}
                                          className="p-1 text-slate-300 hover:text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                          title="Editar linha">
                                          <Pencil className="w-3 h-3" />
                                        </button>
                                      )
                                    )}
                                  </TableCell>

                                  {Object.entries(row).map(([col, val]) => {
                                    const isEditingCell = isEditingRow && editando?.col === col;
                                    const isPk = preview.pks.includes(col);
                                    return (
                                      <TableCell key={col}
                                        className={`text-xs font-mono whitespace-nowrap max-w-[300px] ${isPk ? 'text-slate-400' : ''}`}>
                                        {isEditingCell ? (
                                          <CellEditor
                                            value={val}
                                            onSave={v => salvarCelula(row, col, v)}
                                            onCancel={() => setEditando({ row: i, col: '' })}
                                          />
                                        ) : (
                                          <div
                                            className={`${isEditingRow && !isPk ? 'cursor-pointer hover:bg-indigo-100 rounded px-1 -mx-1 transition-colors' : ''} truncate`}
                                            onClick={() => { if (isEditingRow && !isPk) setEditando({ row: i, col }); }}
                                            title={isEditingRow && !isPk ? 'Clique para editar' : undefined}>
                                            <FmtVal v={val} />
                                          </div>
                                        )}
                                      </TableCell>
                                    );
                                  })}
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      )}
                    </div>

                    {salvando && (
                      <div className="px-4 py-2 border-t border-slate-100 text-xs text-indigo-600 flex items-center gap-1.5">
                        <LoadingSpinner className="w-3.5 h-3.5" /> Salvando…
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ── Query SQL ────────────────────────────────────────────── */}
          <TabsContent value="query" className="flex-1 min-h-0 mt-4 overflow-y-auto">
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">SQL (SELECT apenas)</label>
                <Textarea value={sql} onChange={e => setSql(e.target.value)}
                  className="font-mono text-sm min-h-[120px]"
                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) executarSQL(); }}
                  placeholder="SELECT … (Ctrl+Enter para executar)" />
              </div>
              <Button onClick={executarSQL} disabled={loading}>
                {loading ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Executando…</> : <><Play className="w-3.5 h-3.5" /> Executar</>}
              </Button>

              {erro && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" /> {erro}
                </div>
              )}

              {result?.rows && (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-2 border-b border-slate-100 text-xs text-slate-500">
                    ✓ {result.count} linha(s)
                  </div>
                  <div className="overflow-auto max-h-[55vh]">
                    {result.rows.length === 0 ? (
                      <div className="p-6 text-center text-slate-400 text-sm">Sem resultados</div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {Object.keys(result.rows[0]).map((k: string) => (
                              <TableHead key={k} className="whitespace-nowrap text-xs">{k}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {result.rows.map((row: any, i: number) => (
                            <TableRow key={i}>
                              {Object.values(row).map((v: any, j: number) => (
                                <TableCell key={j} className="font-mono text-xs whitespace-nowrap">
                                  <FmtVal v={v} />
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
