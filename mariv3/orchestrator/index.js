/**
 * orchestrator/index.js — Interface Pública do Orquestrador
 * 
 * Responsabilidade: Delegação via ProcessadorMensagem
 * 
 * Padrão Facade + Dependency Injection Container
 * Todo o trabalho pesado está em processor.js
 */
require('dotenv').config({ path: '../.env' });
const container = require('../container');

/**
 * Processa uma mensagem do início ao fim
 * Delega para ProcessadorMensagem (injetado via Container)
 */
async function processar(msg) {
  try {
    const processor = container.get('processor');
    await processor.processar(msg);
  } catch (e) {
    console.error(`[ORC] Erro ao processar ${msg.phone}:`, e.message);
  }
}

module.exports = { processar, container };
