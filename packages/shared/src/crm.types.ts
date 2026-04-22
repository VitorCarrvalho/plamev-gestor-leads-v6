export interface Organization {
  id: string;
  slug: string;
  nome: string;
  ativo: boolean;
}

export interface Cliente {
  id: string;
  org_id: string;
  nome?: string;
  telefone: string;
  criado_em: Date;
}

export interface PerfilPet {
  id: string;
  client_id: string;
  org_id: string;
  nome?: string;
  especie?: string;
  raca?: string;
  idade_anos?: number;
  cep?: string;
  cpf?: string;
  email?: string;
}

export interface Conversa {
  id: string;
  client_id: string;
  agent_id: string;
  org_id: string;
  canal: string;
  numero_externo: string;
  jid?: string;
  instancia?: string;
  etapa: string;
  score: number;
  ia_silenciada: boolean;
  plano_recomendado?: string;
}
