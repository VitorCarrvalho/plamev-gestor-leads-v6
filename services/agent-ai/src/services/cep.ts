/**
 * cep.ts — Compatibilidade: delega para rede-credenciada.ts
 * Mantido para processor.ts e supervisor.ts que fazem require() dinâmico.
 */
const { buscarClinicas } = require('./rede-credenciada');
module.exports = { buscarClinicas };
