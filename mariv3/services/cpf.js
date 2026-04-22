/**
 * cpf.js — Consulta CPF via SouthTI API
 * Retorna: { nome, nascimento, cpf } ou null se não encontrar
 */
const https = require('https');

const AUTH_TOKEN = 'qrb5cvtaJkqJq0o0opYugCtsnC9Bc0WVov1dcdkpipqmJC9WqYAlEdmaHdRoq1mLs3YmE0YTXaoocUoOnqZiHdcOrFomJC9WqrmLckWrlMUjXRAs5vxzaJOOO';
const COOKIE    = 'PHPSESSID=v0qa8hdcjcc8b8i8dvnt5gi2b4';

function consultarCPF(cpfRaw) {
  const cpf = cpfRaw.replace(/\D/g, '');
  if (cpf.length !== 11) return Promise.resolve(null);

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.southti.com.br',
      path:     `/cpf/?cpf=${cpf}&token=${AUTH_TOKEN}`,
      method:   'GET',
      headers:  { Cookie: COOKIE },
      timeout:  8000,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          // Estrutura esperada: { nome, nascimento } ou { dados: { nome, nascimento } }
          const obj  = json.dados || json;
          const nome = obj.nome || obj.NOME || null;
          const nasc = obj.nascimento || obj.DATA_NASCIMENTO || obj.dataNascimento || null;
          if (nome) {
            resolve({ nome: nome.trim(), nascimento: nasc, cpf });
          } else {
            resolve(null);
          }
        } catch(e) {
          resolve(null);
        }
      });
    });

    req.on('error',   () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

module.exports = { consultarCPF };
