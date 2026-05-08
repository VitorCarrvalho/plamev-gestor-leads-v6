import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Eye, EyeOff, Loader2, Menu } from 'lucide-react';
import { isLoggedIn, login, logout, getUser } from './services/api';
import { cn } from './lib/utils';
import { Sidebar, Pilar } from './components/layout/Sidebar';
import { PageHeader } from './components/layout/PageHeader';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';

// Monitorar
import { DashboardPage }      from './features/monitorar/DashboardPage';
import { PipelineKanbanPage } from './features/atender/PipelineKanbanPage';

// Atender
import { ConversaPage }       from './features/atender/ConversaPage';
import { ContactsPage }       from './features/atender/ContactsPage';
import { ConfiguracaoPage }   from './features/sistema/ConfiguracaoPage';
import { PerfilPage }         from './features/atender/PerfilPage';

// Analisar
import { SalvasPage }  from './features/analisar/SalvasPage';
import { FunilPage }   from './features/analisar/FunilPage';
import { AgentesPage } from './features/analisar/AgentesPage';

// Sistema
import { ChatSimulatorPage } from './features/atender/ChatSimulatorPage';
import { SqlBrowserPage }    from './features/sistema/SqlBrowserPage';
import { AuditoriaPage }     from './features/sistema/AuditoriaPage';
import { TemplatesPage }     from './features/sistema/TemplatesPage';
import { PlanosPage }        from './features/sistema/PlanosPage';

// Configurações
import { ProvedoresPage } from './features/sistema/ProvedoresPage';

// Legado (manter temporariamente)
import { AgendaPage } from './features/sistema/AgendaPage';
import { ConfigPage } from './features/sistema/ConfigPage';

import { useNotifications } from './hooks/useNotifications';
import { UserProfileModal } from './components/UserProfileModal';

// ── LOGIN ─────────────────────────────────────────────────────
const Login: React.FC<{ onLogin: () => void }> = ({ onLogin }) => {
  const [email, setEmail] = useState('geta.hubcenter@gmail.com');
  const [senha, setSenha] = useState('Plamev@2026');
  const [show, setShow] = useState(false);
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true); setErro('');
    try { await login(email, senha); onLogin(); }
    catch (e: any) { setErro(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'radial-gradient(circle at 20% 80%, rgba(99,102,241,0.08) 0%, transparent 60%), radial-gradient(circle at 80% 20%, rgba(139,92,246,0.06) 0%, transparent 60%), #f8fafc' }}>
      <div className="w-full max-w-[380px] bg-white rounded-2xl border border-slate-200 shadow-xl p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
            <LayoutDashboard className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900 leading-tight">Dashboard</h1>
            <p className="text-xs text-slate-500 uppercase tracking-wider">V5 · Plamev</p>
          </div>
        </div>
        <p className="text-sm text-slate-500 mb-5">Supervisão de atendimento em tempo real.</p>

        <label className="text-xs font-medium text-slate-600 mb-1 block">Email</label>
        <Input type="email" value={email} onChange={e => setEmail(e.target.value)} className="mb-3" />

        <label className="text-xs font-medium text-slate-600 mb-1 block">Senha</label>
        <div className="relative mb-4">
          <Input type={show ? 'text' : 'password'} value={senha} onChange={e => setSenha(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()} className="pr-10" />
          <button type="button" onClick={() => setShow(!show)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1">
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        <Button onClick={handleLogin} disabled={loading} className="w-full">
          {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Entrando…</> : 'Entrar'}
        </Button>

        {erro && <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 text-center">{erro}</div>}

        <div className="mt-6 pt-4 border-t border-slate-100 text-xs text-slate-400 text-center">
          Dashboard V5 · dashv5.plamevbrasil.com.br
        </div>
      </div>
    </div>
  );
};

// ── Placeholder de página (fases 2-5 substituem cada um) ───────
const Placeholder: React.FC<{ titulo: string; subtitulo: string; fase: string }> = ({ titulo, subtitulo, fase }) => (
  <>
    <PageHeader title={titulo} subtitle={subtitulo} />
    <div className="flex-1 flex items-center justify-center p-10">
      <div className="text-center max-w-md">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium mb-3">
          ⏳ Aguardando {fase}
        </div>
        <h2 className="text-slate-700 text-base font-semibold">Esta página será implementada em {fase}</h2>
        <p className="text-sm text-slate-500 mt-2">Scaffold da V5 em andamento. Layout, navegação e autenticação prontos.</p>
      </div>
    </div>
  </>
);

// ── SHELL ─────────────────────────────────────────────────────
const Shell: React.FC = () => {
  const [pilar, setPilar]             = useState<Pilar>('monitorar');
  const [subPage, setSubPage]         = useState<string>('dashboard');
  const [menuOpen, setMenuOpen]       = useState(false);
  const [perfilOpen, setPerfilOpen]   = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => { try { return localStorage.getItem('sidebar_collapsed') === 'true'; } catch { return false; } }
  );

  // Event bus leve: qualquer componente pode chamar
  //   window.dispatchEvent(new CustomEvent('dashv5-navegar', { detail: { pilar, subPage, conversaId? } }))
  // pra navegar sem precisar de router. Usado pelos cards de LiveFeed/Fila.
  useEffect(() => {
    const h = (e: any) => {
      if (e.detail?.pilar && e.detail?.subPage) {
        if (e.detail.conversaId) localStorage.setItem('dashv5_conversa_ativa', e.detail.conversaId);
        setPilar(e.detail.pilar);
        setSubPage(e.detail.subPage);
      }
    };
    window.addEventListener('dashv5-navegar', h as any);
    return () => window.removeEventListener('dashv5-navegar', h as any);
  }, []);
  const user = getUser();
  useNotifications(true);  // Fase 6: alertas desktop para novas mensagens

  const navegar = (p: Pilar, s: string) => { setPilar(p); setSubPage(s); };

  const renderPagina = () => {
    const key = `${pilar}/${subPage}`;
    switch (key) {
      // Monitorar
      case 'monitorar/dashboard': return <DashboardPage />;
      case 'monitorar/pipeline':  return <PipelineKanbanPage />;

      // Atender
      case 'atender/chat':     return <ConversaPage />;
      case 'atender/contatos': return <ContactsPage />;
      case 'atender/perfil':   return <PerfilPage onAbrirConversa={() => navegar('atender', 'chat')} />;

      // Analisar
      case 'analisar/salvas':      return <SalvasPage />;
      case 'analisar/funil':       return <FunilPage />;
      case 'analisar/performance': return <AgentesPage />;

      // Sistema
      case 'sistema/simulador':  return <ChatSimulatorPage />;
      case 'sistema/sql':        return <SqlBrowserPage />;
      case 'sistema/auditoria':  return <AuditoriaPage />;
      case 'sistema/templates':  return <TemplatesPage />;
      case 'sistema/planos':     return <PlanosPage />;

      // Configurações
      case 'configuracoes/agentes':    return <ConfiguracaoPage />;
      case 'configuracoes/provedores': return <ProvedoresPage />;

      // Legado
      case 'sistema/agenda': return <AgendaPage />;
      case 'sistema/config': return <ConfigPage />;

      default: return <div className="p-6 text-slate-500">Página não encontrada</div>;
    }
  };

  return (
    <div className="flex min-h-screen">
      <Sidebar
        pilar={pilar}
        subPage={subPage}
        onNavigate={navegar}
        onLogout={() => { logout(); window.location.reload(); }}
        onPerfilClick={() => setPerfilOpen(true)}
        onCollapsedChange={setSidebarCollapsed}
        userEmail={user?.email}
        userName={user?.nome}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
      />
      {perfilOpen && <UserProfileModal onClose={() => setPerfilOpen(false)} />}
      <main
        className={cn(
          'flex-1 min-h-screen flex flex-col bg-slate-50 overflow-hidden transition-[margin] duration-300 ease-in-out',
          sidebarCollapsed ? 'md:ml-[60px]' : 'md:ml-[240px]',
        )}
      >
        {/* Barra top mobile com hambúrguer */}
        <div className="md:hidden sticky top-0 z-20 bg-white border-b border-slate-200 h-12 flex items-center gap-2 px-3 shrink-0">
          <button
            onClick={() => setMenuOpen(true)}
            className="p-1.5 -ml-1 rounded-md text-slate-600 hover:bg-slate-100"
            aria-label="Abrir menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <LayoutDashboard className="w-4 h-4 text-indigo-600" />
            <span className="text-sm font-semibold text-slate-900">Dashboard V5</span>
          </div>
        </div>
        {renderPagina()}
      </main>
    </div>
  );
};

export default function App() {
  const [auth, setAuth] = useState(isLoggedIn());
  return auth ? <Shell /> : <Login onLogin={() => setAuth(true)} />;
}
