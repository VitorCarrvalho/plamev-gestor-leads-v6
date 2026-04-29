import {
  normalizarCep,
  validarCep,
  normalizarTelefone,
  normalizarDistancia,
  formatarResposta,
  buscarRedeCredenciada,
  type Clinica,
} from './rede-credenciada';

// ── Helpers puros ────────────────────────────────────────────────────────────

describe('normalizarCep', () => {
  it('remove hífen', () => expect(normalizarCep('01310-100')).toBe('01310100'));
  it('remove espaços', () => expect(normalizarCep('01310 100')).toBe('01310100'));
  it('mantém 8 dígitos puros', () => expect(normalizarCep('01310100')).toBe('01310100'));
  it('tolera string numérica', () => expect(normalizarCep('30180072')).toBe('30180072'));
});

describe('validarCep', () => {
  it('aceita CEP válido', () => expect(validarCep('30180072')).toBe(true));
  it('rejeita CEP com 7 dígitos', () => expect(validarCep('3018007')).toBe(false));
  it('rejeita CEP com 9 dígitos', () => expect(validarCep('301800720')).toBe(false));
  it('rejeita letras', () => expect(validarCep('3018007A')).toBe(false));
  it('rejeita CEP com muitos zeros', () => expect(validarCep('00000100')).toBe(false));
});

describe('normalizarTelefone', () => {
  it('concatena DDD + número', () => expect(normalizarTelefone('31', '984651788')).toBe('31984651788'));
  it('remove caracteres não numéricos', () => expect(normalizarTelefone('(11)', '9 8765-4321')).toBe('11987654321'));
  it('lida com campos vazios', () => expect(normalizarTelefone('', '')).toBe(''));
});

describe('normalizarDistancia', () => {
  it('arredonda para 1 casa decimal', () => expect(normalizarDistancia('2.6471311504570965')).toBe(2.6));
  it('lida com número já arredondado', () => expect(normalizarDistancia(4.3)).toBe(4.3));
  it('retorna 0 para valor inválido', () => expect(normalizarDistancia('abc')).toBe(0));
  it('arredonda corretamente para cima', () => expect(normalizarDistancia('1.95')).toBe(2));
});

// ── formatarResposta ─────────────────────────────────────────────────────────

const clinicaBase: Clinica = {
  nome: 'Afeto Pet',
  logradouro: 'Rua Agostinho Bretas',
  numero: '373',
  bairro: 'Caiçaras',
  cidade: 'Belo Horizonte',
  estado: 'Minas Gerais',
  telefone: '31984651788',
  distanciaKm: 2.6,
};

describe('formatarResposta', () => {
  it('retorna mensagem de sem cobertura para lista vazia', () => {
    const r = formatarResposta([], 0);
    expect(r).toMatch(/não encontrei clínicas/i);
  });

  it('lista 1 clínica corretamente', () => {
    const r = formatarResposta([clinicaBase], 1);
    expect(r).toContain('Afeto Pet');
    expect(r).toContain('2.6 km');
    expect(r).not.toMatch(/mais \d+ clínica/i);
  });

  it('lista 3 clínicas e não exibe "mais X"', () => {
    const tres = [clinicaBase, { ...clinicaBase, nome: 'B', distanciaKm: 3.0 }, { ...clinicaBase, nome: 'C', distanciaKm: 4.0 }];
    const r = formatarResposta(tres, 3);
    expect(r).toContain('1.');
    expect(r).toContain('2.');
    expect(r).toContain('3.');
    expect(r).not.toMatch(/mais \d+ clínica/i);
  });

  it('mostra "mais X clínicas" quando total > 3', () => {
    const tres = [clinicaBase, { ...clinicaBase, nome: 'B' }, { ...clinicaBase, nome: 'C' }];
    const r = formatarResposta(tres, 26);
    expect(r).toMatch(/mais 23 clínicas/i);
  });

  it('usa apenas as 3 primeiras mesmo com lista maior', () => {
    const cinco = Array.from({ length: 5 }, (_, i) => ({ ...clinicaBase, nome: `Clínica ${i + 1}` }));
    const r = formatarResposta(cinco, 5);
    expect(r).not.toContain('Clínica 4');
    expect(r).not.toContain('Clínica 5');
  });
});

// ── buscarRedeCredenciada (mocks de fetch) ───────────────────────────────────

const clinicaApiRaw = {
  IndividuosNome: 'CLINICA VET LTDA',
  IndividuosNomeFantasia: 'Afeto Pet',
  CredenciadosNomeCredenciado: 'Afeto Pet Hospital Veterinário',
  IndividuosEnderecosLogradouro: 'Rua Agostinho Bretas',
  IndividuosEnderecosNumero: '373',
  IndividuosEnderecosBairro: 'Caiçaras',
  IndividuosEnderecosCidadesNome: 'Belo Horizonte',
  IndividuosEnderecosEstadosNome: 'Minas Gerais',
  IndividuosContatosDdd: '31',
  IndividuosContatosTelefone: '984651788',
  DistanciaKm: '2.6471311504570965',
};

function mockFetch(status: number, body: any) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as any;
}

beforeEach(() => {
  process.env.PLAMEV_SERVICE_AUTHORIZATION_TOKEN = 'token-teste';
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('buscarRedeCredenciada', () => {
  it('retorna cep_invalido para CEP com 7 dígitos', async () => {
    const r = await buscarRedeCredenciada('0131010');
    expect(r.status).toBe('cep_invalido');
  });

  it('retorna cep_invalido para CEP com letras', async () => {
    const r = await buscarRedeCredenciada('0131010A');
    expect(r.status).toBe('cep_invalido');
  });

  it('retorna sem_cobertura quando API retorna lista vazia', async () => {
    mockFetch(200, []);
    const r = await buscarRedeCredenciada('30180072');
    expect(r.status).toBe('sem_cobertura');
    expect(r.total).toBe(0);
  });

  it('retorna ok com clínicas ordenadas por distância', async () => {
    const longe = { ...clinicaApiRaw, CredenciadosNomeCredenciado: 'Longe', DistanciaKm: '10.0' };
    const perto = { ...clinicaApiRaw, CredenciadosNomeCredenciado: 'Perto', DistanciaKm: '1.5' };
    mockFetch(200, [longe, perto]);

    const r = await buscarRedeCredenciada('30180072');
    expect(r.status).toBe('ok');
    expect(r.clinicas![0].nome).toBe('Perto');
    expect(r.clinicas![1].nome).toBe('Longe');
  });

  it('retorna ok com menos de 3 clínicas sem erro', async () => {
    mockFetch(200, [clinicaApiRaw]);
    const r = await buscarRedeCredenciada('30180072');
    expect(r.status).toBe('ok');
    expect(r.total).toBe(1);
    expect(r.texto).not.toMatch(/mais \d+ clínica/i);
  });

  it('retorna ok com mais de 3 clínicas e texto com "mais X"', async () => {
    const lista = Array.from({ length: 5 }, (_, i) => ({
      ...clinicaApiRaw,
      CredenciadosNomeCredenciado: `Clínica ${i + 1}`,
      DistanciaKm: String(i + 1),
    }));
    mockFetch(200, lista);
    const r = await buscarRedeCredenciada('30180072');
    expect(r.status).toBe('ok');
    expect(r.texto).toMatch(/mais 2 clínicas/i);
  });

  it('retorna erro_servico quando API responde 500', async () => {
    mockFetch(500, null);
    const r = await buscarRedeCredenciada('30180072');
    expect(r.status).toBe('erro_servico');
  });

  it('retorna erro_servico em timeout', async () => {
    global.fetch = jest.fn().mockRejectedValue(
      Object.assign(new Error('timeout'), { name: 'TimeoutError' }),
    ) as any;
    const r = await buscarRedeCredenciada('30180072');
    expect(r.status).toBe('erro_servico');
  });

  it('retorna erro_servico para payload malformado (não-array)', async () => {
    mockFetch(200, { erro: 'inesperado' });
    const r = await buscarRedeCredenciada('30180072');
    expect(r.status).toBe('sem_cobertura');
  });

  it('prefere CredenciadosNomeCredenciado como nome da clínica', async () => {
    mockFetch(200, [clinicaApiRaw]);
    const r = await buscarRedeCredenciada('30180072');
    expect(r.clinicas![0].nome).toBe('Afeto Pet Hospital Veterinário');
  });

  it('normaliza distância para 1 casa decimal na resposta', async () => {
    mockFetch(200, [clinicaApiRaw]);
    const r = await buscarRedeCredenciada('30180072');
    expect(r.clinicas![0].distanciaKm).toBe(2.6);
  });

  it('concatena telefone corretamente', async () => {
    mockFetch(200, [clinicaApiRaw]);
    const r = await buscarRedeCredenciada('30180072');
    expect(r.clinicas![0].telefone).toBe('31984651788');
  });
});
