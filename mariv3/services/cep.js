/**
 * services/cep.js — Consulta rede credenciada Plamev por CEP
 * [COMPORTAMENTO MARI] Skill oficial é ÚNICA fonte — usar output direto — 16/04/2026 16:35
 *
 * RETORNOS:
 *   { status: 'ok',            texto }   → texto pronto para enviar ao cliente
 *   { status: 'sem_cobertura' }           → skill retornou sem clínicas
 *   { status: 'erro_servico' }            → falha na execução (5xx, timeout)
 *   { status: 'cep_invalido' }            → CEP malformado
 */
const { execFile } = require('child_process');

const SKILL = '/Users/geta/.openclaw/workspace/skills/plamev-rede-credenciada/consulta.js';

async function buscarClinicas(cepRaw) {
  const cep = String(cepRaw).replace(/\D/g, '');
  if (cep.length !== 8) return { status: 'cep_invalido' };
  if (/^0{5,}/.test(cep)) return { status: 'cep_invalido' }; // CEP com muitos zeros = inválido

  return new Promise((resolve) => {
    execFile('node', [SKILL, cep], { timeout: 15000 }, (err, stdout, stderr) => {

      // Timeout
      if (err?.killed) {
        console.error(`[CEP] ⏱️ Timeout para ${cep}`);
        return resolve({ status: 'erro_servico' });
      }

      // Erro de execução — verificar se é falha de serviço ou só sem resultado
      if (err) {
        const msg = (err.message || '').toLowerCase();
        if (/5\d\d|econnrefused|enotfound|etimedout|socket|network/i.test(msg)) {
          console.error(`[CEP] ❌ Erro de serviço para ${cep}:`, err.message);
          return resolve({ status: 'erro_servico' });
        }
        // CEP inválido pelo script
        if (/cep inválido|inválido/i.test(msg)) {
          return resolve({ status: 'cep_invalido' });
        }
        console.log(`[CEP] ℹ️ Sem resultado para ${cep}:`, err.message);
        return resolve({ status: 'sem_cobertura' });
      }

      const output = (stdout || '').trim();

      // Sem output
      if (!output) return resolve({ status: 'sem_cobertura' });

      // Caso novo (21/04/2026): skill emite JSON estruturado quando não há
      // cobertura, incluindo bairro/cidade/uf do endereço pesquisado.
      // Exemplo: "SEM_COBERTURA_JSON:{"status":"sem_cobertura","bairro":"...", "cidade":"...","uf":"..."}"
      const matchSemCobertura = output.match(/^SEM_COBERTURA_JSON:(\{.+\})$/m);
      if (matchSemCobertura) {
        try {
          const info = JSON.parse(matchSemCobertura[1]);
          console.log(`[CEP] 🚫 ${cep} — sem cobertura (${info.cidade || '?'}/${info.uf || '?'}, bairro ${info.bairro || '?'})`);
          return resolve({
            status: 'sem_cobertura',
            bairro: info.bairro || null,
            cidade: info.cidade || null,
            uf:     info.uf || null,
          });
        } catch {
          return resolve({ status: 'sem_cobertura' });
        }
      }

      // Fallback: formato antigo de texto explícito
      if (/não encontrei clínicas|sem clínica|nenhuma clínica/i.test(output)) {
        return resolve({ status: 'sem_cobertura' });
      }

      // Tem clínicas — retornar o texto direto da skill
      console.log(`[CEP] ✅ ${cep} — clínicas encontradas`);
      resolve({ status: 'ok', texto: output });
    });
  });
}

module.exports = { buscarClinicas };
