// Mantemos o mesmo comportamento operacional atual do CRM:
// preview de reescrita faz fallback para o texto original.
export async function reescreverComoMari(
  _conversaId: string,
  texto: string,
  _instrucao?: string,
): Promise<string> {
  return texto;
}
