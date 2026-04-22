/**
 * validador-reengajamento.js — Guard Rail anti-alucinação B2B
 *
 * Mari opera no nicho de plano de saúde pet (Plamev). Se uma mensagem de
 * reengajamento sair com linguagem de consultoria, B2B, marketing ou vendas
 * corporativas, ela é bloqueada ANTES de chegar no cliente.
 *
 * Caso que motivou (22/04/2026 — Alan):
 *   Mari enviou "Qual seria o maior desafio que você enfrentaria se não
 *   tivesse uma estratégia clara para vender mais neste semestre?" pro tutor
 *   de pet — linguagem completamente fora do nicho.
 */

// Termos que jamais devem aparecer numa mensagem pro tutor. Organizados por
// categoria pra facilitar leitura do log quando bloquear.
const TERMOS_BLOQUEIO = [
  // B2B / corporativo
  { cat: 'B2B',          regex: /\b(b2b|b2c|vendas\s+corporativas?|cliente\s+corporativo|empres[aá]rio|empresa\b|neg[oó]cio\b|neg[oó]cios\b)/i },
  // Estratégia / consultoria
  { cat: 'CONSULTORIA',  regex: /\b(estrat[eé]gia\s+(clara|de\s+vendas|de\s+neg[oó]cio|comercial)|consultoria|consultor\s+de\s+neg[oó]cio|coach|coaching|mentoria)\b/i },
  // Metas / crescimento empresarial
  { cat: 'METAS',        regex: /\b(vender\s+mais\s+(neste|no|este|esse)?\s*(semestre|trimestre|m[eê]s|ano)|bater\s+meta|crescimento\s+de\s+empresa|faturamento|metas\s+corporativas?)\b/i },
  // Perguntas coach genéricas
  { cat: 'COACH',        regex: /\b(qual\s+seria\s+o\s+maior\s+desafio|o\s+que\s+te\s+impede\s+de|se\s+voc[eê]\s+tivesse\s+uma\s+estrat[eé]gia|qual\s+o\s+seu\s+objetivo\s+para\s+\d{4})/i },
  // Marketing digital / B2B pipeline
  { cat: 'MARKETING',    regex: /\b(marketing\s+digital|funil\s+de\s+vendas|lead\s+qualificado|roi|cac|ltv|conversão\s+de\s+leads)\b/i },
];

// Termos que DEVEM aparecer (pelo menos 1) — pra garantir que a mensagem
// está no nicho de pet/saúde. Se zero termos do nicho aparecer e a mensagem
// for longa, é suspeita. Para mensagens muito curtas de saudação, relaxamos.
const TERMOS_NICHO = /\b(pet|peludo|peludinho|gato|gata|gatinho|cachorro|cachorrinho|c[aã]o|cadela|bicho|pata|patinha|tutor|tutora|plamev|plano|cobertura|consulta|vacina|cirurgia|clinica|veterin[aá]ri[oa]|castra[cç][aã]o|sa[uú]de|cuidar|cuidado|lar|familia|prote[cç][aã]o|rede\s+credenciada)\b/i;

/**
 * Valida uma mensagem de reengajamento.
 * Retorna { ok, motivo, categoria, termo } — se ok=false, a mensagem NÃO deve ser enviada.
 */
function validar(texto, { contexto = {} } = {}) {
  if (!texto || typeof texto !== 'string') {
    return { ok: false, motivo: 'vazia', categoria: 'vazio' };
  }
  const t = texto.trim();

  // Termos de bloqueio: detecta e retorna a categoria específica
  for (const { cat, regex } of TERMOS_BLOQUEIO) {
    const match = t.match(regex);
    if (match) {
      return {
        ok: false,
        motivo: `termo fora do nicho detectado`,
        categoria: cat,
        termo: match[0],
      };
    }
  }

  // Nicho: se mensagem tem mais de 80 chars e não tem NADA de pet, suspeita
  if (t.length > 80 && !TERMOS_NICHO.test(t)) {
    return {
      ok: false,
      motivo: 'mensagem longa sem referência ao nicho pet/saúde',
      categoria: 'FORA_NICHO',
    };
  }

  return { ok: true };
}

module.exports = { validar, TERMOS_BLOQUEIO };
