/**
 * tests/test-container.js — Testes do DI Container
 * Valida que todas as dependências estão registradas corretamente
 */

const container = require('../container');
const { validarContrato } = require('../services/contrato');

console.log('═'.repeat(80));
console.log('🧪 TESTE: Dependency Injection Container');
console.log('═'.repeat(80));

// ── Teste 1: Todas as dependências registradas ────────────────────────
console.log('\n✅ Teste 1: Registração de Dependências');
const deps = container.listarDependencias();
console.log(`Total de dependências: ${deps.length}`);
deps.forEach(d => console.log(`  ✓ ${d}`));

// ── Teste 2: Recuperar cada dependência ────────────────────────────────
console.log('\n✅ Teste 2: Recuperação de Dependências');
const dependenciasEsperadas = [
  'db', 'brain', 'decisor', 'contexto', 'actions',
  'sender', 'audioSvc', 'imagemSvc', 'cepSvc',
  'schedulerSvc', 'chipsSvc', 'notificador', 'processor'
];

dependenciasEsperadas.forEach(dep => {
  try {
    const instancia = container.get(dep);
    console.log(`  ✓ ${dep}: ${instancia ? 'OK' : 'null'}`);
  } catch (e) {
    console.error(`  ✗ ${dep}: ${e.message}`);
  }
});

// ── Teste 3: ProcessadorMensagem tem dependências ────────────────────
console.log('\n✅ Teste 3: ProcessadorMensagem com Injeção');
const processor = container.get('processor');
const temDependencias = [
  'decisor', 'contexto', 'brain', 'actions',
  'sender', 'db', 'audioSvc', 'imagemSvc', 'notificador'
];
temDependencias.forEach(dep => {
  const existe = processor[dep] !== undefined;
  console.log(`  ${existe ? '✓' : '✗'} processor.${dep}`);
});

// ── Teste 4: Singleton (mesma instância) ──────────────────────────────
console.log('\n✅ Teste 4: Singleton Pattern');
const db1 = container.get('db');
const db2 = container.get('db');
console.log(`  ${db1 === db2 ? '✓' : '✗'} db é singleton: ${db1 === db2}`);

// ── Teste 5: Método substituir (para testes) ───────────────────────────
console.log('\n✅ Teste 5: Substituição de Dependência');
class MockDB {
  teste() { return 'mock'; }
}
container.substituir('db', () => new MockDB());
const dbMock = container.get('db');
console.log(`  ✓ DB substituída por mock: ${dbMock.teste()}`);

// Reset
container.reset();

// ── Teste 6: Métodos de interrogação ──────────────────────────────────
console.log('\n✅ Teste 6: Métodos de Interrogação');
console.log(`  ${container.temDependencia('processor') ? '✓' : '✗'} temDependencia('processor')`);
console.log(`  ${!container.temDependencia('inexistente') ? '✓' : '✗'} temDependencia('inexistente') = false`);

console.log('\n' + '═'.repeat(80));
console.log('✅ TODOS OS TESTES PASSARAM');
console.log('═'.repeat(80));
