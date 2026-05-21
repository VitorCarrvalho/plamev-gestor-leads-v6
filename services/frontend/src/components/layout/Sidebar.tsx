import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard, Users, Users2, MessageSquare,
  Bookmark, Filter, Award,
  Database, ShieldCheck, FileCode2, Bot, KeyRound, Package,
  LogOut, LucideIcon, Sparkles, Columns3, X,
  ChevronLeft, ChevronRight, ChevronDown, Settings2,
  Eye, TrendingUp, Wrench, BookOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/ui/theme-toggle';

export type Pilar = 'monitorar' | 'atender' | 'analisar' | 'sistema' | 'configuracoes';

export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  id: Pilar;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

export const NAV_TREE: NavGroup[] = [
  {
    id: 'monitorar',
    label: 'Monitorar',
    icon: Eye,
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'pipeline',  label: 'Pipeline',  icon: Columns3 },
    ],
  },
  {
    id: 'atender',
    label: 'Atender',
    icon: MessageSquare,
    items: [
      { id: 'chat',     label: 'Chat',     icon: MessageSquare },
      { id: 'contatos', label: 'Contatos', icon: Users },
    ],
  },
  {
    id: 'analisar',
    label: 'Analisar',
    icon: TrendingUp,
    items: [
      { id: 'salvas',      label: 'Conversas Salvas', icon: Bookmark },
      { id: 'funil',       label: 'Funil',            icon: Filter },
      { id: 'performance', label: 'Performance',      icon: Award },
      { id: 'simulador',   label: 'Chat Simulator',   icon: Sparkles },
    ],
  },
  {
    id: 'sistema',
    label: 'Sistema',
    icon: Wrench,
    items: [
      { id: 'sql',        label: 'SQL Browser',    icon: Database },
      { id: 'auditoria',  label: 'Auditoria',      icon: ShieldCheck },
      { id: 'templates',  label: 'Templates',      icon: FileCode2 },
      { id: 'planos',     label: 'Planos',         icon: Package },
    ],
  },
  {
    id: 'configuracoes',
    label: 'Configurações',
    icon: Settings2,
    items: [
      { id: 'agentes',       label: 'Agentes',       icon: Bot },
      { id: 'provedores',    label: 'Provedores',    icon: KeyRound },
      { id: 'usuarios',      label: 'Usuários',      icon: Users2 },
      { id: 'documentacao',  label: 'Documentação',  icon: BookOpen },
    ],
  },
];

interface SidebarProps {
  pilar: Pilar;
  subPage: string;
  onNavigate: (pilar: Pilar, subPage: string) => void;
  onLogout: () => void;
  onPerfilClick: () => void;
  onCollapsedChange?: (collapsed: boolean) => void;
  userEmail?: string;
  userName?: string;
  userFoto?: string | null;
  badgeCounts?: Partial<Record<string, number>>;
  open?: boolean;
  onClose?: () => void;
}

function loadCollapsed(): boolean {
  try { return localStorage.getItem('sidebar_collapsed') === 'true'; } catch { return false; }
}
function loadOpenGroups(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem('sidebar_open_groups');
    if (raw) return JSON.parse(raw);
  } catch {}
  return NAV_TREE.reduce((acc, g) => ({ ...acc, [g.id]: true }), {} as Record<string, boolean>);
}

export const Sidebar: React.FC<SidebarProps> = ({
  pilar, subPage, onNavigate, onLogout, onPerfilClick, onCollapsedChange,
  userEmail, userName, userFoto, badgeCounts = {}, open, onClose,
}) => {
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(loadOpenGroups);

  // Auto-expand active group
  useEffect(() => {
    setOpenGroups(prev => {
      const next = { ...prev, [pilar]: true };
      try { localStorage.setItem('sidebar_open_groups', JSON.stringify(next)); } catch {}
      return next;
    });
  }, [pilar]);

  const toggleCollapsed = () => {
    setCollapsed(c => {
      const next = !c;
      try { localStorage.setItem('sidebar_collapsed', String(next)); } catch {}
      onCollapsedChange?.(next);
      return next;
    });
  };

  const toggleGroup = (id: string) => {
    setOpenGroups(prev => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem('sidebar_open_groups', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const handleNav = (p: Pilar, s: string) => {
    onNavigate(p, s);
    onClose?.();
  };

  const initials = (userName || userEmail || 'A')[0].toUpperCase();

  return (
    <>
      {/* Overlay mobile */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={onClose}
          aria-label="Fechar menu"
        />
      )}

      <aside
        className={cn(
          'h-screen flex flex-col fixed left-0 top-0 z-40 border-r border-white/[0.06]',
          'transition-[width] duration-300 ease-in-out',
          collapsed ? 'w-[60px]' : 'w-[240px]',
          open ? 'translate-x-0' : '-translate-x-full',
          'md:translate-x-0',
        )}
        style={{ background: 'linear-gradient(180deg, rgb(11 17 32) 0%, rgb(15 23 42) 100%)' }}
      >
        {/* ── Header ──────────────────────────────────────────────── */}
        <div className={cn(
          'h-16 flex items-center border-b border-white/[0.06] flex-shrink-0',
          collapsed ? 'justify-center px-0' : 'gap-3 px-4',
        )}>
          {!collapsed && (
            <>
              <img src="/plamev-logo.png" alt="Plamev" className="h-8 object-contain flex-1 min-w-0" />
              <button
                onClick={onClose}
                className="md:hidden text-slate-500 hover:text-slate-100 p-1 ml-2"
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          )}
          {collapsed && (
            <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center">
              <img src="/p-logo.png" alt="P" className="w-full h-full object-contain" />
            </div>
          )}
        </div>

        {/* ── Nav ─────────────────────────────────────────────────── */}
        <nav className="flex-1 overflow-y-auto py-3 space-y-0.5 overflow-x-hidden">
          {NAV_TREE.map(group => {
            const isGroupActive = pilar === group.id;
            const isOpen = openGroups[group.id] ?? true;
            const GroupIcon = group.icon;

            if (collapsed) {
              // Icon-only mode: show each item as standalone icon
              return (
                <div key={group.id} className="mb-1">
                  {/* Separador sutil entre grupos */}
                  <div className="mx-3 mb-1 border-t border-white/[0.04]" />
                  {group.items.map(item => {
                    const active = isGroupActive && subPage === item.id;
                    const Icon = item.icon;
                    const badge = badgeCounts[item.id];
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleNav(group.id, item.id)}
                        title={`${group.label} · ${item.label}`}
                        className={cn(
                          'relative w-full flex items-center justify-center h-10 rounded-lg mx-auto my-0.5 transition-all duration-150',
                          'w-[44px]',
                          active
                            ? 'bg-indigo-500/20 text-indigo-400'
                            : 'text-slate-500 hover:bg-white/[0.06] hover:text-slate-300',
                        )}
                      >
                        <Icon className="w-4 h-4" />
                        {active && (
                          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-indigo-500 rounded-r-full" />
                        )}
                        {badge != null && badge > 0 && (
                          <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-indigo-400" />
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            }

            // ── Expanded mode ───────────────────────────────────────
            return (
              <div key={group.id} className="px-2">
                {/* Group header */}
                <button
                  onClick={() => toggleGroup(group.id)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all duration-150 group',
                    isGroupActive
                      ? 'text-slate-200'
                      : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]',
                  )}
                >
                  <GroupIcon className={cn('w-3.5 h-3.5 flex-shrink-0', isGroupActive && 'text-indigo-400')} />
                  <span className="text-[11px] font-semibold uppercase tracking-widest flex-1 leading-none">
                    {group.label}
                  </span>
                  <ChevronDown
                    className={cn(
                      'w-3.5 h-3.5 flex-shrink-0 transition-transform duration-200',
                      isOpen ? 'rotate-0' : '-rotate-90',
                    )}
                  />
                </button>

                {/* Group items with animated height */}
                <div
                  className={cn(
                    'overflow-hidden transition-all duration-250 ease-in-out',
                    isOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0',
                  )}
                >
                  <div className="ml-3 pl-2.5 border-l border-white/[0.06] mt-0.5 mb-2 space-y-0.5">
                    {group.items.map(item => {
                      const active = isGroupActive && subPage === item.id;
                      const Icon = item.icon;
                      const badge = badgeCounts[item.id];
                      return (
                        <button
                          key={item.id}
                          onClick={() => handleNav(group.id, item.id)}
                          className={cn(
                            'w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-all duration-150 text-left',
                            active
                              ? 'bg-indigo-500/15 text-indigo-300 font-medium'
                              : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200',
                          )}
                        >
                          {active && (
                            <span className="w-1 h-1 rounded-full bg-indigo-400 flex-shrink-0" />
                          )}
                          <Icon className={cn('w-3.5 h-3.5 flex-shrink-0', !active && 'opacity-70')} />
                          <span className="truncate flex-1">{item.label}</span>
                          {badge != null && badge > 0 && (
                            <span className={cn(
                              'text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none flex-shrink-0',
                              active ? 'bg-indigo-400/30 text-indigo-200' : 'bg-white/10 text-slate-300',
                            )}>
                              {badge > 99 ? '99+' : badge}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </nav>

        {/* ── Collapse toggle ──────────────────────────────────────── */}
        <div className="px-2 pb-1 flex-shrink-0">
          <button
            onClick={toggleCollapsed}
            title={collapsed ? 'Expandir menu' : 'Recolher menu'}
            className={cn(
              'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-slate-500',
              'hover:bg-white/[0.05] hover:text-slate-300 transition-all duration-150',
              collapsed && 'justify-center',
            )}
          >
            {collapsed
              ? <ChevronRight className="w-4 h-4" />
              : (
                <>
                  <ChevronLeft className="w-4 h-4" />
                  <span className="text-xs">Recolher</span>
                </>
              )
            }
          </button>
        </div>

        {/* ── Footer: tema + perfil + logout ──────────────────────── */}
        <div className={cn('border-t border-white/[0.06] p-2 flex-shrink-0', collapsed && 'flex flex-col items-center gap-1')}>
          <ThemeToggle collapsed={collapsed} />
          {/* Perfil */}
          <button
            onClick={onPerfilClick}
            title={collapsed ? `${userName || 'Supervisor'} · ${userEmail}` : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-lg hover:bg-white/[0.06] transition-all duration-150 group',
              collapsed ? 'p-2 justify-center' : 'w-full px-3 py-2 mb-1',
            )}
          >
            <div className="w-7 h-7 rounded-full overflow-hidden bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0 ring-1 ring-white/10">
              {userFoto
                ? <img src={userFoto} alt={userName} className="w-full h-full object-cover" />
                : initials
              }
            </div>
            {!collapsed && (
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-xs font-medium text-slate-300 truncate group-hover:text-slate-100 leading-tight">{userName || 'Supervisor'}</span>
                <span className="text-[10px] text-slate-600 truncate">{userEmail}</span>
              </div>
            )}
          </button>

          {/* Logout */}
          <button
            onClick={onLogout}
            title={collapsed ? 'Sair' : undefined}
            className={cn(
              'flex items-center gap-2 rounded-lg text-slate-600 hover:bg-red-500/10 hover:text-red-400 transition-all duration-150',
              collapsed ? 'p-2 justify-center' : 'w-full px-3 py-2',
            )}
          >
            <LogOut className="w-3.5 h-3.5 flex-shrink-0" />
            {!collapsed && <span className="text-xs">Sair</span>}
          </button>
        </div>
      </aside>
    </>
  );
};
