import React, { useState, useEffect } from 'react';
import { X, User, Lock, Bell, Camera, CheckCircle2, Loader2 } from 'lucide-react';
import { api, getUser } from '@/services/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Tab = 'perfil' | 'seguranca' | 'notificacoes';

interface UserData {
  nome: string;
  email: string;
  foto_url: string | null;
  preferencias: Record<string, any>;
}

interface Prefs {
  notif_desktop: boolean;
  notif_humano: boolean;
  notif_novos_leads: boolean;
}

const DEFAULT_PREFS: Prefs = {
  notif_desktop:    true,
  notif_humano:     true,
  notif_novos_leads: true,
};

export const UserProfileModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [tab, setTab]         = useState<Tab>('perfil');
  const [user, setUser]       = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);

  // Perfil
  const [nome, setNome]       = useState('');
  const [fotoUrl, setFotoUrl] = useState('');
  const [savingPerfil, setSavingPerfil] = useState(false);
  const [perfilOk, setPerfilOk] = useState(false);

  // Senha
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha]   = useState('');
  const [confSenha, setConfSenha]   = useState('');
  const [savingSenha, setSavingSenha] = useState(false);
  const [senhaOk, setSenhaOk]   = useState(false);
  const [senhaErro, setSenhaErro] = useState('');

  // Notificações
  const [prefs, setPrefs]   = useState<Prefs>(DEFAULT_PREFS);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsOk, setPrefsOk] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<any>('/auth/me');
        const u = res.user || res;
        setUser({ nome: u.nome || 'Admin', email: u.email || '', foto_url: u.foto_url || null, preferencias: u.preferencias || {} });
        setNome(u.nome || 'Admin');
        setFotoUrl(u.foto_url || '');
        setPrefs({ ...DEFAULT_PREFS, ...(u.preferencias || {}) });
      } catch {
        const u = getUser();
        setUser({ nome: u?.nome || 'Admin', email: u?.email || '', foto_url: null, preferencias: {} });
        setNome(u?.nome || 'Admin');
      } finally { setLoading(false); }
    })();
  }, []);

  const salvarPerfil = async () => {
    setSavingPerfil(true);
    try {
      await api.patch('/auth/profile', { nome, foto_url: fotoUrl || null });
      setPerfilOk(true);
      setTimeout(() => setPerfilOk(false), 3000);
    } catch (e: any) { alert('Erro: ' + e.message); }
    finally { setSavingPerfil(false); }
  };

  const salvarSenha = async () => {
    setSenhaErro('');
    if (novaSenha !== confSenha) { setSenhaErro('As senhas não coincidem.'); return; }
    if (novaSenha.length < 6) { setSenhaErro('A nova senha deve ter ao menos 6 caracteres.'); return; }
    setSavingSenha(true);
    try {
      await api.patch('/auth/password', { senha_atual: senhaAtual, nova_senha: novaSenha });
      setSenhaOk(true);
      setSenhaAtual(''); setNovaSenha(''); setConfSenha('');
      setTimeout(() => setSenhaOk(false), 3000);
    } catch (e: any) { setSenhaErro(e.message || 'Erro ao alterar senha'); }
    finally { setSavingSenha(false); }
  };

  const salvarPrefs = async () => {
    setSavingPrefs(true);
    try {
      await api.patch('/auth/notificacoes', prefs);
      setPrefsOk(true);
      setTimeout(() => setPrefsOk(false), 3000);
    } catch (e: any) { alert('Erro: ' + e.message); }
    finally { setSavingPrefs(false); }
  };

  const initials = (nome || user?.email || 'A')[0].toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="fixed inset-0 bg-black/40" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Meu Perfil</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : (
          <>
            {/* Avatar + nome */}
            <div className="flex items-center gap-4 px-6 py-5 bg-slate-50 border-b border-slate-100">
              <div className="relative">
                {fotoUrl ? (
                  <img src={fotoUrl} alt={nome} className="w-14 h-14 rounded-full object-cover border-2 border-white shadow" />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xl font-semibold shadow">
                    {initials}
                  </div>
                )}
              </div>
              <div>
                <p className="font-semibold text-slate-900">{user?.nome || 'Admin'}</p>
                <p className="text-sm text-slate-500">{user?.email}</p>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-100">
              {([
                { id: 'perfil',       label: 'Perfil',       icon: User },
                { id: 'seguranca',    label: 'Segurança',    icon: Lock },
                { id: 'notificacoes', label: 'Notificações', icon: Bell },
              ] as { id: Tab; label: string; icon: any }[]).map(t => (
                <button key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors',
                    tab === t.id
                      ? 'border-indigo-500 text-indigo-700'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  )}
                >
                  <t.icon className="w-3.5 h-3.5" /> {t.label}
                </button>
              ))}
            </div>

            {/* Conteúdo da aba */}
            <div className="px-6 py-5 space-y-4">

              {tab === 'perfil' && (
                <>
                  <div>
                    <label className="text-xs font-medium text-slate-600 mb-1 block">Nome de exibição</label>
                    <Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Seu nome" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 mb-1 block flex items-center gap-1">
                      <Camera className="w-3 h-3" /> URL da foto de perfil
                    </label>
                    <Input value={fotoUrl} onChange={e => setFotoUrl(e.target.value)} placeholder="https://..." />
                    <p className="text-[11px] text-slate-400 mt-1">Cole a URL de uma imagem pública (JPG, PNG, WebP)</p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 mb-1 block">Email</label>
                    <Input value={user?.email || ''} disabled className="bg-slate-50 text-slate-500" />
                  </div>
                  <Button onClick={salvarPerfil} disabled={savingPerfil} className="w-full">
                    {savingPerfil ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando…</> : 'Salvar perfil'}
                  </Button>
                  {perfilOk && (
                    <p className="text-sm text-emerald-600 flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" /> Perfil atualizado!
                    </p>
                  )}
                </>
              )}

              {tab === 'seguranca' && (
                <>
                  <div>
                    <label className="text-xs font-medium text-slate-600 mb-1 block">Senha atual</label>
                    <Input type="password" value={senhaAtual} onChange={e => setSenhaAtual(e.target.value)} placeholder="••••••••" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 mb-1 block">Nova senha</label>
                    <Input type="password" value={novaSenha} onChange={e => setNovaSenha(e.target.value)} placeholder="Mínimo 6 caracteres" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 mb-1 block">Confirmar nova senha</label>
                    <Input type="password" value={confSenha} onChange={e => setConfSenha(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && salvarSenha()} placeholder="Repita a nova senha" />
                  </div>
                  {senhaErro && <p className="text-sm text-red-600">{senhaErro}</p>}
                  <Button onClick={salvarSenha} disabled={savingSenha || !senhaAtual || !novaSenha || !confSenha} className="w-full">
                    {savingSenha ? <><Loader2 className="w-4 h-4 animate-spin" /> Alterando…</> : 'Alterar senha'}
                  </Button>
                  {senhaOk && (
                    <p className="text-sm text-emerald-600 flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" /> Senha alterada com sucesso!
                    </p>
                  )}
                </>
              )}

              {tab === 'notificacoes' && (
                <>
                  {([
                    { key: 'notif_desktop',     label: 'Notificações desktop',            desc: 'Alerta visual para novas mensagens' },
                    { key: 'notif_humano',       label: 'Alertas de atendimento humano',   desc: 'Quando um cliente precisa de supervisor' },
                    { key: 'notif_novos_leads',  label: 'Novos leads',                     desc: 'Ao receber um novo contato no sistema' },
                  ] as { key: keyof Prefs; label: string; desc: string }[]).map(p => (
                    <div key={p.key} className="flex items-center justify-between py-2">
                      <div>
                        <p className="text-sm font-medium text-slate-700">{p.label}</p>
                        <p className="text-xs text-slate-400">{p.desc}</p>
                      </div>
                      <button
                        onClick={() => setPrefs(prev => ({ ...prev, [p.key]: !prev[p.key] }))}
                        className={cn(
                          'relative w-11 h-6 rounded-full transition-colors',
                          prefs[p.key] ? 'bg-indigo-500' : 'bg-slate-200'
                        )}
                      >
                        <span className={cn(
                          'absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform',
                          prefs[p.key] ? 'translate-x-5' : 'translate-x-0'
                        )} />
                      </button>
                    </div>
                  ))}
                  <Button onClick={salvarPrefs} disabled={savingPrefs} className="w-full mt-2">
                    {savingPrefs ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando…</> : 'Salvar preferências'}
                  </Button>
                  {prefsOk && (
                    <p className="text-sm text-emerald-600 flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" /> Preferências salvas!
                    </p>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
