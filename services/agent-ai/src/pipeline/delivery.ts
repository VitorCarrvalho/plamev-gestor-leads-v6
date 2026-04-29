import https from 'https';
import http from 'http';
import { InternalMessage } from '@plamev/shared';

const CHANNEL_SERVICE_URL = process.env.CHANNEL_SERVICE_URL || 'http://channel-service.railway.internal:8080';
const CRM_SERVICE_URL = process.env.CRM_SERVICE_URL || 'http://crm-service.railway.internal:8080';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'plamev-internal';

export function postJson(url: string, body: any, headers: Record<string, string> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try { parsed = new URL(url); } catch { return reject(new Error(`URL inválida: ${url}`)); }
    const lib = parsed.protocol === 'https:' ? https : http;
    const payload = JSON.stringify(body);
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port, 10) : undefined,
      path: parsed.pathname + (parsed.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers,
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({}); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(payload);
    req.end();
  });
}

export async function sendResponse(message: InternalMessage, resposta: string) {
  return postJson(
    `${CHANNEL_SERVICE_URL}/internal/send`,
    { message, resposta },
    { 'x-internal-secret': INTERNAL_SECRET },
  );
}

export async function sendDocument(
  message: InternalMessage,
  pdfBuffer: Buffer,
  fileName: string,
  caption = '',
) {
  return postJson(
    `${CHANNEL_SERVICE_URL}/internal/send-document`,
    {
      message,
      base64: pdfBuffer.toString('base64'),
      fileName,
      caption,
    },
    { 'x-internal-secret': INTERNAL_SECRET },
  );
}

export async function persistInteraction(
  message: InternalMessage,
  resposta: string,
  options?: { inputTextOverride?: string },
) {
  return postJson(
    `${CRM_SERVICE_URL}/api/internal/salvar-interacao`,
    {
      message,
      resposta,
      input_text_override: options?.inputTextOverride || null,
    },
    { 'x-internal-secret': INTERNAL_SECRET },
  );
}
