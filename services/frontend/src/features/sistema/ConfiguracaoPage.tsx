/**
 * ConfiguracaoPage — Gerenciamento dinâmico de agentes, canais e prompts.
 * Permite configurar Mari e outros agentes sem tocar em código ou variáveis de ambiente.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Bot, ChevronLeft, Plus, Trash2, Save, Phone, MessageCircle,
  Zap, Brain, Shield, BookOpen, Repeat2, Rocket, Cpu, Loader2, CheckCircle,
  FolderOpen, FileText, Search, ChevronRight, ChevronDown as ChevronDownIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { api } from '@/services/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// ── Tipos ─────────────────────────────────────────────────────
interface Agente {
  id: number; slug: string; nome: string; ativo: boolean;
  descricao?: string; modelo_principal?: string; temperatura?: number;
}

interface Prompt { tipo: string; titulo: string; conteudo: string; ativo: boolean; }

interface CanalWA {
  id: number; instancia_nome: string; instancia_label?: string;
  ddd_prefixos: string[]; chip_fallback: boolean; ativo: boolean;
  provider: 'evolution' | 'twilio';
  evolution_url: string; evolution_api_key: string;
  twilio_account_sid: string; twilio_auth_token: string; twilio_phone_from: string;
}

interface CanalTG { id: number; bot_nome?: string; ativo: boolean; }

interface KbDocMeta {
  id: number; pasta: string; arquivo: string; titulo: string;
  etapas: string[]; sempre_ativo: boolean; ativo: boolean; ordem: number; chars: number;
}
interface KbDoc extends KbDocMeta { conteudo: string; }
interface VaultFile { pasta: string; arquivo: string; path: string; }

interface AgenteDetalhe extends Agente {
  prompts: Prompt[];
  canais_whatsapp: CanalWA[];
  canais_telegram: CanalTG[];
}

// ── Constantes ────────────────────────────────────────────────
const MODELOS = [
  { value: 'claude-haiku-4-5',   label: 'Claude Haiku 4.5  — Rápido / Econômico' },
  { value: 'claude-sonnet-4-6',  label: 'Claude Sonnet 4.6 — Padrão' },
  { value: 'claude-opus-4-7',    label: 'Claude Opus 4.7   — Máxima capacidade' },
];

const PROMPT_DEFS = [
  { tipo: 'soul',           icon: Zap,        label: 'Soul — Identidade Completa',   desc: 'Quem é o agente, missão, valores, persona, como pensa.' },
  { tipo: 'tom',            icon: Brain,       label: 'Tom e Fluxo',                  desc: 'Como fala, fluxo da conversa, CEP, carência, fechamento.' },
  { tipo: 'regras',         icon: Shield,      label: 'Regras Absolutas',             desc: 'O que jamais pode fazer, limites inegociáveis.' },
  { tipo: 'planos',         icon: BookOpen,    label: 'Planos e Produtos',            desc: 'Informações sobre planos, coberturas e diferenciais.' },
  { tipo: 'pensamentos',    icon: Cpu,         label: 'Pensamentos / Raciocínio',     desc: 'Como raciocina internamente, cadência de decisão.' },
  { tipo: 'anti_repeticao', icon: Repeat2,     label: 'Anti-Repetição',              desc: 'Regras para não repetir frases, coleta em bloco.' },
  { tipo: 'modo_rapido',    icon: Rocket,      label: 'Modo Rápido',                 desc: 'Comportamento com leads quentes de anúncio.' },
];

// ── Helper ────────────────────────────────────────────────────
function useSalvo() {
  const [salvo, setSalvo] = useState(false);
  const mostrar = () => { setSalvo(true); setTimeout(() => setSalvo(false), 2000); };
  return { salvo, mostrar };
}

// ════════════════════════════════════════════════════════════════
// Lista de Agentes
// ════════════════════════════════════════════════════════════════
const AgentesLista: React.FC<{ onSelect: (id: number) => void }> = ({ onSelect }) => {
  const [agentes, setAgentes] = useState<Agente[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{ agentes: Agente[] }>('/api/config/agentes')
      .then(d => setAgentes(d.agentes))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <PageHeader title="Configuração de Agentes" subtitle="Gerencie identidade, canais e comportamento dos agentes de IA" />
      <div className="p-6 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Carregando...</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-4xl">
            {agentes.map(a => (
              <button
                key={a.id}
                onClick={() => onSelect(a.id)}
                className="text-left bg-white rounded-xl border border-slate-200 shadow-sm p-5 hover:border-indigo-300 hover:shadow-md transition-all group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
                    <Bot className="w-5 h-5 text-indigo-600" />
                  </div>
                  <Badge variant={a.ativo ? 'green' : 'secondary'}>
                    {a.ativo ? 'Ativo' : 'Inativo'}
                  </Badge>
                </div>
                <div className="font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">{a.nome}</div>
                <div className="text-xs text-slate-400 font-mono mt-0.5">@{a.slug}</div>
                {a.descricao && <p className="text-xs text-slate-500 mt-2 line-clamp-2">{a.descricao}</p>}
                <div className="text-xs text-slate-400 mt-3">{a.modelo_principal || '—'}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
};

// ════════════════════════════════════════════════════════════════
// Editor de Agente — Aba Identidade
// ════════════════════════════════════════════════════════════════
const TabIdentidade: React.FC<{ agente: AgenteDetalhe; onChange: (patch: Partial<Agente>) => void }> = ({ agente, onChange }) => {
  const [form, setForm] = useState({ nome: agente.nome, descricao: agente.descricao || '', modelo_principal: agente.modelo_principal || 'claude-haiku-4-5', temperatura: String(agente.temperatura ?? 0.7), ativo: agente.ativo });
  const [saving, setSaving] = useState(false);
  const { salvo, mostrar } = useSalvo();

  const salvar = async () => {
    setSaving(true);
    try {
      await api.patch(`/api/config/agentes/${agente.id}`, { ...form, temperatura: parseFloat(form.temperatura) });
      onChange({ ...form, temperatura: parseFloat(form.temperatura) });
      mostrar();
    } catch(e: any) { alert(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-5 max-w-xl">
      <div>
        <label className="text-xs font-medium text-slate-600 block mb-1">Nome do agente</label>
        <Input value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} />
      </div>
      <div>
        <label className="text-xs font-medium text-slate-600 block mb-1">Descrição</label>
        <Textarea value={form.descricao} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))} rows={2} placeholder="Descreva brevemente a função deste agente..." />
      </div>
      <div>
        <label className="text-xs font-medium text-slate-600 block mb-1">Modelo de IA</label>
        <Select value={form.modelo_principal} onValueChange={v => setForm(f => ({ ...f, modelo_principal: v }))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {MODELOS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-xs font-medium text-slate-600 block mb-1">Temperatura ({form.temperatura})</label>
        <input type="range" min="0" max="1" step="0.05" value={form.temperatura}
          onChange={e => setForm(f => ({ ...f, temperatura: e.target.value }))}
          className="w-full accent-indigo-500" />
        <div className="flex justify-between text-xs text-slate-400 mt-1"><span>Preciso (0)</span><span>Criativo (1)</span></div>
      </div>
      <div className="flex items-center gap-3">
        <label className="text-xs font-medium text-slate-600">Status</label>
        <button
          onClick={() => setForm(f => ({ ...f, ativo: !f.ativo }))}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.ativo ? 'bg-indigo-500' : 'bg-slate-300'}`}
        >
          <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${form.ativo ? 'translate-x-4' : 'translate-x-0.5'}`} />
        </button>
        <span className="text-xs text-slate-500">{form.ativo ? 'Ativo' : 'Inativo'}</span>
      </div>
      <Button onClick={salvar} disabled={saving} className="gap-2">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : salvo ? <CheckCircle className="w-4 h-4" /> : <Save className="w-4 h-4" />}
        {salvo ? 'Salvo!' : 'Salvar'}
      </Button>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// Editor de Agente — Aba Soul / Prompts
// ════════════════════════════════════════════════════════════════
const TabPrompts: React.FC<{ agente: AgenteDetalhe; onUpdate: (prompts: Prompt[]) => void }> = ({ agente, onUpdate }) => {
  const [prompts, setPrompts] = useState<Record<string, string>>(
    Object.fromEntries(agente.prompts.map(p => [p.tipo, p.conteudo]))
  );
  const [saving, setSaving] = useState<string | null>(null);
  const { salvo, mostrar } = useSalvo();

  const salvarPrompt = async (tipo: string) => {
    setSaving(tipo);
    try {
      await api.put(`/api/config/agentes/${agente.id}/prompts/${tipo}`, { conteudo: prompts[tipo] || '' });
      const updated = agente.prompts.map(p => p.tipo === tipo ? { ...p, conteudo: prompts[tipo] || '' } : p);
      if (!updated.some(p => p.tipo === tipo)) updated.push({ tipo, titulo: tipo, conteudo: prompts[tipo] || '', ativo: true });
      onUpdate(updated);
      mostrar();
    } catch(e: any) { alert(e.message); }
    finally { setSaving(null); }
  };

  return (
    <div className="space-y-6">
      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
        <strong>Como funciona:</strong> Se o campo <em>Soul</em> estiver preenchido, o agente usará esses textos como cérebro.
        Caso vazio, continuará usando os arquivos Obsidian (fallback). Preencha do mais importante para o menos.
      </div>
      {PROMPT_DEFS.map(({ tipo, icon: Icon, label, desc }) => (
        <div key={tipo} className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center flex-shrink-0">
              <Icon className="w-4 h-4 text-indigo-600" />
            </div>
            <div className="flex-1">
              <div className="font-medium text-slate-900 text-sm">{label}</div>
              <div className="text-xs text-slate-500">{desc}</div>
            </div>
          </div>
          <Textarea
            value={prompts[tipo] || ''}
            onChange={e => setPrompts(p => ({ ...p, [tipo]: e.target.value }))}
            placeholder={`Escreva o conteúdo de "${label}"...`}
            className="font-mono text-xs min-h-[140px]"
          />
          <div className="flex justify-between items-center mt-2">
            <span className="text-xs text-slate-400">{(prompts[tipo] || '').length} caracteres</span>
            <Button size="sm" variant="outline" onClick={() => salvarPrompt(tipo)} disabled={saving === tipo} className="gap-1.5 h-7 text-xs">
              {saving === tipo ? <Loader2 className="w-3 h-3 animate-spin" /> : salvo && saving === null ? <CheckCircle className="w-3 h-3 text-emerald-500" /> : <Save className="w-3 h-3" />}
              Salvar
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// Editor de Agente — Aba WhatsApp
// ════════════════════════════════════════════════════════════════
const FORM_WA_VAZIO = {
  instancia_nome: '', instancia_label: '', ddd_prefixos: '', chip_fallback: false, ativo: true,
  provider: 'evolution' as 'evolution' | 'twilio',
  evolution_url: '', evolution_api_key: '',
  twilio_account_sid: '', twilio_auth_token: '', twilio_phone_from: '',
};

const TabWhatsApp: React.FC<{ agente: AgenteDetalhe; onUpdate: (canais: CanalWA[]) => void }> = ({ agente, onUpdate }) => {
  const [canais, setCanais] = useState<CanalWA[]>(agente.canais_whatsapp);
  const [form, setForm] = useState(FORM_WA_VAZIO);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [mostrarForm, setMostrarForm] = useState(false);

  const adicionar = async () => {
    if (!form.instancia_nome) return;
    setSaving(true);
    try {
      const ddds = form.ddd_prefixos.split(',').map(d => d.trim()).filter(Boolean);
      const { canal } = await api.post<{ canal: CanalWA }>(`/api/config/agentes/${agente.id}/canais/whatsapp`, { ...form, ddd_prefixos: ddds });
      const updated = [...canais, canal];
      setCanais(updated);
      onUpdate(updated);
      setForm(FORM_WA_VAZIO);
      setMostrarForm(false);
    } catch(e: any) { alert(e.message); }
    finally { setSaving(false); }
  };

  const remover = async (id: number) => {
    if (!confirm('Remover esta instância?')) return;
    setDeletingId(id);
    try {
      await api.delete(`/api/config/agentes/${agente.id}/canais/whatsapp/${id}`);
      const updated = canais.filter(c => c.id !== id);
      setCanais(updated);
      onUpdate(updated);
    } catch(e: any) { alert(e.message); }
    finally { setDeletingId(null); }
  };

  const toggleAtivo = async (canal: CanalWA) => {
    try {
      await api.patch(`/api/config/agentes/${agente.id}/canais/whatsapp/${canal.id}`, { ativo: !canal.ativo });
      const updated = canais.map(c => c.id === canal.id ? { ...c, ativo: !c.ativo } : c);
      setCanais(updated);
      onUpdate(updated);
    } catch(e: any) { alert(e.message); }
  };

  const providerBadge = (p: string) => p === 'twilio'
    ? <span className="px-1.5 py-0.5 bg-red-50 text-red-700 rounded text-[10px] font-medium">Twilio</span>
    : <span className="px-1.5 py-0.5 bg-green-50 text-green-700 rounded text-[10px] font-medium">Evolution</span>;

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3 border border-slate-200">
        Cada instância é um número/chip de WhatsApp. Configure o <strong>provedor</strong> (Evolution API ou Twilio),
        os <strong>DDDs</strong> atendidos e o <strong>Fallback</strong> para quando nenhum DDD bater.
      </div>

      {canais.length === 0 && <p className="text-sm text-slate-400 italic">Nenhuma instância configurada.</p>}

      {canais.map(c => (
        <div key={c.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
          <Phone className="w-5 h-5 text-indigo-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-900 text-sm font-mono">{c.instancia_nome}</span>
              {providerBadge(c.provider || 'evolution')}
            </div>
            <div className="text-xs text-slate-500">{c.instancia_label || '—'}</div>
            {c.provider === 'evolution' && c.evolution_url && (
              <div className="text-[10px] text-slate-400 font-mono mt-0.5 truncate">{c.evolution_url}</div>
            )}
            {c.provider === 'twilio' && c.twilio_phone_from && (
              <div className="text-[10px] text-slate-400 font-mono mt-0.5">{c.twilio_phone_from}</div>
            )}
            <div className="flex flex-wrap gap-1 mt-1.5">
              {(c.ddd_prefixos || []).map(d => (
                <span key={d} className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded text-[10px] font-mono">{d}</span>
              ))}
              {c.chip_fallback && <span className="px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded text-[10px]">fallback</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => toggleAtivo(c)} className={`h-5 w-9 rounded-full transition-colors ${c.ativo ? 'bg-indigo-500' : 'bg-slate-300'}`}>
              <span className={`block h-4 w-4 ml-0.5 rounded-full bg-white shadow transition-transform ${c.ativo ? 'translate-x-4' : ''}`} />
            </button>
            <button onClick={() => remover(c.id)} disabled={deletingId === c.id} className="text-slate-400 hover:text-red-500 transition-colors p-1">
              {deletingId === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      ))}

      {!mostrarForm ? (
        <button onClick={() => setMostrarForm(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-slate-300 text-sm text-slate-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors">
          <Plus className="w-4 h-4" /> Adicionar instância
        </button>
      ) : (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-5 space-y-4">
          <div className="text-sm font-medium text-slate-700">Nova instância</div>

          {/* Provedor */}
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Provedor *</label>
            <div className="flex gap-2">
              {(['evolution', 'twilio'] as const).map(p => (
                <button key={p} onClick={() => setForm(f => ({ ...f, provider: p }))}
                  className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${form.provider === p ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                  {p === 'evolution' ? 'Evolution API' : 'Twilio'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Nome da instância *</label>
              <Input value={form.instancia_nome} onChange={e => setForm(f => ({ ...f, instancia_nome: e.target.value }))} placeholder="ex: mari011" className="font-mono text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Label amigável</label>
              <Input value={form.instancia_label} onChange={e => setForm(f => ({ ...f, instancia_label: e.target.value }))} placeholder="ex: Mari São Paulo" />
            </div>
          </div>

          {/* Campos Evolution API */}
          {form.provider === 'evolution' && (
            <div className="space-y-3 bg-green-50/50 rounded-lg p-3 border border-green-100">
              <div className="text-xs font-semibold text-green-800">Evolution API</div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">URL do servidor</label>
                <Input value={form.evolution_url} onChange={e => setForm(f => ({ ...f, evolution_url: e.target.value }))} placeholder="https://evolution.exemplo.com.br" className="font-mono text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">API Key</label>
                <Input type="password" value={form.evolution_api_key} onChange={e => setForm(f => ({ ...f, evolution_api_key: e.target.value }))} placeholder="••••••••" className="font-mono text-sm" />
              </div>
            </div>
          )}

          {/* Campos Twilio */}
          {form.provider === 'twilio' && (
            <div className="space-y-3 bg-red-50/50 rounded-lg p-3 border border-red-100">
              <div className="text-xs font-semibold text-red-800">Twilio</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Account SID</label>
                  <Input value={form.twilio_account_sid} onChange={e => setForm(f => ({ ...f, twilio_account_sid: e.target.value }))} placeholder="ACxxxxxxxx" className="font-mono text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Auth Token</label>
                  <Input type="password" value={form.twilio_auth_token} onChange={e => setForm(f => ({ ...f, twilio_auth_token: e.target.value }))} placeholder="••••••••" className="font-mono text-sm" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Número de origem (From)</label>
                <Input value={form.twilio_phone_from} onChange={e => setForm(f => ({ ...f, twilio_phone_from: e.target.value }))} placeholder="+5511999999999" className="font-mono text-sm" />
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">DDDs atendidos (separados por vírgula)</label>
            <Input value={form.ddd_prefixos} onChange={e => setForm(f => ({ ...f, ddd_prefixos: e.target.value }))} placeholder="ex: 011, 012, 013" className="font-mono text-sm" />
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
              <input type="checkbox" checked={form.chip_fallback} onChange={e => setForm(f => ({ ...f, chip_fallback: e.target.checked }))} className="accent-indigo-500" />
              Usar como fallback global
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
              <input type="checkbox" checked={form.ativo} onChange={e => setForm(f => ({ ...f, ativo: e.target.checked }))} className="accent-indigo-500" />
              Ativo
            </label>
          </div>
          <div className="flex gap-2">
            <Button onClick={adicionar} disabled={saving || !form.instancia_nome} className="gap-2 h-8 text-sm">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Adicionar
            </Button>
            <Button variant="outline" onClick={() => setMostrarForm(false)} className="h-8 text-sm">Cancelar</Button>
          </div>
        </div>
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// Editor de Agente — Aba Telegram
// ════════════════════════════════════════════════════════════════
const TabTelegram: React.FC<{ agente: AgenteDetalhe; onUpdate: (canais: CanalTG[]) => void }> = ({ agente, onUpdate }) => {
  const [canais, setCanais] = useState<CanalTG[]>(agente.canais_telegram);
  const [form, setForm] = useState({ bot_token: '', bot_nome: '', ativo: true });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const adicionar = async () => {
    if (!form.bot_token) return;
    setSaving(true);
    try {
      const { canal } = await api.post<{ canal: CanalTG }>(`/api/config/agentes/${agente.id}/canais/telegram`, form);
      const updated = [...canais, canal];
      setCanais(updated);
      onUpdate(updated);
      setForm({ bot_token: '', bot_nome: '', ativo: true });
    } catch(e: any) { alert(e.message); }
    finally { setSaving(false); }
  };

  const remover = async (id: number) => {
    if (!confirm('Remover este bot Telegram?')) return;
    setDeletingId(id);
    try {
      await api.delete(`/api/config/agentes/${agente.id}/canais/telegram/${id}`);
      const updated = canais.filter(c => c.id !== id);
      setCanais(updated);
      onUpdate(updated);
    } catch(e: any) { alert(e.message); }
    finally { setDeletingId(null); }
  };

  const toggleAtivo = async (canal: CanalTG) => {
    try {
      await api.patch(`/api/config/agentes/${agente.id}/canais/telegram/${canal.id}`, { ativo: !canal.ativo });
      const updated = canais.map(c => c.id === canal.id ? { ...c, ativo: !c.ativo } : c);
      setCanais(updated);
      onUpdate(updated);
    } catch(e: any) { alert(e.message); }
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3 border border-slate-200">
        Crie um bot no <strong>@BotFather</strong> do Telegram, copie o token e adicione aqui.
        O sistema iniciará o polling automaticamente (recarregamento em até 2 minutos).
      </div>

      {canais.length === 0 && <p className="text-sm text-slate-400 italic">Nenhum bot Telegram configurado.</p>}

      {canais.map(c => (
        <div key={c.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
          <MessageCircle className="w-5 h-5 text-sky-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-medium text-slate-900 text-sm">{c.bot_nome || 'Bot sem nome'}</div>
            <div className="text-xs text-slate-400">Token configurado • polling {c.ativo ? 'ativo' : 'pausado'}</div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => toggleAtivo(c)} className={`h-5 w-9 rounded-full transition-colors ${c.ativo ? 'bg-sky-500' : 'bg-slate-300'}`}>
              <span className={`block h-4 w-4 ml-0.5 rounded-full bg-white shadow transition-transform ${c.ativo ? 'translate-x-4' : ''}`} />
            </button>
            <button onClick={() => remover(c.id)} disabled={deletingId === c.id} className="text-slate-400 hover:text-red-500 transition-colors p-1">
              {deletingId === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      ))}

      <div className="bg-white rounded-xl border border-dashed border-slate-300 p-5 space-y-3">
        <div className="text-sm font-medium text-slate-700">Adicionar bot</div>
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Token do bot *</label>
          <Input value={form.bot_token} onChange={e => setForm(f => ({ ...f, bot_token: e.target.value }))} placeholder="1234567890:AAF..." className="font-mono text-sm" type="password" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Nome do bot</label>
          <Input value={form.bot_nome} onChange={e => setForm(f => ({ ...f, bot_nome: e.target.value }))} placeholder="ex: @MariPlamevBot" />
        </div>
        <Button onClick={adicionar} disabled={saving || !form.bot_token} className="gap-2 h-8 text-sm">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Adicionar bot
        </Button>
      </div>
    </div>
  );
};

// ── Etapas para seleção ───────────────────────────────────────
const ETAPAS_FUNIL = [
  'acolhimento','qualificacao','apresentacao_planos','validacao_cep',
  'negociacao','objecao','pre_fechamento','fechamento',
];

// ── Cores por pasta ───────────────────────────────────────────
const PASTA_CORES: Record<string, string> = {
  Mari:       'bg-indigo-50 text-indigo-700 border-indigo-200',
  Plamev:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  Vendas:     'bg-amber-50 text-amber-700 border-amber-200',
  Coberturas: 'bg-blue-50 text-blue-700 border-blue-200',
  Produto:    'bg-purple-50 text-purple-700 border-purple-200',
  Tecnico:    'bg-slate-50 text-slate-600 border-slate-200',
  root:       'bg-red-50 text-red-700 border-red-200',
};

// ════════════════════════════════════════════════════════════════
// Aba Conhecimento
// ════════════════════════════════════════════════════════════════
const TabConhecimento: React.FC<{ agenteId: number }> = ({ agenteId }) => {
  const [arquivos, setArquivos] = useState<VaultFile[]>([]);
  const [grupos, setGrupos] = useState<Record<string, VaultFile[]>>({});
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<VaultFile | null>(null);
  const [conteudo, setConteudo] = useState('');
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [busca, setBusca] = useState('');
  const [pastasAbertas, setPastasAbertas] = useState<Set<string>>(new Set(['Mari', 'Plamev', 'Vendas']));

  const carregarArquivos = async () => {
    setLoading(true);
    try {
      const d = await api.get<{ files: string[] }>(`/api/config/agentes/${agenteId}/conhecimento/vault`);
      const lista: VaultFile[] = (d.files || []).map(f => {
        const partes = f.split('/');
        const pasta = partes.length > 1 ? partes[0] : 'root';
        const arquivo = partes[partes.length - 1].replace('.md', '');
        return { pasta, arquivo, path: f };
      });
      setArquivos(lista);
      const g: Record<string, VaultFile[]> = {};
      for (const f of lista) {
        if (!g[f.pasta]) g[f.pasta] = [];
        g[f.pasta].push(f);
      }
      setGrupos(g);
      if (Object.keys(g).length > 0) {
        setPastasAbertas(new Set(Object.keys(g).slice(0, 3)));
      }
    } catch(e: any) { console.error('vault list error:', e); }
    finally { setLoading(false); }
  };

  useEffect(() => { carregarArquivos(); }, [agenteId]);

  const abrirArquivo = async (file: VaultFile) => {
    setSelectedFile(file);
    setLoadingDoc(true);
    setConteudo('');
    try {
      const d = await api.get<{ conteudo: string }>(
        `/api/config/agentes/${agenteId}/conhecimento/vault/arquivo?path=${encodeURIComponent(file.path)}`
      );
      setConteudo(d.conteudo || '');
    } catch(e: any) { console.error(e); setConteudo('*Erro ao carregar arquivo.*'); }
    finally { setLoadingDoc(false); }
  };

  const navegarParaWikilink = (nome: string) => {
    const norm = nome.replace('.md', '');
    const encontrado = arquivos.find(f =>
      f.path.replace('.md', '') === norm ||
      f.arquivo === norm ||
      f.arquivo === norm.split('/').pop()
    );
    if (encontrado) abrirArquivo(encontrado);
  };

  const processarWikilinks = (md: string) =>
    md.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, link, alias) =>
      `[${alias || link}](wikilink:${encodeURIComponent(link)})`
    );

  const togglePasta = (pasta: string) => {
    setPastasAbertas(prev => {
      const next = new Set(prev);
      next.has(pasta) ? next.delete(pasta) : next.add(pasta);
      return next;
    });
  };

  const filteredGrupos = busca.trim()
    ? (() => {
        const result: Record<string, VaultFile[]> = {};
        for (const [pasta, docs] of Object.entries(grupos)) {
          const filtered = docs.filter(d => d.arquivo.toLowerCase().includes(busca.toLowerCase()));
          if (filtered.length) result[pasta] = filtered;
        }
        return result;
      })()
    : grupos;

  return (
    <div className="flex gap-4 h-[calc(100vh-180px)] min-h-[500px]">
      {/* ── Árvore de arquivos ───────────────────────────────── */}
      <div className="w-64 flex-shrink-0 flex flex-col bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-3 border-b border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-700">Base de Conhecimento</span>
            <span className="text-[10px] text-slate-400">{arquivos.length} arquivos</span>
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar arquivo..."
              className="w-full pl-6 pr-2 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus:border-indigo-400"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-xs gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> Carregando...
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto py-1">
            {Object.entries(filteredGrupos).map(([pasta, docs]) => (
              <div key={pasta}>
                <button
                  onClick={() => togglePasta(pasta)}
                  className="w-full flex items-center gap-1.5 px-3 py-1.5 hover:bg-slate-50 transition-colors"
                >
                  {pastasAbertas.has(pasta)
                    ? <ChevronDownIcon className="w-3 h-3 text-slate-400 flex-shrink-0" />
                    : <ChevronRight className="w-3 h-3 text-slate-400 flex-shrink-0" />}
                  <FolderOpen className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                  <span className="text-xs font-medium text-slate-700 flex-1 text-left">{pasta}</span>
                  <span className="text-[10px] text-slate-400">{docs.length}</span>
                </button>
                {pastasAbertas.has(pasta) && docs.map(doc => (
                  <button
                    key={doc.path}
                    onClick={() => abrirArquivo(doc)}
                    className={`w-full flex items-center gap-1.5 pl-7 pr-3 py-1 text-left transition-colors ${
                      selectedFile?.path === doc.path
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'hover:bg-slate-50 text-slate-600'
                    }`}
                  >
                    <FileText className="w-3 h-3 flex-shrink-0" />
                    <span className="text-xs truncate flex-1">{doc.arquivo}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Visualizador Markdown ─────────────────────────────── */}
      <div className="flex-1 flex flex-col bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {!selectedFile && !loadingDoc && (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-2">
            <BookOpen className="w-8 h-8 opacity-30" />
            <span className="text-sm">Selecione um arquivo para visualizar</span>
            <span className="text-xs text-slate-300">Edite no Obsidian — sincroniza via Git automaticamente</span>
          </div>
        )}

        {loadingDoc && (
          <div className="flex-1 flex items-center justify-center text-slate-400 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Carregando...</span>
          </div>
        )}

        {selectedFile && !loadingDoc && (
          <>
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${PASTA_CORES[selectedFile.pasta] || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                {selectedFile.pasta}
              </span>
              <span className="font-medium text-slate-900 text-sm flex-1">{selectedFile.arquivo}</span>
              <span className="text-xs text-slate-400">{conteudo.length} chars</span>
              <span className="text-xs text-slate-300 italic hidden sm:block">Edite no Obsidian</span>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a({ href, children }: any) {
                    if (href?.startsWith('wikilink:')) {
                      const nome = decodeURIComponent(href.slice(9));
                      return (
                        <button
                          onClick={() => navegarParaWikilink(nome)}
                          className="text-indigo-600 hover:text-indigo-800 underline decoration-dotted font-medium cursor-pointer"
                        >
                          {children}
                        </button>
                      );
                    }
                    return <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{children}</a>;
                  },
                  h1({ children }: any) { return <h1 className="text-xl font-bold text-slate-900 mb-4 mt-6 first:mt-0 pb-2 border-b border-slate-100">{children}</h1>; },
                  h2({ children }: any) { return <h2 className="text-lg font-semibold text-slate-800 mb-3 mt-5">{children}</h2>; },
                  h3({ children }: any) { return <h3 className="text-base font-semibold text-slate-700 mb-2 mt-4">{children}</h3>; },
                  p({ children }: any) { return <p className="text-sm text-slate-700 mb-3 leading-relaxed">{children}</p>; },
                  ul({ children }: any) { return <ul className="list-disc pl-5 mb-3 space-y-1 text-sm text-slate-700">{children}</ul>; },
                  ol({ children }: any) { return <ol className="list-decimal pl-5 mb-3 space-y-1 text-sm text-slate-700">{children}</ol>; },
                  li({ children }: any) { return <li className="leading-relaxed text-sm text-slate-700">{children}</li>; },
                  pre({ children }: any) { return <pre className="bg-slate-50 border border-slate-200 rounded-lg p-3 my-3 overflow-x-auto">{children}</pre>; },
                  code({ className, children }: any) {
                    return className
                      ? <code className={`text-xs font-mono text-slate-800 ${className}`}>{children}</code>
                      : <code className="bg-slate-100 text-slate-800 px-1 py-0.5 rounded text-xs font-mono">{children}</code>;
                  },
                  blockquote({ children }: any) { return <blockquote className="border-l-4 border-indigo-200 pl-4 py-1 my-3 text-slate-500 italic text-sm">{children}</blockquote>; },
                  hr() { return <hr className="border-slate-200 my-4" />; },
                  strong({ children }: any) { return <strong className="font-semibold text-slate-900">{children}</strong>; },
                  table({ children }: any) { return <div className="overflow-x-auto my-3"><table className="w-full text-xs border-collapse">{children}</table></div>; },
                  thead({ children }: any) { return <thead className="bg-slate-50">{children}</thead>; },
                  th({ children }: any) { return <th className="border border-slate-200 px-3 py-2 text-left font-semibold text-slate-700">{children}</th>; },
                  td({ children }: any) { return <td className="border border-slate-200 px-3 py-2 text-slate-600">{children}</td>; },
                }}
              >
                {processarWikilinks(conteudo)}
              </ReactMarkdown>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// Editor principal do agente (tabs)
// ════════════════════════════════════════════════════════════════
const AgenteEditor: React.FC<{ id: number; onBack: () => void }> = ({ id, onBack }) => {
  const [agente, setAgente] = useState<AgenteDetalhe | null>(null);
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(() => {
    setLoading(true);
    api.get<{ agente: AgenteDetalhe }>(`/api/config/agentes/${id}`)
      .then(d => setAgente(d.agente))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { carregar(); }, [carregar]);

  if (loading) return (
    <div className="flex-1 flex items-center justify-center text-slate-400 gap-2">
      <Loader2 className="w-5 h-5 animate-spin" /> Carregando...
    </div>
  );

  if (!agente) return (
    <div className="flex-1 flex items-center justify-center text-slate-400">Agente não encontrado.</div>
  );

  return (
    <>
      <PageHeader title={agente.nome} subtitle={`@${agente.slug} · Editar configuração`}>
        <Button variant="outline" onClick={onBack} className="gap-2 h-8 text-sm">
          <ChevronLeft className="w-4 h-4" /> Voltar
        </Button>
      </PageHeader>
      <div className="p-6 flex-1 overflow-y-auto">
        <Tabs defaultValue="identidade">
          <TabsList className="mb-6">
            <TabsTrigger value="identidade">Identidade</TabsTrigger>
            <TabsTrigger value="prompts">Soul & Prompts</TabsTrigger>
            <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
            <TabsTrigger value="telegram">Telegram</TabsTrigger>
            <TabsTrigger value="conhecimento">Conhecimento</TabsTrigger>
          </TabsList>

          <TabsContent value="identidade">
            <TabIdentidade agente={agente} onChange={patch => setAgente(a => a ? { ...a, ...patch } : a)} />
          </TabsContent>

          <TabsContent value="prompts">
            <TabPrompts agente={agente} onUpdate={prompts => setAgente(a => a ? { ...a, prompts } : a)} />
          </TabsContent>

          <TabsContent value="whatsapp">
            <TabWhatsApp agente={agente} onUpdate={canais => setAgente(a => a ? { ...a, canais_whatsapp: canais } : a)} />
          </TabsContent>

          <TabsContent value="telegram">
            <TabTelegram agente={agente} onUpdate={canais => setAgente(a => a ? { ...a, canais_telegram: canais } : a)} />
          </TabsContent>

          <TabsContent value="conhecimento">
            <TabConhecimento agenteId={agente.id} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
};

// ════════════════════════════════════════════════════════════════
// Export principal
// ════════════════════════════════════════════════════════════════
export const ConfiguracaoPage: React.FC = () => {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  if (selectedId !== null) {
    return <AgenteEditor id={selectedId} onBack={() => setSelectedId(null)} />;
  }
  return <AgentesLista onSelect={setSelectedId} />;
};
