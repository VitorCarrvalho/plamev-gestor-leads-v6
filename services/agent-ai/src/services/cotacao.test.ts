import {
  normalizarEstados,
  normalizarCoberturas,
  normalizarRacas,
  normalizarCidade,
  extrairDdd,
  formatarDataNascimento,
  validarPayload,
  formatarCoberturasParaPrompt,
  type CotacaoPayload,
  type Cobertura,
} from './cotacao';

// ── normalizarEstados ────────────────────────────────────────────────────────

describe('normalizarEstados', () => {
  it('normaliza array de estados', () => {
    const raw = [{ Id: 'uuid1', Nome: 'São Paulo', UF: 'SP' }];
    const r = normalizarEstados(raw);
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual({ id: 'uuid1', nome: 'São Paulo', uf: 'SP' });
  });

  it('normaliza objeto de objetos (shape alternativo)', () => {
    const raw = { 0: { Id: 'uuid1', Nome: 'MG', UF: 'MG' } };
    const r = normalizarEstados(raw);
    expect(r).toHaveLength(1);
    expect(r[0].uf).toBe('MG');
  });

  it('filtra entradas sem Id ou UF', () => {
    const raw = [{ Id: 'uuid1', UF: 'SP' }, { Nome: 'Sem Id' }, null];
    const r = normalizarEstados(raw);
    expect(r).toHaveLength(1);
  });

  it('retorna array vazio para payload nulo', () => {
    expect(normalizarEstados(null)).toHaveLength(0);
  });
});

// ── normalizarCoberturas ─────────────────────────────────────────────────────

describe('normalizarCoberturas', () => {
  it('extrai do wrapper Coberturas', () => {
    const raw = { Coberturas: [{ Id: 'c1', Nome: 'Slim', Valor: 89.9, Ordem: 1 }] };
    const r = normalizarCoberturas(raw);
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual({ id: 'c1', nome: 'Slim', valor: 89.9, ordem: 1 });
  });

  it('usa TiposCoberturasNome como fallback de nome', () => {
    const raw = { Coberturas: [{ Id: 'c2', TiposCoberturasNome: 'Advance', Valor: 129.9, Ordem: 2 }] };
    const r = normalizarCoberturas(raw);
    expect(r[0].nome).toBe('Advance');
  });

  it('ordena por Ordem', () => {
    const raw = { Coberturas: [
      { Id: 'c3', Nome: 'Platinum', Valor: 200, Ordem: 3 },
      { Id: 'c1', Nome: 'Slim', Valor: 89, Ordem: 1 },
    ]};
    const r = normalizarCoberturas(raw);
    expect(r[0].nome).toBe('Slim');
    expect(r[1].nome).toBe('Platinum');
  });

  it('aceita array direto (sem wrapper)', () => {
    const raw = [{ Id: 'c1', Nome: 'Slim', Valor: 89.9, Ordem: 1 }];
    const r = normalizarCoberturas(raw);
    expect(r).toHaveLength(1);
  });

  it('retorna array vazio para payload vazio', () => {
    expect(normalizarCoberturas({})).toHaveLength(0);
  });
});

// ── normalizarRacas ──────────────────────────────────────────────────────────

describe('normalizarRacas', () => {
  it('normaliza lista de raças', () => {
    const raw = [{ Id: 'r1', Nome: 'Golden Retriever' }];
    const r = normalizarRacas(raw);
    expect(r[0]).toEqual({ id: 'r1', nome: 'Golden Retriever' });
  });

  it('filtra entradas sem Id', () => {
    const raw = [{ Id: 'r1', Nome: 'A' }, { Nome: 'Sem Id' }];
    expect(normalizarRacas(raw)).toHaveLength(1);
  });
});

// ── normalizarCidade ─────────────────────────────────────────────────────────

describe('normalizarCidade', () => {
  it('converte para maiúsculas', () => expect(normalizarCidade('São Paulo')).toBe('SAO PAULO'));
  it('remove acentos', () => expect(normalizarCidade('Goiânia')).toBe('GOIANIA'));
  it('remove cedilha', () => expect(normalizarCidade('Açaí')).toBe('ACAI'));
  it('trimma espaços', () => expect(normalizarCidade('  Recife  ')).toBe('RECIFE'));
});

// ── extrairDdd ───────────────────────────────────────────────────────────────

describe('extrairDdd', () => {
  it('extrai DDD de número com 11 dígitos', () => {
    const r = extrairDdd('11999998888');
    expect(r).toEqual({ ddd: '11', numero: '999998888' });
  });

  it('extrai DDD de número com 10 dígitos', () => {
    const r = extrairDdd('1199998888');
    expect(r).toEqual({ ddd: '11', numero: '99998888' });
  });

  it('remove máscara antes de extrair', () => {
    const r = extrairDdd('(31) 9 8465-1788');
    expect(r.ddd).toBe('31');
    expect(r.numero).toBe('984651788');
  });

  it('retorna ddd vazio para número com menos de 10 dígitos', () => {
    const r = extrairDdd('98888');
    expect(r.ddd).toBe('');
  });
});

// ── formatarDataNascimento ───────────────────────────────────────────────────

describe('formatarDataNascimento', () => {
  it('aceita DD/MM/YYYY sem alteração', () => {
    expect(formatarDataNascimento('15/03/2020')).toBe('15/03/2020');
  });

  it('converte YYYY-MM-DD para DD/MM/YYYY', () => {
    expect(formatarDataNascimento('2020-03-15')).toBe('15/03/2020');
  });

  it('retorna null para formato inválido', () => {
    expect(formatarDataNascimento('15-03-2020')).toBeNull();
    expect(formatarDataNascimento('2020/03/15')).toBeNull();
    expect(formatarDataNascimento('abc')).toBeNull();
  });
});

// ── validarPayload ───────────────────────────────────────────────────────────

const payloadValido: CotacaoPayload = {
  nome: 'Maria Silva',
  email: 'maria@example.com',
  ddd: '11',
  telefone: '999998888',
  cep: '01310100',
  logradouro: 'Avenida Paulista',
  numero: '1000',
  complemento: '',
  bairro: 'Bela Vista',
  estadosId: 'SP',
  cidadesId: 'SAO PAULO',
  formaPagamento: 1,
  cupomDesconto: '',
  pets: [{
    nome: 'Rex',
    dataNascimento: '15/03/2020',
    sexo: 'Macho',
    especie: '2',
    racasId: 'uuid-raca',
    coberturasId: 'uuid-cob',
  }],
};

describe('validarPayload', () => {
  it('não retorna erros para payload válido', () => {
    expect(validarPayload(payloadValido)).toHaveLength(0);
  });

  it('exige nome, email, ddd, telefone', () => {
    const erros = validarPayload({ ...payloadValido, nome: '', email: '' });
    expect(erros.some(e => e.campo === 'nome')).toBe(true);
    expect(erros.some(e => e.campo === 'email')).toBe(true);
  });

  it('rejeita e-mail inválido', () => {
    const erros = validarPayload({ ...payloadValido, email: 'nao-e-email' });
    expect(erros.some(e => e.campo === 'email')).toBe(true);
  });

  it('rejeita DDD com != 2 dígitos', () => {
    const erros = validarPayload({ ...payloadValido, ddd: '011' });
    expect(erros.some(e => e.campo === 'ddd')).toBe(true);
  });

  it('rejeita telefone com DDD incluído', () => {
    const erros = validarPayload({ ...payloadValido, telefone: '11999998888' });
    expect(erros.some(e => e.campo === 'telefone')).toBe(true);
  });

  it('rejeita CEP inválido', () => {
    const erros = validarPayload({ ...payloadValido, cep: '0131010' });
    expect(erros.some(e => e.campo === 'cep')).toBe(true);
  });

  it('rejeita EstadosId como UUID em vez de UF', () => {
    const erros = validarPayload({ ...payloadValido, estadosId: 'uuid-de-estado' });
    expect(erros.some(e => e.campo === 'estadosId')).toBe(true);
  });

  it('exige ao menos 1 pet', () => {
    const erros = validarPayload({ ...payloadValido, pets: [] });
    expect(erros.some(e => e.campo === 'pets')).toBe(true);
  });

  it('valida data de nascimento do pet', () => {
    const erros = validarPayload({
      ...payloadValido,
      pets: [{ ...payloadValido.pets[0], dataNascimento: '2020-03-15' }],
    });
    expect(erros.some(e => e.campo.includes('dataNascimento'))).toBe(true);
  });

  it('valida sexo do pet', () => {
    const erros = validarPayload({
      ...payloadValido,
      pets: [{ ...payloadValido.pets[0], sexo: 'Masculino' as any }],
    });
    expect(erros.some(e => e.campo.includes('sexo'))).toBe(true);
  });

  it('valida espécie do pet', () => {
    const erros = validarPayload({
      ...payloadValido,
      pets: [{ ...payloadValido.pets[0], especie: '3' as any }],
    });
    expect(erros.some(e => e.campo.includes('especie'))).toBe(true);
  });
});

// ── formatarCoberturasParaPrompt ─────────────────────────────────────────────

describe('formatarCoberturasParaPrompt', () => {
  const coberturas: Cobertura[] = [
    { id: 'uuid1', nome: 'Slim', valor: 89.9, ordem: 1 },
    { id: 'uuid2', nome: 'Advance', valor: 129.9, ordem: 2 },
  ];

  it('inclui nome do plano e valor', () => {
    const r = formatarCoberturasParaPrompt(coberturas, 'SP');
    expect(r).toContain('Slim');
    expect(r).toContain('89,90');
  });

  it('inclui cobertura_id no formato correto', () => {
    const r = formatarCoberturasParaPrompt(coberturas, 'SP');
    expect(r).toContain('[cobertura_id:uuid1]');
  });

  it('menciona a UF', () => {
    const r = formatarCoberturasParaPrompt(coberturas, 'MG');
    expect(r).toContain('MG');
  });

  it('retorna string vazia para lista vazia', () => {
    expect(formatarCoberturasParaPrompt([], 'SP')).toBe('');
  });
});
