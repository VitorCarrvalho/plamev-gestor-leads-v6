/**
 * ChatSimulatorPage.tsx — Dashboard V5
 * Simula exatamente a Mari sem gravar em conversas reais.
 * Proxy via /api/sandbox/* → Intelligence V1 (porta 3471).
 *
 * Arquitetura de UX — 3 colunas com scroll isolado:
 *   ┌── Config (280px) ──┬── Chat (flex) ──┬── Prompt Inspector (340px) ──┐
 *   │ [FIXO] Configuração│ [FIXO] Banner + │ [FIXO] Header                │
 *   │                    │  Trilha etapas  │                              │
 *   ├────────────────────┼─────────────────┼──────────────────────────────┤
 *   │ [SCROLL] Perfil    │ [SCROLL] Msgs   │ [SCROLL] Prompt sistema      │
 *   │ + stats + arquivos │                 │                              │
 *   │                    │ [FIXO] Input    │                              │
 *   └────────────────────┴─────────────────┴──────────────────────────────┘
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  MessageCircle, Send, Trash2, Sparkles, FileCode, Eye, EyeOff, Loader2,
  DollarSign, Clock, Zap, CheckCircle2, AlertCircle, X,
  ChevronRight, MapPin, XCircle, Copy, Save,
} from 'lucide-react';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/PageHeader';
import { cn } from '@/lib/utils';

// ── Constantes ────────────────────────────────────────────────────────────────
const ETAPAS = [
  'acolhimento', 'qualificacao', 'apresentacao_planos',
  'validacao_cep', 'negociacao', 'objecao', 'pre_fechamento', 'fechamento',
];

const ETAPA_LABEL: Record<string, string> = {
  acolhimento: 'Acolhim.',
  qualificacao: 'Qualif.',
  apresentacao_planos: 'Apres.',
  validacao_cep: 'CEP',
  negociacao: 'Negoc.',
  objecao: 'Objeção',
  pre_fechamento: 'Pré-fech.',
  fechamento: 'Fechar',
};

function tempoRelativo(iso: string | null): string {
  if (!iso) return '—';
  const delta = Date.now() - new Date(iso).getTime();
  const s = Math.floor(delta / 1000);
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

type Perfil = {
  nome: string; especie: string; raca: string; idade_anos: number | '';
  cep?: string; email?: string; problema_saude?: string;
};

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════
export const ChatSimulatorPage: React.FC = () => {
  const [etapa, setEtapa] = useState('acolhimento');
  const [canal, setCanal] = useState('whatsapp');
  const [perfil, setPerfil] = useState<Perfil>({ nome: '', especie: '', raca: '', idade_anos: '' });
  const [perfilAuto, setPerfilAuto] = useState<Record<string, boolean>>({});
  const [modelo, setModelo] = useState('');
  const [mostrarPrompt, setMostrarPrompt] = useState(false);
  const [msgs, setMsgs] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [ultima, setUltima] = useState<any>(null);
  const [trilha, setTrilha] = useState<string[]>([]);
  const [cepResult, setCepResult] = useState<{
    cobertura: boolean; clinicas: any[]; texto: string | null; cep: string
  } | null>(null);
  const [cepLoading, setCepLoading] = useState(false);
  const [modalSalvar, setModalSalvar] = useState(false);
  const [salvarNome, setSalvarNome] = useState('');
  const [salvarLoading, setSalvarLoading] = useState(false);
  const [salvarMsg, setSalvarMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Auto-consulta CEP via proxy
  useEffect(() => {
    const cepLimpo = (perfil.cep || '').replace(/\D/g, '');
    if (cepLimpo.length !== 8) { setCepResult(null); return; }
    if (cepResult?.cep === cepLimpo) return;

    setCepLoading(true);
    api.post<any>('/api/sandbox/cep', { cep: cepLimpo })
      .then(r => {
        setCepResult(r);
        const cepFmt = cepLimpo.replace(/(\d{5})(\d{3})/, '$1-$2');
        const txt = r.cobertura && r.texto
          ? r.texto
          : `🚫 Sem clínicas Plamev em até 50km do CEP ${cepFmt}.`;
        setMsgs(prev => [...prev, {
          role: 'agent', conteudo: txt, isCep: true, cepCobertura: r.cobertura,
        }]);
      })
      .catch(() => setCepResult(null))
      .finally(() => setCepLoading(false));
  }, [perfil.cep]); // eslint-disable-line react-hooks/exhaustive-deps

  const enviar = async () => {
    if (!input.trim() || loading) return;
    const historico = [...msgs, { role: 'user', conteudo: input }];
    setMsgs(historico); setInput(''); setLoading(true);
    try {
      const r = await api.post<any>('/api/sandbox/chat/mensagem', {
        etapa, canal, perfil_lead: perfil,
        mensagens: msgs, mensagem_teste: input,
        mostrar_prompt: mostrarPrompt,
        modelo_override: modelo || undefined,
      });
      setMsgs([...historico, {
        role: 'agent', conteudo: r.resposta,
        etapa: r.etapa_efetiva, decisor: r.decisor?.decisao,
      }]);
      setUltima(r);

      setTrilha(t => {
        if (r.etapa_efetiva && r.etapa_efetiva !== t[t.length - 1])
          return [...t, r.etapa_efetiva];
        return t;
      });

      if (r.perfil_extraido && Object.keys(r.perfil_extraido).length > 0) {
        const extraido = r.perfil_extraido as Record<string, any>;
        setPerfil(p => {
          const novo: any = { ...p };
          for (const [k, v] of Object.entries(extraido)) if (v != null && v !== '') novo[k] = v;
          return novo;
        });
        setPerfilAuto(pa => {
          const novo = { ...pa };
          for (const [k, v] of Object.entries(extraido)) if (v != null && v !== '') novo[k] = true;
          return novo;
        });
      }

      if (r.etapa_mudou && r.etapa_efetiva) setEtapa(r.etapa_efetiva);
    } catch (e: any) {
      setMsgs([...historico, { role: 'agent', conteudo: '[ERRO] ' + e.message }]);
    }
    setLoading(false);
  };

  const limpar = () => {
    setMsgs([]); setUltima(null); setTrilha([]); setPerfilAuto({}); setCepResult(null);
    setPerfil({ nome: '', especie: '', raca: '', idade_anos: '' });
  };

  const salvarSimulacao = async () => {
    if (!salvarNome.trim() || !msgs.length) return;
    setSalvarLoading(true); setSalvarMsg(null);
    try {
      await api.post('/api/sandbox/cenarios', {
        nome: salvarNome.trim(),
        descricao: `Simulação salva em ${new Date().toLocaleString('pt-BR')}`,
        etapa,
        canal,
        perfil_lead: perfil,
        mensagens: msgs,
      });
      setSalvarMsg({ ok: true, text: '✓ Simulação salva com sucesso!' });
      setTimeout(() => { setModalSalvar(false); setSalvarNome(''); setSalvarMsg(null); }, 1500);
    } catch (e: any) {
      setSalvarMsg({ ok: false, text: e.message });
    }
    setSalvarLoading(false);
  };

  return (
    <div className="flex flex-col h-screen min-h-0 overflow-hidden">
      <PageHeader title="Chat Simulator" subtitle="Simula a Mari real sem gravar no banco de conversas">
        <Badge variant="amber"><Sparkles className="w-3 h-3" /> Modo Sandbox</Badge>
        <Button variant="outline" size="sm" onClick={() => setMostrarPrompt(v => !v)}>
          {mostrarPrompt ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          Prompt
        </Button>
        <Button variant="outline" size="sm" onClick={() => { setSalvarNome(''); setSalvarMsg(null); setModalSalvar(true); }}
          disabled={msgs.length === 0}>
          <Save className="w-3.5 h-3.5" /> Salvar
        </Button>
        <Button variant="outline" size="sm" onClick={limpar}>
          <Trash2 className="w-3.5 h-3.5" /> Limpar
        </Button>
      </PageHeader>

      <div className={cn(
        'flex-1 grid gap-4 p-4 min-h-0 overflow-hidden',
        mostrarPrompt
          ? 'grid-cols-[280px_minmax(0,1fr)_340px]'
          : 'grid-cols-[280px_minmax(0,1fr)]',
      )}>
        <ConfigPanel
          etapa={etapa} setEtapa={setEtapa}
          canal={canal} setCanal={setCanal}
          modelo={modelo} setModelo={setModelo}
          perfil={perfil} setPerfil={setPerfil}
          perfilAuto={perfilAuto} setPerfilAuto={setPerfilAuto}
          cepResult={cepResult} cepLoading={cepLoading}
          ultima={ultima}
        />

        <ChatPanel
          msgs={msgs}
          input={input} setInput={setInput}
          loading={loading}
          onEnviar={enviar}
          etapaAtual={etapa}
          trilha={trilha}
          ultima={ultima}
        />

        {mostrarPrompt && <PromptInspector ultima={ultima} />}
      </div>

      {/* Modal Salvar Simulação */}
      <Dialog open={modalSalvar} onOpenChange={v => !v && setModalSalvar(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Save className="w-4 h-4 text-indigo-600" /> Salvar simulação
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Nome do cenário</label>
              <Input
                placeholder="Ex: Lead frio com objeção de preço — Advance"
                value={salvarNome}
                onChange={e => setSalvarNome(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && salvarSimulacao()}
                autoFocus
              />
            </div>
            <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-2.5 space-y-0.5">
              <div><span className="font-medium">Etapa:</span> {etapa}</div>
              <div><span className="font-medium">Mensagens:</span> {msgs.length}</div>
              {perfil.nome && <div><span className="font-medium">Pet:</span> {perfil.nome} ({perfil.especie || '—'})</div>}
            </div>
            {salvarMsg && (
              <div className={cn(
                'p-2.5 rounded-lg text-xs flex items-center gap-2',
                salvarMsg.ok
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                  : 'bg-red-50 border border-red-200 text-red-700',
              )}>
                {salvarMsg.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                {salvarMsg.text}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalSalvar(false)}>Cancelar</Button>
            <Button onClick={salvarSimulacao} disabled={salvarLoading || !salvarNome.trim()}>
              {salvarLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG PANEL
// ═══════════════════════════════════════════════════════════════════════════════
interface ConfigPanelProps {
  etapa: string; setEtapa: (v: string) => void;
  canal: string; setCanal: (v: string) => void;
  modelo: string; setModelo: (v: string) => void;
  perfil: Perfil; setPerfil: React.Dispatch<React.SetStateAction<Perfil>>;
  perfilAuto: Record<string, boolean>;
  setPerfilAuto: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  cepResult: any; cepLoading: boolean;
  ultima: any;
}

const ConfigPanel: React.FC<ConfigPanelProps> = ({
  etapa, setEtapa, canal, setCanal, modelo, setModelo,
  perfil, setPerfil, perfilAuto, setPerfilAuto,
  cepResult, cepLoading, ultima,
}) => {
  const [cepCopiado, setCepCopiado] = useState(false);

  const editaCampo = (campo: keyof Perfil, valor: any) => {
    setPerfil(p => ({ ...p, [campo]: valor }));
    setPerfilAuto(pa => ({ ...pa, [campo]: false }));
  };

  return (
    <aside className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col min-h-0 overflow-hidden">
      {/* Configuração */}
      <div className="p-4 border-b border-slate-100 flex-shrink-0">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Configuração</div>
        <div className="space-y-3">
          <Campo label="Etapa">
            <Select value={etapa} onValueChange={setEtapa}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ETAPAS.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
              </SelectContent>
            </Select>
          </Campo>
          <Campo label="Canal">
            <Select value={canal} onValueChange={setCanal}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="telegram">Telegram</SelectItem>
              </SelectContent>
            </Select>
          </Campo>
          <Campo label="Modelo (opcional)">
            <Input value={modelo} onChange={e => setModelo(e.target.value)} placeholder="claude-haiku-4-5" />
          </Campo>
        </div>
      </div>

      {/* Perfil + stats (scroll) */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
        <section>
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1">
            🐶 Perfil do Lead
            {Object.values(perfilAuto).some(Boolean) && (
              <span className="ml-auto text-[9px] font-normal text-emerald-600 normal-case tracking-normal flex items-center gap-1">
                <CheckCircle2 className="w-2.5 h-2.5" /> auto-atualizado
              </span>
            )}
          </div>
          <div className="space-y-3">
            <CampoAuto auto={perfilAuto.nome}>
              <Input placeholder="Nome do pet" value={perfil.nome}
                onChange={e => editaCampo('nome', e.target.value)}
                className={cn(perfilAuto.nome && 'ring-2 ring-emerald-300 border-emerald-400 pr-8')} />
            </CampoAuto>
            <Select value={perfil.especie || ''} onValueChange={v => editaCampo('especie', v)}>
              <SelectTrigger className={cn(perfilAuto.especie && 'ring-2 ring-emerald-300 border-emerald-400')}>
                <SelectValue placeholder="— espécie —" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cachorro">Cachorro</SelectItem>
                <SelectItem value="gato">Gato</SelectItem>
                <SelectItem value="outro">Outro</SelectItem>
              </SelectContent>
            </Select>
            <CampoAuto auto={perfilAuto.raca}>
              <Input placeholder="Raça" value={perfil.raca}
                onChange={e => editaCampo('raca', e.target.value)}
                className={cn(perfilAuto.raca && 'ring-2 ring-emerald-300 border-emerald-400 pr-8')} />
            </CampoAuto>
            <CampoAuto auto={perfilAuto.idade_anos}>
              <Input type="number" step="0.1" placeholder="Idade (anos)"
                value={perfil.idade_anos}
                onChange={e => editaCampo('idade_anos', e.target.value === '' ? '' : parseFloat(e.target.value))}
                className={cn(perfilAuto.idade_anos && 'ring-2 ring-emerald-300 border-emerald-400 pr-8')} />
            </CampoAuto>

            {/* CEP */}
            <div className="space-y-1.5">
              <div className="relative">
                <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                <Input
                  placeholder="CEP (8 dígitos)"
                  value={perfil.cep || ''}
                  onChange={e => editaCampo('cep', e.target.value.replace(/\D/g, '').slice(0, 8))}
                  className={cn('pl-8 font-mono', perfilAuto.cep && 'ring-2 ring-emerald-300 border-emerald-400 pr-8')}
                  maxLength={8}
                />
                {cepLoading && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 animate-spin pointer-events-none" />}
                {!cepLoading && perfilAuto.cep && <CheckCircle2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-emerald-600 pointer-events-none" />}
              </div>
              {cepResult && (
                <div className={cn('rounded-lg border overflow-hidden',
                  cepResult.cobertura ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'
                )}>
                  <div className={cn('flex items-center gap-1.5 px-2.5 py-1.5',
                    cepResult.cobertura ? 'text-emerald-700' : 'text-red-600'
                  )}>
                    {cepResult.cobertura
                      ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                      : <XCircle className="w-3.5 h-3.5 flex-shrink-0" />}
                    <span className="text-[11px] font-semibold flex-1">
                      {cepResult.cobertura
                        ? `${cepResult.clinicas.length} clínica${cepResult.clinicas.length !== 1 ? 's' : ''} em até 50km`
                        : 'Sem cobertura Plamev'}
                    </span>
                    {cepResult.cobertura && cepResult.texto && (
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(cepResult.texto!);
                          setCepCopiado(true); setTimeout(() => setCepCopiado(false), 2000);
                        }}
                        className="text-emerald-600 hover:text-emerald-800 flex-shrink-0"
                        title="Copiar texto para WhatsApp"
                      >
                        {cepCopiado ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                  {cepResult.cobertura && cepResult.clinicas.length > 0 && (
                    <div className="border-t border-emerald-200 divide-y divide-emerald-100 max-h-48 overflow-y-auto">
                      {cepResult.clinicas.map((c: any, i: number) => {
                        const nome = c.CredenciadosNomeCredenciado || c.IndividuosNomeFantasia || c.IndividuosNome;
                        const dist = parseFloat(c.DistanciaKm);
                        const distFmt = dist < 1 ? `${(dist * 1000).toFixed(0)}m` : `${dist.toFixed(1)}km`;
                        return (
                          <div key={i} className="px-2.5 py-1.5 bg-white/60">
                            <div className="text-[11px] font-semibold text-slate-800 truncate">{nome}</div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-slate-500 truncate flex-1">{c.IndividuosEnderecosBairro}</span>
                              <span className={cn('text-[10px] font-semibold flex-shrink-0',
                                dist <= 5 ? 'text-emerald-600' : dist <= 15 ? 'text-amber-600' : 'text-slate-500'
                              )}>{distFmt}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {(perfil.email || perfilAuto.email) && (
              <CampoAuto auto={perfilAuto.email}>
                <Input placeholder="E-mail" value={perfil.email || ''}
                  onChange={e => editaCampo('email', e.target.value)}
                  className={cn(perfilAuto.email && 'ring-2 ring-emerald-300 border-emerald-400 pr-8')} />
              </CampoAuto>
            )}
            {(perfil.problema_saude || perfilAuto.problema_saude) && (
              <CampoAuto auto={perfilAuto.problema_saude}>
                <Input placeholder="Problema de saúde" value={perfil.problema_saude || ''}
                  onChange={e => editaCampo('problema_saude', e.target.value)}
                  className={cn(perfilAuto.problema_saude && 'ring-2 ring-emerald-300 border-emerald-400 pr-8')} />
              </CampoAuto>
            )}
          </div>
        </section>

        {ultima && (
          <>
            <section>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Última chamada</div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <Stat label="In"  valor={ultima.tokens_input} />
                <Stat label="Out" valor={ultima.tokens_output} />
              </div>
              <div className="bg-emerald-50 rounded-lg p-2 mb-2">
                <div className="text-[10px] text-emerald-600 uppercase flex items-center gap-1">
                  <DollarSign className="w-2.5 h-2.5" /> USD
                </div>
                <div className="font-semibold text-emerald-700 text-sm">${(ultima.custo_usd || 0).toFixed(5)}</div>
              </div>
              <div className="bg-slate-50 rounded-lg p-2 flex items-center gap-2">
                <Clock className="w-3 h-3 text-slate-500" />
                <span className="text-xs text-slate-700">{ultima.duracao_ms}ms</span>
              </div>
            </section>

            {ultima.arquivos_carregados?.length > 0 && (
              <section>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <FileCode className="w-3 h-3" /> Arquivos ({ultima.arquivos_carregados.length})
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-1.5 space-y-0.5">
                  {((ultima.arquivos_meta as Array<{ caminho: string; atualizado_em: string | null; tamanho: number }>) ||
                    (ultima.arquivos_carregados || []).map((a: string) => ({ caminho: a, atualizado_em: null, tamanho: 0 }))
                  ).map((a) => (
                    <div key={a.caminho}
                      className="w-full text-left flex flex-col gap-0.5 px-2 py-1.5 rounded text-slate-600 text-[11px] font-mono">
                      <span className="truncate">{a.caminho}</span>
                      {a.atualizado_em && (
                        <span className="text-[9px] text-slate-400">
                          {tempoRelativo(a.atualizado_em)}
                          {a.tamanho ? ` · ${Math.round(a.tamanho / 102.4) / 10} KB` : ''}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </aside>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// CHAT PANEL
// ═══════════════════════════════════════════════════════════════════════════════
interface ChatPanelProps {
  msgs: any[];
  input: string; setInput: (v: string) => void;
  loading: boolean;
  onEnviar: () => void;
  etapaAtual: string;
  trilha: string[];
  ultima: any;
}

const ChatPanel: React.FC<ChatPanelProps> = ({
  msgs, input, setInput, loading, onEnviar, etapaAtual, trilha, ultima,
}) => {
  const msgsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [msgs, loading]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col min-h-0 overflow-hidden">
      {/* Banner Sandbox */}
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs text-amber-700 flex items-center gap-2 flex-shrink-0">
        <Sparkles className="w-3.5 h-3.5" /> Modo Sandbox — não grava em conversas reais
      </div>

      {/* Trilha de etapas */}
      <div className="border-b border-slate-100 px-3 py-2 bg-slate-50/60 overflow-x-auto flex-shrink-0">
        <div className="flex items-center gap-1 text-[11px]">
          <span className="text-slate-400 font-medium whitespace-nowrap pr-1">Trilha:</span>
          {ETAPAS.map((e, i) => {
            const atual = e === (ultima?.etapa_efetiva || etapaAtual);
            const passada = !atual && trilha.includes(e);
            return (
              <React.Fragment key={e}>
                {i > 0 && <ChevronRight className={cn(
                  'w-3 h-3 flex-shrink-0',
                  passada ? 'text-blue-500' : atual ? 'text-red-400' : 'text-slate-300',
                )} />}
                <span className={cn(
                  'px-2 py-0.5 rounded-full whitespace-nowrap transition-colors flex-shrink-0',
                  atual     ? 'bg-red-500 text-white font-semibold shadow-sm ring-2 ring-red-200'
                  : passada ? 'bg-blue-500 text-white font-medium'
                            : 'bg-slate-100 text-slate-400',
                )}>
                  {ETAPA_LABEL[e]}
                </span>
              </React.Fragment>
            );
          })}
          {ultima?.decisor?.decisao?.proxima_acao && (
            <span className="ml-auto text-[10px] text-red-600 font-mono pl-2 whitespace-nowrap flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              {ultima.decisor.decisao.proxima_acao}
            </span>
          )}
        </div>
      </div>

      {/* Mensagens */}
      <div ref={msgsRef}
        className="flex-1 min-h-0 overflow-y-auto p-5 space-y-3 flex flex-col bg-slate-50/30">
        {msgs.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <div className="text-center">
              <MessageCircle className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              <div className="text-sm">Envie uma mensagem para começar</div>
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className="flex flex-col gap-0.5"
            style={{ alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div className={cn(
              'max-w-[75%] rounded-xl px-3 py-2 text-sm shadow-sm whitespace-pre-wrap break-words',
              m.role === 'user'
                ? 'bg-indigo-600 text-white'
                : 'bg-white border border-slate-200 text-slate-800',
            )}>
              {m.conteudo}
            </div>
            {m.role === 'agent' && m.etapa && (
              <div className="text-[10px] text-slate-400 px-2 flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-400" />
                {ETAPA_LABEL[m.etapa] || m.etapa}
                {m.decisor?.proxima_acao && (
                  <span className="text-indigo-500 font-mono">· {m.decisor.proxima_acao}</span>
                )}
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex items-start">
            <div className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-500 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Mari está pensando…
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-slate-200 p-3 flex gap-2 bg-white flex-shrink-0">
        <Input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && onEnviar()}
          placeholder="Digite como se fosse o cliente…"
          disabled={loading} />
        <Button onClick={onEnviar} disabled={loading || !input.trim()}>
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          Enviar
        </Button>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// PROMPT INSPECTOR
// ═══════════════════════════════════════════════════════════════════════════════
const PromptInspector: React.FC<{ ultima: any }> = ({ ultima }) => (
  <aside className="bg-slate-900 rounded-xl border border-slate-700 flex flex-col min-h-0 overflow-hidden">
    <div className="px-4 py-3 border-b border-slate-700 flex-shrink-0">
      <div className="text-xs font-semibold text-indigo-400 uppercase tracking-wider flex items-center gap-2">
        <Zap className="w-3 h-3" /> Prompt Sistema
      </div>
    </div>
    <div className="flex-1 min-h-0 overflow-y-auto p-4">
      {ultima?.prompt_sistema ? (
        <pre className="text-[11px] leading-relaxed text-slate-300 font-mono whitespace-pre-wrap break-words">
          {ultima.prompt_sistema}
        </pre>
      ) : (
        <div className="text-xs text-slate-500">Envie uma mensagem para ver o prompt montado</div>
      )}
    </div>
  </aside>
);

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers de UI
// ═══════════════════════════════════════════════════════════════════════════════
const Campo: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="text-xs font-medium text-slate-600 mb-1 block">{label}</label>
    {children}
  </div>
);

const CampoAuto: React.FC<{ auto?: boolean; children: React.ReactNode }> = ({ auto, children }) => (
  <div className="relative">
    {children}
    {auto && <CheckCircle2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-emerald-600 pointer-events-none" />}
  </div>
);

const Stat: React.FC<{ label: string; valor: number | string }> = ({ label, valor }) => (
  <div className="bg-slate-50 rounded-lg p-2">
    <div className="text-[10px] text-slate-500 uppercase">{label}</div>
    <div className="font-semibold text-slate-900 text-sm">{valor}</div>
  </div>
);
