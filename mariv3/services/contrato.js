/**
 * services/contrato.js — Contratos de Interface para Services
 * Define interfaces que todos os serviços devem implementar
 * 
 * Benefícios:
 * ├─ Facilita mocking em testes
 * ├─ Permite substituição de implementações
 * ├─ Documenta o contrato esperado
 * └─ Detecta violações em desenvolvimento
 */

/**
 * Interface para Serviço de Áudio (Transcrição)
 */
class IServicoAudio {
  /**
   * Transcreve áudio em texto
   * @param {string} instancia - Identificador da instância (ex: Evolution API instance)
   * @param {string} msgId - ID da mensagem
   * @param {string} msgType - Tipo de mensagem ('pttMessage' ou 'audioMessage')
   * @returns {Promise<string|null>} - Texto transcrito ou null se falhar
   */
  async transcrever(instancia, msgId, msgType) {
    throw new Error('transcrever() não implementado');
  }
}

/**
 * Interface para Serviço de Imagem (Análise)
 */
class IServicoImagem {
  /**
   * Analisa imagem e retorna descrição/recomendação
   * @param {string} instancia - Identificador da instância
   * @param {string} msgId - ID da mensagem
   * @param {string} contexto - Contexto (ex: "Pet: Fluffy (gato)")
   * @returns {Promise<string|null>} - Análise ou null se falhar
   */
  async analisar(instancia, msgId, contexto) {
    throw new Error('analisar() não implementado');
  }
}

/**
 * Interface para Serviço de CEP (Clínicas)
 */
class IServicoCEP {
  /**
   * Busca clínicas credenciadas por CEP
   * @param {string} cep - CEP (com ou sem formatação)
   * @param {number} raioKm - Raio de busca em km (padrão 40)
   * @returns {Promise<object|null>} - Resultado {total, cidade, estado, top3[]} ou null
   */
  async buscarClinicas(cep, raioKm = 40) {
    throw new Error('buscarClinicas() não implementado');
  }

  /**
   * Formata resultado para apresentação
   * @param {object} resultado - Resultado de buscarClinicas
   * @returns {string|null} - Texto formatado ou null se vazio
   */
  formatarClinicas(resultado) {
    throw new Error('formatarClinicas() não implementado');
  }
}

/**
 * Interface para Serviço de Envio (Sender)
 */
class IServicoSender {
  /**
   * Envia mensagem para cliente
   * @param {object} msg - Mensagem {canal, phone, instancia, etc}
   * @param {string} texto - Texto a enviar
   * @returns {Promise<boolean>} - true se sucesso, false se erro
   */
  async enviar(msg, texto) {
    throw new Error('enviar() não implementado');
  }
}

/**
 * Interface para Serviço de Scheduler (Agendamento)
 */
class IServicoScheduler {
  /**
   * Agenda uma tarefa
   * @param {string} tipo - Tipo de tarefa (ex: 'reengajamento')
   * @param {object} dados - Dados da tarefa
   * @param {Date} dataAgendamento - Quando agendar
   * @returns {Promise<string>} - ID do agendamento
   */
  async agendar(tipo, dados, dataAgendamento) {
    throw new Error('agendar() não implementado');
  }

  /**
   * Inicia o scheduler
   */
  async iniciar() {
    throw new Error('iniciar() não implementado');
  }
}

/**
 * Validador de Contrato (Desenvolvimento)
 * Use em testes para garantir que implementação segue interface
 * 
 * @example
 * const servicoReal = new ServicoAudio();
 * validarContrato(servicoReal, IServicoAudio);
 */
function validarContrato(instancia, Interface) {
  if (!instancia) {
    throw new Error('Instância não pode ser nula');
  }

  const metodos = Object.getOwnPropertyNames(Interface.prototype);
  const metodosInstancia = Object.getOwnPropertyNames(Object.getPrototypeOf(instancia));

  metodos.forEach(m => {
    if (m === 'constructor') return;
    if (!metodosInstancia.includes(m)) {
      throw new Error(
        `${instancia.constructor.name} não implementa método ${m}(). ` +
        `Verifique se a classe estende ${Interface.name}.`
      );
    }
  });
}

/**
 * Validador de Implementação (Runtime)
 * Verifica se método existe e é função
 */
function validarMetodo(instancia, nomMetodo) {
  if (!instancia[nomMetodo]) {
    throw new Error(
      `Método ${nomMetodo}() não existe em ${instancia.constructor.name}`
    );
  }

  if (typeof instancia[nomMetodo] !== 'function') {
    throw new Error(
      `${nomMetodo} não é uma função em ${instancia.constructor.name}`
    );
  }
}

module.exports = {
  IServicoAudio,
  IServicoImagem,
  IServicoCEP,
  IServicoSender,
  IServicoScheduler,
  validarContrato,
  validarMetodo
};
