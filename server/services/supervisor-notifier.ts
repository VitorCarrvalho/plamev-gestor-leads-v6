/**
 * server/services/supervisor-notifier.ts
 * Envia alerta WhatsApp pros supervisores cadastrados em mari_config
 * quando uma conversa é marcada como 'pago' via dashboard.
 *
 * Gêmeo simplificado do /mariv3/services/supervisor-notifier.js — vive aqui
 * porque o pago é setado no dashboard e aquele service roda no processo mariv3.
 */
import * as https from 'https';
import { queryOne } from '../config/db';
import { env } from '../config/env';

// DDD → instância (mesmo mapa do sender.js da mariv3).
function instanciaPorDDD(phone: string): string {
  const p = phone.replace(/\D/g, '');
  if (p.startsWith('5511')) return 'mari011';
  if (p.startsWith('5531')) return 'mari-plamev-zap2';
  return 'mari-plamev-zap2';
}

function normalizar(phone: string): string {
  let p = phone.replace(/\D/g, '');
  if (!p.startsWith('55')) p = '55' + p;
  if (p.startsWith('55') && p.length === 12) p = p.slice(0, 4) + '9' + p.slice(4);
  return p;
}

function evolutionPost(path: string, body: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: new URL(env.evolutionUrl).hostname,
        path,
        method: 'POST',
        headers: {
          apikey: env.evolutionKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      res => {
        let d = '';
        res.on('data', c => (d += c));
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function getSupervisores(): Promise<string[]> {
  const row = await queryOne<{ valor: string }>(
    `SELECT valor FROM mari_config WHERE chave='supervisores_telefones'`
  ).catch(() => null);
  if (!row?.valor) return [];
  return row.valor
    .split(',')
    .map(s => s.trim().replace(/\D/g, ''))
    .filter(s => s.length >= 10);
}

interface EtapaCtx {
  clienteNome: string | null;
  clientePhone: string;
  petNome?: string | null;
  petRaca?: string | null;
  cep?: string | null;
  plano?: string | null;
  etapa: string;
}

function formatar(ctx: EtapaCtx, emoji: string, titulo: string, sub: string): string {
  const nome = ctx.clienteNome || 'Lead sem nome';
  const fone = `+${normalizar(ctx.clientePhone)}`;
  const linhas = [`${emoji} *${titulo}*`, sub, '', `*Cliente:* ${nome}`, `*Telefone:* ${fone}`];
  if (ctx.petNome) linhas.push(`*Pet:* ${ctx.petNome}${ctx.petRaca ? ` (${ctx.petRaca})` : ''}`);
  if (ctx.cep) linhas.push(`*CEP:* ${ctx.cep}`);
  if (ctx.plano) linhas.push(`*Plano:* ${ctx.plano}`);
  linhas.push(`*Etapa:* ${ctx.etapa}`);
  return linhas.join('\n');
}

export async function notificarPagoManual(ctx: EtapaCtx): Promise<void> {
  const supers = await getSupervisores();
  if (supers.length === 0) return;

  const texto = formatar(ctx, '💰', 'PAGAMENTO CONFIRMADO',
    'Adesão marcada como paga no ERP pelo supervisor.');

  for (const phone of supers) {
    const inst = instanciaPorDDD(phone);
    const numero = normalizar(phone) + '@s.whatsapp.net';
    try {
      await evolutionPost(`/message/sendText/${inst}`, { number: numero, text: texto });
      console.log(`[SUPERVISOR] ✅ alerta pago enviado pra ${phone}`);
    } catch (e: any) {
      console.warn(`[SUPERVISOR] falhou pra ${phone}: ${e.message}`);
    }
  }
}
