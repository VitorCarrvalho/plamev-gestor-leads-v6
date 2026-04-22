/**
 * container.js — Dependency Injection Container
 * Registra e gerencia todas as dependências do sistema
 * 
 * Benefícios:
 * ├─ Injeção de dependências centralizada
 * ├─ Fácil testar (mock de dependências)
 * ├─ Desacoplamento de módulos
 * └─ Configuração em um só lugar
 */

const ProcessadorMensagem = require('./orchestrator/processor');
const NotificadorDashboard = require('./orchestrator/notificador');
const db = require('./db');
const brain = require('./brain');
const decisor = require('./orchestrator/decisor');
const contexto = require('./orchestrator/contexto');
const actions = require('./actions');
const sender = require('./services/sender');
const audioSvc = require('./services/audio');
const imagemSvc = require('./services/imagem');
const cepSvc = require('./services/cep');
const schedulerSvc = require('./services/scheduler');
const chipsSvc = require('./services/chips');

class Container {
  constructor() {
    this.singletons = {};
    this._inicializar();
  }

  /**
   * Registra todas as dependências
   */
  _inicializar() {
    // ── DB e Core ────────────────────────────────────────────
    this.register('db', () => db);
    this.register('brain', () => brain);

    // ── Orquestrador ─────────────────────────────────────────
    this.register('decisor', () => decisor);
    this.register('contexto', () => contexto);

    // ── Ações ────────────────────────────────────────────────
    this.register('actions', () => actions);

    // ── Serviços ─────────────────────────────────────────────
    this.register('sender', () => sender);
    this.register('audioSvc', () => audioSvc);
    this.register('imagemSvc', () => imagemSvc);
    this.register('cepSvc', () => cepSvc);
    this.register('schedulerSvc', () => schedulerSvc);
    this.register('chipsSvc', () => chipsSvc);

    // ── Notificador ──────────────────────────────────────────
    this.register('notificador', () =>
      new NotificadorDashboard({
        portV3: 3400,
        portV4: 3450,
        timeout: 5000
      })
    );

    // ── Processador (depende de tudo) ────────────────────────
    this.register('processor', () =>
      new ProcessadorMensagem({
        decisor: this.get('decisor'),
        contexto: this.get('contexto'),
        brain: this.get('brain'),
        actions: this.get('actions'),
        sender: this.get('sender'),
        db: this.get('db'),
        audioSvc: this.get('audioSvc'),
        imagemSvc: this.get('imagemSvc'),
        notificador: this.get('notificador')
      })
    );
  }

  /**
   * Registra uma dependência
   * @param {string} nome - Nome da dependência
   * @param {function} factory - Função que cria a instância
   */
  register(nome, factory) {
    if (typeof factory !== 'function') {
      throw new Error(`Factory para ${nome} deve ser uma função`);
    }
    this.singletons[nome] = { factory, instance: null };
  }

  /**
   * Recupera uma dependência (lazy loading)
   * @param {string} nome - Nome da dependência
   * @returns {*} - Instância da dependência
   */
  get(nome) {
    if (!this.singletons[nome]) {
      throw new Error(`Dependência não registrada: ${nome}`);
    }

    const { factory, instance } = this.singletons[nome];

    // Lazy loading: criar apenas quando necessário
    if (!instance) {
      this.singletons[nome].instance = factory();
    }

    return this.singletons[nome].instance;
  }

  /**
   * Define um singleton manualmente (para testes)
   * @param {string} nome - Nome da dependência
   * @param {*} instancia - Instância
   */
  setSingleton(nome, instancia) {
    this.singletons[nome] = {
      factory: () => instancia,
      instance: instancia
    };
  }

  /**
   * Substitui uma dependência (para testes)
   * @param {string} nome - Nome da dependência
   * @param {function} factory - Nova factory
   */
  substituir(nome, factory) {
    if (!this.singletons[nome]) {
      throw new Error(`Dependência não existe: ${nome}`);
    }
    this.singletons[nome] = { factory, instance: null };
  }

  /**
   * Reseta todas as instâncias (para testes)
   */
  reset() {
    Object.keys(this.singletons).forEach(k => {
      this.singletons[k].instance = null;
    });
  }

  /**
   * Lista todas as dependências registradas
   */
  listarDependencias() {
    return Object.keys(this.singletons);
  }

  /**
   * Verifica se uma dependência está registrada
   */
  temDependencia(nome) {
    return !!this.singletons[nome];
  }
}

// Exportar instância singleton global
const container = new Container();

module.exports = container;
