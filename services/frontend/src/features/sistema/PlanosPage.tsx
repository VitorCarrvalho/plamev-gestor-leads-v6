/**
 * PlanosPage — Gerenciamento de planos, preços e coberturas da API Plamev.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { api } from '@/services/api';
import { PackageOpen, RefreshCw, Plus, Pencil, Check, X, Loader2, Link2, Trash2 } from 'lucide-react';

// ── Tipos ─────────────────────────────────────────────────────────────────
interface Preco { id: number; modalidade: string; valor: number; valor_tabela: number | null; valor_promocional: number | null; valor_oferta: number | null; valor_limite: number | null; ativo: boolean; }
interface Plano { id: number; slug: string; nome: string; descricao: string; ativo: boolean; precos: Preco[]; }
interface CoberturaApi { id: number; plano_nome: string; plano_slug: string; uf: string; cobertura_uuid: string; valor: number; sincronizado_em: string; }

const moeda = (v: any) => v != null ? `R$ ${Number(v).toFixed(2).replace('.', ',')}` : '—';

// ── Tab: Planos & Preços ─────────────────────────────────────────────────
const PlanosTab: React.FC = () => {
  const [planos, setPlanos] = useState<Plano[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Plano>>({});
  const [novoPlano, setNovoPlano] = useState({ slug: '', nome: '', descricao: '' });
  const [showNovo, setShowNovo] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    try { const d = await api.get<{ planos: Plano[] }>('/api/config/planos'); setPlanos(d.planos || []); }
    catch { setPlanos([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const salvarPlano = async (slug: string) => {
    await api.patch(`/api/config/planos/${slug}`, editForm);
    setEditing(null);
    carregar();
  };

  const criarPlano = async () => {
    if (!novoPlano.slug || !novoPlano.nome) return;
    await api.post('/api/config/planos', novoPlano);
    setNovoPlano({ slug: '', nome: '', descricao: '' });
    setShowNovo(false);
    carregar();
  };

  const renderPriceCell = (precos: Preco[], modalidade: string, field: keyof Preco) => {
    const p = precos?.find(item => item.modalidade === modalidade);
    const value = p ? p[field] : null;
    return (
      <td className={`px-4 py-3 text-center text-xs ${field === 'valor_promocional' ? 'text-indigo-600 font-bold' : field === 'valor_oferta' ? 'text-blue-500' : field === 'valor_limite' ? 'text-emerald-500 font-medium' : 'text-slate-400'}`}>
        {moeda(value)}
      </td>
    );
  };

  if (loading) return <div className="flex items-center gap-2 p-8 text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Carregando planos...</div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center px-2">
        <p className="text-sm text-slate-500">{planos.length} planos cadastrados</p>
        <Button size="sm" onClick={() => setShowNovo(!showNovo)}><Plus className="w-4 h-4 mr-1" /> Novo Plano</Button>
      </div>

      {showNovo && (
        <div className="border border-indigo-200 rounded-xl p-4 bg-indigo-50/50 space-y-2 mx-2">
          <p className="text-sm font-medium text-indigo-700">Novo Plano</p>
          <div className="grid grid-cols-3 gap-2">
            <Input placeholder="slug (ex: advance_plus)" value={novoPlano.slug} onChange={e => setNovoPlano(p => ({ ...p, slug: e.target.value }))} />
            <Input placeholder="Nome" value={novoPlano.nome} onChange={e => setNovoPlano(p => ({ ...p, nome: e.target.value }))} />
            <Input placeholder="Descrição" value={novoPlano.descricao} onChange={e => setNovoPlano(p => ({ ...p, descricao: e.target.value }))} />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={criarPlano}><Check className="w-4 h-4 mr-1" /> Salvar</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowNovo(false)}><X className="w-4 h-4" /></Button>
          </div>
        </div>
      )}

      <div className="border border-slate-200 rounded-xl bg-white overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 border-b border-slate-200">
            <tr>
              <th rowSpan={2} className="text-left px-6 py-4 font-bold text-slate-600 uppercase tracking-wider text-[10px]">Plano</th>
              <th colSpan={4} className="text-center px-4 py-2 font-bold text-indigo-700 uppercase tracking-wider text-[10px] border-l border-slate-200 bg-indigo-50/30">
                <div className="flex items-center justify-center gap-2">
                   <PackageOpen className="w-3 h-3" /> CARTÃO DE CRÉDITO
                </div>
              </th>
              <th colSpan={4} className="text-center px-4 py-2 font-bold text-emerald-700 uppercase tracking-wider text-[10px] border-l border-slate-200 bg-emerald-50/30">
                <div className="flex items-center justify-center gap-2">
                   <RefreshCw className="w-3 h-3" /> PIX / BOLETO
                </div>
              </th>
              <th rowSpan={2} className="text-center px-4 py-4 font-bold text-slate-600 uppercase tracking-wider text-[10px] border-l border-slate-200">Ações</th>
            </tr>
            <tr className="bg-slate-50/40">
              <th className="text-center px-4 py-2 font-medium text-slate-400 text-[9px] border-l border-slate-100 uppercase">Tabela</th>
              <th className="text-center px-4 py-2 font-medium text-indigo-400 text-[9px] uppercase">Promocional</th>
              <th className="text-center px-4 py-2 font-medium text-blue-400 text-[9px] uppercase">Oferta</th>
              <th className="text-center px-4 py-2 font-medium text-emerald-400 text-[9px] uppercase">Limite</th>
              
              <th className="text-center px-4 py-2 font-medium text-slate-400 text-[9px] border-l border-slate-200 uppercase">Tabela</th>
              <th className="text-center px-4 py-2 font-medium text-indigo-400 text-[9px] uppercase">Promocional</th>
              <th className="text-center px-4 py-2 font-medium text-blue-400 text-[9px] uppercase">Oferta</th>
              <th className="text-center px-4 py-2 font-medium text-emerald-400 text-[9px] uppercase">Limite</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {planos.map(p => (
              <tr key={p.id} className="hover:bg-slate-50/50 transition-colors group">
                <td className="px-6 py-4">
                  {editing === p.slug ? (
                    <div className="space-y-1">
                      <Input value={editForm.nome ?? p.nome} onChange={e => setEditForm(f => ({ ...f, nome: e.target.value }))} className="h-7 text-xs" />
                      <Input value={editForm.descricao ?? p.descricao ?? ''} onChange={e => setEditForm(f => ({ ...f, descricao: e.target.value }))} className="h-7 text-xs" placeholder="Desc" />
                      <div className="flex gap-1">
                        <Button size="sm" className="h-6 px-2 text-[10px]" onClick={() => salvarPlano(p.slug)}>Ok</Button>
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => setEditing(null)}>X</Button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p className="font-bold text-slate-700">{p.nome}</p>
                      <p className="text-[10px] text-slate-400 font-mono lowercase">{p.slug}</p>
                    </div>
                  )}
                </td>

                {/* Cartão de Crédito */}
                {renderPriceCell(p.precos, 'cartao', 'valor_tabela')}
                {renderPriceCell(p.precos, 'cartao', 'valor_promocional')}
                {renderPriceCell(p.precos, 'cartao', 'valor_oferta')}
                {renderPriceCell(p.precos, 'cartao', 'valor_limite')}

                {/* Pix / Boleto (usando 'pix' como base, pois boleto costuma ser igual) */}
                {renderPriceCell(p.precos, 'pix', 'valor_tabela')}
                {renderPriceCell(p.precos, 'pix', 'valor_promocional')}
                {renderPriceCell(p.precos, 'pix', 'valor_oferta')}
                {renderPriceCell(p.precos, 'pix', 'valor_limite')}

                <td className="px-4 py-3 text-center border-l border-slate-100">
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => { setEditing(p.slug); setEditForm({}); }}>
                    <Pencil className="w-4 h-4 text-slate-400 group-hover:text-indigo-600" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};


// ── Tab: Coberturas API ───────────────────────────────────────────────────
const CoberturasApiTab: React.FC = () => {
  const [coberturas, setCoberturas] = useState<CoberturaApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [ufSync, setUfSync] = useState('MG');
  const [syncResult, setSyncResult] = useState('');
  const [novoMap, setNovoMap] = useState({ plano_nome: '', plano_slug: '', uf: '', cobertura_uuid: '', valor: '' });
  const [showNovo, setShowNovo] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    try { const d = await api.get<{ coberturas: CoberturaApi[] }>('/api/config/planos/coberturas-api/lista'); setCoberturas(d.coberturas || []); }
    catch { setCoberturas([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const sincronizar = async () => {
    if (!ufSync || !/^[A-Z]{2}$/i.test(ufSync)) return;
    setSyncing(true); setSyncResult('');
    try {
      const d = await api.post<{ sincronizados: number; uf: string }>('/api/config/planos/coberturas-api/sincronizar', { uf: ufSync.toUpperCase() });
      setSyncResult(`✅ ${d.sincronizados} planos sincronizados para ${d.uf}`);
      carregar();
    } catch (e: any) { setSyncResult(`❌ ${e.message}`); }
    finally { setSyncing(false); }
  };

  const remover = async (id: number) => {
    await api.delete(`/api/config/planos/coberturas-api/${id}`);
    carregar();
  };

  const adicionarManual = async () => {
    if (!novoMap.plano_nome || !novoMap.uf || !novoMap.cobertura_uuid) return;
    await api.post('/api/config/planos/coberturas-api', {
      ...novoMap,
      valor: novoMap.valor ? parseValor(novoMap.valor) : undefined,
    });
    setNovoMap({ plano_nome: '', plano_slug: '', uf: '', cobertura_uuid: '', valor: '' });
    setShowNovo(false);
    carregar();
  };

  const ufs = [...new Set(coberturas.map(c => c.uf))].sort();

  if (loading) return <div className="flex items-center gap-2 p-8 text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Carregando...</div>;

  return (
    <div className="space-y-4">
      <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 flex flex-wrap gap-3 items-end">
        <div>
          <p className="text-xs font-medium text-slate-600 mb-1">Sincronizar coberturas da API por UF</p>
          <div className="flex gap-2">
            <Input className="h-9 w-20 uppercase" placeholder="UF" value={ufSync} onChange={e => setUfSync(e.target.value.toUpperCase())} maxLength={2} />
            <Button className="h-9" onClick={sincronizar} disabled={syncing}>
              {syncing ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCw className="w-4 h-4 mr-1" />} Sincronizar
            </Button>
          </div>
        </div>
        {syncResult && <p className="text-sm text-slate-600 self-end">{syncResult}</p>}
        <Button size="sm" variant="outline" className="ml-auto self-end" onClick={() => setShowNovo(!showNovo)}>
          <Plus className="w-4 h-4 mr-1" /> Adicionar manual
        </Button>
      </div>

      {showNovo && (
        <div className="border border-indigo-200 rounded-xl p-4 bg-indigo-50/50 space-y-2">
          <p className="text-sm font-medium text-indigo-700">Mapeamento Manual</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Input placeholder="Nome do plano (ex: Advance Plus)" value={novoMap.plano_nome} onChange={e => setNovoMap(p => ({ ...p, plano_nome: e.target.value }))} />
            <Input placeholder="Slug (ex: advance_plus)" value={novoMap.plano_slug} onChange={e => setNovoMap(p => ({ ...p, plano_slug: e.target.value }))} />
            <Input placeholder="UF (ex: MG)" value={novoMap.uf} onChange={e => setNovoMap(p => ({ ...p, uf: e.target.value.toUpperCase() }))} maxLength={2} />
            <Input placeholder="UUID da cobertura (API Plamev)" value={novoMap.cobertura_uuid} onChange={e => setNovoMap(p => ({ ...p, cobertura_uuid: e.target.value }))} className="sm:col-span-2" />
            <Input placeholder="Valor mensal (R$)" value={novoMap.valor} onChange={e => setNovoMap(p => ({ ...p, valor: e.target.value }))} />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={adicionarManual}><Check className="w-4 h-4 mr-1" /> Salvar</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowNovo(false)}><X className="w-4 h-4" /></Button>
          </div>
        </div>
      )}

      {ufs.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <Link2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Nenhuma cobertura mapeada ainda.</p>
          <p className="text-xs mt-1">Use "Sincronizar" com a UF desejada (ex: MG) para importar da API Plamev.</p>
        </div>
      ) : (
        ufs.map(uf => (
          <div key={uf} className="border border-slate-200 rounded-xl bg-white overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-100">
              <Link2 className="w-4 h-4 text-slate-400" />
              <span className="text-sm font-semibold text-slate-700">{uf}</span>
              <span className="text-xs text-slate-400">({coberturas.filter(c => c.uf === uf).length} planos)</span>
            </div>
            <table className="w-full text-xs">
              <thead className="bg-slate-50/70 text-slate-500">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Nome na API</th>
                  <th className="text-left px-4 py-2 font-medium">Slug local</th>
                  <th className="text-left px-4 py-2 font-medium">UUID</th>
                  <th className="text-right px-4 py-2 font-medium">Valor</th>
                  <th className="text-right px-4 py-2 font-medium">Sincronizado</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {coberturas.filter(c => c.uf === uf).map(c => (
                  <tr key={c.id} className="border-t border-slate-50 hover:bg-slate-50/50">
                    <td className="px-4 py-2 font-medium text-slate-800">{c.plano_nome}</td>
                    <td className="px-4 py-2 text-slate-500 font-mono">{c.plano_slug || '—'}</td>
                    <td className="px-4 py-2 text-slate-400 font-mono text-[10px] max-w-[200px] truncate" title={c.cobertura_uuid}>{c.cobertura_uuid}</td>
                    <td className="px-4 py-2 text-right text-slate-700">{c.valor ? moeda(c.valor) : '—'}</td>
                    <td className="px-4 py-2 text-right text-slate-400">{new Date(c.sincronizado_em).toLocaleDateString('pt-BR')}</td>
                    <td className="px-4 py-2 text-right">
                      <button className="text-slate-300 hover:text-red-500 transition-colors p-1" onClick={() => remover(c.id)}>
                        <X className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
};

// ── Página principal ──────────────────────────────────────────────────────
export const PlanosPage: React.FC = () => {
  const [tab, setTab] = useState<'planos' | 'coberturas'>('planos');

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Planos & Coberturas" subtitle="Gerencie planos, preços e mapeamento de coberturas da API Plamev" />

      <div className="flex gap-1 px-6 pt-2 border-b border-slate-200">
        {(['planos', 'coberturas'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              tab === t
                ? 'bg-white border border-b-white border-slate-200 -mb-px text-indigo-600'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'planos' ? 'Planos & Preços' : 'Coberturas API'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-6">
        {tab === 'planos' ? <PlanosTab /> : <CoberturasApiTab />}
      </div>
    </div>
  );
};
