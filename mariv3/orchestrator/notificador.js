/**
 * orchestrator/notificador.js — Notificador de Dashboards
 * Responsabilidade ÚNICA: Notificar múltiplos dashboards
 * 
 * Desacoplado de orchestrator/index.js
 * Sem dependências de lógica de IA
 */

const http = require('http');

class NotificadorDashboard {
  constructor(config = {}) {
    this.portV3 = config.portV3 || 3400;
    this.portV4 = config.portV4 || 3450;
    this.timeout = config.timeout || 5000;
  }

  /**
   * Notifica um ou múltiplos dashboards com dados de conversa
   * @param {string} conversaId - ID da conversa
   * @param {object} dados - Dados a enviar {conversa_id, phone, nome, msg_cliente, msg_mari}
   */
  async notificar(conversaId, dados) {
    // Executar notificações em paralelo (sem aguardar)
    this._enviarParaDashboard('localhost', this.portV3, '/interno/nova-msg', dados).catch(e => {
      console.warn(`[NOTIFICADOR] Erro dashboard v3: ${e.message}`);
    });

    this._enviarParaDashboard('localhost', this.portV4, '/interno/nova-msg', dados).catch(e => {
      console.warn(`[NOTIFICADOR] Erro dashboard v4: ${e.message}`);
    });

    console.log(`[NOTIFICADOR] Notificação enviada para conversa ${conversaId.slice(0, 8)}...`);
  }

  /**
   * Envia dados para um dashboard específico
   * @private
   */
  _enviarParaDashboard(host, port, path, dados) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(dados);

      const opts = {
        hostname: host,
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      };

      const timer = setTimeout(() => {
        req.destroy();
        reject(new Error(`Timeout ${host}:${port}`));
      }, this.timeout);

      const req = http.request(opts, (res) => {
        clearTimeout(timer);

        let d = '';
        res.on('data', chunk => {
          d += chunk;
        });

        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve({ statusCode: res.statusCode, data: d });
          } else {
            reject(new Error(`Status ${res.statusCode}`));
          }
        });
      });

      req.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      req.write(body);
      req.end();
    });
  }

  /**
   * Notificar com dados estruturados (para futura expansão)
   */
  async notificarEstruturado(tipo, dados) {
    const payload = {
      tipo, // 'nova_mensagem', 'cliente_novo', 'escalonamento', etc
      timestamp: new Date().toISOString(),
      ...dados
    };

    await this.notificar(dados.conversa_id, payload);
  }
}

module.exports = NotificadorDashboard;
