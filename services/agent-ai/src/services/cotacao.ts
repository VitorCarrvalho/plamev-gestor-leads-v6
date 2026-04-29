/**
 * cotacao.ts — Skill de cotação Plamev
 *
 * Fluxo:
 *   1. buscarEstados()                          → UF disponíveis
 *   2. buscarCoberturas(estadoUUID)             → planos + preços + IDs
 *   3. buscarRacas(especie)                     → raças por espécie (cache pesado)
 *   4. buscarEnderecoPorCep(cep)               → ViaCEP (sem auth)
 *   5. submeterCotacao(payload)                → POST final
 */

const BASE_URL = 'https://service.plamev.com.br';
const VIACEP_URL = 'https://viacep.com.br/ws';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

function token(): string {
  const t = process.env.PLAMEV_API_TOKEN;
  if (!t) throw new Error('PLAMEV_API_TOKEN não configurado');
  return t;
}

async function plamevGet(path: string, timeout = 10000): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: token(), Accept: 'application/json' },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`Plamev API ${path}: HTTP ${res.status}`);
  return res.json() as Promise<any>;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface Estado {
  id: string;   // UUID → usar em buscarCoberturas
  nome: string;
  uf: string;   // 2 letras → usar como EstadosId no POST
}

export interface Cobertura {
  id: string;   // UUID → CoberturasId no POST
  nome: string;
  valor: number;
  ordem: number;
}

export interface Raca {
  id: string;
  nome: string;
}

export interface Endereco {
  cep: string;
  logradouro: string;
  bairro: string;
  cidade: string;
  uf: string;     // 2 letras
  cidadeUpper: string; // "SAO PAULO" — para CidadesId no POST
}

export interface PetCotacao {
  nome: string;
  dataNascimento: string;   // DD/MM/YYYY
  sexo: 'Macho' | 'Fêmea';
  especie: '1' | '2';       // '1'=Felino, '2'=Canino
  racasId: string;          // UUID ou 'SEMRACA1'/'SEMRACA2'
  coberturasId: string;     // UUID de Coberturas
}

export interface CotacaoPayload {
  nome: string;
  email: string;
  ddd: string;        // exatamente 2 dígitos
  telefone: string;   // dígitos, sem DDD
  cep: string;        // 8 dígitos
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  estadosId: string;  // UF (2 letras) — NÃO o UUID
  cidadesId: string;  // nome em maiúsculas
  formaPagamento: 1 | 2; // 1=Cartão, 2=Boleto
  cupomDesconto: string;
  pets: PetCotacao[];
}

export interface CotacaoResultItem {
  nome: string;
  valor: number;
}

export interface CotacaoResult {
  numeroCotacao: string;
  dataFidelidade: string;
  valorAdesao: number;
  valorTotalMensalidade: number;
  composicaoMensalidade: CotacaoResultItem[];
  composicaoAdesao: CotacaoResultItem[];
  descontos: CotacaoResultItem[];
}

export interface ValidationError {
  campo: string;
  mensagem: string;
}

// ── Caches ────────────────────────────────────────────────────────────────

let _estadosCache: { at: number; data: Estado[] } | null = null;
const _coberturasCache = new Map<string, { at: number; data: Cobertura[] }>();
const _racasCache = new Map<string, { at: number; data: Raca[] }>();

function isFresh(at: number) { return Date.now() - at < CACHE_TTL_MS; }

// ── Normalização defensiva ────────────────────────────────────────────────

export function normalizarEstados(raw: any): Estado[] {
  const lista = Array.isArray(raw) ? raw : Object.values(raw ?? {});
  return lista
    .filter((e: any) => e?.Id && e?.UF)
    .map((e: any) => ({ id: e.Id, nome: e.Nome || e.UF, uf: e.UF }));
}

export function normalizarCoberturas(raw: any): Cobertura[] {
  const lista = raw?.Coberturas ?? raw;
  const arr = Array.isArray(lista) ? lista : Object.values(lista ?? {});
  return arr
    .filter((c: any) => c?.Id)
    .map((c: any) => ({
      id: c.Id,
      nome: c.Nome ?? c.TiposCoberturasNome ?? c.CoberturasNome ?? 'Plano',
      valor: parseFloat(c.Valor ?? c.ValorMensalidade ?? 0),
      ordem: parseInt(c.Ordem ?? '99', 10),
    }))
    .sort((a, b) => a.ordem - b.ordem);
}

export function normalizarRacas(raw: any): Raca[] {
  const lista = Array.isArray(raw) ? raw : Object.values(raw ?? {});
  return lista.filter((r: any) => r?.Id).map((r: any) => ({ id: r.Id, nome: r.Nome || '' }));
}

export function normalizarCidade(cidade: string): string {
  return cidade
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim();
}

export function extrairDdd(telefone: string): { ddd: string; numero: string } {
  const digits = telefone.replace(/\D/g, '');
  if (digits.length >= 10) {
    return { ddd: digits.slice(0, 2), numero: digits.slice(2) };
  }
  return { ddd: '', numero: digits };
}

export function formatarDataNascimento(input: string): string | null {
  // Aceita: DD/MM/YYYY ou YYYY-MM-DD
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(input)) return input;
  const m = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return null;
}

// ── Endpoints ─────────────────────────────────────────────────────────────

export async function buscarEstados(): Promise<Estado[]> {
  if (_estadosCache && isFresh(_estadosCache.at)) return _estadosCache.data;
  const raw = await plamevGet('/Estados/Consultar');
  const data = normalizarEstados(raw);
  _estadosCache = { at: Date.now(), data };
  console.log(`[COTACAO] ✅ Estados carregados: ${data.length}`);
  return data;
}

export async function buscarCoberturas(estadoUuid: string): Promise<Cobertura[]> {
  const cached = _coberturasCache.get(estadoUuid);
  if (cached && isFresh(cached.at)) return cached.data;
  const raw = await plamevGet(
    `/Coberturas/BuscarCoberturasComPreco?EstadosId=${encodeURIComponent(estadoUuid)}&Valores=true&order=Ordem`,
  );
  const data = normalizarCoberturas(raw);
  _coberturasCache.set(estadoUuid, { at: Date.now(), data });
  console.log(`[COTACAO] ✅ Coberturas para ${estadoUuid}: ${data.length} planos`);
  return data;
}

export async function buscarCoberturasParaUF(uf: string): Promise<Cobertura[]> {
  const estados = await buscarEstados();
  const estado = estados.find(e => e.uf === uf.toUpperCase());
  if (!estado) throw new Error(`UF não encontrada: ${uf}`);
  return buscarCoberturas(estado.id);
}

export async function buscarRacas(especie: '1' | '2'): Promise<Raca[]> {
  const cached = _racasCache.get(especie);
  if (cached && isFresh(cached.at)) return cached.data;
  const raw = await plamevGet(`/Racas/consultar?Especie=${especie}&Authorization=qtest`);
  const data = normalizarRacas(raw);
  _racasCache.set(especie, { at: Date.now(), data });
  console.log(`[COTACAO] ✅ Raças especie=${especie}: ${data.length}`);
  return data;
}

export async function encontrarRacaPorNome(nome: string, especie: '1' | '2'): Promise<Raca | null> {
  if (!nome?.trim()) return null;
  const racas = await buscarRacas(especie);
  const normalizado = nome.trim().toLowerCase();
  return racas.find(r => r.nome.toLowerCase().includes(normalizado)) ?? null;
}

export async function buscarEnderecoPorCep(cep: string): Promise<Endereco | null> {
  const digits = cep.replace(/\D/g, '');
  if (digits.length !== 8) return null;
  try {
    const res = await fetch(`${VIACEP_URL}/${digits}/json/`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const d: any = await res.json();
    if (d?.erro) return null;
    return {
      cep: digits,
      logradouro: d.logradouro || '',
      bairro: d.bairro || '',
      cidade: d.localidade || '',
      uf: d.uf || '',
      cidadeUpper: normalizarCidade(d.localidade || ''),
    };
  } catch {
    return null;
  }
}

// ── Validação ─────────────────────────────────────────────────────────────

export function validarPayload(p: CotacaoPayload): ValidationError[] {
  const erros: ValidationError[] = [];
  const req = (campo: string, valor: any, label = campo) => {
    if (!valor || String(valor).trim() === '') erros.push({ campo, mensagem: `${label} é obrigatório` });
  };

  req('nome', p.nome, 'Nome');
  req('email', p.email, 'E-mail');
  if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email))
    erros.push({ campo: 'email', mensagem: 'E-mail inválido' });

  if (!/^\d{2}$/.test(p.ddd))
    erros.push({ campo: 'ddd', mensagem: 'DDD deve ter exatamente 2 dígitos' });
  if (!/^\d{8,9}$/.test(p.telefone))
    erros.push({ campo: 'telefone', mensagem: 'Telefone deve ter 8 ou 9 dígitos (sem DDD)' });
  if (!/^\d{8}$/.test(p.cep))
    erros.push({ campo: 'cep', mensagem: 'CEP deve ter 8 dígitos' });

  req('logradouro', p.logradouro, 'Logradouro');
  req('numero', p.numero, 'Número');
  req('bairro', p.bairro, 'Bairro');
  req('estadosId', p.estadosId, 'Estado (UF)');
  if (p.estadosId && !/^[A-Z]{2}$/.test(p.estadosId))
    erros.push({ campo: 'estadosId', mensagem: 'EstadosId deve ser a UF de 2 letras (ex: SP)' });
  req('cidadesId', p.cidadesId, 'Cidade');

  if (!p.pets?.length)
    erros.push({ campo: 'pets', mensagem: 'Pelo menos um pet é obrigatório' });

  p.pets?.forEach((pet, i) => {
    const prefix = `pets[${i}]`;
    if (!pet.nome) erros.push({ campo: `${prefix}.nome`, mensagem: `Nome do pet ${i + 1} é obrigatório` });
    if (!pet.dataNascimento || !/^\d{2}\/\d{2}\/\d{4}$/.test(pet.dataNascimento))
      erros.push({ campo: `${prefix}.dataNascimento`, mensagem: `Data de nascimento do pet ${i + 1} deve ser DD/MM/YYYY` });
    if (!['Macho', 'Fêmea'].includes(pet.sexo))
      erros.push({ campo: `${prefix}.sexo`, mensagem: `Sexo do pet ${i + 1} deve ser "Macho" ou "Fêmea"` });
    if (!['1', '2'].includes(pet.especie))
      erros.push({ campo: `${prefix}.especie`, mensagem: `Espécie do pet ${i + 1} deve ser "1" (felino) ou "2" (canino)` });
    if (!pet.coberturasId)
      erros.push({ campo: `${prefix}.coberturasId`, mensagem: `Plano do pet ${i + 1} é obrigatório` });
    if (!pet.racasId)
      erros.push({ campo: `${prefix}.racasId`, mensagem: `Raça do pet ${i + 1} é obrigatória` });
  });

  return erros;
}

// ── Submissão ─────────────────────────────────────────────────────────────

export async function submeterCotacao(payload: CotacaoPayload): Promise<CotacaoResult> {
  const erros = validarPayload(payload);
  if (erros.length) throw Object.assign(new Error('Payload inválido'), { erros });

  const body = {
    ConsultoresId: process.env.PLAMEV_CONSULTORES_ID || 'alefcavalcante',
    CupomDesconto: payload.cupomDesconto || '',
    Nome: payload.nome,
    Email: payload.email,
    Ddd: payload.ddd,
    Telefone: payload.telefone,
    Site: 1,
    CotacoesOrigensId: 1,
    FormaPagamento: payload.formaPagamento,
    Cep: payload.cep,
    Logradouro: payload.logradouro,
    Numero: payload.numero,
    Complemento: payload.complemento || '',
    Bairro: payload.bairro,
    EstadosId: payload.estadosId,
    CidadesId: payload.cidadesId,
    CotacoesPets: payload.pets.map(pet => ({
      Nome: pet.nome,
      DataNascimento: pet.dataNascimento,
      Sexo: pet.sexo,
      Especie: pet.especie,
      RacasId: pet.racasId,
      CoberturasId: pet.coberturasId,
    })),
  };

  const t = Date.now();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/Cotacoes/SolicitaCotacaoPet`, {
        method: 'POST',
        headers: {
          Authorization: token(),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });

      const data: any = await res.json().catch(() => null);

      if (!res.ok) {
        const msg = data?.Mensagem || data?.Message || `HTTP ${res.status}`;
        if (res.status < 500) throw Object.assign(new Error(msg), { status: res.status, data });
        throw new Error(msg);
      }

      const duracao = Date.now() - t;
      const result: CotacaoResult = {
        numeroCotacao: data.NumeroCotacao,
        dataFidelidade: data.DataFidelidade,
        valorAdesao: data.ValorAdesao ?? 0,
        valorTotalMensalidade: data.ValorTotalMensalidade ?? 0,
        composicaoMensalidade: (data.ComposicaoMensalidade ?? []).map((i: any) => ({ nome: i.Nome, valor: i.Valor })),
        composicaoAdesao: (data.ComposicaoAdesao ?? []).map((i: any) => ({ nome: i.Nome, valor: i.Valor })),
        descontos: (data.Descontos ?? []).map((i: any) => ({ nome: i.Nome, valor: i.Valor })),
      };

      console.log(`[COTACAO] ✅ Cotação ${result.numeroCotacao} — R$${result.valorTotalMensalidade}/mês (${duracao}ms)`);
      return result;
    } catch (e: any) {
      lastError = e;
      if (e.status && e.status < 500) throw e; // 4xx: não retry
      if (attempt < 3) await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }

  console.error('[COTACAO] ❌ Falha após 3 tentativas:', lastError?.message);
  throw lastError!;
}

// ── Formatação para sistema prompt ─────────────────────────────────────────

export function formatarCoberturasParaPrompt(coberturas: Cobertura[], uf: string): string {
  if (!coberturas.length) return '';
  const linhas = [
    `Planos disponíveis para ${uf} (valores mensais):`,
    ...coberturas.map(c =>
      `- ${c.nome}: R$${c.valor.toFixed(2).replace('.', ',')} [cobertura_id:${c.id}]`
    ),
    '',
    'Ao confirmar o plano com o cliente, extraia o cobertura_id correspondente em dados_extraidos.',
  ];
  return linhas.join('\n');
}
