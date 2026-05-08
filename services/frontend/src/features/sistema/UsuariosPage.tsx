import React, { useState, useEffect, useCallback } from 'react';
import {
  Users, Plus, Search, MoreVertical, Edit2, Trash2,
  KeyRound, Power, PowerOff, Copy, Check, ChevronDown,
  ChevronRight, Clock, LogIn, Activity, Shield, UserCheck, UserX,
  Loader2, AlertTriangle, RefreshCw,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getTokenForSocket } from '@/services/api';
import { cn } from '@/lib/utils';

const API = (import.meta as any).env?.VITE_API_URL || '';

// ── Types ──────────────────────────────────────────────────────────
interface Usuario {
  id: number;
  nome: string;
  email: string;
  perfil: 'admin' | 'supervisor' | 'operador';
  foto_url: string | null;
  ativo: boolean;
  ultimo_login: string | null;
  ultima_atividade: string | null;
  ultima_acao: string | null;
  criado_em: string | null;
}

type ModalType = 'criar' | 'editar' | 'reset' | 'remover' | null;

// ── Helpers ─────────────────────────────────────────────────────────
function formatDate(d: string | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(d));
}

function perfilLabel(p: string): { label: string; color: string } {
  if (p === 'admin') return { label: 'Admin', color: 'bg-purple-500/15 text-purple-400 border-purple-500/25' };
  if (p === 'supervisor') return { label: 'Supervisor', color: 'bg-blue-500/15 text-blue-400 border-blue-500/25' };
  return { label: 'Operador', color: 'bg-slate-500/15 text-slate-400 border-slate-500/25' };
}

function initials(nome: string): string {
  return nome.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

// ── API calls ────────────────────────────────────────────────────────
async function apiFetch(path: string, opts?: RequestInit) {
  const token = getTokenForSocket();
  const resp = await fetch(`${API}/api${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(opts?.headers || {}),
    },
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.erro || `HTTP ${resp.status}`);
  return data;
}

// ── Main Page ────────────────────────────────────────────────────────
export const UsuariosPage: React.FC = () => {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [modal, setModal] = useState<ModalType>(null);
  const [usuarioSelecionado, setUsuarioSelecionado] = useState<Usuario | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [senhaTemporaria, setSenhaTemporaria] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [salvando, setSalvando] = useState(false);

  // Form state
  const [formNome, setFormNome] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formSenha, setFormSenha] = useState('');
  const [formPerfil, setFormPerfil] = useState<string>('operador');
  const [formErro, setFormErro] = useState('');

  const carregarUsuarios = useCallback(async () => {
    setLoading(true);
    setErro('');
    try {
      const data = await apiFetch('/usuarios');
      setUsuarios(data.usuarios || []);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { carregarUsuarios(); }, [carregarUsuarios]);

  const abrirModal = (tipo: ModalType, usuario?: Usuario) => {
    setModal(tipo);
    setUsuarioSelecionado(usuario || null);
    setFormErro('');
    setSenhaTemporaria('');
    setCopiado(false);
    if (tipo === 'editar' && usuario) {
      setFormNome(usuario.nome);
      setFormEmail(usuario.email);
      setFormPerfil(usuario.perfil);
    } else if (tipo === 'criar') {
      setFormNome('');
      setFormEmail('');
      setFormSenha('');
      setFormPerfil('operador');
    }
  };

  const fecharModal = () => {
    setModal(null);
    setUsuarioSelecionado(null);
    setFormErro('');
  };

  const salvarCriar = async () => {
    if (!formNome.trim() || !formEmail.trim() || !formSenha.trim()) {
      setFormErro('Nome, e-mail e senha são obrigatórios.'); return;
    }
    setSalvando(true); setFormErro('');
    try {
      await apiFetch('/usuarios', {
        method: 'POST',
        body: JSON.stringify({ nome: formNome, email: formEmail, senha: formSenha, perfil: formPerfil }),
      });
      fecharModal();
      carregarUsuarios();
    } catch (e: any) {
      setFormErro(e.message);
    } finally {
      setSalvando(false);
    }
  };

  const salvarEditar = async () => {
    if (!usuarioSelecionado) return;
    setSalvando(true); setFormErro('');
    try {
      await apiFetch(`/usuarios/${usuarioSelecionado.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ nome: formNome, email: formEmail, perfil: formPerfil }),
      });
      fecharModal();
      carregarUsuarios();
    } catch (e: any) {
      setFormErro(e.message);
    } finally {
      setSalvando(false);
    }
  };

  const resetarSenha = async (usuario: Usuario) => {
    setSalvando(true);
    try {
      const data = await apiFetch(`/usuarios/${usuario.id}/reset-senha`, { method: 'POST' });
      setSenhaTemporaria(data.senha_temporaria);
      setModal('reset');
      setUsuarioSelecionado(usuario);
    } catch (e: any) {
      setFormErro(e.message);
    } finally {
      setSalvando(false);
    }
  };

  const toggleStatus = async (usuario: Usuario) => {
    try {
      await apiFetch(`/usuarios/${usuario.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ ativo: !usuario.ativo }),
      });
      carregarUsuarios();
    } catch (e: any) {
      setErro(e.message);
    }
  };

  const removerUsuario = async () => {
    if (!usuarioSelecionado) return;
    setSalvando(true);
    try {
      await apiFetch(`/usuarios/${usuarioSelecionado.id}`, { method: 'DELETE' });
      fecharModal();
      carregarUsuarios();
    } catch (e: any) {
      setFormErro(e.message);
    } finally {
      setSalvando(false);
    }
  };

  const copiarSenha = () => {
    navigator.clipboard.writeText(senhaTemporaria).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    });
  };

  const usuariosFiltrados = usuarios.filter(u =>
    u.nome.toLowerCase().includes(busca.toLowerCase()) ||
    u.email.toLowerCase().includes(busca.toLowerCase())
  );

  const ativos = usuarios.filter(u => u.ativo).length;
  const inativos = usuarios.filter(u => !u.ativo).length;

  return (
    <>
      <PageHeader
        title="Usuários"
        subtitle="Gerencie os acessos e permissões da equipe"
      />

      <div className="flex-1 p-6 space-y-5 overflow-auto">
        {/* ── Stats cards ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total', value: usuarios.length, icon: Users, color: 'text-indigo-400' },
            { label: 'Ativos', value: ativos, icon: UserCheck, color: 'text-emerald-400' },
            { label: 'Inativos', value: inativos, icon: UserX, color: 'text-rose-400' },
            { label: 'Admins', value: usuarios.filter(u => u.perfil === 'admin').length, icon: Shield, color: 'text-purple-400' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3">
              <div className={cn('w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center', color)}>
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-800">{value}</div>
                <div className="text-xs text-slate-500">{label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Toolbar ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Buscar usuário..."
              value={busca}
              onChange={e => setBusca(e.target.value)}
              className="pl-9"
              id="busca-usuarios"
            />
          </div>
          <Button variant="outline" size="sm" onClick={carregarUsuarios} id="btn-atualizar-usuarios">
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button size="sm" onClick={() => abrirModal('criar')} id="btn-criar-usuario">
            <Plus className="w-4 h-4 mr-1.5" />
            Novo Usuário
          </Button>
        </div>

        {/* ── Error ───────────────────────────────────────────────── */}
        {erro && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3 text-red-700 text-sm">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {erro}
          </div>
        )}

        {/* ── Table ───────────────────────────────────────────────── */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
            </div>
          ) : usuariosFiltrados.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Nenhum usuário encontrado</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Usuário</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider hidden md:table-cell">Perfil</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider hidden lg:table-cell">Último Login</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {usuariosFiltrados.map(u => {
                  const { label, color } = perfilLabel(u.perfil);
                  const isExpanded = expandedId === u.id;

                  return (
                    <React.Fragment key={u.id}>
                      <tr className={cn('hover:bg-slate-50 transition-colors', !u.ativo && 'opacity-60')}>
                        {/* Avatar + nome */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                              {u.foto_url
                                ? <img src={u.foto_url} alt={u.nome} className="w-full h-full rounded-full object-cover" />
                                : initials(u.nome)
                              }
                            </div>
                            <div>
                              <div className="font-medium text-slate-800">{u.nome}</div>
                              <div className="text-xs text-slate-500">{u.email}</div>
                            </div>
                          </div>
                        </td>

                        {/* Perfil */}
                        <td className="px-4 py-3 hidden md:table-cell">
                          <span className={cn('text-xs px-2 py-1 rounded-full border font-medium', color)}>
                            {label}
                          </span>
                        </td>

                        {/* Último login */}
                        <td className="px-4 py-3 hidden lg:table-cell">
                          <div className="flex items-center gap-1.5 text-slate-500">
                            <LogIn className="w-3.5 h-3.5 opacity-60" />
                            <span className="text-xs">{formatDate(u.ultimo_login)}</span>
                          </div>
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3">
                          <span className={cn(
                            'inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full font-medium',
                            u.ativo
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-slate-100 text-slate-500 border border-slate-200'
                          )}>
                            <span className={cn('w-1.5 h-1.5 rounded-full', u.ativo ? 'bg-emerald-500' : 'bg-slate-400')} />
                            {u.ativo ? 'Ativo' : 'Inativo'}
                          </span>
                        </td>

                        {/* Ações */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 justify-end">
                            {/* Expandir histórico */}
                            <button
                              onClick={() => setExpandedId(isExpanded ? null : u.id)}
                              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                              title="Ver atividade"
                              id={`btn-atividade-${u.id}`}
                            >
                              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>

                            {/* Editar */}
                            <button
                              onClick={() => abrirModal('editar', u)}
                              className="p-1.5 rounded-lg text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                              title="Editar"
                              id={`btn-editar-${u.id}`}
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>

                            {/* Reset senha */}
                            <button
                              onClick={() => resetarSenha(u)}
                              className="p-1.5 rounded-lg text-slate-400 hover:bg-amber-50 hover:text-amber-600 transition-colors"
                              title="Resetar senha"
                              id={`btn-reset-${u.id}`}
                            >
                              <KeyRound className="w-4 h-4" />
                            </button>

                            {/* Ativar/Desativar */}
                            <button
                              onClick={() => toggleStatus(u)}
                              className={cn(
                                'p-1.5 rounded-lg transition-colors',
                                u.ativo
                                  ? 'text-slate-400 hover:bg-rose-50 hover:text-rose-600'
                                  : 'text-slate-400 hover:bg-emerald-50 hover:text-emerald-600'
                              )}
                              title={u.ativo ? 'Desativar' : 'Ativar'}
                              id={`btn-status-${u.id}`}
                            >
                              {u.ativo ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                            </button>

                            {/* Remover */}
                            <button
                              onClick={() => abrirModal('remover', u)}
                              className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                              title="Remover"
                              id={`btn-remover-${u.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* ── Painel de atividade expandido ─────────── */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={5} className="bg-slate-50 px-6 py-4 border-b border-slate-100">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                              {[
                                { icon: LogIn, label: 'Último Login', value: formatDate(u.ultimo_login) },
                                { icon: Activity, label: 'Última Atividade', value: formatDate(u.ultima_atividade) },
                                { icon: MoreVertical, label: 'Última Ação', value: u.ultima_acao || '—' },
                                { icon: Clock, label: 'Membro desde', value: formatDate(u.criado_em) },
                              ].map(({ icon: Icon, label, value }) => (
                                <div key={label} className="flex items-start gap-2">
                                  <Icon className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
                                  <div>
                                    <div className="text-slate-500 font-medium">{label}</div>
                                    <div className="text-slate-700 mt-0.5">{value}</div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Modal: Criar / Editar ─────────────────────────────────── */}
      {(modal === 'criar' || modal === 'editar') && (
        <ModalOverlay onClose={fecharModal}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-5">
              {modal === 'criar' ? 'Novo Usuário' : 'Editar Usuário'}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Nome *</label>
                <Input
                  id="campo-nome"
                  placeholder="João Silva"
                  value={formNome}
                  onChange={e => setFormNome(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">E-mail *</label>
                <Input
                  id="campo-email"
                  type="email"
                  placeholder="joao@empresa.com"
                  value={formEmail}
                  onChange={e => setFormEmail(e.target.value)}
                />
              </div>
              {modal === 'criar' && (
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Senha *</label>
                  <Input
                    id="campo-senha"
                    type="password"
                    placeholder="••••••••"
                    value={formSenha}
                    onChange={e => setFormSenha(e.target.value)}
                  />
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Perfil</label>
                <select
                  id="campo-perfil"
                  value={formPerfil}
                  onChange={e => setFormPerfil(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                >
                  <option value="operador">Operador</option>
                  <option value="supervisor">Supervisor</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>

            {formErro && (
              <p className="mt-3 text-sm text-red-600 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> {formErro}
              </p>
            )}

            <div className="flex gap-3 mt-6 justify-end">
              <Button variant="outline" onClick={fecharModal} id="btn-cancelar-modal">Cancelar</Button>
              <Button
                onClick={modal === 'criar' ? salvarCriar : salvarEditar}
                disabled={salvando}
                id="btn-salvar-usuario"
              >
                {salvando ? <><Loader2 className="w-4 h-4 animate-spin mr-1.5" />Salvando…</> : 'Salvar'}
              </Button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* ── Modal: Reset de senha ─────────────────────────────────── */}
      {modal === 'reset' && (
        <ModalOverlay onClose={fecharModal}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                <KeyRound className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-800">Senha Resetada</h2>
                <p className="text-xs text-slate-500">{usuarioSelecionado?.nome}</p>
              </div>
            </div>

            <p className="text-sm text-slate-600 mb-4">
              Nova senha temporária gerada. Compartilhe com o usuário e peça que ele altere no primeiro acesso.
            </p>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-3">
              <code className="text-sm font-mono text-slate-800 font-semibold select-all">{senhaTemporaria}</code>
              <button
                onClick={copiarSenha}
                className="p-2 rounded-lg hover:bg-slate-200 transition-colors text-slate-500"
                id="btn-copiar-senha"
              >
                {copiado ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>

            <div className="flex justify-end mt-6">
              <Button onClick={fecharModal} id="btn-fechar-reset">Fechar</Button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* ── Modal: Confirmar remoção ──────────────────────────────── */}
      {modal === 'remover' && usuarioSelecionado && (
        <ModalOverlay onClose={fecharModal}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-800">Remover Usuário</h2>
                <p className="text-xs text-slate-500">{usuarioSelecionado.nome}</p>
              </div>
            </div>

            <p className="text-sm text-slate-600 mb-6">
              Esta ação é <strong>permanente</strong>. O usuário perderá acesso imediatamente e não poderá ser recuperado.
            </p>

            {formErro && (
              <p className="mb-3 text-sm text-red-600">{formErro}</p>
            )}

            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={fecharModal} id="btn-cancelar-remover">Cancelar</Button>
              <Button
                onClick={removerUsuario}
                disabled={salvando}
                className="bg-red-600 hover:bg-red-700"
                id="btn-confirmar-remover"
              >
                {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Remover'}
              </Button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </>
  );
};

// ── Overlay component ──────────────────────────────────────────────
const ModalOverlay: React.FC<{ children: React.ReactNode; onClose: () => void }> = ({ children, onClose }) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center p-4"
    style={{ background: 'rgba(0,0,0,0.45)' }}
    onClick={e => { if (e.target === e.currentTarget) onClose(); }}
  >
    {children}
  </div>
);
