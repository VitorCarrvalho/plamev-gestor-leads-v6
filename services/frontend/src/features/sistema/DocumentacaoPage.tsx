import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Search, BookOpen, ChevronRight, Copy, Check,
  Info, AlertTriangle, AlertCircle, Lightbulb,
  Tag, Users, ArrowLeft, Hash,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  ARTICLES, CATEGORIAS, TIPO_LABELS, AUDIENCIA_LABELS, buscarArtigos,
  Article, Block, AudienceTag, ArticleType,
} from './docs-data';

// ─── Renderizador de bloco ────────────────────────────────────────────────────

const CopyButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button
      onClick={copy}
      className="absolute top-2 right-2 p-1.5 rounded bg-white/10 hover:bg-white/20 text-slate-400 hover:text-slate-100 transition-colors"
      title="Copiar"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
};

const ALERT_STYLES = {
  info:    { bg: 'bg-blue-50 border-blue-200',    icon: Info,          iconCls: 'text-blue-500',   text: 'text-blue-800' },
  warning: { bg: 'bg-amber-50 border-amber-200',  icon: AlertTriangle, iconCls: 'text-amber-500',  text: 'text-amber-800' },
  danger:  { bg: 'bg-red-50 border-red-200',      icon: AlertCircle,   iconCls: 'text-red-500',    text: 'text-red-800' },
  tip:     { bg: 'bg-emerald-50 border-emerald-200', icon: Lightbulb,  iconCls: 'text-emerald-500',text: 'text-emerald-800' },
};

function renderBlock(block: Block, idx: number): React.ReactNode {
  switch (block.type) {
    case 'h2':
      return (
        <h2 key={idx} id={`h-${idx}`} className="text-base font-semibold text-slate-800 mt-7 mb-2 flex items-center gap-2 group">
          <Hash className="w-3.5 h-3.5 text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
          {block.text}
        </h2>
      );
    case 'h3':
      return (
        <h3 key={idx} className="text-sm font-semibold text-slate-700 mt-5 mb-1.5">
          {block.text}
        </h3>
      );
    case 'p':
      return (
        <p key={idx} className="text-sm text-slate-600 leading-relaxed mb-3">
          {block.text}
        </p>
      );
    case 'code':
      return (
        <div key={idx} className="my-4">
          {block.title && (
            <div className="text-[10px] font-mono text-slate-400 bg-slate-800 px-3 py-1 rounded-t border border-slate-700 border-b-0">
              {block.title}
            </div>
          )}
          <div className="relative">
            <pre className={cn(
              'text-[12px] leading-relaxed p-4 overflow-x-auto text-slate-200 bg-slate-900 border border-slate-700',
              block.title ? 'rounded-b' : 'rounded',
            )}>
              <code>{block.text}</code>
            </pre>
            <CopyButton text={block.text} />
          </div>
        </div>
      );
    case 'alert': {
      const s = ALERT_STYLES[block.variant];
      const Icon = s.icon;
      return (
        <div key={idx} className={cn('flex gap-2.5 p-3 rounded-lg border my-4', s.bg)}>
          <Icon className={cn('w-4 h-4 flex-shrink-0 mt-0.5', s.iconCls)} />
          <p className={cn('text-xs leading-relaxed', s.text)}>{block.text}</p>
        </div>
      );
    }
    case 'list':
      return (
        <ul key={idx} className="my-3 space-y-1.5 pl-1">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-2 text-sm text-slate-600 leading-relaxed">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0 mt-2" />
              {item}
            </li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol key={idx} className="my-3 space-y-1.5 pl-1">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-2.5 text-sm text-slate-600 leading-relaxed">
              <span className="text-[11px] font-bold text-indigo-500 flex-shrink-0 w-4 text-right mt-0.5">{i + 1}.</span>
              {item}
            </li>
          ))}
        </ol>
      );
    case 'table':
      return (
        <div key={idx} className="my-4 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {block.headers.map((h, i) => (
                  <th key={i} className="text-left px-3 py-2.5 font-semibold text-slate-600 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri} className={cn('border-b border-slate-100 last:border-0', ri % 2 === 0 ? 'bg-white' : 'bg-slate-50/50')}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-2 text-slate-600 align-top">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'divider':
      return <hr key={idx} className="my-6 border-slate-200" />;
    default:
      return null;
  }
}

// ─── Extrai headings h2 para TOC ─────────────────────────────────────────────
function extractH2s(blocks: Block[]): { idx: number; text: string }[] {
  return blocks
    .map((b, idx) => b.type === 'h2' ? { idx, text: b.text } : null)
    .filter(Boolean) as { idx: number; text: string }[];
}

// ─── Badge de audiência ───────────────────────────────────────────────────────
const AUDIENCE_COLORS: Record<AudienceTag, string> = {
  engenheiro: 'bg-violet-100 text-violet-700',
  analista:   'bg-blue-100 text-blue-700',
  vendedor:   'bg-emerald-100 text-emerald-700',
};
const TIPO_COLORS: Record<ArticleType, string> = {
  explicacao: 'bg-slate-100 text-slate-600',
  tutorial:   'bg-amber-100 text-amber-700',
  howto:      'bg-orange-100 text-orange-700',
  referencia: 'bg-indigo-100 text-indigo-700',
  adr:        'bg-pink-100 text-pink-700',
};

// ─── Componente principal ─────────────────────────────────────────────────────

export const DocumentacaoPage: React.FC = () => {
  const [query, setQuery]             = useState('');
  const [debouncedQ, setDebouncedQ]   = useState('');
  const [audiencia, setAudiencia]     = useState<AudienceTag | 'todos'>('todos');
  const [tipo, setTipo]               = useState<ArticleType | 'todos'>('todos');
  const [selectedId, setSelectedId]   = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);

  // Debounce da busca
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const artigos = useMemo(
    () => buscarArtigos(debouncedQ, audiencia, tipo),
    [debouncedQ, audiencia, tipo],
  );

  const selected = useMemo(
    () => ARTICLES.find(a => a.id === selectedId) ?? null,
    [selectedId],
  );

  const toc = useMemo(
    () => selected ? extractH2s(selected.blocks) : [],
    [selected],
  );

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleBack = useCallback(() => {
    setSelectedId(null);
    contentRef.current?.scrollTo({ top: 0 });
  }, []);

  // Agrupar artigos por categoria
  const grouped = useMemo(() => {
    const map = new Map<string, Article[]>();
    CATEGORIAS.forEach(cat => {
      const list = artigos.filter(a => a.category === cat);
      if (list.length) map.set(cat, list);
    });
    return map;
  }, [artigos]);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-50">
      <PageHeader
        title="Documentação"
        subtitle={`${ARTICLES.length} artigos sobre operação, IA e desenvolvimento`}
      />

      <div className="flex flex-1 overflow-hidden">

        {/* ── Painel lateral de navegação ───────────────────────────── */}
        <aside
          className={cn(
            'flex-shrink-0 flex flex-col border-r border-slate-200 bg-white transition-[width] duration-200 overflow-hidden',
            sidebarOpen ? 'w-[280px]' : 'w-0',
          )}
        >
          {/* Busca + filtros */}
          <div className="p-3 border-b border-slate-100 space-y-2 flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Buscar artigos..."
                className="w-full pl-8 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent placeholder-slate-400"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  ×
                </button>
              )}
            </div>

            {/* Filtro audiência */}
            <div className="flex flex-wrap gap-1">
              {(['todos', 'engenheiro', 'analista', 'vendedor'] as const).map(a => (
                <button
                  key={a}
                  onClick={() => setAudiencia(a)}
                  className={cn(
                    'text-[10px] px-2 py-0.5 rounded-full border transition-colors',
                    audiencia === a
                      ? 'bg-indigo-500 text-white border-indigo-500'
                      : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300',
                  )}
                >
                  {a === 'todos' ? 'Todos' : AUDIENCIA_LABELS[a]}
                </button>
              ))}
            </div>

            {/* Filtro tipo */}
            <div className="flex flex-wrap gap-1">
              {(['todos', 'explicacao', 'tutorial', 'howto', 'referencia', 'adr'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTipo(t)}
                  className={cn(
                    'text-[10px] px-2 py-0.5 rounded-full border transition-colors',
                    tipo === t
                      ? 'bg-slate-700 text-white border-slate-700'
                      : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300',
                  )}
                >
                  {t === 'todos' ? 'Todos os tipos' : TIPO_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          {/* Lista de artigos agrupada por categoria */}
          <div className="flex-1 overflow-y-auto py-2">
            {artigos.length === 0 ? (
              <div className="text-center py-8 text-sm text-slate-400">
                Nenhum artigo encontrado
              </div>
            ) : (
              Array.from(grouped.entries()).map(([cat, items]) => (
                <div key={cat} className="mb-1">
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {cat}
                  </div>
                  {items.map(art => (
                    <button
                      key={art.id}
                      onClick={() => handleSelect(art.id)}
                      className={cn(
                        'w-full text-left px-3 py-2 text-sm flex items-start gap-2 transition-colors group',
                        selectedId === art.id
                          ? 'bg-indigo-50 text-indigo-700 border-r-2 border-indigo-500'
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800',
                      )}
                    >
                      <BookOpen className={cn('w-3.5 h-3.5 mt-0.5 flex-shrink-0', selectedId === art.id ? 'text-indigo-400' : 'text-slate-400')} />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium leading-tight truncate">{art.title}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5 truncate">{art.summary}</div>
                      </div>
                      {selectedId === art.id && <ChevronRight className="w-3 h-3 flex-shrink-0 mt-1 text-indigo-400" />}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>

          {/* Counter */}
          <div className="px-3 py-2 border-t border-slate-100 text-[10px] text-slate-400 flex-shrink-0">
            {artigos.length} de {ARTICLES.length} artigos
          </div>
        </aside>

        {/* ── Área principal ─────────────────────────────────────────── */}
        <main className="flex-1 flex overflow-hidden">

          {/* Conteúdo do artigo */}
          <div ref={contentRef} className="flex-1 overflow-y-auto">
            {/* Toggle sidebar button */}
            <button
              onClick={() => setSidebarOpen(v => !v)}
              className="fixed left-0 bottom-6 z-10 bg-white border border-slate-200 rounded-r-lg px-2 py-3 shadow-sm text-slate-400 hover:text-slate-600 hover:border-slate-300 transition-all"
              title={sidebarOpen ? 'Ocultar índice' : 'Mostrar índice'}
            >
              <ChevronRight className={cn('w-3.5 h-3.5 transition-transform', sidebarOpen && 'rotate-180')} />
            </button>

            {!selected ? (
              // ── Home da documentação ──────────────────────────────
              <div className="max-w-3xl mx-auto px-6 py-8">
                <div className="mb-8">
                  <h1 className="text-xl font-semibold text-slate-800 mb-2">Documentação Plamev Gestor</h1>
                  <p className="text-sm text-slate-500">Selecione um artigo ao lado ou use a busca para encontrar o que precisa.</p>
                </div>

                {/* Cards de atalho por audiência */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                  {(['engenheiro', 'analista', 'vendedor'] as AudienceTag[]).map(aud => {
                    const count = ARTICLES.filter(a => a.audience.includes(aud)).length;
                    return (
                      <button
                        key={aud}
                        onClick={() => setAudiencia(aud)}
                        className="text-left p-4 bg-white rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-sm transition-all group"
                      >
                        <div className={cn('inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full mb-2', AUDIENCE_COLORS[aud])}>
                          <Users className="w-3 h-3" />
                          {AUDIENCIA_LABELS[aud]}
                        </div>
                        <div className="text-sm font-medium text-slate-700 group-hover:text-indigo-700 mt-1">
                          {count} artigos
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {aud === 'engenheiro' && 'Arquitetura, APIs, guardrails, deploy'}
                          {aud === 'analista' && 'Métricas, funil, reativação, KPIs'}
                          {aud === 'vendedor' && 'Chat, handoff, descontos, operação'}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Artigos por categoria */}
                {Array.from(grouped.entries()).map(([cat, items]) => (
                  <div key={cat} className="mb-6">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">{cat}</h2>
                    <div className="grid gap-2">
                      {items.map(art => (
                        <button
                          key={art.id}
                          onClick={() => handleSelect(art.id)}
                          className="text-left p-3 bg-white rounded-lg border border-slate-200 hover:border-indigo-300 hover:shadow-sm transition-all group flex items-start gap-3"
                        >
                          <BookOpen className="w-4 h-4 text-slate-400 group-hover:text-indigo-400 flex-shrink-0 mt-0.5 transition-colors" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-slate-700 group-hover:text-indigo-700 truncate transition-colors">
                              {art.title}
                            </div>
                            <div className="text-xs text-slate-400 mt-0.5 line-clamp-1">{art.summary}</div>
                          </div>
                          <div className="flex gap-1 flex-shrink-0">
                            <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-medium', TIPO_COLORS[art.type])}>
                              {TIPO_LABELS[art.type]}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              // ── Artigo selecionado ────────────────────────────────
              <div className="max-w-3xl mx-auto px-6 py-6">
                {/* Breadcrumb + voltar */}
                <div className="flex items-center gap-2 mb-5">
                  <button
                    onClick={handleBack}
                    className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-indigo-600 transition-colors"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Documentação
                  </button>
                  <ChevronRight className="w-3 h-3 text-slate-300" />
                  <span className="text-xs text-slate-400">{selected.category}</span>
                  <ChevronRight className="w-3 h-3 text-slate-300" />
                  <span className="text-xs text-slate-600 font-medium truncate">{selected.title}</span>
                </div>

                {/* Header do artigo */}
                <div className="mb-6">
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', TIPO_COLORS[selected.type])}>
                      {TIPO_LABELS[selected.type]}
                    </span>
                    {selected.audience.map(a => (
                      <span key={a} className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1', AUDIENCE_COLORS[a])}>
                        <Users className="w-2.5 h-2.5" />
                        {AUDIENCIA_LABELS[a]}
                      </span>
                    ))}
                  </div>
                  <h1 className="text-lg font-bold text-slate-800 mb-2">{selected.title}</h1>
                  <p className="text-sm text-slate-500 leading-relaxed">{selected.summary}</p>
                  {selected.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-3">
                      {selected.tags.map(tag => (
                        <span key={tag} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-500">
                          <Tag className="w-2.5 h-2.5" />
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <hr className="border-slate-200 mb-6" />

                {/* Conteúdo */}
                <div>
                  {selected.blocks.map((block, idx) => renderBlock(block, idx))}
                </div>

                {/* Navegação prev/next */}
                <div className="mt-10 pt-6 border-t border-slate-200 flex justify-between items-center">
                  <button
                    onClick={handleBack}
                    className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-700 transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Voltar ao índice
                  </button>
                  <div className="text-xs text-slate-300">
                    {ARTICLES.findIndex(a => a.id === selected.id) + 1} / {ARTICLES.length}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── TOC (Table of Contents) ──────────────────────────── */}
          {selected && toc.length > 1 && (
            <div className="hidden xl:flex flex-col w-[200px] flex-shrink-0 border-l border-slate-200 bg-white overflow-y-auto py-6 px-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-3">
                Neste artigo
              </div>
              <nav className="space-y-1">
                {toc.map(({ idx, text }) => (
                  <button
                    key={idx}
                    onClick={() => {
                      const el = document.getElementById(`h-${idx}`);
                      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    className="w-full text-left text-xs text-slate-500 hover:text-indigo-600 py-1 leading-tight transition-colors"
                  >
                    {text}
                  </button>
                ))}
              </nav>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
