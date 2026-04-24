export async function gravar(params: {
  ator_email?: string;
  ator_ip?: string;
  acao: string;
  alvo_tipo?: string;
  alvo_id?: string | null;
  detalhe?: object;
}): Promise<void> {
  console.log('[AUDIT]', JSON.stringify(params));
}
