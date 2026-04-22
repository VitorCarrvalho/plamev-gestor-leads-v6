import React from 'react';
import {
  LayoutDashboard, Radio, Users, MessageSquare, UserCircle, Eye,
  BarChart3, Bookmark, Filter, Award,
  Calendar, Database, ShieldCheck, FileCode2, Settings,
  Bell, LogOut, LucideIcon, Sparkles, Columns3, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type Pilar = 'monitorar' | 'atender' | 'analisar' | 'sistema';

export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_TREE: { id: Pilar; label: string; items: NavItem[] }[] = [
  {
    id: 'monitorar',
    label: 'Monitorar',
    items: [
      { id: 'live',  label: 'Live Feed',     icon: Radio },
      { id: 'fila',  label: 'Fila de Leads', icon: Users },
      { id: 'stats', label: 'Estatísticas',  icon: BarChart3 },
    ],
  },
  {
    id: 'atender',
    label: 'Atender',
    items: [
      { id: 'conversa',   label: 'Conversa Ativa',  icon: MessageSquare },
      { id: 'perfil',     label: 'Perfil do Lead',  icon: UserCircle },
      { id: 'kanban',     label: 'Pipeline',        icon: Columns3 },
      { id: 'simulador',  label: 'Chat Simulator',  icon: Sparkles },
    ],
  },
  {
    id: 'analisar',
    label: 'Analisar',
    items: [
      { id: 'salvas',  label: 'Conversas Salvas', icon: Bookmark },
      { id: 'funil',   label: 'Funil',            icon: Filter },
      { id: 'agentes', label: 'Performance',      icon: Award },
    ],
  },
  {
    id: 'sistema',
    label: 'Sistema',
    items: [
      { id: 'agenda',    label: 'Agenda',     icon: Calendar },
      { id: 'sql',       label: 'SQL Browser', icon: Database },
      { id: 'auditoria', label: 'Auditoria',  icon: ShieldCheck },
      { id: 'templates', label: 'Templates',  icon: FileCode2 },
      { id: 'config',    label: 'Config',     icon: Settings },
    ],
  },
];

interface SidebarProps {
  pilar: Pilar;
  subPage: string;
  onNavigate: (pilar: Pilar, subPage: string) => void;
  onLogout: () => void;
  userEmail?: string;
  badgeCounts?: Partial<Record<string, number>>;  // { live: 3, agenda: 12, ... }
  open?: boolean;
  onClose?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ pilar, subPage, onNavigate, onLogout, userEmail, badgeCounts = {}, open, onClose }) => {
  const handleNav = (p: Pilar, s: string) => {
    onNavigate(p, s);
    onClose?.();
  };
  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={onClose} aria-label="Fechar menu" />
      )}
      <aside
        className={cn(
          'w-[232px] h-screen flex flex-col fixed left-0 top-0 z-40 border-r border-slate-800 sidebar-scroll transition-transform duration-200',
          open ? 'translate-x-0' : '-translate-x-full',
          'md:translate-x-0'
        )}
        style={{ backgroundColor: 'rgb(15 23 42)' }}
      >
    <div className="h-16 flex items-center gap-3 px-5 border-b border-slate-800">
      <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center flex-shrink-0">
        <LayoutDashboard className="w-5 h-5 text-indigo-400" />
      </div>
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-sm font-semibold text-slate-100 leading-tight">Dashboard</span>
        <span className="text-[10px] text-slate-500 uppercase tracking-wider">V5 · Plamev</span>
      </div>
      <button onClick={onClose} className="md:hidden text-slate-400 hover:text-slate-100 p-1" aria-label="Fechar">
        <X className="w-5 h-5" />
      </button>
    </div>

    <nav className="flex-1 overflow-y-auto sidebar-scroll py-3">
      {NAV_TREE.map(group => (
        <div key={group.id} className="mb-3">
          <div className="px-5 mb-1">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{group.label}</span>
          </div>
          <div className="flex flex-col">
            {group.items.map(item => {
              const active = pilar === group.id && subPage === item.id;
              const Icon = item.icon;
              const badge = badgeCounts[item.id];
              return (
                <button
                  key={item.id}
                  onClick={() => handleNav(group.id, item.id)}
                  className={cn(
                    'flex items-center gap-3 mx-2 px-3 py-2 text-sm rounded-lg transition-all duration-150 text-left',
                    active
                      ? 'bg-indigo-500/15 text-indigo-300 border-l-2 border-indigo-500 font-medium pl-[10px]'
                      : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'
                  )}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate flex-1">{item.label}</span>
                  {badge != null && badge > 0 && (
                    <span className={cn(
                      'text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none',
                      active ? 'bg-indigo-400/30 text-indigo-200' : 'bg-slate-700 text-slate-200'
                    )}>
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>

    <div className="border-t border-slate-800 p-3">
      <div className="flex items-center gap-3 px-2 py-2 rounded-lg mb-2">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
          {(userEmail || 'A')[0].toUpperCase()}
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-medium text-slate-200 truncate">Supervisor</span>
          <span className="text-[10px] text-slate-500 truncate">{userEmail}</span>
        </div>
      </div>
      <button
        onClick={onLogout}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-lg text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-colors"
      >
        <LogOut className="w-4 h-4" />
        <span>Sair</span>
      </button>
    </div>
      </aside>
    </>
  );
};
