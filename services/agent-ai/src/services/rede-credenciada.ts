/**
 * rede-credenciada.ts — Consulta rede credenciada Plamev por CEP via HTTP
 *
 * Retornos:
 *   { status: 'ok',            cep, total, clinicas, texto }
 *   { status: 'sem_cobertura', cep, total: 0, clinicas: [] }
 *   { status: 'erro_servico' }
 *   { status: 'cep_invalido' }
 */

const API_URL = 'https://service.plamev.com.br/Credenciados/BuscarRedeCredenciadaPorLocalidade';
const RAIO = '40';

export interface Clinica {
  nome: string;
  logradouro: string;
  numero: string;
  bairro: string;
  cidade: string;
  estado: string;
  telefone: string;
  distanciaKm: number;
}

export interface RedeResult {
  status: 'ok' | 'sem_cobertura' | 'erro_servico' | 'cep_invalido';
  cep?: string;
  total?: number;
  clinicas?: Clinica[];
  texto?: string;
}

export function normalizarCep(raw: string): string {
  return String(raw).replace(/\D/g, '');
}

export function validarCep(cep: string): boolean {
  return /^\d{8}$/.test(cep) && !/^0{5,}/.test(cep);
}

function nomeDaClinica(item: any): string {
  return (
    item.CredenciadosNomeCredenciado?.trim() ||
    item.IndividuosNomeFantasia?.trim() ||
    item.IndividuosNome?.trim() ||
    'Clínica sem nome'
  );
}

export function normalizarTelefone(ddd: string, tel: string): string {
  return `${ddd || ''}${tel || ''}`.replace(/\D/g, '');
}

export function normalizarDistancia(dist: string | number): number {
  const num = parseFloat(String(dist));
  return isNaN(num) ? 0 : Math.round(num * 10) / 10;
}

// Remove registros que não são clínicas reais:
// 1. Nome da própria Plamev (qualquer variação com "plamev")
// 2. Profissionais individuais: nomes que começam com Dr./Dra./Doutor/Doutora
// 3. Registros com especialidade em parênteses (ex: "Dra. Júlia Corrêa (Pneumologia)")
export function deveExcluir(nome: string): boolean {
  if (!nome) return true;
  if (/plamev/i.test(nome)) return true;
  if (/^(dr\.?\s|dra\.?\s|doutor\s|doutora\s)/i.test(nome)) return true;
  if (/\(.+\)/.test(nome)) return true;
  return false;
}

function mapearClinica(item: any): Clinica {
  return {
    nome: nomeDaClinica(item),
    logradouro: item.IndividuosEnderecosLogradouro || '',
    numero: item.IndividuosEnderecosNumero || '',
    bairro: item.IndividuosEnderecosBairro || '',
    cidade: item.IndividuosEnderecosCidadesNome || '',
    estado: item.IndividuosEnderecosEstadosNome || '',
    telefone: normalizarTelefone(item.IndividuosContatosDdd, item.IndividuosContatosTelefone),
    distanciaKm: normalizarDistancia(item.DistanciaKm || 0),
  };
}

export function formatarResposta(clinicas: Clinica[], total: number): string {
  if (clinicas.length === 0) {
    return 'Não encontrei clínicas credenciadas em um raio de 40 km para esse CEP. Posso te ajudar consultando outro CEP?';
  }

  const top = clinicas.slice(0, 3);
  const linhas: string[] = [
    `Encontrei ${top.length === 1 ? 'essa clínica' : `essas ${top.length} clínicas`} mais próxima${top.length !== 1 ? 's' : ''} ao seu CEP:`,
  ];

  top.forEach((c, i) => {
    linhas.push(`\n${i + 1}. *${c.nome}*`);
    linhas.push(`Endereço: ${[c.logradouro, c.numero, c.bairro, c.cidade].filter(Boolean).join(', ')} - ${c.estado}`);
    if (c.telefone) linhas.push(`Telefone: ${c.telefone}`);
    linhas.push(`Distância: ${c.distanciaKm} km`);
  });

  if (total > 3) {
    const resto = total - 3;
    linhas.push(`\nEncontramos mais ${resto} clínica${resto !== 1 ? 's' : ''} próxima${resto !== 1 ? 's' : ''} ao seu CEP.`);
  }

  return linhas.join('\n');
}

export async function buscarRedeCredenciada(cepRaw: string): Promise<RedeResult> {
  const cep = normalizarCep(cepRaw);
  const t = Date.now();

  if (!validarCep(cep)) {
    return { status: 'cep_invalido' };
  }

  const token = process.env.PLAMEV_SERVICE_AUTHORIZATION_TOKEN;
  if (!token) {
    console.error('[REDE-CREDENCIADA] ❌ PLAMEV_SERVICE_AUTHORIZATION_TOKEN não configurado');
    return { status: 'erro_servico' };
  }

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ Cep: cep, Raio: RAIO }),
      signal: AbortSignal.timeout(12000),
    });

    const duracao = Date.now() - t;

    if (!res.ok) {
      console.error(`[REDE-CREDENCIADA] ❌ API HTTP ${res.status} para CEP ${cep} (${duracao}ms)`);
      return { status: 'erro_servico' };
    }

    let payload: any;
    try { payload = await res.json(); } catch { payload = null; }

    const lista = Array.isArray(payload) ? payload : [];
    console.log(`[REDE-CREDENCIADA] 📍 CEP ${cep}: ${lista.length} clínicas em ${duracao}ms`);

    if (lista.length === 0) {
      return { status: 'sem_cobertura', cep, total: 0, clinicas: [] };
    }

    const ordenadas = [...lista].sort(
      (a, b) => parseFloat(a.DistanciaKm || '0') - parseFloat(b.DistanciaKm || '0'),
    );
    const clinicas = ordenadas
      .map(mapearClinica)
      .filter(c => !deveExcluir(c.nome));

    if (clinicas.length > 0) {
      const removidos = ordenadas.length - clinicas.length;
      if (removidos > 0) console.log(`[REDE-CREDENCIADA] 🔎 ${removidos} registro(s) filtrado(s) (Plamev/médicos/especialistas)`);
    }

    return {
      status: 'ok',
      cep,
      total: clinicas.length,
      clinicas,
      texto: formatarResposta(clinicas, clinicas.length),
    };
  } catch (e: any) {
    const duracao = Date.now() - t;
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      console.error(`[REDE-CREDENCIADA] ⏱️ Timeout para CEP ${cep} (${duracao}ms)`);
    } else {
      console.error(`[REDE-CREDENCIADA] ❌ Erro para CEP ${cep} (${duracao}ms):`, e.message);
    }
    return { status: 'erro_servico' };
  }
}

// Compatibilidade com processor.ts e supervisor.ts (mantém contrato do cep.ts antigo)
export async function buscarClinicas(cepRaw: string): Promise<{
  status: string;
  texto?: string;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
}> {
  const result = await buscarRedeCredenciada(cepRaw);
  if (result.status === 'ok') return { status: 'ok', texto: result.texto };
  if (result.status === 'sem_cobertura') return { status: 'sem_cobertura', bairro: null, cidade: null, uf: null };
  return { status: result.status };
}
