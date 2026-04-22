/**
 * types/index.ts
 * Tipos compartilhados entre todas as camadas do dashboard.
 * Fonte única de verdade para as entidades do domínio.
 */

// ── Agente ────────────────────────────────────────────────────
export interface Agente {
  id: number;
  slug: string;
  nome: string;
  obsidian_path: string;
  modelo_negociacao: string;
  ativo: boolean;
}

// ── Cliente ───────────────────────────────────────────────────
export interface Cliente {
  id: string;          // UUID
  nome: string | null;
  origem: string | null;
  criado_em: string;
}

export interface PerfilPet {
  nome_pet: string | null;
  especie: string | null;
  raca: string | null;
  idade_anos: number | null;
  sexo: string | null;
  castrado: boolean | null;
  problema_saude: string | null;
  cep: string | null;
  cidade: string | null;
  estado: string | null;
  email: string | null;
  cpf: string | null;
}

// ── Conversa ──────────────────────────────────────────────────
export type StatusConversa = 'ativa' | 'pausada' | 'encerrada' | 'transferida';
export type EtapaConversa  = 
  | 'acolhimento' | 'qualificacao' | 'apresentacao_planos'
  | 'validacao_cep' | 'negociacao' | 'objecao'
  | 'pre_fechamento' | 'fechamento';

export interface Conversa {
  id: string;          // UUID
  client_id: string;
  agent_id: number;
  canal: 'whatsapp' | 'telegram';
  numero_externo: string;
  jid: string | null;
  sender_chip: string | null;
  instancia_whatsapp: string | null;
  numero_cotacao: string | null;
  etapa: EtapaConversa;
  status: StatusConversa;
  ia_silenciada: boolean;
  score: number;
  resumo_conversa: string | null;
  criado_em: string;
  ultima_interacao: string;
  // Joins
  cliente_nome: string | null;
  agente_slug: string | null;
  agente_nome: string | null;
  chip: string | null;           // nome amigável da instância
}

// ── Mensagem ──────────────────────────────────────────────────
export type RoleMensagem = 'user' | 'agent' | 'supervisor' | 'system';
export type EnviadoPor   = 'ia' | 'humano' | 'supervisora';

export interface Mensagem {
  id: string;
  conversa_id: string;
  role: RoleMensagem;
  conteudo: string;
  enviado_por: EnviadoPor;
  timestamp: string;
}

// ── Card de contato (visão da lista) ──────────────────────────
export interface ContatoCard {
  conversa_id: string;
  client_id: string;
  nome_exibicao: string;        // nome limpo e amigável
  telefone_formatado: string;   // ex: (12) 99732-8912
  numero_origem: string;        // número bruto / JID
  chip: string;                 // Mari 011, Mari 031...
  agente_nome: string;
  etapa: EtapaConversa;
  status: StatusConversa;
  ia_silenciada: boolean;
  ultima_interacao: string;
  nova_mensagem: boolean;       // badge de não lido
  nome_pet: string | null;
  especie_pet: string | null;
}

// ── Stats do header ───────────────────────────────────────────
export interface DashboardStats {
  clientes_hoje: number;
  msgs_hoje: number;
  custo_hoje: string;
  custo_mes: string;
  conversas_ativas: number;
  // Métricas mensais (adicionadas na correção V5)
  clientes_mes: number;
  msgs_mes: number;
  fechamentos_mes: number;
  fechamentos_fonte?: 'lead_proposals' | 'etapa_proxy' | 'etapa_venda_fechada_pago';
}

// ── Eventos Socket ────────────────────────────────────────────
export interface EventoNovaMensagem {
  conversa_id: string;
  phone: string;
  nome: string;
  msg_cliente: string | null;
  msg_mari: string | null;
  msg_supervisor: string | null;
  timestamp: string;
}

// ── Payload de ação operacional ───────────────────────────────
export interface PayloadInstrucao {
  conversa_id: string;
  texto: string;
}

export interface PayloadTransferir {
  conversa_id: string;
  agent_slug: string;
}
