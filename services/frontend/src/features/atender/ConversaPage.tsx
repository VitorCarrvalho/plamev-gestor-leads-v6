/**
 * ConversaPage — Pilar Atender
 * Layout 3 colunas: lista | chat | perfil.
 * Cada coluna com scroll isolado.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  MessageCircle, Phone, Search, Clock, ChevronRight, RefreshCw,
  Flame, CircleOff, Send, Sparkles, FileText, Bell, Loader2,
  CheckCircle2, AlertCircle, VolumeX, Volume2, Zap, Calendar,
  UserCircle, Bookmark, ArrowLeftRight, Pencil, Trash2, X, Save,
  Brain, DollarSign, Mail, MapPin, User as UserIcon, Thermometer,
  Paperclip, Image as ImageIcon, FileAudio, Download,
} from 'lucide-react';

// Detecta markers de anexo salvos como texto em mensagens.conteudo e
// devolve { tipo, rotulo } pra renderizar um card em vez do texto cru.
// Exemplos de marker produzidos pelo pipeline Mari (processor.js / sender.js):
//   [📋 PDF advance enviado]
//   [📋 PDF advance_plus enviado]
//   [🖼️ imagem cep-cobertura.png enviada]
//   [🎵 audio-xxx.ogg]
function detectarAnexo(conteudo: string): { tipo: 'pdf' | 'imagem' | 'audio'; rotulo: string } | null {
  if (!conteudo) return null;
  const mPdf = conteudo.match(/^\[(?:📋|📄)\s*PDF\s+([^\]]+?)\s+enviad[oa]\]$/i);
  if (mPdf) return { tipo: 'pdf', rotulo: `Manual ${mPdf[1].replace(/_/g, ' ')}` };
  const mImg = conteudo.match(/^\[(?:🖼️|🖼|📷)\s*imagem\s+([^\]]+?)(?:\s+enviad[oa])?\]$/i);
  if (mImg) return { tipo: 'imagem', rotulo: mImg[1] };
  const mAud = conteudo.match(/^\[(?:🎵|🎙️)\s*[áa]udio\s+([^\]]+?)(?:\s+enviad[oa])?\]$/i);
  if (mAud) return { tipo: 'audio', rotulo: mAud[1] };
  return null;
}

// Trilha canônica de etapas — azul = realmente visitada, vermelho = atual, cinza = nunca visitada.
// IMPORTANTE: não existe dependência entre etapas. Um lead pode chegar já querendo fechar e pular
// direto pra 'fechamento' sem passar pelas anteriores. Por isso pintamos apenas as etapas que
// aparecem no histórico real (funil_conversao / array `trilha` acumulado).
const ETAPAS_TRILHA = ['acolhimento', 'qualificacao', 'apresentacao_planos', 'validacao_cep', 'negociacao', 'objecao', 'pre_fechamento', 'fechamento', 'venda_fechada', 'pago'];
const ETAPA_LABEL_TRILHA: Record<string, string> = {
  acolhimento: 'Acolhim.',
  qualificacao: 'Qualif.',
  apresentacao_planos: 'Apres.',
  validacao_cep: 'CEP',
  negociacao: 'Negoc.',
  objecao: 'Objeção',
  pre_fechamento: 'Pré-fech.',
  fechamento: 'Fechar',
  venda_fechada: '✓ Venda',
  pago: '💰 Pago',
};

const Trilha: React.FC<{ etapaAtual: string | null | undefined; etapasVisitadas: string[] }> = ({ etapaAtual, etapasVisitadas }) => {
  const visitadasSet = new Set(etapasVisitadas || []);
  return (
    <div className="border-b border-slate-100 px-3 py-2 bg-slate-50/60 overflow-x-auto flex-shrink-0">
      <div className="flex items-center gap-1 text-[11px]">
        <span className="text-slate-400 font-medium whitespace-nowrap pr-1">Trilha:</span>
        {ETAPAS_TRILHA.map((e, i) => {
          const atual = e === etapaAtual;
          const visitada = !atual && visitadasSet.has(e);
          return (
            <React.Fragment key={e}>
              {i > 0 && <ChevronRight className="w-3 h-3 flex-shrink-0 text-slate-300" />}
              <span className={cn(
                'px-2 py-0.5 rounded-full whitespace-nowrap transition-colors flex-shrink-0',
                atual      ? 'bg-red-500 text-white font-semibold shadow-sm ring-2 ring-red-200'
                : visitada ? 'bg-blue-500 text-white font-medium'
                           : 'bg-slate-100 text-slate-400'
              )}>
                {ETAPA_LABEL_TRILHA[e] || e}
              </span>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
import { api, isAdmin } from '@/services/api';
import { useSocket } from '@/hooks/useSocket';
import { PageHeader } from '@/components/layout/PageHeader';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { cn } from '@/lib/utils';

function fmtFone(p: string | null): string {
  if (!p) return '—';
  const d = p.replace(/\D/g, '');
  if (d.length === 13) return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return p;
}

function fmtTempo(iso: string | null): string {
  if (!iso) return '—';
  const delta = Date.now() - new Date(iso).getTime();
  const m = Math.floor(delta / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ── Cor do avatar por temperatura/estado do lead (21/04/2026) ───────────
// Substitui a lógica antiga que usava cor por canal (whatsapp=verde, tele=azul).
// Agora a cor reflete o STATUS comercial — o supervisor vê o pipeline no piscar.
const TEMP_ESTILO: Record<string, { avatar: string; dot: string; label: string; emoji: string }> = {
  vendido:  { avatar: 'bg-gradient-to-br from-purple-500 to-purple-700',     dot: 'bg-purple-500',   label: 'Vendido',  emoji: '💜' },
  quente:   { avatar: 'bg-gradient-to-br from-red-500 to-orange-500',        dot: 'bg-red-500',      label: 'Quente',   emoji: '🔥' },
  morno:    { avatar: 'bg-gradient-to-br from-amber-400 to-amber-600',       dot: 'bg-amber-500',    label: 'Morno',    emoji: '⚡' },
  frio:     { avatar: 'bg-gradient-to-br from-sky-400 to-sky-600',            dot: 'bg-sky-500',      label: 'Frio',     emoji: '❄️' },
  perdido:  { avatar: 'bg-gradient-to-br from-slate-400 to-slate-600',       dot: 'bg-slate-500',    label: 'Perdido',  emoji: '💤' },
};
function estiloTemperatura(c: any) {
  const t = c?.temperatura_lead || 'morno';
  // Overrides de etapa pra reforçar visualmente
  if (c?.etapa === 'pago')          return { ...TEMP_ESTILO.vendido, avatar: 'bg-gradient-to-br from-emerald-500 to-emerald-700', dot: 'bg-emerald-500', label: 'Pago', emoji: '💰' };
  if (c?.etapa === 'venda_fechada') return TEMP_ESTILO.vendido;
  return TEMP_ESTILO[t] || TEMP_ESTILO.morno;
}

// ── Mapa de próximo passo sugerido por etapa ────────────────────────────
const PROXIMO_PASSO: Record<string, { proximo: string | null; hint: string }> = {
  acolhimento:          { proximo: 'qualificacao',        hint: 'Coletar raça + idade do pet' },
  qualificacao:         { proximo: 'apresentacao_planos', hint: 'Apresentar plano recomendado' },
  apresentacao_planos:  { proximo: 'validacao_cep',       hint: 'Pedir CEP pra confirmar cobertura' },
  validacao_cep:        { proximo: 'pre_fechamento',      hint: 'Coletar nome, CPF, e-mail' },
  negociacao:           { proximo: 'pre_fechamento',      hint: 'Aplicar Oferta (WOW) ou Supervisora' },
  objecao:              { proximo: 'negociacao',          hint: 'Responder objeção + CTA' },
  pre_fechamento:       { proximo: 'fechamento',          hint: 'Enviar link de pagamento' },
  fechamento:           { proximo: 'venda_fechada',       hint: 'Cliente confirmou interesse' },
  venda_fechada:        { proximo: 'pago',                hint: 'Aguardando confirmação no ERP' },
  pago:                 { proximo: null,                  hint: 'Venda concluída 💜' },
};

// Persistência de conversa ativa (click em LiveFeed/Fila navega pra Atender com ela aberta)
const CONVERSA_ATIVA_KEY = 'dashv5_conversa_ativa';

export const ConversaPage: React.FC = () => {
  const socket = useSocket();
  const [conversas, setConversas] = useState<any[]>([]);
  // Lê conversa pré-selecionada (navegação vinda de outras telas — LiveFeed, Fila, etc)
  const [ativa, setAtiva] = useState<string | null>(() => {
    const preselected = localStorage.getItem(CONVERSA_ATIVA_KEY);
    if (preselected) { localStorage.removeItem(CONVERSA_ATIVA_KEY); return preselected; }
    return null;
  });
  const [busca, setBusca] = useState('');
  const [filtroEtapa, setFiltroEtapa] = useState<string>('todas');
  const [filtroTemp, setFiltroTemp] = useState<string>('todas');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<any[]>('/api/conversas').then(cs => { setConversas(cs); setLoading(false); });
  }, []);

  useEffect(() => {
    const refresh = () => api.get<any[]>('/api/conversas').then(setConversas);
    socket.on('nova_msg', refresh);
    socket.on('conversa_atualizada', refresh);
    socket.on('ia_status', refresh);
    return () => { socket.off('nova_msg', refresh); socket.off('conversa_atualizada', refresh); socket.off('ia_status', refresh); };
  }, [socket]);

  const filtradas = conversas.filter(c => {
    if (filtroEtapa !== 'todas' && c.etapa !== filtroEtapa) return false;
    if (filtroTemp  !== 'todas' && (c.temperatura_lead || 'morno') !== filtroTemp) return false;
    if (!busca.trim()) return true;
    const q = busca.toLowerCase();
    return (c.nome_cliente || '').toLowerCase().includes(q)
      || (c.nome_pet || '').toLowerCase().includes(q)
      || (c.phone || '').includes(q);
  });

  // Contagem por etapa pra popular as pills
  const contEtapa: Record<string, number> = {};
  const contTemp: Record<string, number>  = {};
  conversas.forEach(c => {
    const e = c.etapa || 'acolhimento';
    const t = c.temperatura_lead || 'morno';
    contEtapa[e] = (contEtapa[e] || 0) + 1;
    contTemp[t]  = (contTemp[t]  || 0) + 1;
  });

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <PageHeader title="Conversa Ativa" subtitle="Supervisione e intervenha em tempo real">
        <Badge variant="green" className="gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> ao vivo</Badge>
      </PageHeader>

      <div className="flex-1 grid grid-cols-[320px_minmax(0,1fr)_360px] gap-0 min-h-0 overflow-hidden">
        {/* COLUNA 1 — Conversas + filtros + legenda */}
        <div className="bg-white border-r border-slate-200 flex flex-col min-h-0 overflow-hidden">
          <div className="flex-shrink-0">
            <div className="px-3 py-1.5 bg-slate-100 border-b border-slate-200 text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
              <MessageCircle className="w-3 h-3" /> Conversas
              <span className="ml-auto text-slate-400 font-normal normal-case">{filtradas.length} de {conversas.length}</span>
            </div>

            {/* Legenda de temperatura — visual rápido pro supervisor */}
            <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2 flex-wrap text-[10px]">
              <span className="text-slate-400 font-medium">Legenda:</span>
              {(['quente','morno','frio','perdido','vendido'] as const).map(t => {
                const e = TEMP_ESTILO[t];
                return (
                  <button
                    key={t}
                    onClick={() => setFiltroTemp(filtroTemp === t ? 'todas' : t)}
                    className={cn(
                      'flex items-center gap-1 px-1.5 py-0.5 rounded transition-all',
                      filtroTemp === t ? 'bg-slate-900 text-white' : 'hover:bg-slate-100 text-slate-600'
                    )}
                    title={`Filtrar ${e.label}`}
                  >
                    <span className={cn('w-2 h-2 rounded-full', e.dot)} />
                    <span>{e.emoji} {e.label}</span>
                    <span className="opacity-60">({contTemp[t] || 0})</span>
                  </button>
                );
              })}
            </div>

            {/* Busca */}
            <div className="px-3 pt-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <Input placeholder="Buscar…" value={busca} onChange={e => setBusca(e.target.value)} className="pl-9 h-9 text-sm" />
              </div>
            </div>

            {/* Filtro por etapa — pills horizontais */}
            <div className="px-3 py-2 border-b border-slate-200 flex gap-1 overflow-x-auto">
              <button
                onClick={() => setFiltroEtapa('todas')}
                className={cn(
                  'text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap transition',
                  filtroEtapa === 'todas' ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                )}
              >
                Todas ({conversas.length})
              </button>
              {ETAPAS_TRILHA.map(e => (
                <button
                  key={e}
                  onClick={() => setFiltroEtapa(filtroEtapa === e ? 'todas' : e)}
                  className={cn(
                    'text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap transition',
                    filtroEtapa === e ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200',
                    !contEtapa[e] && 'opacity-40'
                  )}
                  title={PROXIMO_PASSO[e]?.hint || ''}
                >
                  {ETAPA_LABEL_TRILHA[e] || e} {contEtapa[e] ? `(${contEtapa[e]})` : ''}
                </button>
              ))}
            </div>
          </div>

          {/* Lista de conversas — ocupa todo o espaço restante */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {loading ? <LoadingSpinner />
              : filtradas.length === 0 ? <EmptyState icon={MessageCircle} title="Nada encontrado" />
              : filtradas.map(c => (
                <ContactItem key={c.conversa_id} conversa={c} ativa={ativa === c.conversa_id} onClick={() => setAtiva(c.conversa_id)} />
              ))}
          </div>
        </div>

        {/* COLUNA 2 — Chat */}
        <div className="flex flex-col min-h-0 overflow-hidden bg-slate-50">
          {ativa
            ? <ChatWindow conversaId={ativa} />
            : <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
                <div className="text-center">
                  <MessageCircle className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                  <div>Selecione uma conversa à esquerda</div>
                </div>
              </div>
          }
        </div>

        {/* COLUNA 3 — Perfil */}
        <div className="bg-white border-l border-slate-200 flex flex-col min-h-0 overflow-hidden">
          {ativa
            ? <PerfilPanel conversaId={ativa} />
            : <div className="flex-1 flex items-center justify-center text-slate-300 text-xs p-4 text-center">
                Perfil do lead aparece aqui
              </div>
          }
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// CARD CLIENTE — versão rica, usada na seção superior (leads quentes/fechando)
// ═══════════════════════════════════════════════════════════════
const CardCliente: React.FC<{ conversa: any; ativa: boolean; onClick: () => void }> = ({ conversa: c, ativa, onClick }) => {
  const score = c.score || 0;
  const etapaCor =
    c.etapa === 'pago'            ? 'from-emerald-500 to-emerald-600' :
    c.etapa === 'venda_fechada'   ? 'from-indigo-500 to-indigo-600' :
    c.etapa === 'fechamento' || c.etapa === 'pre_fechamento' ? 'from-amber-500 to-orange-500' :
    c.etapa === 'negociacao' || c.etapa === 'objecao' ? 'from-rose-500 to-pink-500' :
    'from-slate-400 to-slate-500';

  const etapaLabel =
    c.etapa === 'pago'            ? '💰 Pago' :
    c.etapa === 'venda_fechada'   ? '✓ Venda' :
    c.etapa === 'pre_fechamento'  ? 'Pré-fech.' :
    c.etapa === 'fechamento'      ? 'Fechando' :
    c.etapa === 'negociacao'      ? 'Negoc.' :
    c.etapa === 'objecao'         ? 'Objeção' :
    c.etapa === 'apresentacao_planos' ? 'Apres.' :
    c.etapa === 'qualificacao'    ? 'Qualif.' :
    c.etapa === 'validacao_cep'   ? 'CEP' :
    c.etapa || '—';

  const petDesc = [c.nome_pet, c.raca, c.idade_anos ? `${c.idade_anos}a` : null].filter(Boolean).join(' · ');

  return (
    <button onClick={onClick}
      className={cn(
        'w-full text-left rounded-xl border bg-white p-3 transition-all hover:shadow-md',
        ativa ? 'border-indigo-400 ring-2 ring-indigo-200 shadow-sm' : 'border-slate-200'
      )}>
      {/* Linha 1: avatar + nome + score */}
      <div className="flex items-center gap-2.5 mb-1.5">
        <div className={cn(
          'w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-sm',
          c.canal === 'whatsapp' ? 'bg-gradient-to-br from-emerald-500 to-emerald-600' : 'bg-gradient-to-br from-blue-500 to-blue-600'
        )}>
          {(c.nome_cliente || c.nome_pet || '?')[0].toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-900 truncate">
            {c.nome_cliente || fmtFone(c.phone)}
          </div>
          <div className="text-[10px] text-slate-500 flex items-center gap-1">
            <Phone className="w-2.5 h-2.5" /> {fmtFone(c.phone)}
            {c.ia_silenciada && <CircleOff className="w-2.5 h-2.5 text-amber-500 ml-1" />}
          </div>
        </div>
        {score >= 7 && (
          <div className="flex items-center gap-1 bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0">
            🔥 {score}
          </div>
        )}
      </div>

      {/* Linha 2: Pet */}
      {petDesc && (
        <div className="text-[11px] text-emerald-700 mb-1.5 truncate">🐾 {petDesc}</div>
      )}

      {/* Linha 3: badges de etapa + plano */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className={cn(
          'px-2 py-0.5 rounded-md text-[10px] font-semibold text-white bg-gradient-to-r shadow-sm',
          etapaCor
        )}>
          {etapaLabel}
        </span>
        {c.plano_recomendado && (
          <span className="px-2 py-0.5 rounded-md bg-purple-100 text-purple-700 text-[10px] font-medium">
            📦 {c.plano_recomendado}
          </span>
        )}
        {c.temperatura_lead && (
          <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 text-[10px] font-medium">
            🌡️ {c.temperatura_lead}
          </span>
        )}
        <span className="ml-auto text-[9px] text-slate-400">{fmtTempo(c.ultima_msg_ts)}</span>
      </div>

      {/* Linha 4: última mensagem (preview) */}
      {c.ultima_msg_conteudo && (
        <div className="mt-1.5 text-[11px] text-slate-600 italic line-clamp-1 border-t border-slate-100 pt-1.5">
          "{c.ultima_msg_conteudo.slice(0, 65)}"
        </div>
      )}
    </button>
  );
};

// ═══════════════════════════════════════════════════════════════
// CONTACT ITEM — versão compacta, usada na seção inferior (todas as conversas)
// ═══════════════════════════════════════════════════════════════
const ContactItem: React.FC<{ conversa: any; ativa: boolean; onClick: () => void }> = ({ conversa: c, ativa, onClick }) => {
  const quente = (c.score || 0) >= 7;
  const estilo = estiloTemperatura(c);
  return (
    <button onClick={onClick}
      className={cn(
        'w-full text-left px-3 py-2.5 border-b border-slate-100 flex items-center gap-3 transition-colors',
        ativa ? 'bg-indigo-50 border-l-2 border-l-indigo-500 pl-[10px]' : 'hover:bg-slate-50'
      )}>
      <div
        className={cn(
          'w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-xs flex-shrink-0 shadow-sm',
          estilo.avatar
        )}
        title={`${estilo.label} · Score ${c.score ?? 0}/10`}
      >
        {(c.nome_cliente || c.nome_pet || '?')[0].toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="font-medium text-slate-900 text-sm truncate">{c.nome_cliente || fmtFone(c.phone)}</span>
          {quente && <Flame className="w-3 h-3 text-red-500 flex-shrink-0" />}
          {c.ia_silenciada && <CircleOff className="w-3 h-3 text-amber-500 flex-shrink-0" />}
        </div>
        <div className="text-xs text-slate-500 truncate flex items-center gap-1">
          <span className={cn('w-1.5 h-1.5 rounded-full', estilo.dot)} />
          {c.nome_pet && <span className="text-emerald-600">🐾 {c.nome_pet}</span>}
          {!c.nome_pet && (c.ultima_msg_conteudo?.slice(0, 30) || fmtFone(c.phone))}
        </div>
      </div>
      <span className="text-[10px] text-slate-400 flex-shrink-0">{fmtTempo(c.ultima_msg_ts)}</span>
    </button>
  );
};

// ═══════════════════════════════════════════════════════════════
// CHAT WINDOW — 3 abas Mari/Direto/Nota + mensagens
// ═══════════════════════════════════════════════════════════════
const ChatWindow: React.FC<{ conversaId: string }> = ({ conversaId }) => {
  const socket = useSocket();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [aba, setAba] = useState<'mari' | 'direto' | 'nota'>('mari');
  const [texto, setTexto] = useState('');
  const [reescrever, setReescrever] = useState(true);
  const [acaoLoading, setAcaoLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [modalAgendar, setModalAgendar] = useState(false);
  const msgsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-foca o input quando a ação termina OU quando troca de aba
  useEffect(() => { if (!acaoLoading) inputRef.current?.focus(); }, [acaoLoading, aba, conversaId]);

  const carregarConversa = async () => {
    setLoading(true);
    try {
      const d = await api.get<any>(`/api/conversas/${conversaId}/full`);
      setData(d);
    } catch (e: any) {
      console.error('[ChatWindow] Erro ao carregar conversa:', e.message);
    }
    setLoading(false);
  };

  // Carregar via REST
  useEffect(() => { carregarConversa(); }, [conversaId]);

  // Scroll para o final quando novas mensagens chegam (só do container)
  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [data?.mensagens?.length]);

  // Feedback ok/erro genérico
  useEffect(() => {
    const handlers: [string, (d: any) => void][] = [
      ['provocar_ok',        () => setFeedback({ ok: true, text: '✓ Mari provocou o lead' })],
      ['instrucao_ok',       () => setFeedback({ ok: true, text: '✓ Mari enviou mensagem' })],
      ['falar_direto_ok',    () => setFeedback({ ok: true, text: '✓ Mensagem enviada' })],
      ['nota_ok',            () => setFeedback({ ok: true, text: '✓ Nota salva' })],
      ['agendar_ok',         () => setFeedback({ ok: true, text: '✓ Mensagem agendada' })],
      ['ia_status',          (d) => setFeedback({ ok: true, text: `✓ IA ${d.silenciada ? 'silenciada' : 'ativa'}` })],
      ['erro',               (d) => setFeedback({ ok: false, text: d.msg || 'Erro' })],
    ];
    handlers.forEach(([e, h]) => socket.on(e, (d: any) => { h(d); setAcaoLoading(false); setTimeout(() => setFeedback(null), 3000); carregarConversa(); }));
    return () => { handlers.forEach(([e]) => socket.off(e)); };
  }, [socket, conversaId]);

  const executarAcao = () => {
    if (!texto.trim() && aba !== 'mari') return;
    setAcaoLoading(true); setFeedback(null);
    if (aba === 'mari')   socket.emit('provocar',   { conversa_id: conversaId });
    if (aba === 'direto') socket.emit('falar_direto', { conversa_id: conversaId, texto, reescrever });
    if (aba === 'nota')   socket.emit('salvar_nota', { conversa_id: conversaId, texto });
    setTexto('');
    // Re-foca imediatamente (ainda em loading) — permite digitar a próxima msg
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const instruirMari = () => {
    if (!texto.trim()) return;
    setAcaoLoading(true); setFeedback(null);
    socket.emit('instrucao', { conversa_id: conversaId, texto });
    setTexto('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  // Enter envia, Shift+Enter quebra linha
  const onKeyDownInput = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (aba === 'mari')
        (texto.trim() ? instruirMari : executarAcao)();
      else
        executarAcao();
    }
  };

  const toggleIa = () => socket.emit('silenciar_ia', conversaId);

  const [modalIntelV1, setModalIntelV1] = useState(false);
  const [motivoIntelV1, setMotivoIntelV1] = useState('');
  const [enviandoIntelV1, setEnviandoIntelV1] = useState(false);

  const enviarParaIntelV1 = async () => {
    setEnviandoIntelV1(true);
    try {
      const r = await api.post<{ ok: boolean; id: number; titulo: string }>(
        `/api/analisar/enviar-intel-v1/${conversaId}`,
        { motivo: motivoIntelV1 }
      );
      setFeedback({ ok: true, text: `✓ Enviado ao Intel V1 (#${r.id})` });
      setModalIntelV1(false); setMotivoIntelV1('');
      setTimeout(() => setFeedback(null), 3000);
    } catch (e: any) {
      setFeedback({ ok: false, text: e?.message || 'Erro ao enviar' });
    } finally { setEnviandoIntelV1(false); }
  };

  const mudarEtapa = async (etapa: string) => {
    try {
      await api.patch(`/api/conversa/${conversaId}/etapa`, { etapa });
      setFeedback({ ok: true, text: `✓ Etapa atualizada para ${etapa}` });
      await carregarConversa();
      setTimeout(() => setFeedback(null), 3000);
    } catch (e: any) {
      setFeedback({ ok: false, text: e?.message || 'Erro ao mudar etapa' });
    }
  };

  if (loading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;
  if (!data) return <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Conversa não encontrada</div>;

  const { conversa, mensagens, agendamentos, etapasVisitadas = [] } = data;
  const iaSilenciada = conversa.ia_silenciada;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Header da conversa */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
          {(conversa.nome_cliente || '?')[0].toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-slate-900 text-sm flex items-center gap-2">
            {conversa.nome_cliente || fmtFone(conversa.phone)}
            <Badge variant={conversa.canal === 'whatsapp' ? 'green' : 'blue'} className="text-[10px]">
              {conversa.canal}
            </Badge>
          </div>
          <div className="text-xs text-slate-500 flex items-center gap-2">
            <Phone className="w-3 h-3" /> {fmtFone(conversa.phone)}
            {conversa.etapa && <><span>·</span><span>{conversa.etapa}</span></>}
            {conversa.score != null && <><span>·</span><span className="font-semibold">{conversa.score}/10</span></>}
          </div>
        </div>
        <Button size="sm" variant={iaSilenciada ? 'danger-outline' : 'outline'} onClick={toggleIa}>
          {iaSilenciada ? <><Volume2 className="w-3.5 h-3.5" /> Ativar IA</> : <><VolumeX className="w-3.5 h-3.5" /> Silenciar IA</>}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setModalAgendar(true)}>
          <Calendar className="w-3.5 h-3.5" /> Agendar
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setModalIntelV1(true)}
          title="Enviar esta conversa ao Intelligence V1 para análise"
        >
          <Brain className="w-3.5 h-3.5" /> Análise
        </Button>
        {conversa.etapa !== 'pago' && (
          <Button
            size="sm"
            variant={conversa.etapa === 'venda_fechada' ? 'default' : 'outline'}
            onClick={() => mudarEtapa('pago')}
            title="Marcar como pago (adesão confirmada no ERP)"
          >
            <DollarSign className="w-3.5 h-3.5" /> Marcar Pago
          </Button>
        )}
      </div>

      <Dialog open={modalIntelV1} onOpenChange={setModalIntelV1}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar conversa para análise no Intelligence V1</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Será criado um snapshot das mensagens e do perfil atuais. O Intelligence V1 vai
              listar esta conversa em <span className="font-medium">Sandbox · Análise</span>.
            </p>
            <label className="text-xs font-medium text-slate-600 block">
              Motivo / o que analisar (opcional)
            </label>
            <Textarea
              value={motivoIntelV1}
              onChange={e => setMotivoIntelV1(e.target.value)}
              placeholder="Ex: Mari enviou preço 3x e parou de responder. Verificar apresentacao-planos."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalIntelV1(false)}>Cancelar</Button>
            <Button onClick={enviarParaIntelV1} disabled={enviandoIntelV1}>
              {enviandoIntelV1 ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Enviando…</> : <>Enviar <Brain className="w-3.5 h-3.5" /></>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Trilha de etapas — azul = realmente visitadas, vermelho = atual, cinza = não visitadas */}
      <Trilha etapaAtual={conversa.etapa} etapasVisitadas={etapasVisitadas} />

      {/* Feedback */}
      {feedback && (
        <div className={cn(
          'px-4 py-2 text-xs flex items-center gap-2 flex-shrink-0',
          feedback.ok ? 'bg-emerald-50 text-emerald-700 border-b border-emerald-200' : 'bg-red-50 text-red-700 border-b border-red-200'
        )}>
          {feedback.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
          {feedback.text}
        </div>
      )}

      {/* Mensagens */}
      <div ref={msgsRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
        {mensagens.length === 0
          ? <div className="text-center text-slate-400 text-sm py-10">Sem mensagens</div>
          : mensagens.map((m: any) => (
            <Bolha
              key={m.id}
              msg={{ ...m, conversa_id: conversaId }}
              onChange={() => socket.emit('get_conversa', conversaId)}
            />
          ))}
      </div>

      {/* Ações — Tabs (rodapé FIXO, fora da rolagem das mensagens) */}
      <div className="bg-white border-t-2 border-slate-200 p-3 flex-shrink-0 shadow-[0_-4px_12px_-4px_rgba(0,0,0,0.06)] z-10">
        <Tabs value={aba} onValueChange={v => setAba(v as any)}>
          <div className="flex items-center gap-2 mb-2">
            <TabsList>
              <TabsTrigger value="mari"><Sparkles className="w-3 h-3" /> Mari</TabsTrigger>
              <TabsTrigger value="direto"><Send className="w-3 h-3" /> Direto</TabsTrigger>
              <TabsTrigger value="nota"><FileText className="w-3 h-3" /> Nota</TabsTrigger>
            </TabsList>
            {aba === 'direto' && (
              <label className="text-xs text-slate-500 flex items-center gap-1 ml-auto">
                <input type="checkbox" checked={reescrever} onChange={e => setReescrever(e.target.checked)} />
                Reescrever no tom Mari
              </label>
            )}
          </div>

          <TabsContent value="mari" className="mt-0">
            <Textarea
              ref={aba === 'mari' ? inputRef : undefined}
              value={texto}
              onChange={e => setTexto(e.target.value)}
              onKeyDown={onKeyDownInput}
              placeholder="(opcional) Instrução para Mari. Deixe vazio para gerar provocação. · Enter envia, Shift+Enter quebra linha"
              className="min-h-[50px] max-h-[120px] text-sm resize-none"
              autoFocus
            />
            <div className="flex gap-2 mt-2">
              <Button onClick={texto.trim() ? instruirMari : executarAcao} disabled={acaoLoading} size="sm">
                {acaoLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                {texto.trim() ? 'Instruir Mari' : 'Provocar'}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="direto" className="mt-0">
            <Textarea
              ref={aba === 'direto' ? inputRef : undefined}
              value={texto}
              onChange={e => setTexto(e.target.value)}
              onKeyDown={onKeyDownInput}
              placeholder="Escreva no nome da Mari… · Enter envia, Shift+Enter quebra linha"
              className="min-h-[50px] max-h-[120px] text-sm resize-none"
              autoFocus
            />
            <Button onClick={executarAcao} disabled={acaoLoading || !texto.trim()} size="sm" className="mt-2">
              {acaoLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Enviar
            </Button>
          </TabsContent>

          <TabsContent value="nota" className="mt-0">
            <Textarea
              ref={aba === 'nota' ? inputRef : undefined}
              value={texto}
              onChange={e => setTexto(e.target.value)}
              onKeyDown={onKeyDownInput}
              placeholder="Nota interna (não visível ao cliente)… · Enter envia"
              className="min-h-[50px] max-h-[120px] text-sm resize-none"
              autoFocus
            />
            <Button onClick={executarAcao} disabled={acaoLoading || !texto.trim()} size="sm" className="mt-2">
              {acaoLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
              Salvar nota
            </Button>
          </TabsContent>
        </Tabs>
      </div>

      {/* Modal Agendar */}
      {modalAgendar && <ModalAgendar conversaId={conversaId} onClose={() => setModalAgendar(false)} />}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// BOLHA de mensagem — com toolbar (editar / excluir / reescrever como Mari)
// ═══════════════════════════════════════════════════════════════
const Bolha: React.FC<{ msg: any; onChange?: () => void }> = ({ msg, onChange }) => {
  const ehCliente = msg.role === 'user' || msg.enviado_por === 'cliente';
  const ehNota = msg.role === 'system' || msg.enviado_por === 'nota';
  const admin = isAdmin();

  const [editando, setEditando] = useState(false);
  const [textoEdit, setTextoEdit] = useState(msg.conteudo);
  const [salvando, setSalvando] = useState(false);
  const [reescritaOpen, setReescritaOpen] = useState(false);

  const salvarEdicao = async () => {
    if (!textoEdit.trim() || textoEdit === msg.conteudo) { setEditando(false); return; }
    setSalvando(true);
    try {
      await api.patch(`/api/mensagens/${msg.id}`, { conteudo: textoEdit });
      setEditando(false);
      onChange?.();
    } catch (e: any) { alert(e.message); }
    setSalvando(false);
  };

  const excluir = async () => {
    if (!confirm('Excluir esta mensagem permanentemente? A ação fica no log de auditoria.')) return;
    try {
      await api.delete(`/api/mensagens/${msg.id}`);
      onChange?.();
    } catch (e: any) { alert(e.message); }
  };

  if (ehNota) {
    return (
      <div className="flex justify-center my-2">
        <div className="bg-amber-50 border border-amber-200 text-amber-700 text-xs px-3 py-1.5 rounded-full flex items-center gap-1 group">
          <FileText className="w-3 h-3" />
          <span>{msg.conteudo}</span>
          {admin && (
            <button onClick={excluir} className="opacity-0 group-hover:opacity-100 transition-opacity ml-1 hover:text-red-600" title="Excluir nota">
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={cn('flex group', ehCliente ? 'justify-end' : 'justify-start')}>
        {/* Toolbar esquerda (antes da bolha quando NÃO é cliente) */}
        {!ehCliente && admin && !editando && (
          <ToolbarMsg
            msg={msg}
            onEditar={() => { setTextoEdit(msg.conteudo); setEditando(true); }}
            onExcluir={excluir}
            onReescrever={() => setReescritaOpen(true)}
            alinhamento="esq"
          />
        )}

        <div className={cn(
          'max-w-[75%] rounded-xl px-3 py-2 text-sm shadow-sm',
          ehCliente ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-800'
        )}>
          {editando ? (
            <div className="space-y-2">
              <Textarea value={textoEdit} onChange={e => setTextoEdit(e.target.value)}
                className="min-h-[80px] bg-white text-slate-900 text-sm"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) salvarEdicao(); }} />
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="outline" onClick={() => setEditando(false)} disabled={salvando}>
                  <X className="w-3 h-3" /> Cancelar
                </Button>
                <Button size="sm" onClick={salvarEdicao} disabled={salvando}>
                  {salvando ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Salvar
                </Button>
              </div>
              <div className="text-[10px] text-slate-500">⌘+Enter para salvar · só altera histórico local · não reenvia ao cliente</div>
            </div>
          ) : (
            <>
              {(() => {
                const anexo = detectarAnexo(msg.conteudo);
                if (!anexo) return <div className="whitespace-pre-wrap break-words">{msg.conteudo}</div>;
                const Icone = anexo.tipo === 'pdf' ? FileText : anexo.tipo === 'imagem' ? ImageIcon : FileAudio;
                const cor = ehCliente
                  ? 'bg-indigo-500/30 border-indigo-300/40'
                  : 'bg-slate-50 border-slate-200';
                return (
                  <div className={cn('flex items-center gap-2 px-3 py-2 rounded-lg border', cor)}>
                    <div className={cn('flex items-center justify-center w-8 h-8 rounded-md',
                      ehCliente ? 'bg-white/20' : 'bg-indigo-100 text-indigo-600')}>
                      <Icone className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={cn('text-xs font-medium truncate', ehCliente ? 'text-white' : 'text-slate-800')}>
                        {anexo.rotulo}
                      </div>
                      <div className={cn('text-[10px]', ehCliente ? 'text-indigo-100' : 'text-slate-500')}>
                        {anexo.tipo === 'pdf' ? 'Documento PDF' : anexo.tipo === 'imagem' ? 'Imagem' : 'Áudio'} · enviado pelo WhatsApp
                      </div>
                    </div>
                    <Paperclip className={cn('w-3.5 h-3.5 shrink-0', ehCliente ? 'text-indigo-100' : 'text-slate-400')} />
                  </div>
                );
              })()}
              <div className={cn('text-[10px] mt-1 opacity-70', ehCliente ? 'text-indigo-100' : 'text-slate-400')}>
                {new Date(msg.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </>
          )}
        </div>

        {/* Toolbar direita (depois da bolha quando é cliente) */}
        {ehCliente && admin && !editando && (
          <ToolbarMsg
            msg={msg}
            onEditar={() => { setTextoEdit(msg.conteudo); setEditando(true); }}
            onExcluir={excluir}
            onReescrever={() => setReescritaOpen(true)}
            alinhamento="dir"
          />
        )}
      </div>

      {/* Modal de reescrita */}
      {reescritaOpen && (
        <ReescreverDialog
          textoOriginal={msg.conteudo}
          conversaId={msg.conversa_id}
          onClose={() => setReescritaOpen(false)}
          onAplicar={async (novo) => {
            setTextoEdit(novo);
            setEditando(true);
            setReescritaOpen(false);
          }}
        />
      )}
    </>
  );
};

const ToolbarMsg: React.FC<{
  msg: any;
  onEditar: () => void;
  onExcluir: () => void;
  onReescrever: () => void;
  alinhamento: 'esq' | 'dir';
}> = ({ onEditar, onExcluir, onReescrever, alinhamento }) => (
  <div className={cn(
    'flex flex-col gap-1 self-center opacity-0 group-hover:opacity-100 transition-opacity',
    alinhamento === 'esq' ? 'mr-1.5 items-end' : 'ml-1.5 items-start'
  )}>
    <button onClick={onReescrever}
      className="p-1 rounded hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 transition-colors"
      title="Reescrever como Mari">
      <Sparkles className="w-3.5 h-3.5" />
    </button>
    <button onClick={onEditar}
      className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
      title="Editar mensagem">
      <Pencil className="w-3.5 h-3.5" />
    </button>
    <button onClick={onExcluir}
      className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors"
      title="Excluir mensagem">
      <Trash2 className="w-3.5 h-3.5" />
    </button>
  </div>
);

// ═══════════════════════════════════════════════════════════════
// ReescreverDialog — Mari reescreve o texto no tom dela
// ═══════════════════════════════════════════════════════════════
interface ReescreverDialogProps {
  textoOriginal: string;
  conversaId: string;
  onClose: () => void;
  onAplicar: (novoTexto: string) => void;
}

const ReescreverDialog: React.FC<ReescreverDialogProps> = ({ textoOriginal, conversaId, onClose, onAplicar }) => {
  const [instrucao, setInstrucao] = useState('');
  const [resultado, setResultado] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  const reescrever = async () => {
    setLoading(true); setErro(''); setResultado(null);
    try {
      const r = await api.post<any>('/api/mensagens/reescrever', {
        texto: textoOriginal,
        conversa_id: conversaId,
        instrucao: instrucao.trim() || undefined,
      });
      setResultado(r.texto_reescrito);
    } catch (e: any) { setErro(e.message); }
    setLoading(false);
  };

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-600" /> Reescrever como Mari
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1.5 block">Texto original</label>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm text-slate-700 whitespace-pre-wrap max-h-40 overflow-y-auto">
              {textoOriginal}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 mb-1.5 block">
              Instruções para Mari (opcional)
            </label>
            <Textarea value={instrucao} onChange={e => setInstrucao(e.target.value)}
              placeholder={'Ex: "Deixa mais empática", "Destaca a carência de 15 dias", "Menos formal"…'}
              className="min-h-[70px] text-sm" />
            <div className="text-[11px] text-slate-500 mt-1">
              Deixe vazio pra Mari só reescrever no tom padrão (calorosa, WhatsApp, sem asteriscos).
            </div>
          </div>

          <Button onClick={reescrever} disabled={loading}>
            {loading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Mari pensando…</> : <><Sparkles className="w-3.5 h-3.5" /> Reescrever</>}
          </Button>

          {erro && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> {erro}
            </div>
          )}

          {resultado && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-emerald-700 mb-1.5 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Reescrita da Mari
              </label>
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-slate-800 whitespace-pre-wrap">
                {resultado}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          {resultado && (
            <Button onClick={() => onAplicar(resultado)}>
              <Pencil className="w-3.5 h-3.5" /> Usar no editor
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ═══════════════════════════════════════════════════════════════
// PERFIL PANEL (coluna direita)
// ═══════════════════════════════════════════════════════════════
const PerfilPanel: React.FC<{ conversaId: string }> = ({ conversaId }) => {
  const socket = useSocket();
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    api.get<any>(`/api/conversas/${conversaId}/full`)
      .then(setData)
      .catch(e => console.error('[PerfilPanel]', e.message));
  }, [conversaId]);

  // Atualiza quando o socket avisar
  useEffect(() => {
    const refresh = () => api.get<any>(`/api/conversas/${conversaId}/full`).then(setData).catch(() => {});
    socket.on('conversa_atualizada', refresh);
    socket.on('nova_msg', refresh);
    return () => { socket.off('conversa_atualizada', refresh); socket.off('nova_msg', refresh); };
  }, [conversaId, socket]);

  if (!data) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  const { conversa, perfil = {}, agendamentos = [], obsidianAtivo = [] } = data;

  // Fallbacks resilientes: usa o campo direto OU o perfil_pet OU vazio
  const nomeCliente = conversa.nome_cliente || conversa.cliente_nome || perfil.nome_cliente || '—';
  const telefone    = conversa.phone || conversa.numero_externo || perfil.telefone;
  const cidadeUf    = perfil.cidade ? `${perfil.cidade}${perfil.estado ? '/' + perfil.estado : ''}` : null;

  // Destaque visual se etapa = venda_fechada ou pago
  const highlightEtapa =
    conversa.etapa === 'pago'          ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
    conversa.etapa === 'venda_fechada' ? 'bg-indigo-50 border-indigo-200 text-indigo-700' :
    conversa.etapa === 'pre_fechamento' || conversa.etapa === 'fechamento' ? 'bg-amber-50 border-amber-200 text-amber-700' :
    'bg-slate-50 border-slate-200 text-slate-700';

  // Dados pro card rico do topo
  const score = conversa.score || 0;
  const petDesc = [perfil.nome_pet, perfil.raca, perfil.idade_anos ? `${perfil.idade_anos}a` : null].filter(Boolean).join(' · ');
  const etapaCor =
    conversa.etapa === 'pago'           ? 'from-emerald-500 to-emerald-600' :
    conversa.etapa === 'venda_fechada'  ? 'from-indigo-500 to-indigo-600' :
    conversa.etapa === 'fechamento' || conversa.etapa === 'pre_fechamento' ? 'from-amber-500 to-orange-500' :
    conversa.etapa === 'negociacao'  || conversa.etapa === 'objecao'       ? 'from-rose-500 to-pink-500' :
    'from-slate-400 to-slate-500';

  const estilo = estiloTemperatura(conversa);
  const proximoPassoInfo = PROXIMO_PASSO[conversa.etapa] || { proximo: null, hint: '' };

  return (
    <div className="flex flex-col min-h-0 overflow-hidden h-full">
      {/* Header fixo — label */}
      <div className="px-3 py-1.5 bg-slate-100 border-b border-slate-200 text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1 flex-shrink-0">
        <UserCircle className="w-3 h-3" /> Perfil do Lead
      </div>

      {/* Conteúdo rolável — scroll próprio, isolado das outras colunas */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 text-sm bg-slate-50/40">
        {/* ───── CARD RICO DO CLIENTE (clica no avatar → scroll pro chat no mobile) ───── */}
        <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
          <div className="flex items-center gap-2.5 mb-2">
            <div
              className={cn(
                'w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-base flex-shrink-0 shadow-sm',
                estilo.avatar
              )}
              title={`${estilo.label} · Score ${score}/10 · ${conversa.canal}`}
            >
              {(nomeCliente !== '—' ? nomeCliente : perfil.nome_pet || '?')[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-900 truncate">{nomeCliente}</div>
              <div className="text-[10px] text-slate-500 flex items-center gap-1">
                <Phone className="w-2.5 h-2.5" /> {telefone ? fmtFone(telefone) : '—'}
                {conversa.ia_silenciada && <CircleOff className="w-2.5 h-2.5 text-amber-500 ml-1" />}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold text-white', estilo.dot.replace('bg-', 'bg-'))}>
                {estilo.emoji} {estilo.label}
              </span>
              {score >= 7 && (
                <span className="text-[10px] text-red-700 font-bold">score {score}/10</span>
              )}
            </div>
          </div>
          {petDesc && (
            <div className="text-[11px] text-emerald-700 mb-2 truncate">🐾 {petDesc}</div>
          )}
          <div className="flex items-center gap-1 flex-wrap">
            <span className={cn(
              'px-2 py-0.5 rounded-md text-[10px] font-semibold text-white bg-gradient-to-r shadow-sm',
              etapaCor
            )}>
              {(ETAPA_LABEL_TRILHA as any)[conversa.etapa] || conversa.etapa || '—'}
            </span>
            {conversa.plano_recomendado && (
              <span className="px-2 py-0.5 rounded-md bg-purple-100 text-purple-700 text-[10px] font-medium">
                📦 {conversa.plano_recomendado}
              </span>
            )}
            {conversa.temperatura_lead && (
              <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 text-[10px] font-medium">
                🌡️ {conversa.temperatura_lead}
              </span>
            )}
            <span className="ml-auto text-[9px] text-slate-400">
              {conversa.ultima_interacao ? fmtTempo(conversa.ultima_interacao) : '—'}
            </span>
          </div>
          {/* Custo IA em destaque */}
          {conversa.custo_ia_usd != null && Number(conversa.custo_ia_usd) > 0 && (
            <div
              className="mt-2 flex items-center justify-between bg-slate-50 border border-slate-200 rounded-md px-2 py-1 text-[10px] text-slate-600"
              title={`${Number(conversa.custo_ia_tokens || 0).toLocaleString('pt-BR')} tokens · ${conversa.custo_ia_chamadas} chamada(s)`}
            >
              <span className="flex items-center gap-1">
                <DollarSign className="w-3 h-3 text-amber-500" />
                <span className="font-medium">Custo IA</span>
              </span>
              <span className="font-mono font-semibold text-slate-800">
                US$ {Number(conversa.custo_ia_usd).toFixed(4)}
              </span>
            </div>
          )}
        </div>

        {/* ───── MINI-TRILHA + PRÓXIMO PASSO ───── */}
        <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1">
            <ArrowLeftRight className="w-3 h-3" /> Trilha + Próximo Passo
          </div>
          <div className="flex items-center gap-1 flex-wrap text-[10px] mb-2">
            {ETAPAS_TRILHA.map((e, i) => {
              const atual = e === conversa.etapa;
              const visitada = !atual && (data.etapasVisitadas || []).includes(e);
              const proxima  = e === proximoPassoInfo.proximo;
              return (
                <React.Fragment key={e}>
                  {i > 0 && <ChevronRight className="w-2.5 h-2.5 text-slate-300 flex-shrink-0" />}
                  <span className={cn(
                    'px-1.5 py-0.5 rounded whitespace-nowrap transition-all',
                    atual      ? 'bg-red-500 text-white font-semibold shadow-sm ring-2 ring-red-200'
                    : visitada ? 'bg-blue-500 text-white font-medium'
                    : proxima  ? 'bg-amber-100 text-amber-800 font-semibold border border-amber-300 animate-pulse'
                               : 'bg-slate-100 text-slate-400'
                  )}>
                    {ETAPA_LABEL_TRILHA[e] || e}
                  </span>
                </React.Fragment>
              );
            })}
          </div>
          {proximoPassoInfo.hint && (
            <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 flex items-start gap-1.5">
              <span className="font-bold">👉</span>
              <span><b className="font-semibold">Próximo:</b> {proximoPassoInfo.hint}</span>
            </div>
          )}
        </div>

        {/* ───── CONVERSA (subiu para o topo das seções) ───── */}
        <Secao titulo="💬 Conversa" icon={MessageCircle}>
          <Linha label="Canal"    valor={conversa.canal} />
          <Linha label="Chip"     valor={conversa.chip} />
          <Linha label="Agente"   valor={conversa.agente_nome || conversa.agente_slug} />
          <Linha label="Msgs"     valor={conversa.total_msgs} />
          <Linha label="IA"       valor={conversa.ia_silenciada ? '🔇 silenciada' : '🔊 ativa'} />
          <Linha label="Criada"   valor={conversa.criado_em ? new Date(conversa.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null} />
          <Linha label="Últ. int." valor={conversa.ultima_interacao ? fmtTempo(conversa.ultima_interacao) : null} />
        </Secao>

        <Secao titulo="👤 Cliente" icon={UserIcon}>
          <Linha label="Nome" valor={nomeCliente !== '—' ? nomeCliente : null} />
          <Linha label="Telefone" valor={telefone ? fmtFone(telefone) : null} />
          <Linha label="E-mail" valor={perfil.email} />
          <Linha label="CPF" valor={perfil.cpf} />
          <Linha label="CEP" valor={perfil.cep} />
          <Linha label="Cidade/UF" valor={cidadeUf} />
          <Linha label="Origem" valor={perfil.origem || conversa.cliente_origem} />
          <Linha label="Indicado por" valor={perfil.indicado_por} />
        </Secao>

        <Secao titulo="🐾 Pet" icon={undefined}>
          <Linha label="Nome"     valor={perfil.nome_pet} />
          <Linha label="Espécie"  valor={perfil.especie} />
          <Linha label="Raça"     valor={perfil.raca} />
          <Linha label="Idade"    valor={perfil.idade_anos ? `${perfil.idade_anos} anos` : null} />
          <Linha label="Sexo"     valor={perfil.sexo} />
          <Linha label="Castrado" valor={perfil.castrado === true ? 'Sim' : perfil.castrado === false ? 'Não' : null} />
          <Linha label="Saúde"    valor={perfil.problema_saude} />
          <Linha label="Vínculo"  valor={perfil.vinculo_emocional} />
          {!perfil.nome_pet && !perfil.especie && !perfil.raca && (
            <div className="text-[11px] text-slate-400 italic">Sem dados do pet ainda</div>
          )}
        </Secao>

        <Secao titulo="💼 Venda" icon={DollarSign}>
          <Linha label="Etapa"    valor={(ETAPA_LABEL_TRILHA as any)[conversa.etapa] || conversa.etapa} />
          <Linha label="Score"    valor={conversa.score != null ? `${conversa.score}/10` : null} />
          <Linha label="Plano rec." valor={conversa.plano_recomendado} />
          <Linha label="Objeção"  valor={conversa.objecao_principal} />
          <Linha label="Cotação #" valor={conversa.numero_cotacao} />
          <Linha label="Lead qty" valor={conversa.lead_quality_class} />
          <Linha label="Temperatura" valor={conversa.temperatura_lead} />
          <Linha label="Neg. step" valor={conversa.negociacao_step} />
          <Linha label="Rede"     valor={conversa.classificacao_rede} />
          <Linha label="Clínicas 40km" valor={conversa.clinicas_40km} />
        </Secao>

        <Secao titulo="🧮 Custo IA" icon={DollarSign}>
          <Linha
            label="Total (USD)"
            valor={conversa.custo_ia_usd != null
              ? `US$ ${Number(conversa.custo_ia_usd).toFixed(4)}`
              : null}
          />
          <Linha
            label="Total (BRL)"
            valor={conversa.custo_ia_usd != null
              ? `R$ ${(Number(conversa.custo_ia_usd) * 5.25).toFixed(4).replace('.', ',')}`
              : null}
          />
          <Linha label="Tokens" valor={conversa.custo_ia_tokens != null ? Number(conversa.custo_ia_tokens).toLocaleString('pt-BR') : null} />
          <Linha label="Chamadas" valor={conversa.custo_ia_chamadas} />
          {conversa.custo_ia_chamadas > 0 && (
            <Linha
              label="Custo/msg"
              valor={`US$ ${(Number(conversa.custo_ia_usd || 0) / conversa.custo_ia_chamadas).toFixed(6)}`}
            />
          )}
        </Secao>

        {conversa.resumo_conversa && (
          <Secao titulo="📝 Resumo">
            <div className="text-[11px] text-slate-700 whitespace-pre-wrap leading-relaxed bg-white border border-slate-200 rounded-lg p-2">
              {conversa.resumo_conversa}
            </div>
          </Secao>
        )}

        {agendamentos.length > 0 && (
          <Secao titulo={`📅 Agendados (${agendamentos.length})`}>
            {agendamentos.map((a: any, i: number) => (
              <div key={i} className="text-[11px] bg-white border border-slate-200 rounded-lg p-2">
                <div className="font-medium text-slate-700">{new Date(a.executar_em).toLocaleString('pt-BR')}</div>
                <div className="text-slate-500 mt-0.5 line-clamp-2">{a.mensagem}</div>
              </div>
            ))}
          </Secao>
        )}

        {obsidianAtivo.length > 0 && (
          <Secao titulo={`📚 Arquivos ativos (${obsidianAtivo.length})`}>
            {obsidianAtivo.map((a: string, i: number) => (
              <code key={i} className="text-[10px] text-slate-600 bg-white border border-slate-200 px-2 py-0.5 rounded block truncate">{a}</code>
            ))}
          </Secao>
        )}
      </div>
    </div>
  );
};

const Secao: React.FC<{ titulo: string; children: React.ReactNode; icon?: any }> = ({ titulo, children }) => (
  <div className="bg-white border border-slate-200 rounded-lg p-2.5">
    <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{titulo}</div>
    <div className="space-y-1">{children}</div>
  </div>
);

const Linha: React.FC<{ label: string; valor: any }> = ({ label, valor }) => {
  if (valor == null || valor === '') return null;
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-slate-500 min-w-[70px]">{label}:</span>
      <span className="text-slate-800 font-medium flex-1 break-words">{valor}</span>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// MODAL Agendar
// ═══════════════════════════════════════════════════════════════
const ModalAgendar: React.FC<{ conversaId: string; onClose: () => void }> = ({ conversaId, onClose }) => {
  const socket = useSocket();
  const [texto, setTexto] = useState('');
  const [quando, setQuando] = useState('');
  const [reescrever, setReescrever] = useState(true);
  const [loading, setLoading] = useState(false);

  const agendar = () => {
    if (!texto.trim() || !quando) return;
    setLoading(true);
    socket.emit('agendar_manual', { conversa_id: conversaId, texto, reescrever, executar_em: new Date(quando).toISOString() });
    const onOk = () => { onClose(); setLoading(false); socket.off('agendar_ok', onOk); };
    socket.on('agendar_ok', onOk);
  };

  const minDt = new Date(Date.now() + 5 * 60000).toISOString().slice(0, 16);

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Calendar className="w-4 h-4 text-indigo-600" /> Agendar mensagem</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Texto</label>
            <Textarea value={texto} onChange={e => setTexto(e.target.value)} placeholder="O que a Mari vai enviar…" className="min-h-[100px]" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Quando</label>
            <Input type="datetime-local" value={quando} onChange={e => setQuando(e.target.value)} min={minDt} />
          </div>
          <label className="text-xs text-slate-600 flex items-center gap-2">
            <input type="checkbox" checked={reescrever} onChange={e => setReescrever(e.target.checked)} />
            Reescrever no tom Mari
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={agendar} disabled={loading || !texto.trim() || !quando}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Calendar className="w-3.5 h-3.5" />}
            Agendar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
