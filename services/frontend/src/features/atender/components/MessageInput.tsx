import React, { useRef, useState, useCallback } from 'react';
import {
  Send, Zap, FileText, Paperclip, Mic, Smile, StopCircle,
  X, Loader2, Sparkles, CheckCircle, AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { BASE_URL } from '@/services/api';

type Modo = 'mari' | 'direto' | 'nota';

const MODO_CONFIG: Record<Modo, { label: string; icon: React.ReactNode; placeholder: string; color: string }> = {
  mari: {
    label: 'Mari',
    icon: <Sparkles className="w-3 h-3" />,
    placeholder: 'Instrução para a Mari (opcional) — vazio = provocar automaticamente · Enter envia',
    color: 'text-indigo-600 bg-indigo-50 border-indigo-200',
  },
  direto: {
    label: 'Direto',
    icon: <Send className="w-3 h-3" />,
    placeholder: 'Mensagem que será enviada diretamente ao cliente · Enter envia',
    color: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  },
  nota: {
    label: 'Nota',
    icon: <FileText className="w-3 h-3" />,
    placeholder: 'Nota interna (não visível ao cliente) · Enter envia',
    color: 'text-amber-700 bg-amber-50 border-amber-200',
  },
};

const EMOJIS = ['😊','😂','❤️','👍','🙏','😢','😮','🔥','✅','🎉','💪','🐾','🐶','🐱','🐕','💊','🏥','📋','💰','📅'];

// 25 MB em bytes — limite razoável para WhatsApp (documentos até 100MB mas API limita a 25MB)
const MAX_FILE_BYTES = 25 * 1024 * 1024;

interface ReplyPreview {
  id: string;
  conteudo: string;
  enviado_por: string;
  msg_id_externo?: string | null;
  role?: string;
}

interface MessageInputProps {
  conversaId: string;
  acaoLoading: boolean;
  replyTo: ReplyPreview | null;
  onClearReply: () => void;
  onSend: (modo: Modo, texto: string, opts?: { reescrever?: boolean; quoted_id_externo?: string | null; quoted_from_me?: boolean }) => void;
  onAgendar: () => void;
  onMidiaEnviada?: () => void;
}

type UploadStatus = 'idle' | 'uploading' | 'ok' | 'erro';

export const MessageInput: React.FC<MessageInputProps> = ({
  conversaId, acaoLoading, replyTo, onClearReply, onSend, onAgendar, onMidiaEnviada,
}) => {
  const [modo, setModo] = useState<Modo>('mari');
  const [texto, setTexto] = useState('');
  const [reescrever, setReescrever] = useState(true);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [uploadMsg, setUploadMsg] = useState('');

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cfg = MODO_CONFIG[modo];

  const handleSend = useCallback(() => {
    if (acaoLoading) return;
    if (modo === 'mari' && !texto.trim()) {
      onSend('mari', '');
      return;
    }
    if (!texto.trim()) return;
    onSend(modo, texto, modo === 'direto' ? {
      reescrever,
      quoted_id_externo: replyTo?.msg_id_externo ?? null,
      quoted_from_me: replyTo?.role !== undefined ? replyTo.role !== 'user' : false,
    } : undefined);
    setTexto('');
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [texto, modo, reescrever, acaoLoading, onSend]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const enviarMidia = async (b64: string, mimeType: string, fileName: string) => {
    setUploadStatus('uploading');
    setUploadMsg(`Enviando ${fileName}…`);
    try {
      const res = await fetch(`${BASE_URL}/api/mensagens/enviar-midia`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('dash_v5_token')}`,
        },
        body: JSON.stringify({ conversa_id: conversaId, base64: b64, mimeType, fileName }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setUploadStatus('ok');
      setUploadMsg(`${fileName} enviado!`);
      onMidiaEnviada?.();
      setTimeout(() => setUploadStatus('idle'), 2500);
    } catch (e: any) {
      console.error('[INPUT] Erro ao enviar mídia:', e.message);
      setUploadStatus('erro');
      setUploadMsg(`Falha ao enviar: ${e.message}`);
      setTimeout(() => setUploadStatus('idle'), 4000);
    }
  };

  const iniciarGravacao = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      chunksRef.current = [];
      mr.ondataavailable = e => chunksRef.current.push(e.data);
      mr.start(200);
      mediaRef.current = mr;
      setGravando(true);
      setSegundos(0);
      timerRef.current = setInterval(() => setSegundos(s => s + 1), 1000);
    } catch (e: any) {
      alert('Microfone não disponível: ' + e.message);
    }
  };

  const pararGravacao = () => {
    const mr = mediaRef.current;
    if (!mr) return;
    mr.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      const reader = new FileReader();
      reader.onloadend = async () => {
        const b64 = (reader.result as string).split(',')[1];
        await enviarMidia(b64, 'audio/webm', `audio-${Date.now()}.webm`);
      };
      reader.readAsDataURL(blob);
      mr.stream.getTracks().forEach(t => t.stop());
    };
    mr.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    setGravando(false);
    setSegundos(0);
  };

  const onAnexar = () => {
    fileInputRef.current?.click();
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reseta o input para permitir selecionar o mesmo arquivo novamente
    e.target.value = '';

    if (file.size > MAX_FILE_BYTES) {
      setUploadStatus('erro');
      setUploadMsg(`Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)} MB). Limite: 25 MB.`);
      setTimeout(() => setUploadStatus('idle'), 4000);
      return;
    }

    const reader = new FileReader();
    reader.onloadend = async () => {
      const b64 = (reader.result as string).split(',')[1];
      const mimeType = file.type || 'application/octet-stream';
      await enviarMidia(b64, mimeType, file.name);
    };
    reader.readAsDataURL(file);
  };

  const uploadIdle = uploadStatus === 'idle';

  return (
    <div className="bg-white border-t border-slate-200 flex-shrink-0 z-10">
      {/* Reply preview */}
      {replyTo && (
        <div className="flex items-start gap-2 px-4 pt-2.5 pb-1">
          <div className="flex-1 bg-slate-50 border-l-4 border-indigo-400 rounded-r-lg px-3 py-1.5">
            <div className="text-[10px] font-semibold text-indigo-600 mb-0.5">
              Respondendo a {replyTo.enviado_por === 'cliente' || replyTo.enviado_por === 'humano' ? 'cliente' : 'Mari'}
            </div>
            <div className="text-xs text-slate-600 truncate">{replyTo.conteudo?.slice(0, 80)}</div>
          </div>
          <button onClick={onClearReply} className="mt-1 p-1 text-slate-400 hover:text-slate-700">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Upload status banner */}
      {!uploadIdle && (
        <div className={cn(
          'flex items-center gap-2 px-4 py-1.5 text-xs font-medium',
          uploadStatus === 'uploading' && 'bg-blue-50 text-blue-700',
          uploadStatus === 'ok'        && 'bg-emerald-50 text-emerald-700',
          uploadStatus === 'erro'      && 'bg-red-50 text-red-700',
        )}>
          {uploadStatus === 'uploading' && <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />}
          {uploadStatus === 'ok'        && <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />}
          {uploadStatus === 'erro'      && <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />}
          <span className="truncate">{uploadMsg}</span>
        </div>
      )}

      {/* Seletor de modo */}
      <div className="flex items-center gap-2 px-4 pt-2.5 pb-1">
        <div className="flex items-center gap-1 bg-slate-100 rounded-full p-0.5">
          {(Object.keys(MODO_CONFIG) as Modo[]).map(m => (
            <button
              key={m}
              onClick={() => { setModo(m); setTimeout(() => inputRef.current?.focus(), 0); }}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all',
                modo === m
                  ? cn('shadow-sm', MODO_CONFIG[m].color)
                  : 'text-slate-500 hover:text-slate-700'
              )}
            >
              {MODO_CONFIG[m].icon}
              {MODO_CONFIG[m].label}
            </button>
          ))}
        </div>
        {modo === 'direto' && (
          <label className="text-[11px] text-slate-500 flex items-center gap-1 ml-auto cursor-pointer">
            <input type="checkbox" checked={reescrever} onChange={e => setReescrever(e.target.checked)} className="w-3 h-3" />
            Reescrever no tom Mari
          </label>
        )}
      </div>

      {/* Input file oculto — aceita qualquer tipo */}
      <input
        ref={fileInputRef}
        type="file"
        accept="*/*"
        className="hidden"
        onChange={onFileChange}
      />

      {/* Área de texto */}
      <div className="px-3 pb-2">
        {gravando ? (
          <div className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl">
            <StopCircle className="w-5 h-5 text-red-500 animate-pulse" />
            <span className="text-sm text-red-700 font-medium flex-1">Gravando… {segundos}s</span>
            <Button size="sm" variant="danger-outline" onClick={pararGravacao}>
              <StopCircle className="w-3.5 h-3.5" /> Parar e enviar
            </Button>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            {/* Emoji picker */}
            <div className="relative self-end mb-1">
              <button
                onClick={() => setEmojiOpen(v => !v)}
                className="p-1.5 text-slate-400 hover:text-slate-700 transition-colors"
                title="Emoji"
              >
                <Smile className="w-4.5 h-4.5" />
              </button>
              {emojiOpen && (
                <div className="absolute bottom-8 left-0 bg-white rounded-2xl shadow-xl border border-slate-200 p-3 z-20 w-[220px]">
                  <div className="flex flex-wrap gap-1.5">
                    {EMOJIS.map(e => (
                      <button key={e} onClick={() => { setTexto(t => t + e); setEmojiOpen(false); inputRef.current?.focus(); }}
                        className="text-xl hover:scale-125 transition-transform">{e}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Textarea */}
            <Textarea
              ref={inputRef}
              value={texto}
              onChange={e => setTexto(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={cfg.placeholder}
              className="flex-1 min-h-[44px] max-h-[140px] text-sm resize-none rounded-2xl border-slate-200 focus:border-indigo-300 focus:ring-indigo-200"
              autoFocus
            />

            {/* Ações do input */}
            <div className="flex items-end gap-1 mb-0.5">
              <button
                onClick={onAnexar}
                disabled={uploadStatus === 'uploading'}
                className={cn(
                  'p-1.5 transition-colors',
                  uploadStatus === 'uploading'
                    ? 'text-blue-400 cursor-wait'
                    : uploadStatus === 'ok'
                      ? 'text-emerald-500'
                      : uploadStatus === 'erro'
                        ? 'text-red-400'
                        : 'text-slate-400 hover:text-slate-700'
                )}
                title="Anexar qualquer arquivo (imagem, vídeo, PDF, áudio, texto, etc.)"
              >
                {uploadStatus === 'uploading'
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Paperclip className="w-4 h-4" />
                }
              </button>
              <button onClick={iniciarGravacao} className="p-1.5 text-slate-400 hover:text-red-500 transition-colors" title="Gravar áudio">
                <Mic className="w-4 h-4" />
              </button>
              <Button
                size="sm"
                onClick={handleSend}
                disabled={acaoLoading || (modo !== 'mari' && !texto.trim())}
                className="rounded-full w-9 h-9 p-0 flex items-center justify-center"
                title={modo === 'mari' && !texto.trim() ? 'Provocar Mari' : 'Enviar'}
              >
                {acaoLoading
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : modo === 'mari' && !texto.trim()
                    ? <Zap className="w-4 h-4" />
                    : <Send className="w-4 h-4" />
                }
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
