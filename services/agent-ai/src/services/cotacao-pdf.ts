import PDFDocument from 'pdfkit';
import { CotacaoResult, CotacaoPayload } from './cotacao';

const BLUE_DARK  = '#0B4FA8';
const BLUE       = '#1E88E5';
const BLUE_LIGHT = '#E3F2FD';
const GRAY       = '#5C6370';
const GRAY_LIGHT = '#F4F6F9';
const WHITE      = '#FFFFFF';

function brl(value: number): string {
  return `R$ ${value.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function drawRect(
  doc: PDFKit.PDFDocument,
  x: number, y: number, w: number, h: number,
  fill: string,
) {
  doc.save().rect(x, y, w, h).fill(fill).restore();
}

function row(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  y: number,
  labelColor = GRAY,
  valueColor = '#1A1A2E',
  bold = false,
) {
  const margin = 56;
  const labelW = 200;
  doc
    .fontSize(9).fillColor(labelColor).font('Helvetica')
    .text(label, margin, y, { width: labelW });
  doc
    .fontSize(9).fillColor(valueColor).font(bold ? 'Helvetica-Bold' : 'Helvetica')
    .text(value, margin + labelW, y, { width: 500 - margin - labelW });
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string, y: number) {
  drawRect(doc, 44, y - 2, 508, 20, BLUE_LIGHT);
  doc.fontSize(9).fillColor(BLUE_DARK).font('Helvetica-Bold').text(title, 56, y, { width: 484 });
  return y + 24;
}

export async function gerarCotacaoPdf(
  resultado: CotacaoResult,
  payload: CotacaoPayload,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Cotação Plamev ${resultado.numeroCotacao}` } });

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = 595.28;
    const margin = 44;

    // ── Header ──────────────────────────────────────────────────
    drawRect(doc, 0, 0, W, 72, BLUE_DARK);
    doc
      .fontSize(22).fillColor(WHITE).font('Helvetica-Bold')
      .text('PLAMEV', margin, 20, { continued: true })
      .font('Helvetica')
      .text(' — Plano de Saúde Pet', { continued: false });
    doc
      .fontSize(10).fillColor('#B3D4FF').font('Helvetica')
      .text('Proposta de Cotação', margin, 46);

    // ── Info bar ────────────────────────────────────────────────
    drawRect(doc, 0, 72, W, 28, BLUE);
    doc.fontSize(9).fillColor(WHITE).font('Helvetica-Bold');
    const infoY = 81;
    doc.text(`Cotação Nº: ${resultado.numeroCotacao}`, margin, infoY, { width: 200 });
    const dataEmissao = new Date().toLocaleDateString('pt-BR');
    doc.text(`Emissão: ${dataEmissao}`, margin + 200, infoY, { width: 140 });
    if (resultado.dataFidelidade) {
      doc.text(`Fidelidade até: ${formatDate(resultado.dataFidelidade)}`, margin + 360, infoY, { width: 150 });
    }

    let y = 114;

    // ── Dados do Titular ────────────────────────────────────────
    y = sectionTitle(doc, 'DADOS DO TITULAR', y);
    row(doc, 'Nome', payload.nome, y); y += 16;
    row(doc, 'E-mail', payload.email, y); y += 16;
    const telefone = `(${payload.ddd}) ${payload.telefone.replace(/^(\d{4,5})(\d{4})$/, '$1-$2')}`;
    row(doc, 'Telefone', telefone, y); y += 16;
    const endereco = [payload.logradouro, payload.numero, payload.complemento, payload.bairro].filter(Boolean).join(', ');
    row(doc, 'Endereço', endereco, y); y += 16;
    row(doc, 'Cidade / UF', `${payload.cidadesId} — ${payload.estadosId}`, y); y += 16;
    row(doc, 'CEP', payload.cep.replace(/^(\d{5})(\d{3})$/, '$1-$2'), y); y += 20;

    // ── Pets e Planos ────────────────────────────────────────────
    y = sectionTitle(doc, 'PETS E PLANOS CONTRATADOS', y);

    for (const pet of resultado.pets) {
      // Mini card por pet
      drawRect(doc, margin, y, W - margin * 2, 60, GRAY_LIGHT);
      doc.save().rect(margin, y, 4, 60).fill(BLUE).restore();

      const petNome = pet.nome || 'Pet';
      doc.fontSize(10).fillColor(BLUE_DARK).font('Helvetica-Bold').text(petNome, margin + 12, y + 6);

      const planoNome = pet.plano?.nome || '';
      const fidelidade = pet.plano?.fidelidade || '';
      const valorPet = pet.plano?.valor ?? 0;
      const descontoCartao = pet.plano?.descontoCartao ?? 0;

      doc.fontSize(9).fillColor(GRAY).font('Helvetica').text(`Plano: `, margin + 12, y + 22, { continued: true });
      doc.fillColor('#1A1A2E').font('Helvetica-Bold').text(planoNome || '—');

      if (fidelidade) {
        doc.fontSize(9).fillColor(GRAY).font('Helvetica').text(`Fidelidade: ${fidelidade}`, margin + 12, y + 36);
      }
      doc.fontSize(9).fillColor(BLUE_DARK).font('Helvetica-Bold')
        .text(brl(valorPet) + '/mês', W - margin - 100, y + 22, { width: 100, align: 'right' });
      if (descontoCartao > 0) {
        doc.fontSize(8).fillColor(GRAY).font('Helvetica')
          .text(`Desc. cartão: ${brl(descontoCartao)}`, W - margin - 100, y + 36, { width: 100, align: 'right' });
      }

      y += 68;
    }

    y += 4;

    // ── Resumo Financeiro ────────────────────────────────────────
    y = sectionTitle(doc, 'RESUMO FINANCEIRO', y);

    if (resultado.valorMensalidade > 0 && resultado.valorMensalidade !== resultado.valorTotalMensalidade) {
      row(doc, 'Mensalidade (tabela)', brl(resultado.valorMensalidade), y, GRAY, '#1A1A2E'); y += 16;
    }
    if (resultado.valorDescontosMensalidades > 0) {
      row(doc, 'Descontos', `- ${brl(resultado.valorDescontosMensalidades)}`, y, GRAY, BLUE); y += 16;
    }

    // Composição por pet (caso haja múltiplos)
    if (resultado.composicaoMensalidade.length > 1) {
      for (const item of resultado.composicaoMensalidade) {
        row(doc, `  ${item.nome}`, brl(item.valor), y, GRAY, '#1A1A2E'); y += 14;
      }
    }

    // Linha de destaque: mensalidade total
    drawRect(doc, margin, y + 2, W - margin * 2, 22, BLUE_DARK);
    doc.fontSize(10).fillColor(WHITE).font('Helvetica-Bold')
      .text('MENSALIDADE TOTAL', margin + 8, y + 7, { width: 240 });
    doc.fontSize(10).fillColor(WHITE).font('Helvetica-Bold')
      .text(brl(resultado.valorTotalMensalidade) + '/mês', margin + 8, y + 7, { width: W - margin * 2 - 16, align: 'right' });
    y += 30;

    if (resultado.valorAdesao > 0) {
      row(doc, 'Taxa de adesão (1x)', brl(resultado.valorAdesao), y, GRAY, '#1A1A2E'); y += 16;
    }

    if (resultado.descontos.length > 0) {
      y += 4;
      doc.fontSize(8).fillColor(GRAY).font('Helvetica-Oblique')
        .text(`Descontos aplicados: ${resultado.descontos.map(d => d.nome).join(', ')}`, margin, y);
      y += 14;
    }

    y += 12;

    // ── Informações de Pagamento ─────────────────────────────────
    y = sectionTitle(doc, 'PAGAMENTO', y);
    const formaPagamento = payload.formaPagamento === 1 ? 'Cartão de Crédito' : 'Boleto Bancário';
    row(doc, 'Forma de pagamento', formaPagamento, y); y += 20;

    // ── Footer ───────────────────────────────────────────────────
    const pageH = 841.89;
    drawRect(doc, 0, pageH - 44, W, 44, BLUE_DARK);
    doc.fontSize(8).fillColor('#B3D4FF').font('Helvetica')
      .text('Esta cotação tem validade de 7 dias. Valores sujeitos a confirmação mediante análise cadastral.', margin, pageH - 34, { width: W - margin * 2, align: 'center' });
    doc.fontSize(8).fillColor(WHITE).font('Helvetica-Bold')
      .text('www.plamev.com.br', margin, pageH - 20, { width: W - margin * 2, align: 'center' });

    doc.end();
  });
}
