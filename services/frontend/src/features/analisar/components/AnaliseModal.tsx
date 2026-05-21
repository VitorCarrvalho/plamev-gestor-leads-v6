import React, { useState } from 'react';
import {
  CheckCircle2, XCircle, FileText, BookOpen, Copy, Check,
  TrendingUp, AlertTriangle, AlertCircle, Info,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

// ── Tipos ───────────────────────────────────────────────────────
interface Acerto {
  descricao: string;
  arquivo_referencia: string;
  trecho_conversa?: string;
  impacto: 'alto' | 'medio' | 'baixo';
}

interface Erro {
  descricao: string;
  gravidade: 'critica' | 'importante' | 'leve';
  regra_violada: string;
  arquivo_referencia: string;
  trecho_conversa?: string;
  como_deveria_ser: string;
}

interface DocumentoAtualizar {
  arquivo: string;
  tipo_acao: 'adicionar_regra' | 'adicionar_exemplo' | 'corrigir_regra' | 'adicionar_guarda';
  descricao: string;
  trecho_sugerido: string;
  secao_alvo?: string;
}

interface OndeSalvar {
  arquivo: string;
  secao: string;
  instrucao: string;
  trecho_exemplo: string;
}

export interface AnaliseConversa {
  resumo_executivo: string;
  score_geral: number;
  acertos: Acerto[];
  erros: Erro[];
  documentos_atualizar: DocumentoAtualizar[];
  onde_salvar_comportamento?: OndeSalvar;
  modelo_usado: string;
  tokens_usados: { input: number; output: number };
}

interface AnaliseModalProps {
  open: boolean;
  onClose: () => void;
  titulo: string;
  tipoResultado: string;
  analise: AnaliseConversa;
}

// ── Score visual ─────────────────────────────────────────────────
function ScoreRing({ score }: { score: number }) {
  const color = score >= 80 ? 'text-emerald-500' : score >= 60 ? 'text-amber-500' : 'text-red-500';
  const ring = score >= 80 ? 'stroke-emerald-500' : score >= 60 ? 'stroke-amber-500' : 'stroke-red-500';
  const r = 28;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-20 h-20">
        <svg className="w-20 h-20 -rotate-90" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r={r} fill="none" strokeWidth="5" className="stroke-border" />
          <circle cx="32" cy="32" r={r} fill="none" strokeWidth="5"
            strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round"
            className={ring} />
        </svg>
        <div className={cn('absolute inset-0 flex items-center justify-center text-xl font-bold', color)}>
          {score}
        </div>
      </div>
      <span className="text-xs text-text-muted">score</span>
    </div>
  );
}

// ── Botão copiar ─────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy}
      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-border text-text-muted hover:bg-surface-2 transition-colors">
      {copied ? <><Check className="w-3 h-3 text-emerald-500" /> Copiado</> : <><Copy className="w-3 h-3" /> Copiar</>}
    </button>
  );
}

// ── Gravidade / Impacto badges ───────────────────────────────────
function GravidadeBadge({ g }: { g: string }) {
  const map = {
    critica: { variant: 'red' as const, label: 'Crítico', icon: XCircle },
    importante: { variant: 'amber' as const, label: 'Importante', icon: AlertTriangle },
    leve: { variant: 'blue' as const, label: 'Leve', icon: Info },
  };
  const cfg = map[g as keyof typeof map] || map.leve;
  const Icon = cfg.icon;
  return (
    <Badge variant={cfg.variant} className="text-[10px] gap-0.5">
      <Icon className="w-2.5 h-2.5" /> {cfg.label}
    </Badge>
  );
}

function ImpactoBadge({ i }: { i: string }) {
  const map = {
    alto: { variant: 'green' as const, label: 'Alto impacto' },
    medio: { variant: 'blue' as const, label: 'Médio impacto' },
    baixo: { variant: 'secondary' as const, label: 'Baixo impacto' },
  };
  const cfg = map[i as keyof typeof map] || map.baixo;
  return <Badge variant={cfg.variant} className="text-[10px]">{cfg.label}</Badge>;
}

function TipoAcaoBadge({ t }: { t: string }) {
  const map = {
    adicionar_regra: { variant: 'red' as const, label: '+ Regra' },
    adicionar_guarda: { variant: 'amber' as const, label: '+ Guarda' },
    adicionar_exemplo: { variant: 'green' as const, label: '+ Exemplo' },
    corrigir_regra: { variant: 'purple' as const, label: '✏ Corrigir' },
  };
  const cfg = map[t as keyof typeof map] || { variant: 'secondary' as const, label: t };
  return <Badge variant={cfg.variant} className="text-[10px]">{cfg.label}</Badge>;
}

// ── Modal principal ──────────────────────────────────────────────
export const AnaliseModal: React.FC<AnaliseModalProps> = ({
  open, onClose, titulo, tipoResultado, analise,
}) => {
  const totalAbas = analise.onde_salvar_comportamento ? 5 : 4;
  const tipoLabel = {
    sucesso: { label: '🏆 Fechou venda', variant: 'green' as const },
    falha: { label: '❌ Não converteu', variant: 'red' as const },
    analise: { label: '📋 Análise neutra', variant: 'secondary' as const },
  }[tipoResultado] || { label: '📋 Análise', variant: 'secondary' as const };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col gap-0 p-0">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border flex-shrink-0">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-base leading-tight truncate">{titulo}</DialogTitle>
              <div className="flex items-center gap-2 mt-1.5">
                <Badge variant={tipoLabel.variant} className="text-[10px]">{tipoLabel.label}</Badge>
                <span className="text-xs text-text-faint">{analise.modelo_usado} · {analise.tokens_usados.input + analise.tokens_usados.output} tokens</span>
              </div>
            </div>
            <ScoreRing score={analise.score_geral} />
          </div>
        </DialogHeader>

        {/* Tabs */}
        <Tabs defaultValue="resumo" className="flex-1 min-h-0 flex flex-col">
          <TabsList className="mx-6 mt-4 flex-shrink-0 self-start">
            <TabsTrigger value="resumo">Resumo</TabsTrigger>
            <TabsTrigger value="acertos">
              Acertos <span className="ml-1 text-emerald-600 font-bold">{analise.acertos.length}</span>
            </TabsTrigger>
            <TabsTrigger value="erros">
              Erros <span className={cn('ml-1 font-bold', analise.erros.length > 0 ? 'text-red-600' : 'text-text-faint')}>{analise.erros.length}</span>
            </TabsTrigger>
            <TabsTrigger value="documentos">
              Docs <span className="ml-1 text-amber-600 font-bold">{analise.documentos_atualizar.length}</span>
            </TabsTrigger>
            {analise.onde_salvar_comportamento && (
              <TabsTrigger value="salvar">Salvar</TabsTrigger>
            )}
          </TabsList>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
            {/* ── Resumo ── */}
            <TabsContent value="resumo" className="mt-4 space-y-4">
              <div className="bg-surface-2 rounded-xl p-4 text-sm text-text leading-relaxed">
                {analise.resumo_executivo}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-4 text-center border border-emerald-200 dark:border-emerald-800">
                  <div className="text-2xl font-bold text-emerald-600">{analise.acertos.length}</div>
                  <div className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">Acertos</div>
                </div>
                <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-4 text-center border border-red-200 dark:border-red-800">
                  <div className="text-2xl font-bold text-red-600">{analise.erros.length}</div>
                  <div className="text-xs text-red-700 dark:text-red-400 mt-0.5">Erros</div>
                </div>
                <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 text-center border border-amber-200 dark:border-amber-800">
                  <div className="text-2xl font-bold text-amber-600">{analise.documentos_atualizar.length}</div>
                  <div className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">Docs p/ atualizar</div>
                </div>
              </div>
            </TabsContent>

            {/* ── Acertos ── */}
            <TabsContent value="acertos" className="mt-4 space-y-3">
              {analise.acertos.length === 0 && (
                <div className="text-sm text-text-muted text-center py-8">Nenhum acerto registrado.</div>
              )}
              {analise.acertos.map((a, i) => (
                <div key={i} className="bg-surface rounded-xl border border-border p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                      <span className="text-sm text-text font-medium">{a.descricao}</span>
                    </div>
                    <ImpactoBadge i={a.impacto} />
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-text-faint">
                    <BookOpen className="w-3 h-3" />
                    <span>{a.arquivo_referencia}</span>
                  </div>
                  {a.trecho_conversa && (
                    <blockquote className="border-l-2 border-emerald-400 pl-3 text-xs text-text-muted italic bg-surface-2 rounded-r py-1.5 pr-2">
                      {a.trecho_conversa}
                    </blockquote>
                  )}
                </div>
              ))}
            </TabsContent>

            {/* ── Erros ── */}
            <TabsContent value="erros" className="mt-4 space-y-3">
              {analise.erros.length === 0 && (
                <div className="text-sm text-text-muted text-center py-8">Nenhum erro registrado.</div>
              )}
              {analise.erros.map((e, i) => (
                <div key={i} className="bg-surface rounded-xl border border-border p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <XCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                      <span className="text-sm text-text font-medium">{e.descricao}</span>
                    </div>
                    <GravidadeBadge g={e.gravidade} />
                  </div>
                  <div className="text-xs text-text-muted">
                    <span className="font-medium">Regra violada:</span> {e.regra_violada}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-text-faint">
                    <BookOpen className="w-3 h-3" />
                    <span>{e.arquivo_referencia}</span>
                  </div>
                  {e.trecho_conversa && (
                    <blockquote className="border-l-2 border-red-400 pl-3 text-xs text-text-muted italic bg-surface-2 rounded-r py-1.5 pr-2">
                      {e.trecho_conversa}
                    </blockquote>
                  )}
                  <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 text-xs text-emerald-800 dark:text-emerald-300">
                    <span className="font-medium">Como deveria ser: </span>{e.como_deveria_ser}
                  </div>
                </div>
              ))}
            </TabsContent>

            {/* ── Documentos ── */}
            <TabsContent value="documentos" className="mt-4 space-y-3">
              {analise.documentos_atualizar.length === 0 && (
                <div className="text-sm text-text-muted text-center py-8">Nenhum documento precisa ser atualizado.</div>
              )}
              {analise.documentos_atualizar.map((d, i) => (
                <div key={i} className="bg-surface rounded-xl border border-border p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-amber-500 flex-shrink-0" />
                      <span className="text-sm font-medium text-text font-mono">{d.arquivo}</span>
                    </div>
                    <TipoAcaoBadge t={d.tipo_acao} />
                  </div>
                  {d.secao_alvo && (
                    <div className="text-xs text-text-faint">Seção: <span className="font-medium text-text-muted">{d.secao_alvo}</span></div>
                  )}
                  <p className="text-sm text-text-muted">{d.descricao}</p>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-text-faint">Trecho a adicionar:</span>
                      <CopyButton text={d.trecho_sugerido} />
                    </div>
                    <pre className="bg-surface-2 rounded-lg p-3 text-xs font-mono text-text whitespace-pre-wrap border border-border overflow-x-auto">
                      {d.trecho_sugerido}
                    </pre>
                  </div>
                </div>
              ))}
            </TabsContent>

            {/* ── Salvar comportamento ── */}
            {analise.onde_salvar_comportamento && (
              <TabsContent value="salvar" className="mt-4 space-y-4">
                <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 text-sm text-emerald-800 dark:text-emerald-300">
                  <div className="font-medium mb-1">Esta conversa é um exemplo de sucesso 🏆</div>
                  <div className="text-xs">{analise.onde_salvar_comportamento.instrucao}</div>
                </div>
                <div className="bg-surface rounded-xl border border-border p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-emerald-500" />
                    <span className="text-sm font-medium text-text font-mono">{analise.onde_salvar_comportamento.arquivo}</span>
                  </div>
                  <div className="text-xs text-text-faint">Seção: <span className="font-medium text-text-muted">{analise.onde_salvar_comportamento.secao}</span></div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-text-faint">Exemplo a salvar:</span>
                      <CopyButton text={analise.onde_salvar_comportamento.trecho_exemplo} />
                    </div>
                    <pre className="bg-surface-2 rounded-lg p-3 text-xs font-mono text-text whitespace-pre-wrap border border-border overflow-x-auto">
                      {analise.onde_salvar_comportamento.trecho_exemplo}
                    </pre>
                  </div>
                </div>
              </TabsContent>
            )}
          </div>
        </Tabs>

        <DialogFooter className="px-6 pb-6 pt-2 border-t border-border flex-shrink-0">
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
