import React, { useState, useRef } from 'react';
import { FileText, Pencil, Trash2, Sparkles, Save, Loader2, X, Reply, Smile } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api, isAdmin } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MediaRenderer } from './MediaRenderer';

const EMOJIS_RAPIDOS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

function fmtHora(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

interface MessageBubbleProps {
  msg: any;
  prevMsg: any | null;
  nextMsg: any | null;
  onChange: () => void;
  onReply: (msg: any) => void;
  reactions: string[];
  onReact: (msgId: string, emoji: string) => void;
}

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
        texto: textoOriginal, conversa_id: conversaId,
        instrucao: instrucao.trim() || undefined,
      });
      setResultado(r.texto_reescrito);
    } catch (e: any) { setErro(e.message); }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-900 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-600" /> Reescrever como Mari
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
        </div>
        <div className="bg-slate-50 border rounded-lg p-3 text-sm text-slate-700 whitespace-pre-wrap max-h-32 overflow-y-auto">{textoOriginal}</div>
        <Textarea value={instrucao} onChange={e => setInstrucao(e.target.value)}
          placeholder='"Deixa mais empática", "Destaca a carência de 15 dias"…'
          className="min-h-[60px] text-sm" />
        <Button onClick={reescrever} disabled={loading} size="sm">
          {loading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Mari pensando…</> : <><Sparkles className="w-3.5 h-3.5" /> Reescrever</>}
        </Button>
        {erro && <div className="text-sm text-red-600 p-2 bg-red-50 rounded">{erro}</div>}
        {resultado && (
          <div className="space-y-2">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm whitespace-pre-wrap">{resultado}</div>
            <Button size="sm" onClick={() => onAplicar(resultado)}>
              <Pencil className="w-3.5 h-3.5" /> Usar no editor
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  msg, prevMsg, nextMsg, onChange, onReply, reactions, onReact,
}) => {
  const ehCliente = msg.role === 'user' || msg.enviado_por === 'cliente';
  const ehNota = msg.role === 'system' || msg.enviado_por === 'nota' || /^\[NOTA\]/i.test(msg.conteudo || '');
  const ehSupervisora = !ehCliente && !ehNota && msg.enviado_por === 'supervisora';
  const admin = isAdmin();

  const sameSenderAsPrev = prevMsg && !ehNota &&
    ((prevMsg.role === 'user' || prevMsg.enviado_por === 'cliente') === ehCliente) &&
    !(prevMsg.role === 'system' || prevMsg.enviado_por === 'nota' || /^\[NOTA\]/i.test(prevMsg.conteudo || ''));

  const sameSenderAsNext = nextMsg && !ehNota &&
    ((nextMsg.role === 'user' || nextMsg.enviado_por === 'cliente') === ehCliente) &&
    !(nextMsg.role === 'system' || nextMsg.enviado_por === 'nota' || /^\[NOTA\]/i.test(nextMsg.conteudo || ''));

  const [editando, setEditando] = useState(false);
  const [textoEdit, setTextoEdit] = useState(msg.conteudo);
  const [salvando, setSalvando] = useState(false);
  const [reescritaOpen, setReescritaOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const emojiRef = useRef<HTMLDivElement>(null);

  const salvarEdicao = async () => {
    if (!textoEdit.trim() || textoEdit === msg.conteudo) { setEditando(false); return; }
    setSalvando(true);
    try {
      await api.patch(`/api/mensagens/${msg.id}`, { conteudo: textoEdit });
      setEditando(false); onChange();
    } catch (e: any) { alert(e.message); }
    setSalvando(false);
  };

  const excluir = async () => {
    if (!confirm('Excluir esta mensagem? A ação fica no log de auditoria.')) return;
    try { await api.delete(`/api/mensagens/${msg.id}`); onChange(); }
    catch (e: any) { alert(e.message); }
  };

  // ── Nota interna: pill central ─────────────────────────────────
  if (ehNota) {
    return (
      <div className="flex justify-center my-1">
        <div className="bg-amber-50 border border-amber-200 text-amber-700 text-xs px-3 py-1.5 rounded-full flex items-center gap-1.5 max-w-[80%] group">
          <FileText className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">{(msg.conteudo || '').replace(/^\[NOTA\]\s*/i, '')}</span>
          {admin && (
            <button onClick={excluir} className="opacity-0 group-hover:opacity-100 transition-opacity ml-1 hover:text-red-600 flex-shrink-0">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    );
  }

  // Arredondamento estilo WhatsApp:
  // - Bolha única ou primeira de um grupo: tem "cauda" (sharp corner no lado do sender)
  // - Mensagens do meio do grupo: sem cauda
  // - Última do grupo: sharp corner
  // Cliente fica à ESQUERDA (tail no canto superior-esquerdo), agente à DIREITA (tail no canto superior-direito)
  const radius = ehCliente
    ? cn('rounded-[18px]', !sameSenderAsPrev && 'rounded-tl-[4px]', !sameSenderAsNext && 'rounded-bl-[4px]')
    : cn('rounded-[18px]', !sameSenderAsPrev && 'rounded-tr-[4px]', !sameSenderAsNext && 'rounded-br-[4px]');

  const gap = sameSenderAsPrev ? 'mt-0.5' : 'mt-3';

  return (
    <>
      <div
        className={cn('flex group items-end px-3', ehCliente ? 'justify-start' : 'justify-end', gap)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => { setHovered(false); setEmojiOpen(false); }}
      >
        {/* Hover actions — lado direito da bolha do CLIENTE (que fica à esquerda) */}
        {ehCliente && hovered && !editando && (
          <div className="flex items-center gap-1 ml-1 mb-1 opacity-0 group-hover:opacity-100 transition-opacity relative">
            <button
              onClick={() => onReply(msg)}
              className="p-1.5 rounded-full bg-white shadow-sm hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
              title="Responder"
            >
              <Reply className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setEmojiOpen(v => !v)}
              className="p-1.5 rounded-full bg-white shadow-sm hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
              title="Reagir"
            >
              <Smile className="w-3.5 h-3.5" />
            </button>
            {admin && (
              <button onClick={excluir}
                className="p-1.5 rounded-full bg-white shadow-sm hover:bg-red-50 text-slate-500 hover:text-red-600 transition-colors" title="Excluir">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            {/* Emoji picker */}
            {emojiOpen && (
              <div ref={emojiRef} className="absolute bottom-8 left-0 bg-white rounded-2xl shadow-xl border border-slate-200 px-3 py-2 flex gap-1.5 z-20">
                {EMOJIS_RAPIDOS.map(e => (
                  <button key={e} onClick={() => { onReact(msg.id, e); setEmojiOpen(false); }}
                    className="text-xl hover:scale-125 transition-transform">{e}</button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Bolha */}
        <div className={cn(
          'relative max-w-[72%] px-3 py-2 shadow-sm',
          radius,
          ehCliente
            ? 'bg-white border border-slate-200 text-slate-800'
            : 'bg-[#dcf8c6] text-slate-800'
        )}>
          {editando ? (
            <div className="space-y-2 min-w-[240px]">
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
              <div className="text-[10px] text-slate-400">⌘+Enter para salvar · não reenvia ao cliente</div>
            </div>
          ) : (
            <>
              <MediaRenderer
                conteudo={msg.conteudo}
                metadata={msg.metadata}
                ehCliente={ehCliente}
              />
              <div className="flex items-center gap-1 mt-1 justify-end">
                <span className="text-[10px] text-slate-400 opacity-70">{fmtHora(msg.timestamp)}</span>
                {ehSupervisora && (
                  <span className="text-[9px] bg-indigo-100 text-indigo-600 px-1 py-0.5 rounded font-medium">Supervisor</span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Hover actions — lado esquerdo da bolha do AGENTE (que fica à direita) */}
        {!ehCliente && hovered && !editando && (
          <div className="flex items-center gap-1 mr-1 mb-1 opacity-0 group-hover:opacity-100 transition-opacity relative">
            {admin && (
              <>
                <button onClick={excluir}
                  className="p-1.5 rounded-full bg-white shadow-sm hover:bg-red-50 text-slate-500 hover:text-red-600 transition-colors" title="Excluir">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => { setTextoEdit(msg.conteudo); setEditando(true); }}
                  className="p-1.5 rounded-full bg-white shadow-sm hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors" title="Editar">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setReescritaOpen(true)}
                  className="p-1.5 rounded-full bg-white shadow-sm hover:bg-indigo-50 text-slate-500 hover:text-indigo-600 transition-colors" title="Reescrever como Mari">
                  <Sparkles className="w-3.5 h-3.5" />
                </button>
              </>
            )}
            <button
              onClick={() => setEmojiOpen(v => !v)}
              className="p-1.5 rounded-full bg-white shadow-sm hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
              title="Reagir"
            >
              <Smile className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onReply(msg)}
              className="p-1.5 rounded-full bg-white shadow-sm hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
              title="Responder"
            >
              <Reply className="w-3.5 h-3.5" />
            </button>
            {/* Emoji picker */}
            {emojiOpen && (
              <div ref={emojiRef} className="absolute bottom-8 right-0 bg-white rounded-2xl shadow-xl border border-slate-200 px-3 py-2 flex gap-1.5 z-20">
                {EMOJIS_RAPIDOS.map(e => (
                  <button key={e} onClick={() => { onReact(msg.id, e); setEmojiOpen(false); }}
                    className="text-xl hover:scale-125 transition-transform">{e}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Reações abaixo da bolha */}
      {reactions.length > 0 && (
        <div className={cn('flex gap-1 px-3 mt-0.5', ehCliente ? 'justify-end pr-4' : 'justify-start pl-4')}>
          {reactions.map(emoji => (
            <button
              key={emoji}
              onClick={() => onReact(msg.id, emoji)}
              className="text-base bg-white rounded-full shadow-sm border border-slate-200 px-1.5 py-0.5 hover:scale-110 transition-transform leading-none"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {reescritaOpen && (
        <ReescreverDialog
          textoOriginal={msg.conteudo}
          conversaId={msg.conversa_id}
          onClose={() => setReescritaOpen(false)}
          onAplicar={async (novo) => { setTextoEdit(novo); setEditando(true); setReescritaOpen(false); }}
        />
      )}
    </>
  );
};
