/**
 * services/actions.service.ts
 * Ações operacionais do supervisor: provocar, falar direto, instruir Mari, enviar manual.
 * Integra com Evolution API para envio e com Anthropic para geração de texto.
 */
import https from 'https';
import fs from 'fs';
import path from 'path';
import { env } from '../config/env';
import { queryOne, query, execute } from '../config/db';
let io: any = null;
export function setIo(ioInstance: any) { io = ioInstance; }

// PDFs ficam em mariv3/public/manuais/ (pasta irmã do dashboard-v5)
const PASTA_MANUAIS = process.env.MANUAIS_PATH
  || path.resolve(__dirname, '../../../mariv3/public/manuais');

// ── Evolution API — envio de mensagem ─────────────────────────
function evolutionPost(path: string, body: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: new URL(env.evolutionUrl).hostname,
      path,
      method: 'POST',
      headers: {
        apikey: env.evolutionKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

/** Determina instância correta baseado no sender_chip registrado */
async function resolverInstancia(conversaId: string): Promise<{ instancia: string; numero: string }> {
  const conv = await queryOne<any>(
    'SELECT numero_externo, jid, instancia_whatsapp, sender_chip FROM conversas WHERE id = $1',
    [conversaId]
  );
  if (!conv) throw new Error('Conversa não encontrada');
  const instancia = conv.instancia_whatsapp || 'mari-plamev-whatsapp';
  const numero    = conv.jid || (conv.numero_externo + '@s.whatsapp.net');
  return { instancia, numero };
}

/** Envia mensagem diretamente pelo chip correto */
async function enviarMensagem(conversaId: string, texto: string): Promise<void> {
  const { instancia, numero } = await resolverInstancia(conversaId);
  const r = await evolutionPost(`/message/sendText/${instancia}`, { number: numero, text: texto });
  if (!r.key && !r.id) throw new Error(`Falha no envio: ${JSON.stringify(r).slice(0, 100)}`);
}

// ── Anthropic — geração de texto contextualizado ───────────────
// REJECT em vez de resolver com string vazia — evita enviar msg em branco ao cliente.
// Todos os callers têm try/catch (socket handlers) que convertem em 'erro' pro supervisor.
async function gerarTexto(system: string, user: string): Promise<string> {
  if (!env.anthropicKey) {
    throw new Error('[gerarTexto] ANTHROPIC_API_KEY não configurada');
  }
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: env.claudeModel,
      max_tokens: 150,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'x-api-key': env.anthropicKey, 'anthropic-version': '2023-06-01',
        'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
      },
      timeout: 20_000,
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(d);
          if (parsed.error) {
            reject(new Error(`[gerarTexto] API error: ${parsed.error.message || JSON.stringify(parsed.error)}`));
            return;
          }
          const texto = parsed.content?.[0]?.text?.trim();
          if (!texto) {
            reject(new Error('[gerarTexto] Claude retornou resposta vazia'));
            return;
          }
          resolve(texto);
        } catch (err: any) {
          reject(new Error(`[gerarTexto] Falha ao parsear: ${err.message}`));
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('[gerarTexto] Timeout (20s)')); });
    req.on('error', err => reject(new Error(`[gerarTexto] Erro de rede: ${err.message}`)));
    req.write(body); req.end();
  });
}

// ── Buscar contexto do cliente para geração ───────────────────
async function contextoCliente(conversaId: string) {
  const conv     = await queryOne<any>('SELECT * FROM conversas WHERE id = $1', [conversaId]);
  const cliente  = await queryOne<any>('SELECT * FROM clientes WHERE id = $1', [conv?.client_id]);
  const perfil   = await queryOne<any>(
    'SELECT * FROM perfil_pet WHERE client_id = $1 ORDER BY atualizado_em DESC LIMIT 1',
    [conv?.client_id]
  );
  const historico = await query<any>(
    'SELECT role, conteudo FROM mensagens WHERE conversa_id = $1 ORDER BY timestamp DESC LIMIT 8',
    [conversaId]
  );
  return { conv, cliente, perfil, historico: historico.reverse() };
}

// ── PROVOCAR — reativação contextualizada ─────────────────────
export async function provocar(conversaId: string): Promise<string> {
  const { cliente, perfil, historico } = await contextoCliente(conversaId);
  const nomePet    = perfil?.nome_pet || '';
  const nomeCliente = cliente?.nome   || '';
  const histTxt    = historico.slice(-4)
    .map(h => `${h.role === 'user' ? nomeCliente : 'Mari'}: ${h.conteudo.slice(0, 80)}`)
    .join('\n');

  const system = `Você é Mari, consultora da Plamev. Calorosa, natural, WhatsApp. Sem asteriscos. Máx 2 frases.`;
  const user   = `Gere UMA mensagem de reativação para ${nomeCliente}${nomePet ? ` (pet: ${nomePet})` : ''}.
Histórico recente:\n${histTxt || '(sem histórico)'}
Seja espontânea, mencione o pet se souber o nome. NÃO mencione que é automático.`;

  const msg = await gerarTexto(system, user);
  if (!msg) throw new Error('Sem resposta do Claude');

  // Enviar e salvar no histórico
  let enviado = false;
  try {
    await enviarMensagem(conversaId, msg);
    enviado = true;
  } catch (e: any) {
    console.warn('[ACTIONS] Provocar — envio falhou:', e.message);
  }

  // Salvar no histórico independente de ter enviado
  await execute(
    `INSERT INTO mensagens (conversa_id, role, conteudo, enviado_por) VALUES ($1,$2,$3,$4)`,
    [conversaId, 'agent', msg, 'ia']
  ).catch(() => {});

  // Notificar dashboard via nova_msg
  if (enviado) {
    const convData = await queryOne<any>('SELECT numero_externo FROM conversas WHERE id=$1', [conversaId]);
    const cliData  = await queryOne<any>('SELECT nome FROM clientes WHERE id=(SELECT client_id FROM conversas WHERE id=$1)', [conversaId]);
    io?.emit('nova_msg', {
      conversa_id: conversaId,
      msg_mari: msg,
      phone: convData?.numero_externo,
      nome: cliData?.nome,
      timestamp: new Date().toISOString(),
    });
  }

  return msg;
}

// ── INSTRUIR MARI — supervisor instrui, Mari reescreve e envia ──
export async function instruirMari(conversaId: string, instrucao: string): Promise<string> {
  const { cliente, perfil, historico } = await contextoCliente(conversaId);
  const nomePet    = perfil?.nome_pet || '';
  const nomeCliente = cliente?.nome   || '';
  const histTxt    = historico.slice(-4)
    .map(h => `${h.role === 'user' ? nomeCliente : 'Mari'}: ${h.conteudo.slice(0, 80)}`)
    .join('\n');

  const system = `Você é Mari, consultora da Plamev. Calorosa, natural, WhatsApp. Sem asteriscos. Máx 2 frases.`;
  const user   = `Cliente: ${nomeCliente}${nomePet ? ` | Pet: ${nomePet}` : ''}
Histórico:\n${histTxt}
INSTRUÇÃO DO SUPERVISOR: ${instrucao}
Gere a mensagem seguindo a instrução, no seu estilo natural.`;

  const msg = await gerarTexto(system, user);
  if (!msg) throw new Error('Sem resposta do Claude');
  await enviarMensagem(conversaId, msg);
  return msg;
}

// ── FALAR DIRETO — supervisor escreve, Mari reescreve (opcional) ─
// Se a reescrita falhar (Claude off, timeout, etc), manda o texto ORIGINAL —
// nunca manda vazio. Supervisor tem o controle final.
export async function falarDireto(conversaId: string, texto: string, reescrever = true): Promise<string> {
  let msgFinal = texto;

  if (reescrever) {
    try {
      const { cliente, perfil } = await contextoCliente(conversaId);
      const nomePet    = perfil?.nome_pet || '';
      const nomeCliente = cliente?.nome   || '';
      const system = `Você é Mari, da Plamev. Calorosa, natural, WhatsApp. Sem asteriscos. Máx 2 frases.`;
      const user   = `Reescreva no seu estilo: "${texto}"
Cliente: ${nomeCliente}${nomePet ? ` | Pet: ${nomePet}` : ''}`;
      msgFinal = await gerarTexto(system, user);
    } catch (e: any) {
      console.warn('[falarDireto] reescrita falhou, enviando texto original:', e.message);
      msgFinal = texto;
    }
  }

  await enviarMensagem(conversaId, msgFinal);
  return msgFinal;
}

// ── PREVIEW — prévia antes de enviar ─────────────────────────
export async function previewFalarDireto(conversaId: string, texto: string): Promise<string> {
  const { cliente, perfil } = await contextoCliente(conversaId);
  const system = `Você é Mari, da Plamev. Calorosa, natural, WhatsApp. Sem asteriscos. Máx 2 frases.`;
  const user   = `Reescreva: "${texto}"\nCliente: ${cliente?.nome || ''}${perfil?.nome_pet ? ` | Pet: ${perfil.nome_pet}` : ''}`;
  return gerarTexto(system, user);
}

// ── REESCREVER COMO MARI — com contexto opcional e instrução personalizada ─
// Usado pela toolbar de mensagem (editar/excluir/reescrever no ChatWindow).
export async function reescreverComoMari(
  conversaId: string | undefined,
  textoOriginal: string,
  instrucaoExtra?: string
): Promise<string> {
  let ctx = '';
  if (conversaId) {
    try {
      const { cliente, perfil, historico } = await contextoCliente(conversaId);
      const nomePet     = perfil?.nome_pet || '';
      const nomeCliente = cliente?.nome   || '';
      const histTxt     = historico.slice(-4)
        .map(h => `${h.role === 'user' ? (nomeCliente || 'Cliente') : 'Mari'}: ${h.conteudo.slice(0, 80)}`)
        .join('\n');
      ctx = `\nCliente: ${nomeCliente}${nomePet ? ` | Pet: ${nomePet}` : ''}`;
      if (histTxt) ctx += `\nHistórico recente:\n${histTxt}`;
    } catch { /* contexto é opcional */ }
  }

  const system = `Você é Mari, consultora da Plamev. Calorosa, natural, WhatsApp brasileiro.
Sem asteriscos. Máximo 2-3 frases. Use emoji com moderação (1-2 por mensagem).`;
  const user = `Reescreva o texto abaixo no seu estilo${instrucaoExtra ? `, seguindo esta instrução adicional: ${instrucaoExtra}` : ''}.

TEXTO:
"""
${textoOriginal}
"""
${ctx}

Retorne APENAS o texto reescrito, sem aspas, sem comentários.`;

  return gerarTexto(system, user);
}

// ── ENVIAR MANUAL — supervisor envia PDF do plano direto ao cliente ──
export async function enviarManual(conversaId: string, planoSlug: string): Promise<string> {
  const { instancia, numero } = await resolverInstancia(conversaId);

  // Buscar manual no banco
  const manual = await queryOne<any>(
    `SELECT * FROM manuais_planos WHERE plano_slug = $1 AND ativo = true ORDER BY id DESC LIMIT 1`,
    [planoSlug || 'geral']
  ) || await queryOne<any>(
    `SELECT * FROM manuais_planos WHERE plano_slug = 'geral' AND ativo = true ORDER BY id DESC LIMIT 1`
  );

  if (!manual) throw new Error(`Nenhum manual cadastrado para o plano: ${planoSlug}`);

  const caminhoArquivo = path.join(PASTA_MANUAIS, manual.arquivo_nome);
  if (!fs.existsSync(caminhoArquivo)) {
    throw new Error(`Arquivo não encontrado: ${manual.arquivo_nome}. Verifique mariv3/public/manuais/`);
  }

  const base64   = fs.readFileSync(caminhoArquivo).toString('base64');
  const fileName = manual.arquivo_nome;
  const caption  = `📄 ${manual.plano_nome}`;

  const r = await evolutionPost(`/message/sendMedia/${instancia}`, {
    number:    numero,
    mediatype: 'document',
    mimetype:  'application/pdf',
    media:     base64,
    fileName,
    caption,
  });

  if (!r.key && !r.id) throw new Error(`Falha ao enviar PDF: ${JSON.stringify(r).slice(0, 100)}`);

  // Salvar no histórico
  await execute(
    `INSERT INTO mensagens (conversa_id, role, conteudo, enviado_por) VALUES ($1,$2,$3,$4)`,
    [conversaId, 'agent', `[📄 Manual enviado pelo supervisor: ${manual.plano_nome} ${manual.versao}]`, 'supervisor']
  ).catch(() => {});

  console.log(`[ACTIONS-V5] ✅ Manual "${manual.plano_nome}" enviado para ${numero}`);
  return `Manual ${manual.plano_nome} (${manual.versao}) enviado com sucesso!`;
}
