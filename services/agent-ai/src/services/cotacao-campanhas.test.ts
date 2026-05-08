
import {
  normalizePlanName,
  parsePriceFromText,
  findMatchingPriceTable,
} from './cotacao';

describe('Resolução de Campanhas Dinâmicas', () => {
  describe('1. Normalização de Nome do Plano', () => {
    it('deve remover espaços extras e ignorar case', () => {
      expect(normalizePlanName(' ADVANCE ')).toBe('advance');
      expect(normalizePlanName('Advance Plus')).toBe('advance plus');
      expect(normalizePlanName('  Advance    Plus  ')).toBe('advance plus');
    });
  });

  describe('2. Parsing de Preço', () => {
    it('deve converter corretamente valores decimais em texto', () => {
      expect(parsePriceFromText('89,99')).toBe(89.99);
      expect(parsePriceFromText('89.99')).toBe(89.99);
      expect(parsePriceFromText('R$ 89,99')).toBe(89.99);
      expect(parsePriceFromText('Advance 89,98')).toBe(89.98);
      expect(parsePriceFromText('Platinum 229,99')).toBe(229.99);
    });

    it('deve retornar número quando a entrada já é número', () => {
      expect(parsePriceFromText(89.99)).toBe(89.99);
      expect(parsePriceFromText(100)).toBe(100);
    });

    it('deve retornar null para valores inválidos', () => {
      expect(parsePriceFromText('Texto sem numero')).toBeNull();
      expect(parsePriceFromText(null)).toBeNull();
    });
  });

  describe('3. Seleção da Tabela com Tolerância de R$ 1,00', () => {
    const tabelasMock = [
      { Id: 'T1', Nome: 'Advance 119,98', Ativo: true },
      { Id: 'T2', Nome: 'Advance 99,98', Ativo: true },
      { Id: 'T3', Nome: 'Advance 89,98', Ativo: true },
      { Id: 'T4', Nome: 'Advance 109,98', Ativo: true }
    ];

    it('deve selecionar a tabela exata ou mais próxima dentro de 1 real de tolerância (valor maior na api)', () => {
      const match = findMatchingPriceTable(tabelasMock, 89.99);
      expect(match).not.toBeNull();
      expect(match?.Id).toBe('T3');
    });

    it('deve selecionar a tabela exata ou mais próxima (valor igual na api)', () => {
      const match = findMatchingPriceTable(tabelasMock, 89.98);
      expect(match).not.toBeNull();
      expect(match?.Id).toBe('T3');
    });

    it('deve selecionar a tabela mais próxima (valor menor na api)', () => {
      const match = findMatchingPriceTable(tabelasMock, 89.50);
      expect(match).not.toBeNull();
      expect(match?.Id).toBe('T3'); // Diff é 0.48, menor que 1.00
    });

    it('não deve selecionar tabela se a diferença for maior que 1 real', () => {
      const match = findMatchingPriceTable(tabelasMock, 88.00);
      expect(match).toBeNull();
    });
  });
});
