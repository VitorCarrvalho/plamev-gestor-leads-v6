/**
 * routes/sandbox.ts — Proxy para Intelligence V1 (Chat Simulator)
 *
 * Encaminha chamadas de /api/sandbox/* para o Intelligence V1 (porta 3471),
 * repassando o token JWT do operador.
 * O Intelligence V1 valida o mesmo token (compartilham segredo JWT).
 */
import { Router } from 'express';
import { autenticar } from '../middleware/auth';
import http from 'http';

const router = Router();

const INTEL_BASE = process.env.INTELLIGENCE_V1_URL || 'http://localhost:3471';

function proxyPost(targetPath: string, req: any, res: any) {
  const body = JSON.stringify(req.body || {});
  const token = (req.headers.authorization || '').replace('Bearer ', '');

  const url = new URL(targetPath, INTEL_BASE);
  const options: http.RequestOptions = {
    hostname: url.hostname,
    port: Number(url.port) || 80,
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Authorization': `Bearer ${token}`,
    },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    let data = '';
    proxyRes.on('data', chunk => { data += chunk; });
    proxyRes.on('end', () => {
      res.status(proxyRes.statusCode || 200)
        .set('Content-Type', 'application/json')
        .send(data);
    });
  });

  proxyReq.on('error', (e) => {
    res.status(502).json({ erro: `Intelligence V1 indisponível: ${e.message}` });
  });

  proxyReq.write(body);
  proxyReq.end();
}

function proxyGet(targetPath: string, req: any, res: any) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const qs = new URLSearchParams(req.query as any).toString();
  const url = new URL(targetPath + (qs ? `?${qs}` : ''), INTEL_BASE);

  const options: http.RequestOptions = {
    hostname: url.hostname,
    port: Number(url.port) || 80,
    path: url.pathname + url.search,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    let data = '';
    proxyRes.on('data', chunk => { data += chunk; });
    proxyRes.on('end', () => {
      res.status(proxyRes.statusCode || 200)
        .set('Content-Type', 'application/json')
        .send(data);
    });
  });

  proxyReq.on('error', (e) => {
    res.status(502).json({ erro: `Intelligence V1 indisponível: ${e.message}` });
  });

  proxyReq.end();
}

// Chat Simulator
router.post('/chat/mensagem', autenticar, (req, res) => {
  proxyPost('/api/sandbox/chat/mensagem', req, res);
});

router.get('/chat/etapas', autenticar, (req, res) => {
  proxyGet('/api/sandbox/chat/etapas', req, res);
});

// Cenários: salvar e listar simulações
router.get('/cenarios', autenticar, (req, res) => {
  proxyGet('/api/sandbox/cenarios', req, res);
});

router.post('/cenarios', autenticar, (req, res) => {
  proxyPost('/api/sandbox/cenarios', req, res);
});

// CEP (usado no perfil do simulador)
router.post('/cep', autenticar, (req, res) => {
  proxyPost('/api/sistema/cep', req, res);
});

export default router;
