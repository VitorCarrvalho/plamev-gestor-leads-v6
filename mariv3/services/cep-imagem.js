/**
 * cep-imagem.js — Gera imagem com resultado de cobertura CEP
 * Usa @napi-rs/canvas para criar um card visual com as 3 clínicas mais próximas
 */
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const os   = require('os');
const fs   = require('fs');

/**
 * Gera imagem PNG com resultado de cobertura CEP
 * @param {Object} resultado — resultado de buscarClinicas()
 * @returns {string} — path do arquivo temporário gerado
 */
async function gerarImagemCEP(resultado) {
  const W = 680, H = 420;
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  // ── Fundo gradiente ──────────────────────────────────────
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#0f172a');
  grad.addColorStop(1, '#1e293b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // ── Borda arredondada decorativa ─────────────────────────
  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(10, 10, W - 20, H - 20, 16);
  ctx.stroke();

  // ── Header ───────────────────────────────────────────────
  ctx.fillStyle = '#22c55e';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('🏥 Cobertura Plamev na sua região', 30, 52);

  const cidade  = resultado.cidade  || '';
  const estado  = resultado.estado  || '';
  const total   = resultado.total   || 0;
  const raio    = resultado.raio    || 40;

  ctx.fillStyle = '#94a3b8';
  ctx.font = '15px sans-serif';
  ctx.fillText(`${cidade}${estado ? ' — ' + estado : ''} · raio ${raio}km`, 30, 80);

  // ── Total de clínicas ────────────────────────────────────
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 17px sans-serif';
  ctx.fillText(`✅  ${total} clínica${total !== 1 ? 's' : ''} credenciada${total !== 1 ? 's' : ''} encontrada${total !== 1 ? 's' : ''}`, 30, 115);

  // ── Linha separadora ─────────────────────────────────────
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(30, 130); ctx.lineTo(W - 30, 130);
  ctx.stroke();

  // ── 3 clínicas mais próximas ─────────────────────────────
  const top3 = (resultado.top3 || []).slice(0, 3);
  const cores = ['#38bdf8', '#818cf8', '#fb923c'];

  top3.forEach((c, i) => {
    const y = 155 + i * 85;

    // Número
    ctx.fillStyle = cores[i];
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText(`${i + 1}.`, 30, y);

    // Nome
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 15px sans-serif';
    const nome = c.nome && c.nome.length > 42 ? c.nome.substring(0, 42) + '…' : (c.nome || '');
    ctx.fillText(nome, 55, y);

    // Endereço
    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px sans-serif';
    const end = c.endereco && c.endereco.length > 55 ? c.endereco.substring(0, 55) + '…' : (c.endereco || '');
    ctx.fillText(`📍 ${end}`, 55, y + 20);

    // Telefone + Distância
    const info = [
      c.telefone ? `📞 ${c.telefone}` : '',
      c.distancia ? `📏 ${c.distancia}` : '',
    ].filter(Boolean).join('   ');
    if (info) {
      ctx.fillStyle = '#64748b';
      ctx.font = '12px sans-serif';
      ctx.fillText(info, 55, y + 38);
    }
  });

  // ── Footer ───────────────────────────────────────────────
  ctx.fillStyle = '#334155';
  ctx.fillRect(0, H - 45, W, 45);
  ctx.fillStyle = '#64748b';
  ctx.font = '12px sans-serif';
  ctx.fillText('plamev.com.br  ·  Rede credenciada vistoriada pelo CRMV', 30, H - 16);

  // ── Salvar arquivo temp ───────────────────────────────────
  const tmpPath = path.join(os.tmpdir(), `plamev-cep-${Date.now()}.png`);
  const buffer  = canvas.toBuffer('image/png');
  fs.writeFileSync(tmpPath, buffer);

  return tmpPath;
}

module.exports = { gerarImagemCEP };
