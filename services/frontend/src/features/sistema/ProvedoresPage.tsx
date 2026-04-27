/**
 * ProvedoresPage — Gerenciamento de provedores LLM e integrações de canal.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { api } from '@/services/api';
import {
  Plus, Trash2, Loader2, Star, StarOff, Pencil, Check, X, Eye, EyeOff, KeyRound,
} from 'lucide-react';

// ── Tipos ─────────────────────────────────────────────────────────
interface LlmConfig {
  id: number;
  nome: string;
  provedor: string;
  modelo: string;
  temperatura: number;
  max_tokens: number;
  ativo: boolean;
  padrao: boolean;
  tem_key: boolean;
  api_key_display: string;
}

const PROVEDORES: Record<string, { label: string; cor: string; modelos: string[] }> = {
  anthropic: {
    label: 'Anthropic',
    cor: '#e2673b',
    modelos: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-5'],
  },
  openai: {
    label: 'OpenAI',
    cor: '#10a37f',
    modelos: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  },
  google: {
    label: 'Google',
    cor: '#4285f4',
    modelos: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  },
  groq: {
    label: 'Groq',
    cor: '#f55036',
    modelos: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768', 'llama-3.1-8b-instant'],
  },
  mistral: {
    label: 'Mistral',
    cor: '#ff6633',
    modelos: ['mistral-large-latest', 'mistral-medium', 'mistral-small-latest'],
  },
};

const FORM_VAZIO = {
  nome: '', provedor: 'anthropic', modelo: 'claude-opus-4-5',
  api_key: '', temperatura: '0.7', max_tokens: '4096',
};

// ── Componente principal ──────────────────────────────────────────
export const ProvedoresPage: React.FC = () => {
  const [configs, setConfigs] = useState<LlmConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | 'novo' | null>(null);
  const [form, setForm] = useState(FORM_VAZIO);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get<{ configs: LlmConfig[] }>('/api/config/llm');
      setConfigs(d.configs);
    } catch (e: any) { setErro(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const feedback = (msg: string) => { setOk(msg); setTimeout(() => setOk(''), 2500); };

  const abrirNovo = () => {
    setForm(FORM_VAZIO);
    setShowKey(false);
    setEditingId('novo');
  };

  const abrirEditar = (c: LlmConfig) => {
    setForm({
      nome: c.nome, provedor: c.provedor, modelo: c.modelo,
      api_key: '',  // nunca pré-preenche a key
      temperatura: String(c.temperatura), max_tokens: String(c.max_tokens),
    });
    setShowKey(false);
    setEditingId(c.id);
  };

  const cancelar = () => { setEditingId(null); setErro(''); };

  const salvar = async () => {
    if (!form.nome || !form.provedor || !form.modelo) {
      setErro('Nome, provedor e modelo são obrigatórios.'); return;
    }
    setSaving(true); setErro('');
    try {
      const payload = {
        ...form,
        temperatura: parseFloat(form.temperatura) || 0.7,
        max_tokens: parseInt(form.max_tokens) || 4096,
      };
      if (editingId === 'novo') {
        await api.post('/api/config/llm', payload);
        feedback('Provedor criado.');
      } else {
        await api.patch(`/api/config/llm/${editingId}`, payload);
        feedback('Salvo.');
      }
      setEditingId(null);
      await carregar();
    } catch (e: any) { setErro(e.message); }
    finally { setSaving(false); }
  };

  const definirPadrao = async (id: number) => {
    try {
      await api.put(`/api/config/llm/${id}/padrao`, {});
      feedback('Provedor padrão atualizado.');
      await carregar();
    } catch (e: any) { setErro(e.message); }
  };

  const remover = async (id: number) => {
    if (!confirm('Remover este provedor LLM?')) return;
    setDeletingId(id);
    try {
      await api.delete(`/api/config/llm/${id}`);
      feedback('Removido.');
      await carregar();
    } catch (e: any) { setErro(e.message); }
    finally { setDeletingId(null); }
  };

  const modelosPorProvedor = PROVEDORES[form.provedor]?.modelos ?? [];

  return (
    <>
      <PageHeader title="Provedores" subtitle="Gerencie provedores de LLM e suas credenciais" />

      <div className="p-6 flex-1 overflow-y-auto max-w-3xl">
        {/* Feedback global */}
        {ok   && <div className="mb-4 px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700">{ok}</div>}
        {erro && <div className="mb-4 px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{erro}</div>}

        {/* ── Cabeçalho da seção ── */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Provedores LLM</h2>
            <p className="text-xs text-slate-500 mt-0.5">O provedor marcado como padrão é usado pelos agentes quando não há configuração específica.</p>
          </div>
          {editingId === null && (
            <Button size="sm" onClick={abrirNovo} className="gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Adicionar
            </Button>
          )}
        </div>

        {/* ── Formulário Novo / Editar ── */}
        {editingId !== null && (
          <div className="mb-5 bg-white rounded-xl border border-indigo-200 shadow-sm p-5 space-y-4">
            <div className="text-sm font-semibold text-slate-800">
              {editingId === 'novo' ? 'Novo Provedor LLM' : 'Editar Provedor'}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Nome de exibição *</label>
                <Input value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                  placeholder="ex: Claude Principal" />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Provedor *</label>
                <select
                  value={form.provedor}
                  onChange={e => {
                    const p = e.target.value;
                    setForm(f => ({ ...f, provedor: p, modelo: PROVEDORES[p]?.modelos[0] ?? '' }));
                  }}
                  className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  {Object.entries(PROVEDORES).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Modelo *</label>
              <select
                value={form.modelo}
                onChange={e => setForm(f => ({ ...f, modelo: e.target.value }))}
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                {modelosPorProvedor.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">
                API Key {editingId !== 'novo' && <span className="text-slate-400">(deixe em branco para manter a atual)</span>}
              </label>
              <div className="relative">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={form.api_key}
                  onChange={e => setForm(f => ({ ...f, api_key: e.target.value }))}
                  placeholder={editingId === 'novo' ? 'sk-ant-...' : '••••••••  (não alterada)'}
                  className="pr-9 font-mono text-sm"
                />
                <button type="button" onClick={() => setShowKey(s => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1">
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Temperatura (0–1)</label>
                <Input type="number" min="0" max="1" step="0.1" value={form.temperatura}
                  onChange={e => setForm(f => ({ ...f, temperatura: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Max Tokens</label>
                <Input type="number" min="256" max="32000" step="256" value={form.max_tokens}
                  onChange={e => setForm(f => ({ ...f, max_tokens: e.target.value }))} />
              </div>
            </div>

            {erro && <p className="text-xs text-red-600">{erro}</p>}

            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={salvar} disabled={saving} className="gap-1.5">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Salvar
              </Button>
              <Button size="sm" variant="outline" onClick={cancelar}>
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Lista de provedores ── */}
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-400 py-6">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
          </div>
        ) : configs.length === 0 ? (
          <div className="text-sm text-slate-400 italic py-6">Nenhum provedor configurado.</div>
        ) : (
          <div className="space-y-3">
            {configs.map(c => {
              const prov = PROVEDORES[c.provedor];
              return (
                <div key={c.id} className={`bg-white rounded-xl border shadow-sm p-4 flex items-start gap-4 ${c.padrao ? 'border-indigo-200' : 'border-slate-200'}`}>
                  {/* Badge provedor */}
                  <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-white text-xs font-bold"
                    style={{ backgroundColor: prov?.cor ?? '#6366f1' }}>
                    {(prov?.label ?? c.provedor).substring(0, 2).toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-800 text-sm">{c.nome}</span>
                      {c.padrao && <Badge variant="default" className="text-[10px] h-4 px-1.5 bg-indigo-100 text-indigo-700 border-0">Padrão</Badge>}
                      {!c.ativo && <Badge variant="secondary" className="text-[10px] h-4 px-1.5">Inativo</Badge>}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      <span className="font-medium" style={{ color: prov?.cor ?? '#6366f1' }}>{prov?.label ?? c.provedor}</span>
                      {' · '}<span className="font-mono">{c.modelo}</span>
                      {' · '}temp {c.temperatura} · {c.max_tokens} tokens
                    </div>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <KeyRound className="w-3 h-3 text-slate-400" />
                      {c.tem_key
                        ? <span className="text-xs font-mono text-slate-500">{c.api_key_display}</span>
                        : <span className="text-xs text-amber-600 italic">Sem API key</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {!c.padrao && (
                      <button onClick={() => definirPadrao(c.id)} title="Definir como padrão"
                        className="p-1.5 text-slate-400 hover:text-indigo-600 transition-colors rounded-md hover:bg-indigo-50">
                        <StarOff className="w-4 h-4" />
                      </button>
                    )}
                    {c.padrao && (
                      <div className="p-1.5 text-indigo-500">
                        <Star className="w-4 h-4 fill-indigo-500" />
                      </div>
                    )}
                    <button onClick={() => abrirEditar(c)} title="Editar"
                      className="p-1.5 text-slate-400 hover:text-slate-700 transition-colors rounded-md hover:bg-slate-100">
                      <Pencil className="w-4 h-4" />
                    </button>
                    {!c.padrao && (
                      <button onClick={() => remover(c.id)} disabled={deletingId === c.id} title="Remover"
                        className="p-1.5 text-slate-400 hover:text-red-500 transition-colors rounded-md hover:bg-red-50">
                        {deletingId === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Info box ── */}
        <div className="mt-6 bg-slate-50 rounded-xl border border-slate-200 p-4 text-xs text-slate-500 space-y-1">
          <p><strong className="text-slate-700">API Keys</strong> são armazenadas com segurança e nunca exibidas por completo.</p>
          <p><strong className="text-slate-700">Provedor padrão</strong> é usado por todos os agentes que não têm configuração específica.</p>
          <p><strong className="text-slate-700">Temperatura</strong>: 0 = determinístico · 1 = mais criativo. Recomendado: 0.7.</p>
        </div>
      </div>
    </>
  );
};
