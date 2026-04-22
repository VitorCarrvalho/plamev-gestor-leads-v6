/**
 * PipelineKanbanPage — Pilar Atender
 * Visão Kanban dos leads organizada por etapa do funil.
 *
 * Features:
 *   · Drag-and-drop nativo (HTML5 DnD) entre colunas → atualiza etapa via PATCH
 *   · Click no card → modal de ações com trilha vertical, mover, perdido, ir pra conversa
 *   · Trilha vertical: ✓ visitada · ● atual · ○ pendente (carregada via socket)
 *   · Colunas selecionáveis (dropdown multi-check)
 *   · Filtro por período de último contato: 1d / 3d / 7d / personalizado
 *   · Filtros rápidos: Todos · Quentes · IA Silenciada · IA Ativa
 *   · Toggle silenciar/ativar Mari direto no card
 *   · Indicador visual âmbar em cards com IA silenciada
 *   · Atualização em tempo real via Socket.IO
 */

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  AlertTriangle, ArrowRight, Calendar, Check, ChevronDown,
  ChevronRight, Circle, CircleOff, DollarSign, Flame,
  LayoutGrid, Loader2, MapPin, MessageSquare, Phone,
  Search, Volume2, VolumeX, X, CheckCircle2, GripVertical,
} from 'lucide-react';
import { api } from '@/services/api';
import { useSocket } from '@/hooks/useSocket';
import { PageHeader } from '@/components/layout/PageHeader';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { cn } from '@/lib/utils';

// ── helpers ────────────────────────────────────────────────────
function fmtFone(p: string | null | undefined): string {
  if (!p) return '—';
  const d = p.replace(/\D/g, '');
  if (d.length === 13) return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return p;
}

function fmtTempo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const delta = Date.now() - new Date(iso).getTime();
  const m = Math.floor(delta / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ── etapas canônicas ───────────────────────────────────────────
const ETAPAS = [
  { id: 'acolhimento',         label: 'Acolhimento',   hint: 'Primeiro contato com o lead',              cor: 'text-slate-600',   header: 'bg-slate-100',   body: 'bg-slate-50',     border: 'border-slate-200',   accent: 'bg-slate-400'   },
  { id: 'qualificacao',        label: 'Qualificação',  hint: 'Coletar raça, idade e perfil do pet',      cor: 'text-sky-700',     header: 'bg-sky-100',     body: 'bg-sky-50/60',    border: 'border-sky-200',     accent: 'bg-sky-500'     },
  { id: 'apresentacao_planos', label: 'Apresentação',  hint: 'Apresentar plano recomendado',             cor: 'text-blue-700',    header: 'bg-blue-100',    body: 'bg-blue-50/60',   border: 'border-blue-200',    accent: 'bg-blue-500'    },
  { id: 'validacao_cep',       label: 'CEP',           hint: 'Validar cobertura na região',              cor: 'text-violet-700',  header: 'bg-violet-100',  body: 'bg-violet-50/60', border: 'border-violet-200',  accent: 'bg-violet-500'  },
  { id: 'negociacao',          label: 'Negociação',    hint: 'Negociar preço, carências e plano',        cor: 'text-rose-700',    header: 'bg-rose-100',    body: 'bg-rose-50/60',   border: 'border-rose-200',    accent: 'bg-rose-500'    },
  { id: 'objecao',             label: 'Objeção',       hint: 'Tratar objeção principal do lead',         cor: 'text-pink-700',    header: 'bg-pink-100',    body: 'bg-pink-50/60',   border: 'border-pink-200',    accent: 'bg-pink-500'    },
  { id: 'pre_fechamento',      label: 'Pré-Fech.',     hint: 'Coletar nome, CPF e e-mail',               cor: 'text-orange-700',  header: 'bg-orange-100',  body: 'bg-orange-50/60', border: 'border-orange-200',  accent: 'bg-orange-500'  },
  { id: 'fechamento',          label: 'Fechamento',    hint: 'Enviar link de pagamento',                 cor: 'text-amber-700',   header: 'bg-amber-100',   body: 'bg-amber-50/60',  border: 'border-amber-200',   accent: 'bg-amber-500'   },
  { id: 'venda_fechada',       label: '✓ Venda',       hint: 'Interesse confirmado, aguarda ERP',        cor: 'text-indigo-700',  header: 'bg-indigo-100',  body: 'bg-indigo-50/60', border: 'border-indigo-200',  accent: 'bg-indigo-500'  },
  { id: 'pago',                label: '💰 Pago',       hint: 'Adesão confirmada — venda concluída!',     cor: 'text-emerald-700', header: 'bg-emerald-100', body: 'bg-emerald-50/60',border: 'border-emerald-200', accent: 'bg-emerald-500' },
] as const;

type EtapaId = typeof ETAPAS[number]['id'];
type Periodo  = 1 | 3 | 7 | 'custom';

// ── avatar por temperatura ─────────────────────────────────────
const TEMP_GRAD: Record<string, string> = {
  quente:  'from-red-500 to-orange-500',
  morno:   'from-amber-400 to-amber-600',
  frio:    'from-sky-400 to-sky-600',
  perdido: 'from-slate-400 to-slate-600',
  vendido: 'from-purple-500 to-purple-700',
};
function avatarGrad(c: any): string {
  if (c.etapa === 'pago')          return 'from-emerald-500 to-emerald-700';
  if (c.etapa === 'venda_fechada') return 'from-purple-500 to-purple-700';
  return TEMP_GRAD[c.temperatura_lead || 'morno'] ?? TEMP_GRAD.morno;
}

// ── navegar para Conversa Ativa ────────────────────────────────
function abrirConversa(conversaId: string) {
  localStorage.setItem('dashv5_conversa_ativa', conversaId);
  window.dispatchEvent(new CustomEvent('dashv5-navegar', {
    detail: { pilar: 'atender', subPage: 'conversa', conversaId },
  }));
}

// Chave usada no dataTransfer durante o drag
const DND_KEY = 'kanban/conversaId';

// ═══════════════════════════════════════════════════════════════
// TOAST de feedback de drag (aparece no topo da página)
// ═══════════════════════════════════════════════════════════════
const DragToast: React.FC<{ msg: { ok: boolean; text: string } | null }> = ({ msg }) => {
  if (!msg) return null;
  return (
    <div className={cn(
      'fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2',
      'px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium',
      'animate-in fade-in slide-in-from-top-2 duration-200',
      msg.ok
        ? 'bg-emerald-600 text-white'
        : 'bg-red-600 text-white',
    )}>
      {msg.ok
        ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
        : <AlertTriangle className="w-4 h-4 flex-shrink-0" />
      }
      {msg.text}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// MODAL DE AÇÕES (click no card)
// ═══════════════════════════════════════════════════════════════
const CardModal: React.FC<{
  conversa:  any;
  onClose:   () => void;
  onRefresh: () => void;
}> = ({ conversa: c, onClose, onRefresh }) => {
  const socket = useSocket();
  const [detalhe,        setDetalhe]        = useState<any>(null);
  const [carregando,     setCarregando]     = useState(true);
  const [movendo,        setMovendo]        = useState<string | null>(null);
  const [confirmPerdido, setConfirmPerdido] = useState(false);
  const [marcandoPerdido,setMarcandoPerdido]= useState(false);
  const [feedback,       setFeedback]       = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    socket.emit('get_conversa', c.conversa_id);
    const onData = (d: any) => {
      if (d.conversa?.id === c.conversa_id) { setDetalhe(d); setCarregando(false); }
    };
    socket.on('conversa_data', onData);
    return () => { socket.off('conversa_data', onData); };
  }, [c.conversa_id, socket]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const exibir = (ok: boolean, text: string) => {
    setFeedback({ ok, text });
    setTimeout(() => setFeedback(null), 2500);
  };

  const moverEtapa = async (etapaId: string) => {
    if (etapaId === c.etapa) return;
    setMovendo(etapaId);
    try {
      await api.patch(`/api/conversa/${c.conversa_id}/etapa`, { etapa: etapaId });
      exibir(true, `✓ Movido para ${ETAPAS.find(e => e.id === etapaId)?.label ?? etapaId}`);
      onRefresh();
      setTimeout(() => socket.emit('get_conversa', c.conversa_id), 300);
    } catch (err: any) {
      exibir(false, err?.message ?? 'Erro ao mover etapa');
    } finally { setMovendo(null); }
  };

  const marcarPerdido = async () => {
    setMarcandoPerdido(true);
    try {
      await api.patch(`/api/conversa/${c.conversa_id}/etapa`, { etapa: 'encerrado' });
      exibir(true, '✓ Lead marcado como perdido');
      onRefresh();
      setTimeout(onClose, 1200);
    } catch (err: any) {
      exibir(false, err?.message ?? 'Erro');
      setMarcandoPerdido(false);
      setConfirmPerdido(false);
    }
  };

  const etapasVisitadas: string[] = detalhe?.etapasVisitadas ?? [];
  const etapaAtual = detalhe?.conversa?.etapa ?? c.etapa ?? 'acolhimento';
  const visitadasSet = new Set(etapasVisitadas);
  const silenciada = !!c.ia_silenciada;
  const score = c.score ?? 0;
  const petDesc = [c.nome_pet, c.raca, c.idade_anos ? `${c.idade_anos}a` : null].filter(Boolean).join(' · ');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(2px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden"
           style={{ maxHeight: '90vh' }}>

        {/* Header */}
        <div className={cn(
          'flex items-center gap-3 px-5 py-4 border-b border-slate-100',
          silenciada ? 'bg-amber-50' : 'bg-slate-50',
        )}>
          <div className={cn(
            'w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 bg-gradient-to-br',
            avatarGrad(c),
          )}>
            {(c.nome_cliente ?? c.nome_pet ?? '?')[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-slate-900 text-sm flex items-center gap-2 truncate">
              {c.nome_cliente ?? fmtFone(c.phone)}
              {score >= 7 && <Flame className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
              {silenciada && <CircleOff className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />}
            </div>
            <div className="text-[11px] text-slate-500 flex items-center gap-2">
              <Phone className="w-3 h-3" /> {fmtFone(c.phone)}
              {petDesc && <><span>·</span><span className="text-emerald-600">🐾 {petDesc}</span></>}
            </div>
          </div>
          <button onClick={onClose}
            className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-1.5 rounded-lg transition-colors flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Feedback inline */}
        {feedback && (
          <div className={cn(
            'px-5 py-2 text-xs flex items-center gap-2 font-medium',
            feedback.ok
              ? 'bg-emerald-50 text-emerald-700 border-b border-emerald-100'
              : 'bg-red-50 text-red-700 border-b border-red-100',
          )}>
            {feedback.ok
              ? <CheckCircle2 className="w-3.5 h-3.5" />
              : <AlertTriangle className="w-3.5 h-3.5" />
            }
            {feedback.text}
          </div>
        )}

        {/* Conteúdo rolável */}
        <div className="flex-1 min-h-0 overflow-y-auto">

          {/* ── TRILHA VERTICAL ── */}
          <div className="px-5 pt-4 pb-3">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1">
              <MapPin className="w-3 h-3" /> Trilha do Lead
              <span className="ml-auto text-[10px] normal-case font-normal text-slate-400">
                Clique numa etapa para mover
              </span>
            </div>

            {carregando ? (
              <div className="flex items-center gap-2 text-slate-400 text-xs py-4">
                <Loader2 className="w-4 h-4 animate-spin" /> Carregando trilha…
              </div>
            ) : (
              <div className="relative">
                {/* Linha vertical conectora */}
                <div className="absolute left-[13px] top-3 bottom-3 w-0.5 bg-slate-100 z-0" />

                <div className="space-y-1 relative z-10">
                  {ETAPAS.map(etapa => {
                    const atual    = etapa.id === etapaAtual;
                    const visitada = !atual && visitadasSet.has(etapa.id);
                    const pendente = !atual && !visitada;

                    return (
                      <button
                        key={etapa.id}
                        onClick={() => !atual && moverEtapa(etapa.id)}
                        disabled={!!movendo}
                        title={atual ? 'Etapa atual' : `Mover para ${etapa.label}`}
                        className={cn(
                          'w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-left transition-all',
                          atual
                            ? 'bg-indigo-50 border border-indigo-200 cursor-default'
                            : visitada
                              ? 'hover:bg-emerald-50 cursor-pointer'
                              : 'hover:bg-slate-50 cursor-pointer opacity-60 hover:opacity-100',
                          movendo === etapa.id && 'opacity-50',
                        )}
                      >
                        {/* Nó da trilha */}
                        <div className="flex-shrink-0 w-7 h-7 flex items-center justify-center">
                          {movendo === etapa.id ? (
                            <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                          ) : atual ? (
                            <div className="w-6 h-6 rounded-full border-2 border-indigo-500 bg-indigo-500 flex items-center justify-center shadow-sm ring-2 ring-indigo-200">
                              <span className="w-2 h-2 rounded-full bg-white" />
                            </div>
                          ) : visitada ? (
                            <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center shadow-sm">
                              <Check className="w-3.5 h-3.5 text-white" />
                            </div>
                          ) : (
                            <div className="w-6 h-6 rounded-full border-2 border-slate-200 bg-white flex items-center justify-center">
                              <Circle className="w-3 h-3 text-slate-300" />
                            </div>
                          )}
                        </div>

                        {/* Label + hint */}
                        <div className="flex-1 min-w-0">
                          <div className={cn(
                            'text-sm font-medium leading-tight',
                            atual    ? 'text-indigo-700'  :
                            visitada ? 'text-emerald-700' :
                                       'text-slate-400',
                          )}>
                            {etapa.label}
                            {atual && (
                              <span className="ml-2 text-[10px] font-semibold bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full">
                                atual
                              </span>
                            )}
                          </div>
                          <div className={cn(
                            'text-[10px] mt-0.5 leading-tight',
                            atual    ? 'text-indigo-400'  :
                            visitada ? 'text-emerald-500' :
                                       'text-slate-300',
                          )}>
                            {etapa.hint}
                          </div>
                        </div>

                        {!atual && (
                          <ArrowRight className={cn(
                            'w-3.5 h-3.5 flex-shrink-0 transition-opacity',
                            visitada ? 'text-emerald-400 opacity-70' : 'text-slate-300 opacity-50',
                          )} />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ── AÇÕES ── */}
          <div className="px-5 pb-5 space-y-2">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
              <ChevronRight className="w-3 h-3" /> Ações rápidas
            </div>

            <Button className="w-full justify-start gap-2"
              onClick={() => { onClose(); abrirConversa(c.conversa_id); }}>
              <MessageSquare className="w-4 h-4" /> Abrir Conversa Ativa
            </Button>

            {c.etapa !== 'pago' && (
              <Button variant="outline"
                className="w-full justify-start gap-2 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                onClick={() => moverEtapa('pago')} disabled={!!movendo}>
                <DollarSign className="w-4 h-4" />
                {movendo === 'pago'
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Marcando…</>
                  : 'Marcar como 💰 Pago'
                }
              </Button>
            )}

            {!confirmPerdido ? (
              <Button variant="outline"
                className="w-full justify-start gap-2 text-slate-600 hover:text-red-600 hover:border-red-300 hover:bg-red-50"
                onClick={() => setConfirmPerdido(true)}>
                <AlertTriangle className="w-4 h-4" /> Marcar como Perdido
              </Button>
            ) : (
              <div className="border border-red-200 bg-red-50 rounded-xl p-3 space-y-2">
                <p className="text-xs text-red-700 font-medium flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Confirmar? O lead sairá do Pipeline.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                    onClick={marcarPerdido} disabled={marcandoPerdido}>
                    {marcandoPerdido
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Marcando…</>
                      : 'Sim, perdido'
                    }
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1"
                    onClick={() => setConfirmPerdido(false)} disabled={marcandoPerdido}>
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// KANBAN CARD — draggable + clicável
// ═══════════════════════════════════════════════════════════════
const KanbanCard: React.FC<{
  conversa:    any;
  isDragging:  boolean;   // este card está sendo arrastado?
  onDragStart: (e: React.DragEvent, conversaId: string) => void;
  onDragEnd:   () => void;
  onSilenciar: (id: string) => void;
  onAbrir:     (c: any) => void;
}> = ({ conversa: c, isDragging, onDragStart, onDragEnd, onSilenciar, onAbrir }) => {
  const silenciada = !!c.ia_silenciada;
  const score      = c.score ?? 0;
  const petDesc    = [c.nome_pet, c.raca, c.idade_anos ? `${c.idade_anos}a` : null].filter(Boolean).join(' · ');
  const ts         = c.ultima_interacao ?? c.ultima_msg_ts;

  // Distinguir clique de drag: registramos se o mouse se moveu
  const didDrag = useRef(false);

  return (
    <div
      draggable
      onDragStart={e => { didDrag.current = true; onDragStart(e, c.conversa_id); }}
      onDragEnd={() => { onDragEnd(); setTimeout(() => { didDrag.current = false; }, 50); }}
      onClick={() => { if (!didDrag.current) onAbrir(c); }}
      className={cn(
        'relative rounded-xl border bg-white shadow-sm transition-all group select-none cursor-grab active:cursor-grabbing',
        isDragging
          ? 'opacity-40 scale-[0.97] shadow-none border-dashed border-indigo-300'
          : 'hover:shadow-md hover:border-indigo-300',
        silenciada
          ? 'border-amber-300 bg-amber-50/40 ring-1 ring-amber-200'
          : 'border-slate-200',
      )}
    >
      {/* Banner âmbar quando IA silenciada */}
      {silenciada && (
        <div className="flex items-center gap-1 px-3 py-1 bg-amber-100 border-b border-amber-200 rounded-t-xl text-[10px] text-amber-700 font-semibold">
          <CircleOff className="w-3 h-3" /> IA silenciada
        </div>
      )}

      <div className="p-3">
        {/* Handle de drag — canto superior direito */}
        <div className={cn(
          'absolute top-2 right-2 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity',
          isDragging && 'opacity-100 text-indigo-400',
        )}>
          <GripVertical className="w-3.5 h-3.5" />
        </div>

        {/* Linha 1: avatar · nome · tempo */}
        <div className="flex items-center gap-2 mb-1.5 pr-4">
          <div className={cn(
            'w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-xs flex-shrink-0 shadow-sm bg-gradient-to-br',
            avatarGrad(c),
          )}>
            {(c.nome_cliente ?? c.nome_pet ?? '?')[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-900 truncate flex items-center gap-1">
              {c.nome_cliente ?? fmtFone(c.phone)}
              {score >= 7 && <Flame className="w-3 h-3 text-red-500 flex-shrink-0" />}
            </div>
            <div className="text-[10px] text-slate-500 flex items-center gap-1">
              <Phone className="w-2.5 h-2.5 flex-shrink-0" /> {fmtFone(c.phone)}
            </div>
          </div>
          <span className="text-[10px] text-slate-400 flex-shrink-0 pr-4">{fmtTempo(ts)}</span>
        </div>

        {/* Pet */}
        {petDesc && (
          <div className="text-[11px] text-emerald-700 mb-1.5 truncate">🐾 {petDesc}</div>
        )}

        {/* Badges */}
        <div className="flex items-center gap-1 flex-wrap">
          {score >= 7 && (
            <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold">🔥 {score}</span>
          )}
          {c.plano_recomendado && (
            <span className="px-1.5 py-0.5 rounded-md bg-purple-100 text-purple-700 text-[10px] font-medium truncate max-w-[90px]">
              📦 {c.plano_recomendado}
            </span>
          )}
          {c.temperatura_lead && (
            <span className="px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-600 text-[10px]">
              🌡️ {c.temperatura_lead}
            </span>
          )}
        </div>

        {/* Última mensagem */}
        {c.ultima_msg_conteudo && (
          <div className="mt-1.5 text-[11px] text-slate-500 italic line-clamp-1 border-t border-slate-100 pt-1.5">
            "{c.ultima_msg_conteudo.slice(0, 55)}"
          </div>
        )}

        {/* Dica de interação */}
        {!isDragging && (
          <div className="mt-1 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-indigo-400 flex items-center gap-1">
            <GripVertical className="w-3 h-3" /> arraste · <ChevronRight className="w-3 h-3" /> clique para opções
          </div>
        )}
      </div>

      {/* Botão silenciar/ativar */}
      <button
        onClick={e => { e.stopPropagation(); onSilenciar(c.conversa_id); }}
        title={silenciada ? 'Ativar Mari' : 'Silenciar Mari'}
        className={cn(
          'absolute bottom-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium transition-all',
          silenciada
            ? 'text-amber-700 bg-amber-200 hover:bg-amber-300'
            : 'opacity-0 group-hover:opacity-100 text-slate-500 bg-slate-100 hover:bg-slate-200',
        )}
      >
        {silenciada
          ? <><Volume2 className="w-3 h-3" /> Ativar</>
          : <><VolumeX className="w-3 h-3" /> Silenciar</>
        }
      </button>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// COLUNA KANBAN — drop zone
// ═══════════════════════════════════════════════════════════════
const KanbanColuna: React.FC<{
  etapa:       typeof ETAPAS[number];
  cards:       any[];
  draggingId:  string | null;
  isDropTarget: boolean;
  onDragOver:  (e: React.DragEvent) => void;
  onDragEnter: (etapaId: EtapaId) => void;
  onDrop:      (e: React.DragEvent, etapaId: EtapaId) => void;
  onDragStart: (e: React.DragEvent, conversaId: string) => void;
  onDragEnd:   () => void;
  onSilenciar: (id: string) => void;
  onAbrir:     (c: any) => void;
}> = ({ etapa, cards, draggingId, isDropTarget, onDragOver, onDragEnter, onDrop, onDragStart, onDragEnd, onSilenciar, onAbrir }) => {
  const silenciadas = cards.filter(c => c.ia_silenciada).length;

  return (
    <div
      className={cn(
        'flex flex-col flex-shrink-0 w-[272px] rounded-xl border transition-all duration-150',
        isDropTarget
          ? 'border-2 border-indigo-400 shadow-lg shadow-indigo-100 scale-[1.01]'
          : etapa.border,
      )}
      onDragOver={onDragOver}
      onDragEnter={() => onDragEnter(etapa.id as EtapaId)}
      onDrop={e => onDrop(e, etapa.id as EtapaId)}
    >
      {/* Cabeçalho */}
      <div className={cn(
        'px-3 py-2.5 rounded-t-xl flex items-center gap-2 border-b transition-colors',
        isDropTarget ? 'bg-indigo-50 border-indigo-300' : `${etapa.header} ${etapa.border}`,
      )}>
        <span className={cn('w-2 h-2 rounded-full flex-shrink-0', etapa.accent)} />
        <span className={cn('font-semibold text-sm', isDropTarget ? 'text-indigo-700' : etapa.cor)}>
          {etapa.label}
        </span>
        {isDropTarget && (
          <span className="text-[10px] text-indigo-500 font-medium animate-pulse">solte aqui</span>
        )}
        <span className={cn(
          'ml-auto text-xs font-bold px-2 py-0.5 rounded-full shadow-sm',
          isDropTarget ? 'bg-indigo-100 text-indigo-700' : `bg-white/80 ${etapa.cor}`,
        )}>
          {cards.length}
        </span>
        {silenciadas > 0 && (
          <span className="text-[10px] text-amber-700 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 font-medium">
            <CircleOff className="w-2.5 h-2.5" /> {silenciadas}
          </span>
        )}
      </div>

      {/* Área de drop */}
      <div
        className={cn(
          'flex-1 overflow-y-auto p-2 space-y-2 min-h-[80px] transition-colors duration-150 rounded-b-xl',
          isDropTarget
            ? 'bg-indigo-50/80 ring-2 ring-inset ring-indigo-200'
            : etapa.body,
        )}
        style={{ maxHeight: 'calc(100vh - 218px)' }}
      >
        {/* Placeholder visível durante drag */}
        {isDropTarget && draggingId && (
          <div className="border-2 border-dashed border-indigo-300 rounded-xl h-20 flex items-center justify-center text-indigo-400 text-xs font-medium bg-indigo-50">
            ↓ Solte para mover
          </div>
        )}

        {cards.length === 0 && !isDropTarget ? (
          <div className="text-center text-slate-400 text-xs py-8 select-none">— vazio —</div>
        ) : (
          [...cards]
            .sort((a, b) => {
              const ta = new Date(a.ultima_interacao ?? a.ultima_msg_ts ?? 0).getTime();
              const tb = new Date(b.ultima_interacao ?? b.ultima_msg_ts ?? 0).getTime();
              return tb - ta;
            })
            .map(c => (
              <KanbanCard
                key={c.conversa_id}
                conversa={c}
                isDragging={draggingId === c.conversa_id}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onSilenciar={onSilenciar}
                onAbrir={onAbrir}
              />
            ))
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// DROPDOWN DE ETAPAS
// ═══════════════════════════════════════════════════════════════
const EtapasDropdown: React.FC<{
  selecionadas: EtapaId[];
  onChange:     (ids: EtapaId[]) => void;
}> = ({ selecionadas, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const todas = selecionadas.length === ETAPAS.length;

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const toggle = (id: EtapaId) =>
    onChange(selecionadas.includes(id)
      ? selecionadas.filter(s => s !== id)
      : [...selecionadas, id]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors',
          open ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
        )}
      >
        <LayoutGrid className="w-3.5 h-3.5" />
        Colunas
        {!todas && (
          <span className="bg-indigo-500 text-white px-1.5 py-0.5 rounded-full text-[10px] leading-none">
            {selecionadas.length}
          </span>
        )}
        <ChevronDown className={cn('w-3 h-3 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-xl p-3 min-w-[210px]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Etapas visíveis</span>
            <button
              onClick={() => onChange(todas ? [] : ETAPAS.map(e => e.id as EtapaId))}
              className="text-[10px] text-indigo-600 hover:underline font-medium"
            >
              {todas ? 'Desmarcar todas' : 'Marcar todas'}
            </button>
          </div>
          <div className="space-y-0.5">
            {ETAPAS.map(e => {
              const checked = selecionadas.includes(e.id as EtapaId);
              return (
                <button key={e.id} onClick={() => toggle(e.id as EtapaId)}
                  className="w-full flex items-center gap-2 py-1.5 px-1 rounded hover:bg-slate-50 text-left">
                  <div className={cn(
                    'w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors',
                    checked ? 'border-indigo-500 bg-indigo-500' : 'border-slate-300',
                  )}>
                    {checked && <Check className="w-2.5 h-2.5 text-white" />}
                  </div>
                  <span className={cn('text-xs font-medium', e.cor)}>{e.label}</span>
                </button>
              );
            })}
          </div>
          <button onClick={() => setOpen(false)}
            className="mt-2 w-full text-xs text-center text-slate-500 hover:text-slate-700 border-t border-slate-100 pt-2">
            Fechar
          </button>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// PAGE PRINCIPAL
// ═══════════════════════════════════════════════════════════════
export const PipelineKanbanPage: React.FC = () => {
  const socket = useSocket();

  const [conversas,     setConversas]     = useState<any[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [busca,         setBusca]         = useState('');
  const [filtroIA,      setFiltroIA]      = useState<'todas' | 'silenciadas' | 'ativas'>('todas');
  const [filtroQuente,  setFiltroQuente]  = useState(false);
  const [periodo,       setPeriodo]       = useState<Periodo | null>(null);
  const [dataCustom,    setDataCustom]    = useState('');
  const [etapasVis,     setEtapasVis]     = useState<EtapaId[]>(ETAPAS.map(e => e.id as EtapaId));
  const [modalConversa, setModalConversa] = useState<any | null>(null);

  // ── drag state ─────────────────────────────────────────────
  const [draggingId,  setDraggingId]  = useState<string | null>(null);
  const [overEtapa,   setOverEtapa]   = useState<EtapaId | null>(null);
  const [dragToast,   setDragToast]   = useState<{ ok: boolean; text: string } | null>(null);

  // ── carrega dados ──────────────────────────────────────────
  const carregarConversas = useCallback(
    () => api.get<any[]>('/api/conversas').then(setConversas),
    [],
  );

  useEffect(() => {
    carregarConversas().then(() => setLoading(false));
  }, [carregarConversas]);

  useEffect(() => {
    socket.on('nova_msg',            carregarConversas);
    socket.on('conversa_atualizada', carregarConversas);
    socket.on('ia_status',           carregarConversas);
    return () => {
      socket.off('nova_msg',            carregarConversas);
      socket.off('conversa_atualizada', carregarConversas);
      socket.off('ia_status',           carregarConversas);
    };
  }, [socket, carregarConversas]);

  const silenciarIA = (conversaId: string) => socket.emit('silenciar_ia', conversaId);

  // ── drag handlers ──────────────────────────────────────────
  const handleDragStart = useCallback((e: React.DragEvent, conversaId: string) => {
    e.dataTransfer.setData(DND_KEY, conversaId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingId(conversaId);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
    setOverEtapa(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDragEnter = useCallback((etapaId: EtapaId) => {
    setOverEtapa(etapaId);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, etapaId: EtapaId) => {
    e.preventDefault();
    const conversaId = e.dataTransfer.getData(DND_KEY);
    setDraggingId(null);
    setOverEtapa(null);

    if (!conversaId) return;

    // Verifica se a etapa mudou
    const conversa = conversas.find(c => c.conversa_id === conversaId);
    if (!conversa || conversa.etapa === etapaId) return;

    // Atualização otimista: move o card na UI imediatamente
    setConversas(prev =>
      prev.map(c => c.conversa_id === conversaId ? { ...c, etapa: etapaId } : c),
    );

    const etapaLabel = ETAPAS.find(e => e.id === etapaId)?.label ?? etapaId;
    const nome = conversa.nome_cliente ?? fmtFone(conversa.phone) ?? 'Lead';

    try {
      await api.patch(`/api/conversa/${conversaId}/etapa`, { etapa: etapaId });
      setDragToast({ ok: true, text: `✓ ${nome} → ${etapaLabel}` });
    } catch (err: any) {
      // Reverte em caso de erro
      setConversas(prev =>
        prev.map(c => c.conversa_id === conversaId ? { ...c, etapa: conversa.etapa } : c),
      );
      setDragToast({ ok: false, text: err?.message ?? 'Erro ao mover lead' });
    } finally {
      setTimeout(() => setDragToast(null), 2500);
      // Recarrega para garantir consistência
      setTimeout(carregarConversas, 500);
    }
  }, [conversas, carregarConversas]);

  // ── filtragem ──────────────────────────────────────────────
  const filtradas = useMemo(() => {
    return conversas.filter(c => {
      if (busca.trim()) {
        const q = busca.toLowerCase();
        if (
          !(c.nome_cliente ?? '').toLowerCase().includes(q) &&
          !(c.nome_pet    ?? '').toLowerCase().includes(q) &&
          !(c.phone       ?? '').includes(q)
        ) return false;
      }
      if (filtroIA === 'silenciadas' && !c.ia_silenciada) return false;
      if (filtroIA === 'ativas'      &&  c.ia_silenciada) return false;
      if (filtroQuente && (c.score ?? 0) < 7)             return false;
      if (periodo !== null) {
        const ts = c.ultima_interacao ?? c.ultima_msg_ts;
        if (!ts) return false;
        const ago = new Date(ts).getTime();
        if (periodo === 'custom') {
          if (dataCustom && ago < new Date(dataCustom).getTime()) return false;
        } else {
          if (Date.now() - ago > periodo * 86_400_000) return false;
        }
      }
      return true;
    });
  }, [conversas, busca, filtroIA, filtroQuente, periodo, dataCustom]);

  const porEtapa = useMemo(() => {
    const map = Object.fromEntries(ETAPAS.map(e => [e.id, [] as any[]]));
    filtradas.forEach(c => {
      const id = c.etapa ?? 'acolhimento';
      if (map[id] !== undefined) map[id].push(c);
    });
    return map as Record<EtapaId, any[]>;
  }, [filtradas]);

  const totalSilenciadas = useMemo(
    () => conversas.filter(c => c.ia_silenciada).length,
    [conversas],
  );

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Toast de drag-and-drop */}
      <DragToast msg={dragToast} />

      <PageHeader title="Pipeline Kanban" subtitle="Arraste os cards entre colunas ou clique para mais opções">
        <Badge variant="default" className="text-[11px]">{conversas.length} leads</Badge>
        {totalSilenciadas > 0 && (
          <button
            onClick={() => setFiltroIA(f => f === 'silenciadas' ? 'todas' : 'silenciadas')}
            className={cn(
              'flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border font-medium transition-colors',
              filtroIA === 'silenciadas'
                ? 'bg-amber-500 text-white border-amber-500'
                : 'border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100',
            )}
          >
            <CircleOff className="w-3 h-3" /> {totalSilenciadas} silenciadas
          </button>
        )}
      </PageHeader>

      {/* ── FILTROS ─────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 px-4 py-2.5 flex-shrink-0 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <button onClick={() => { setFiltroIA('todas'); setFiltroQuente(false); }}
              className={cn('px-3 py-1 rounded-full text-xs font-medium transition-colors',
                filtroIA === 'todas' && !filtroQuente ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
              Todos
            </button>
            <button onClick={() => setFiltroQuente(q => !q)}
              className={cn('px-3 py-1 rounded-full text-xs font-medium transition-colors',
                filtroQuente ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
              🔥 Quentes
            </button>
            <button onClick={() => setFiltroIA(f => f === 'silenciadas' ? 'todas' : 'silenciadas')}
              className={cn('flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors',
                filtroIA === 'silenciadas' ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
              <CircleOff className="w-3 h-3" /> IA Silenciada
            </button>
            <button onClick={() => setFiltroIA(f => f === 'ativas' ? 'todas' : 'ativas')}
              className={cn('flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors',
                filtroIA === 'ativas' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
              <Volume2 className="w-3 h-3" /> IA Ativa
            </button>
          </div>
          <div className="flex-1 relative min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <Input placeholder="Nome, pet ou telefone…" value={busca}
              onChange={e => setBusca(e.target.value)} className="pl-9 h-8 text-sm" />
          </div>
          <span className="text-xs text-slate-400 whitespace-nowrap ml-auto">
            {filtradas.length} de {conversas.length}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Calendar className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
            <span className="text-xs text-slate-500 font-medium whitespace-nowrap">Último contato:</span>
            {([1, 3, 7] as const).map(d => (
              <button key={d} onClick={() => setPeriodo(periodo === d ? null : d)}
                className={cn('px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                  periodo === d ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
                {d}d
              </button>
            ))}
            <button onClick={() => setPeriodo(periodo === 'custom' ? null : 'custom')}
              className={cn('px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                periodo === 'custom' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
              Personalizado
            </button>
            {periodo === 'custom' && (
              <input type="date" value={dataCustom}
                onChange={e => setDataCustom(e.target.value)}
                max={new Date().toISOString().slice(0, 10)}
                className="h-7 text-xs border border-slate-200 rounded-lg px-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            )}
            {periodo !== null && (
              <button onClick={() => { setPeriodo(null); setDataCustom(''); }}
                className="text-slate-400 hover:text-slate-600 p-0.5 rounded" title="Limpar filtro">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="ml-auto">
            <EtapasDropdown selecionadas={etapasVis} onChange={setEtapasVis} />
          </div>
        </div>
      </div>

      {/* ── KANBAN BOARD ──────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden bg-slate-100 p-4">
        {loading ? (
          <div className="flex items-center justify-center h-full"><LoadingSpinner /></div>
        ) : etapasVis.length === 0 ? (
          <div className="flex items-center justify-center h-full text-slate-400 text-sm flex-col gap-2">
            <LayoutGrid className="w-8 h-8 text-slate-300" />
            <span>Nenhuma coluna selecionada.</span>
            <span className="text-xs">Use o botão <strong>Colunas</strong> para escolher as etapas.</span>
          </div>
        ) : (
          <div className="flex gap-3 h-full" style={{ minWidth: `${etapasVis.length * 284}px` }}>
            {ETAPAS
              .filter(e => etapasVis.includes(e.id as EtapaId))
              .map(etapa => (
                <KanbanColuna
                  key={etapa.id}
                  etapa={etapa}
                  cards={porEtapa[etapa.id as EtapaId] ?? []}
                  draggingId={draggingId}
                  isDropTarget={overEtapa === etapa.id && draggingId !== null}
                  onDragOver={handleDragOver}
                  onDragEnter={handleDragEnter}
                  onDrop={handleDrop}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onSilenciar={silenciarIA}
                  onAbrir={setModalConversa}
                />
              ))
            }
          </div>
        )}
      </div>

      {/* ── MODAL ─────────────────────────────────────────── */}
      {modalConversa && (
        <CardModal
          conversa={modalConversa}
          onClose={() => setModalConversa(null)}
          onRefresh={carregarConversas}
        />
      )}
    </div>
  );
};
