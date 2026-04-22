/**
 * utils/formatters.ts
 * Funções puras de formatação de dados vindos do Evolution API e do BD.
 * Sem dependências externas — testáveis isoladamente.
 */

/**
 * Formata número de telefone para exibição amigável.
 * Ex: 5512997328912 → (12) 99732-8912
 */
export function formatarTelefone(raw: string | null): string {
  if (!raw) return '—';
  const n = raw.replace(/\D/g, '');

  if (n.startsWith('55') && n.length >= 12) {
    const ddd  = n.slice(2, 4);
    const rest = n.slice(4);
    if (rest.length === 9) return `(${ddd}) ${rest.slice(0,5)}-${rest.slice(5)}`;
    if (rest.length === 8) return `(${ddd}) ${rest.slice(0,4)}-${rest.slice(4)}`;
  }
  // JID LID ou número desconhecido — mostrar últimos 8 dígitos
  if (n.length > 11) return `…${n.slice(-8)}`;
  return raw;
}

/**
 * Extrai número limpo de um JID WhatsApp.
 * Ex: 5512997328912@s.whatsapp.net → 5512997328912
 * Ex: 86140048650311@lid → 86140048650311
 */
export function jidParaPhone(jid: string | null): string {
  if (!jid) return '';
  return jid.replace(/@s\.whatsapp\.net$|@lid$|@c\.us$/g, '');
}

/**
 * Retorna nome amigável da instância Evolution.
 */
export function nomeInstancia(instancia: string | null, canal: string): string {
  if (!instancia) return canal === 'telegram' ? '💬 Telegram' : '📱 WhatsApp';
  const mapa: Record<string, string> = {
    'mari-plamev-whatsapp': '📱 Mari 011',
    'mari-plamev-zap2':     '📱 Mari 031',
    'plamev':               '📱 Bella 021',
    'grione':               '📱 Grione',
  };
  return mapa[instancia] || `📱 ${instancia}`;
}

/**
 * Retorna nome amigável do contato com fallback inteligente.
 * Prioridade: nome salvo > pushName > número formatado
 */
export function nomeExibicao(nome: string | null, telefone: string | null): string {
  if (nome && nome !== 'Cliente' && nome.trim().length > 1) return nome.trim();
  if (telefone) return formatarTelefone(telefone);
  return 'Contato';
}

/**
 * Formata tempo relativo para exibição no card.
 * Ex: "2min", "3h", "2d"
 */
export function tempoRelativo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1)    return 'agora';
  if (diff < 60)   return `${diff}min`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h`;
  return `${Math.floor(diff / 1440)}d`;
}

/**
 * Normaliza etapa para exibição.
 */
export function etapaLabel(etapa: string): string {
  const mapa: Record<string, string> = {
    acolhimento:         'Acolhimento',
    qualificacao:        'Qualificação',
    apresentacao_planos: 'Apresentação',
    validacao_cep:       'CEP / Rede',
    negociacao:          'Negociação',
    objecao:             'Objeção',
    pre_fechamento:      'Pré-fechamento',
    fechamento:          'Fechamento',
  };
  return mapa[etapa] || etapa;
}
