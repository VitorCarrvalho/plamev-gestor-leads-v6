/**
 * PlanosPage — Gerenciamento de planos, preços e coberturas da API Plamev.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { api } from '@/services/api';
import { PackageOpen, RefreshCw, Plus, Pencil, Check, X, Loader2, Link2 } from 'lucide-react';

// ── Tipos ─────────────────────────────────────────────────────────────────
interface Preco { modalidade: string; valor: number; valor_tabela: number; valor_promocional: number; ativo: boolean; }
interface Plano { id: number; slug: string; nome: string; descricao: string; ativo: boolean; precos: Preco[]; }
interface CoberturaApi { id: number; plano_nome: string; plano_slug: string; uf: string; cobertura_uuid: string; valor: number; sincronizado_em: string; plano_nome_local: string; }

// ── Helpers ──────────────────────────────────────────────────────────────
const moeda = (v: number) => v != null ? `R$ ${Number(v).toFixed(2).replace('.', ',')}` : '—';

// ── Tab: Planos & Preços ─────────────────────────────────────────────────
const PlanosTab: React.FC = () => {
  const [planos, setPlanos] = useState<Plano[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [novoPlano, setNovoPlano] = useState({ slug: '', nome: '', descricao: '' });
  const [showNovo, setShowNovo] = useState(false);
  const [precoForm, setPrecoForm] = useState<{ [slug: string]: { modalidade: string; valor: string } }>({});

  const carregar = useCallback(async () => {
    setLoading(true);
    try { const d = await api('/api/config/planos'); setPlanos(d.planos || []); }
    catch { setPlanos([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const salvarPlano = async (slug: string) => {
    await api(`/api/config/planos/${slug}`, { method: 'PATCH', body: JSON.stringify(editForm) });
    setEditing(null);
    carregar();
  };

  const criarPlano = async () => {
    if (!novoPlano.slug || !novoPlano.nome) return;
    await api('/api/config/planos', { method: 'POST', body: JSON.stringify(novoPlano) });
    setNovoPlano({ slug: '', nome: '', descricao: '' });
    setShowNovo(false);
    carregar();
  };

  const adicionarPreco = async (slug: string) => {
    const f = precoForm[slug];
    if (!f?.modalidade || !f?.valor) return;
    await api(`/api/config/planos/${slug}/preco`, {
      method: 'POST',
      body: JSON.stringify({ modalidade: f.modalidade, valor: parseFloat(f.valor) }),
    });
    setPrecoForm(prev => ({ ...prev, [slug]: { modalidade: 'cartao', valor: '' } }));
    carregar();
  };

  if (loading) return <div className="flex items-center gap-2 p-8 text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Carregando planos...</div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-slate-500">{planos.length} planos cadastrados</p>
        <Button size="sm" onClick={() => setShowNovo(!showNovo)}><Plus className="w-4 h-4 mr-1" /> Novo Plano</Button>
      </div>

      {showNovo && (
        <div className="border border-indigo-200 rounded-xl p-4 bg-indigo-50/50 space-y-2">
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

      {planos.map(p => (
        <div key={p.slug} className="border border-slate-200 rounded-xl bg-white">
          <div className="flex items-center gap-3 p-4 border-b border-slate-100">
            <PackageOpen className="w-5 h-5 text-indigo-500 shrink-0" />
            {editing === p.slug ? (
              <div className="flex gap-2 flex-1">
                <Input value={editForm.nome ?? p.nome} onChange={e => setEditForm((f: any) => ({ ...f, nome: e.target.value }))} className="h-8 text-sm" />
                <Input value={editForm.descricao ?? p.descricao ?? ''} onChange={e => setEditForm((f: any) => ({ ...f, descricao: e.target.value }))} className="h-8 text-sm" placeholder="Descrição" />
                <Button size="sm" onClick={() => salvarPlano(p.slug)}><Check className="w-4 h-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}><X className="w-4 h-4" /></Button>
              </div>
            ) : (
              <div className="flex items-center gap-3 flex-1">
                <span className="font-semibold text-slate-800">{p.nome}</span>
                <span className="text-xs text-slate-400 font-mono">{p.slug}</span>
                {p.descricao && <span className="text-xs text-slate-500">{p.descricao}</span>}
                <Badge variant={p.ativo ? 'default' : 'secondary'} className="ml-auto">{p.ativo ? 'Ativo' : 'Inativo'}</Badge>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditing(p.slug); setEditForm({}); }}>
                  <Pencil className="w-3 h-3" />
                </Button>
              </div>
            )}
          </div>

          <div className="p-4">
            <p className="text-xs font-medium text-slate-500 mb-2">Preços vigentes</p>
            {(p.precos || []).length === 0 ? (
              <p className="text-xs text-slate-400">Nenhum preço cadastrado</p>
            ) : (
              <div className="flex gap-4 flex-wrap">
                {(p.precos || []).map(pr => (
                  <div key={pr.modalidade} className="bg-slate-50 rounded-lg px-3 py-2 text-center">
                    <p className="text-xs text-slate-500 capitalize">{pr.modalidade}</p>
                    <p className="font-bold text-slate-800">{moeda(pr.valor)}</p>
                    {pr.valor_tabela && <p className="text-xs text-slate-400 line-through">{moeda(pr.valor_tabela)}</p>}
                    {pr.valor_promocional && <p className="text-xs text-green-600 font-medium">Promo: {moeda(pr.valor_promocional)}</p>}
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 mt-3 items-center">
              <select
                className="h-8 border border-slate-200 rounded-md px-2 text-xs text-slate-700 bg-white"
                value={precoForm[p.slug]?.modalidade ?? 'cartao'}
                onChange={e => setPrecoForm(prev => ({ ...prev, [p.slug]: { ...(prev[p.slug] || {}), modalidade: e.target.value } }))}
              >
                <option value="cartao">Cartão</option>
                <option value="boleto">Boleto</option>
                <option value="pix">PIX</option>
              </select>
              <Input
                className="h-8 w-28 text-xs"
                placeholder="Valor (R$)"
                value={precoForm[p.slug]?.valor ?? ''}
                onChange={e => setPrecoForm(prev => ({ ...prev, [p.slug]: { ...(prev[p.slug] || {}), valor: e.target.value } }))}
              />
              <Button size="sm" className="h-8" onClick={() => adicionarPreco(p.slug)}>
                <Plus className="w-3 h-3 mr-1" /> Adicionar preço
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

// ── Tab: Coberturas API ───────────────────────────────────────────────────
const CoberturasApiTab: React.FC = () => {
  const [coberturas, setCoberturas] = useState<CoberturaApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [ufSync, setUfSync] = useState('MG');
  const [syncResult, setSyncResult] = useState<string>('');
  const [novoMap, setNovoMap] = useState({ plano_nome: '', plano_slug: '', uf: '', cobertura_uuid: '', valor: '' });
  const [showNovo, setShowNovo] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    try { const d = await api('/api/config/planos/coberturas-api/lista'); setCoberturas(d.coberturas || []); }
    catch { setCoberturas([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const sincronizar = async () => {
    if (!ufSync || !/^[A-Z]{2}$/i.test(ufSync)) return;
    setSyncing(true);
    setSyncResult('');
    try {
      const d = await api('/api/config/planos/coberturas-api/sincronizar', {
        method: 'POST',
        body: JSON.stringify({ uf: ufSync.toUpperCase() }),
      });
      setSyncResult(`✅ ${d.sincronizados} planos sincronizados para ${d.uf}`);
      carregar();
    } catch (e: any) {
      setSyncResult(`❌ Erro: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const remover = async (id: number) => {
    await api(`/api/config/planos/coberturas-api/${id}`, { method: 'DELETE' });
    carregar();
  };

  const adicionarManual = async () => {
    if (!novoMap.plano_nome || !novoMap.uf || !novoMap.cobertura_uuid) return;
    await api('/api/config/planos/coberturas-api', {
      method: 'POST',
      body: JSON.stringify({ ...novoMap, valor: novoMap.valor ? parseFloat(novoMap.valor) : undefined }),
    });
    setNovoMap({ plano_nome: '', plano_slug: '', uf: '', cobertura_uuid: '', valor: '' });
    setShowNovo(false);
    carregar();
  };

  const ufs = [...new Set(coberturas.map(c => c.uf))].sort();

  if (loading) return <div className="flex items-center gap-2 p-8 text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Carregando...</div>;

  return (
    <div className="space-y-4">
      {/* Sync */}
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
        {syncResult && <p className="text-sm text-slate-600">{syncResult}</p>}
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => setShowNovo(!showNovo)}>
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

      {/* Lista por UF */}
      {ufs.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">
          Nenhuma cobertura mapeada. Use "Sincronizar" para importar da API Plamev.
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
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="text-left px-4 py-2">Nome na API</th>
                  <th className="text-left px-4 py-2">Slug local</th>
                  <th className="text-left px-4 py-2 font-mono">UUID</th>
                  <th className="text-right px-4 py-2">Valor</th>
                  <th className="text-right px-4 py-2">Sincronizado</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {coberturas.filter(c => c.uf === uf).map(c => (
                  <tr key={c.id} className="border-t border-slate-50 hover:bg-slate-50/50">
                    <td className="px-4 py-2 font-medium text-slate-800">{c.plano_nome}</td>
                    <td className="px-4 py-2 text-slate-500 font-mono">{c.plano_slug || '—'}</td>
                    <td className="px-4 py-2 text-slate-400 font-mono text-[10px] max-w-[180px] truncate">{c.cobertura_uuid}</td>
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
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${tab === t ? 'bg-white border border-b-white border-slate-200 text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
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
