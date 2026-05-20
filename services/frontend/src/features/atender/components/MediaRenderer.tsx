import React, { useState } from 'react';
import {
  FileText, Image as ImageIcon, FileAudio, FileVideo, Download,
  MapPin, User, X, FileCode, FileSpreadsheet, Presentation,
  File, Music,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Formata markdown básico do WhatsApp: *bold*, _italic_, ~strike~, `code`
function formatWhatsApp(text: string): React.ReactNode[] {
  const parts = text.split(/(\*[^*]+\*|_[^_]+_|~[^~]+~|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (/^\*[^*]+\*$/.test(part)) return <strong key={i}>{part.slice(1, -1)}</strong>;
    if (/^_[^_]+_$/.test(part))   return <em key={i}>{part.slice(1, -1)}</em>;
    if (/^~[^~]+~$/.test(part))   return <s key={i}>{part.slice(1, -1)}</s>;
    if (/^`[^`]+`$/.test(part))   return <code key={i} className="bg-black/10 px-1 rounded text-[11px] font-mono">{part.slice(1, -1)}</code>;
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

// Detecta markers de texto produzidos pelo pipeline Mari
function detectarMarker(conteudo: string): { tipo: 'pdf' | 'imagem' | 'audio'; rotulo: string } | null {
  if (!conteudo) return null;
  const mPdf = conteudo.match(/^\[(?:📋|📄)\s*PDF\s+([^\]]+?)\s+enviad[oa]\]$/i);
  if (mPdf) return { tipo: 'pdf', rotulo: `Manual ${mPdf[1].replace(/_/g, ' ')}` };
  const mImg = conteudo.match(/^\[(?:🖼️|🖼|📷)\s*imagem\s+([^\]]+?)(?:\s+enviad[oa])?\]$/i);
  if (mImg) return { tipo: 'imagem', rotulo: mImg[1] };
  const mAud = conteudo.match(/^\[(?:🎵|🎙️)\s*[áa]udio\s+([^\]]+?)(?:\s+enviad[oa])?\]$/i);
  if (mAud) return { tipo: 'audio', rotulo: mAud[1] };
  return null;
}

// Ícone e cor por tipo de arquivo
function fileIcon(mimeType: string, fileName?: string): { Icon: React.ElementType; color: string; label: string } {
  const mime = mimeType?.toLowerCase() || '';
  const ext = (fileName?.split('.').pop() || '').toLowerCase();

  if (mime === 'application/pdf' || ext === 'pdf')
    return { Icon: FileText, color: 'text-red-500', label: 'PDF' };
  if (mime.includes('word') || ext === 'doc' || ext === 'docx')
    return { Icon: FileText, color: 'text-blue-500', label: 'Word' };
  if (mime.includes('sheet') || mime.includes('excel') || ext === 'xls' || ext === 'xlsx' || ext === 'csv')
    return { Icon: FileSpreadsheet, color: 'text-emerald-500', label: 'Planilha' };
  if (mime.includes('presentation') || mime.includes('powerpoint') || ext === 'ppt' || ext === 'pptx')
    return { Icon: Presentation, color: 'text-orange-500', label: 'Apresentação' };
  if (mime.startsWith('text/') || ext === 'txt' || ext === 'md' || ext === 'csv' || ext === 'json' || ext === 'xml')
    return { Icon: FileCode, color: 'text-slate-500', label: ext.toUpperCase() || 'Texto' };
  if (mime.startsWith('audio/') || ext === 'mp3' || ext === 'wav' || ext === 'm4a' || ext === 'ogg')
    return { Icon: Music, color: 'text-purple-500', label: 'Áudio' };
  if (mime.startsWith('video/') || ext === 'mp4' || ext === 'mov' || ext === 'avi' || ext === 'mkv')
    return { Icon: FileVideo, color: 'text-pink-500', label: 'Vídeo' };
  if (mime.startsWith('image/'))
    return { Icon: ImageIcon, color: 'text-teal-500', label: 'Imagem' };
  return { Icon: File, color: 'text-slate-400', label: 'Arquivo' };
}

interface MediaRendererProps {
  conteudo: string;
  metadata?: any;
  ehCliente: boolean;
}

export const MediaRenderer: React.FC<MediaRendererProps> = ({ conteudo, metadata, ehCliente }) => {
  const [lightbox, setLightbox] = useState<string | null>(null);

  const bubble = ehCliente
    ? { bg: 'bg-indigo-500/20 border-indigo-300/40', icon: 'bg-white/20', text: 'text-white', sub: 'text-indigo-100' }
    : { bg: 'bg-slate-50 border-slate-200', icon: 'bg-indigo-100 text-indigo-600', text: 'text-slate-800', sub: 'text-slate-500' };

  // ── 1. Imagem em base64 ────────────────────────────────────────
  if (metadata?.mediaType === 'image' && metadata?.mediaBase64) {
    const src = `data:${metadata.mimeType || 'image/jpeg'};base64,${metadata.mediaBase64}`;
    return (
      <>
        <div className="rounded-lg overflow-hidden max-w-[240px] cursor-pointer" onClick={() => setLightbox(src)}>
          <img src={src} alt="imagem" className="w-full object-cover" />
          {conteudo && !conteudo.startsWith('[') && (
            <div className={cn('text-sm px-2 py-1', ehCliente ? 'text-white' : 'text-slate-700')}>{conteudo}</div>
          )}
        </div>
        {lightbox && (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center" onClick={() => setLightbox(null)}>
            <button className="absolute top-4 right-4 text-white"><X className="w-6 h-6" /></button>
            <img src={lightbox} alt="imagem ampliada" className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg" />
          </div>
        )}
      </>
    );
  }

  // ── 2. Áudio em base64 ─────────────────────────────────────────
  if ((metadata?.mediaType === 'audio' || metadata?.mediaType === 'ptt') && metadata?.mediaBase64) {
    const src = `data:${metadata.mimeType || 'audio/ogg'};base64,${metadata.mediaBase64}`;
    return (
      <div className={cn('flex items-center gap-2 px-3 py-2 rounded-lg border', bubble.bg)}>
        <FileAudio className={cn('w-5 h-5 flex-shrink-0', ehCliente ? 'text-indigo-200' : 'text-indigo-500')} />
        <audio controls src={src} className="h-8 flex-1 min-w-[160px]" />
      </div>
    );
  }

  // ── 3. Vídeo em base64 ─────────────────────────────────────────
  if (metadata?.mediaType === 'video' && metadata?.mediaBase64) {
    const src = `data:${metadata.mimeType || 'video/mp4'};base64,${metadata.mediaBase64}`;
    return (
      <div className="rounded-lg overflow-hidden max-w-[280px]">
        <video controls src={src} className="w-full" />
        {conteudo && !conteudo.startsWith('[') && (
          <div className={cn('text-sm px-2 py-1', ehCliente ? 'text-white' : 'text-slate-700')}>{conteudo}</div>
        )}
      </div>
    );
  }

  // ── 4. Documento / arquivo (qualquer tipo não-mídia) ───────────
  if (metadata?.mediaType === 'document' && metadata?.fileName) {
    const { Icon, color, label } = fileIcon(metadata.mimeType || '', metadata.fileName);
    return (
      <div className={cn('flex items-center gap-2 px-3 py-2 rounded-lg border max-w-[280px]', bubble.bg)}>
        <div className={cn('flex items-center justify-center w-9 h-9 rounded-md flex-shrink-0', bubble.icon)}>
          <Icon className={cn('w-5 h-5', color)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className={cn('text-xs font-medium truncate', bubble.text)}>{metadata.fileName}</div>
          <div className={cn('text-[10px]', bubble.sub)}>{label}</div>
        </div>
        {metadata.mediaBase64 && (
          <a
            href={`data:${metadata.mimeType || 'application/octet-stream'};base64,${metadata.mediaBase64}`}
            download={metadata.fileName}
            className={cn('shrink-0 p-1 rounded hover:bg-black/10 transition-colors', ehCliente ? 'text-indigo-100 hover:text-white' : 'text-slate-400 hover:text-slate-700')}
            title="Baixar arquivo"
          >
            <Download className="w-4 h-4" />
          </a>
        )}
      </div>
    );
  }

  // ── 5. Sticker ─────────────────────────────────────────────────
  if (metadata?.mediaType === 'sticker' && metadata?.mediaBase64) {
    const src = `data:image/webp;base64,${metadata.mediaBase64}`;
    return <img src={src} alt="sticker" className="w-28 h-28 object-contain" />;
  }

  // ── 6. Localização ─────────────────────────────────────────────
  if (metadata?.mediaType === 'location') {
    const { lat, lon, name } = metadata;
    const url = `https://maps.google.com?q=${lat},${lon}`;
    return (
      <a href={url} target="_blank" rel="noopener noreferrer"
        className={cn('flex items-center gap-2 px-3 py-2 rounded-lg border', bubble.bg)}>
        <MapPin className={cn('w-4 h-4 flex-shrink-0', ehCliente ? 'text-indigo-200' : 'text-indigo-500')} />
        <div>
          <div className={cn('text-xs font-medium', bubble.text)}>{name || 'Ver no mapa'}</div>
          <div className={cn('text-[10px]', bubble.sub)}>{lat}, {lon}</div>
        </div>
      </a>
    );
  }

  // ── 7. Contato ─────────────────────────────────────────────────
  if (metadata?.mediaType === 'contact') {
    return (
      <div className={cn('flex items-center gap-2 px-3 py-2 rounded-lg border', bubble.bg)}>
        <User className={cn('w-4 h-4 flex-shrink-0', ehCliente ? 'text-indigo-200' : 'text-indigo-500')} />
        <div>
          <div className={cn('text-xs font-medium', bubble.text)}>{metadata.contactName || 'Contato'}</div>
          {metadata.contactPhone && <div className={cn('text-[10px]', bubble.sub)}>{metadata.contactPhone}</div>}
        </div>
      </div>
    );
  }

  // ── 8. Markers de texto legados ([📋 PDF ...], etc.) ──────────
  const marker = detectarMarker(conteudo);
  if (marker) {
    const Icone = marker.tipo === 'pdf' ? FileText : marker.tipo === 'imagem' ? ImageIcon : FileAudio;
    return (
      <div className={cn('flex items-center gap-2 px-3 py-2 rounded-lg border', bubble.bg)}>
        <div className={cn('flex items-center justify-center w-8 h-8 rounded-md flex-shrink-0', bubble.icon)}>
          <Icone className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className={cn('text-xs font-medium truncate', bubble.text)}>{marker.rotulo}</div>
          <div className={cn('text-[10px]', bubble.sub)}>
            {marker.tipo === 'pdf' ? 'Documento PDF' : marker.tipo === 'imagem' ? 'Imagem' : 'Áudio'} · enviado pelo WhatsApp
          </div>
        </div>
      </div>
    );
  }

  // ── 9. Texto simples com formatação WhatsApp ───────────────────
  return (
    <div className="whitespace-pre-wrap break-words leading-relaxed text-sm">
      {formatWhatsApp(conteudo || '')}
    </div>
  );
};
