import { InternalMessage } from '@plamev/shared';
import { pool, searchKnowledge } from './rag';
import { checkInputGuard } from './guards/input-guard';
import { validateClaims } from './guards/output-guard';
import { generateResponse, ChatMessage } from '../clients/llm-client';
import { langfuse } from '../clients/langfuse-client';
import { sendResponse, persistInteraction, sendDocument, atualizarMsgIdExterno } from './delivery';
import { carregar as vaultCarregar } from '../services/vault';
import { buscarRedeCredenciada, normalizarCep, validarCep, type RedeResult } from '../services/rede-credenciada';
import {
  buscarEnderecoPorCep,
  encontrarRacaPorNome,
  submeterCotacao,
  extrairDdd,
  formatarDataNascimento,
  normalizarCidade,
  resolverCoberturaIdPorNome,
  resolverCoberturaPorNomeViaApi,
  type CotacaoPayload,
  getCampaignByPlanAndState,
  getCampaignPriceTable,
  findMatchingPriceTable,
  getPlanNameByCoberturasId,
  buscarEstados,
} from '../services/cotacao';
import { gerarCotacaoPdf } from '../services/cotacao-pdf';
import {
  resolverConfigRuntimeAgente,
  ResolvedAgentRuntimeConfig,
  buscarContextoConversaAtiva,
  buscarTabelaPlanos,
  buscarPrompts,
  atualizarConversa,
} from '../db';
import {
  buildGreetingResponse,
  buildMariPrompt,
  chooseNonRepeatingFallback,
  detectCatalogIntent,
  detectGreetingOnly,
  detectPriceIntent,
  formatConversationStatePrompt,
  formatProductCatalogPrompt,
  formatPriceFloorSummary,
  inferTargetStage,
} from './mari-runtime';

function detectarCepNoTexto(texto: string): string | null {
  const semEspacos = texto.replace(/\s/g, '');
  const matchHifen = texto.match(/\b(\d{5})-(\d{3})\b/);
  if (matchHifen) return matchHifen[1] + matchHifen[2];
  const matchPuro = semEspacos.match(/\b(\d{8})\b/);
  if (matchPuro) return validarCep(matchPuro[1]) ? matchPuro[1] : null;
  return null;
}

function formatarSecaoRede(result: RedeResult, cep: string): string {
  if (result.status === 'cep_invalido') {
    return `CEP "${cep}" é inválido. Instrua o cliente a enviar um CEP com 8 números.`;
  }
  if (result.status === 'erro_servico') {
    return 'Serviço de rede credenciada indisponível agora. Informe ao cliente de forma amigável e sugira tentar novamente em instantes.';
  }
  if (result.status === 'sem_cobertura') {
    return `CEP ${cep} consultado agora — sem clínicas credenciadas em até 40 km. Informe com empatia e ofereça cadastro na lista de espera.`;
  }
  return `Dados REAIS de rede credenciada consultados agora para o CEP ${cep}. Use EXATAMENTE as clínicas abaixo, sem inventar outras:\n\n${result.texto}`;
}

async function lf_flush() {
  try { await langfuse.flushAsync(); }
  catch (e: any) { console.error('[LANGFUSE] ❌ Flush falhou:', e?.message ?? e); }
}

// Dado o índice de um preço na resposta, identifica o plano mais próximo mencionado
// antes (ou logo após) esse preço — retorna o slug do plano ou null.
function detectPlanSlugForPrice(text: string, priceIndex: number, priceLength: number): string | null {
  const before = text.substring(Math.max(0, priceIndex - 350), priceIndex);
  const after  = text.substring(priceIndex + priceLength, Math.min(text.length, priceIndex + priceLength + 100));
  const ctx    = before + ' ' + after;

  // Ordem importa: padrões mais específicos (plus) devem vir antes dos genéricos
  const patterns: Array<{ re: RegExp; slug: string }> = [
    { re: /advance[\s_]plus/gi,  slug: 'advance_plus'  },
    { re: /platinum[\s_]plus/gi, slug: 'platinum_plus' },
    { re: /diamond[\s_]plus/gi,  slug: 'diamond_plus'  },
    { re: /\badvance\b/gi,       slug: 'advance'       },
    { re: /\bplatinum\b/gi,      slug: 'platinum'      },
    { re: /\bdiamond\b/gi,       slug: 'diamond'       },
    { re: /\bslim\b/gi,          slug: 'slim'          },
  ];

  // Pega a menção com maior índice em `before` (a mais próxima do preço)
  let lastIdx = -1;
  let result: string | null = null;
  for (const { re, slug } of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(before)) !== null) {
      if (m.index > lastIdx) { lastIdx = m.index; result = slug; }
    }
  }
  if (result) return result;

  // Se não achou antes, tenta no trecho após o preço
  for (const { re, slug } of patterns) {
    re.lastIndex = 0;
    if (re.test(after)) return slug;
  }
  return null;
}

const HISTORY_LIMIT = 30;

// ── Cotação: disparo não-bloqueante ───────────────────────────
async function dispararCotacao(
  msg: InternalMessage,
  dados: Record<string, any>,
  conversaAtual: any,
) {
  const tag = `[COTACAO] ${msg.phone}`;
  try {
    // Extrai dados do lead dos dados_extraidos + conversa + perfil_pet
    // Suporta chaves abreviadas (nc/np/ep/rp/cp/em/dn/sx/ci) e chaves completas
    const nomeCliente = dados.nome || dados.nc || dados.tutor_nome || conversaAtual?.tutor_nome || msg.nome || '';
    const email       = dados.email || dados.em || conversaAtual?.email || '';
    const telefone    = dados.telefone || msg.phone || '';
    const cepRaw      = dados.cep || dados.cp || conversaAtual?.cep || '';
    const petNome     = dados.pet_nome || dados.nome_pet || dados.np || conversaAtual?.nome_pet || '';
    const petNasc     = formatarDataNascimento(dados.pet_nascimento || dados.data_nascimento || dados.dn || '') || '';
    const petSexo     = dados.pet_sexo || dados.sexo || dados.sx || conversaAtual?.sexo || 'Macho';
    const petEspecie  = (dados.pet_especie || dados.especie || dados.ep || '2') as '1' | '2';
    const petRacaNome = dados.pet_raca || dados.raca || dados.rp || conversaAtual?.raca || '';
    const coberturaId = dados.cobertura_id || dados.coberturasId || dados.ci || conversaAtual?.plano_recomendado || '';
    const planoInteresse = dados.plano_interesse || dados.pi || conversaAtual?.plano_recomendado || '';
    // Valor negociado: prioriza dados_extraidos (mais fresco), depois o persistido na conversa
    const valorOfertado = dados.valor_ofertado || dados.vo || conversaAtual?.valor_ofertado || null;

    if (!nomeCliente || !email || !coberturaId || !cepRaw) {
      console.warn(`${tag} ⚠️ Dados insuficientes para cotação (nome=${!!nomeCliente} email=${!!email} cobertura=${!!coberturaId} cep=${!!cepRaw})`);
      await sendResponse(msg, 'Para gerar sua cotação ainda preciso de alguns dados. Pode me informar: nome completo, e-mail, CEP e qual plano você escolheu? 😊');
      return;
    }

    // Endereço via ViaCEP
    const endereco = await buscarEnderecoPorCep(cepRaw);
    if (!endereco) {
      console.warn(`${tag} ⚠️ CEP inválido ou não encontrado: ${cepRaw}`);
      return;
    }

    // Resolvendo EstadosId (UUID)
    const estados = await buscarEstados();
    const estadoIdUuid = estados.find(e => e.uf === endereco.uf)?.id;
    if (!estadoIdUuid) {
      console.warn(`${tag} ⚠️ Estado de cobertura não encontrado para o CEP informado: ${cepRaw} (${endereco.uf})`);
      return;
    }

    // Raça → UUID (normaliza para lowercase)
    let racaId = (dados.racas_id || dados.racasId || '').toLowerCase();
    if (!racaId && petRacaNome) {
      const raca = await encontrarRacaPorNome(petRacaNome, petEspecie);
      racaId = raca?.id?.toLowerCase() || (petEspecie === '2' ? 'SEMRACA2' : 'SEMRACA1');
    }
    if (!racaId) racaId = petEspecie === '2' ? 'SEMRACA2' : 'SEMRACA1';

    let coberturaIdResolvido = coberturaId;
    let campanhasCoberturasId: string | undefined;
    let campanhasCoberturasTabelasId: string | undefined;

    // ── Resolver nome do plano negociado ──────────────────────
    // planoInteresse (pi) tem prioridade; se nulo mas ci é UUID conhecido, faz reverse lookup.
    const uuidPatternCheck = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let planoNomeParaBusca = planoInteresse;
    if (!planoNomeParaBusca && coberturaId && uuidPatternCheck.test(coberturaId)) {
      planoNomeParaBusca = await getPlanNameByCoberturasId(coberturaId);
      if (planoNomeParaBusca) console.log(`${tag} 🔍 Nome do plano resolvido via UUID: ${coberturaId} → "${planoNomeParaBusca}"`);
    }
    // Se ci foi enviado como string textual ("Advance"), usa-o como nome também.
    if (!planoNomeParaBusca && coberturaId && !uuidPatternCheck.test(coberturaId)) {
      planoNomeParaBusca = coberturaId;
    }

    if (planoNomeParaBusca) {
      console.log(`${tag} 🔍 Resolvendo plano "${planoNomeParaBusca}" via API Plamev${valorOfertado ? ` (valor negociado R$ ${valorOfertado})` : ''}`);

      // ── REQ 2: /Coberturas/BuscarCoberturasComPreco ─────────────
      // Fonte canônica de CoberturasId E TiposCoberturasId (não usar tabela local stale)
      const cobApi = await resolverCoberturaPorNomeViaApi(planoNomeParaBusca, endereco.uf);
      if (!cobApi) {
        console.warn(`${tag} ⚠️ Plano "${planoNomeParaBusca}" não encontrado na API Plamev para UF=${endereco.uf}`);
        // Fallback: tenta resolver via cache local antigo
        const fallback = await resolverCoberturaIdPorNome(planoNomeParaBusca, endereco.uf);
        if (fallback) {
          coberturaIdResolvido = fallback;
          console.log(`${tag} ⚠️ Usando fallback local para CoberturasId — sem campanha`);
        } else {
          await sendResponse(msg, 'Tive um problema ao identificar o plano escolhido. Pode me confirmar qual plano você quer? 😊');
          return;
        }
      } else {
        coberturaIdResolvido = cobApi.coberturasId;
        console.log(`${tag} ✅ Req 2: CoberturasId=${cobApi.coberturasId} TiposCoberturasId=${cobApi.tiposCoberturasId} ("${cobApi.nomeApi}")`);

        // ── REQ 3: /CampanhasCoberturas/BuscarCampanhasEv ─────────────
        // Match EXATO do nome (sem incluir variantes promocionais como "ADVANCE 50%")
        if (cobApi.tiposCoberturasId > 0) {
          const campanha = await getCampaignByPlanAndState(cobApi.tiposCoberturasId, estadoIdUuid, planoNomeParaBusca);
          if (!campanha) {
            console.warn(`${tag} ⚠️ Req 3: campanha não encontrada para "${planoNomeParaBusca}" no estado ${estadoIdUuid}`);
          } else {
            campanhasCoberturasId = campanha.CampanhasCoberturasId;
            console.log(`${tag} ✅ Req 3: CampanhasCoberturasId=${campanhasCoberturasId}`);

            // ── REQ 4: /CampanhasCoberturasTabelas/consultar ─────────
            // Match por valor negociado com tolerância de ±R$1,00
            if (valorOfertado) {
              const tables = await getCampaignPriceTable(campanha.CampanhasCoberturasId);
              const precoNumerico = typeof valorOfertado === 'string'
                ? parseFloat(valorOfertado.replace(',', '.'))
                : parseFloat(String(valorOfertado));

              if (!isNaN(precoNumerico)) {
                const tableMatch = findMatchingPriceTable(tables, precoNumerico);
                if (!tableMatch) {
                  console.warn(`${tag} ⚠️ Req 4: tabela não encontrada para R$ ${precoNumerico} — usando campanha sem tabela`);
                  const nomesTabelas = tables.map((t: any) => t.Nome).join(' | ');
                  if (nomesTabelas) console.warn(`${tag}   Tabelas disponíveis: ${nomesTabelas}`);
                } else {
                  campanhasCoberturasTabelasId = tableMatch.Id;
                  console.log(`${tag} ✅ Req 4: CampanhasCoberturasTabelasId=${campanhasCoberturasTabelasId} ("${tableMatch.Nome}")`);
                }
              }
            } else {
              console.log(`${tag} ℹ️ Sem valor negociado — Req 4 (tabela) ignorada`);
            }
          }
        }
      }
    } else {
      console.warn(`${tag} ⚠️ Plano de interesse não identificado (pi e ci ausentes) — cotação sem campanha`);
    }

    // DDD + número — strip código de país 55 se presente
    let telefoneBruto = telefone.replace(/\D/g, '');
    if (telefoneBruto.startsWith('55') && telefoneBruto.length > 11) {
      telefoneBruto = telefoneBruto.slice(2);
    }
    const { ddd, numero } = extrairDdd(telefoneBruto);

    const payload: CotacaoPayload = {
      nome: nomeCliente,
      email,
      ddd,
      telefone: numero,
      cep: endereco.cep,
      logradouro: endereco.logradouro,
      numero: dados.numero_endereco || 'S/N',
      complemento: dados.complemento || '',
      bairro: endereco.bairro,
      estadosId: endereco.uf,
      cidadesId: normalizarCidade(endereco.cidade),
      formaPagamento: 2,
      cupomDesconto: '',
      pets: [{
        nome: petNome || 'Pet',
        dataNascimento: petNasc || '01/01/2022',
        sexo: ['Macho', 'Fêmea'].includes(petSexo) ? petSexo as 'Macho' | 'Fêmea' : 'Macho',
        especie: petEspecie,
        racasId: racaId,
        coberturasId: coberturaIdResolvido,
        campanhasCoberturasId,
        campanhasCoberturasTabelasId,
      }],
    };

    console.log(`${tag} 🔄 Submetendo cotação para ${nomeCliente} (pet: ${petNome}) | ddd=${ddd} tel=${numero} cep=${endereco.cep} uf=${endereco.uf} ci=${coberturaIdResolvido} especie=${petEspecie} raca=${racaId}`);
    const resultado = await submeterCotacao(payload);
    console.log(`${tag} ✅ Cotação ${resultado.numeroCotacao} gerada — ${resultado.valorTotalMensalidade}/mês`);

    // Gera PDF
    const pdfBuffer = await gerarCotacaoPdf(resultado, payload);
    const fileName = `cotacao-plamev-${resultado.numeroCotacao.replace(/[^a-zA-Z0-9]/g, '-')}.pdf`;
    console.log(`${tag} 📄 PDF gerado (${Math.round(pdfBuffer.length / 1024)}KB)`);

    // Envia PDF via WhatsApp
    await sendDocument(msg, pdfBuffer, fileName, `Aqui está sua cotação Plamev! Nº ${resultado.numeroCotacao} 🐾`);
    console.log(`${tag} 📤 PDF enviado via WhatsApp`);

    // Envia link de pagamento (só se tiver id válido)
    if (resultado.id) {
      const linkPagamento = `https://cliente.plamev.com.br/pagamento/checkout/${resultado.id}`;
      const msgPagamento = [
        `Para finalizar a contratação, acesse o link de pagamento seguro abaixo 👇`,
        ``,
        linkPagamento,
        ``,
        `*Atenção:* realize o pagamento somente pelo site oficial da Plamev (*cliente.plamev.com.br*). Não acesse links recebidos de outras fontes.`,
        ``,
        `Assim que concluir o pagamento, me confirma aqui pra eu registrar tudo certinho? 💛`,
      ].join('\n');
      await sendResponse(msg, msgPagamento);
      console.log(`${tag} 🔗 Link de pagamento enviado: ${linkPagamento}`);
    }
  } catch (e: any) {
    console.error(`${tag} ❌ Falha ao disparar cotação:`, e.message);
    if (e.erros) console.error(`${tag}   Erros de validação:`, JSON.stringify(e.erros));
    await sendResponse(msg, 'Tive um problema ao gerar sua cotação 😕 Pode me chamar novamente para eu tentar de novo?').catch(() => {});
  }
}

// ── 1. Histórico de mensagens ─────────────────────────────────
async function buscarHistorico(orgId: string, phone: string, canal: string): Promise<ChatMessage[]> {
  try {
    const { rows } = await pool.query(`
      SELECT m.role, m.conteudo, m.enviado_por
      FROM mensagens m
      JOIN conversas c ON c.id = m.conversa_id
      WHERE c.numero_externo = $1
        AND c.org_id = $2
        AND c.canal = $3
        AND c.status = 'ativa'
        AND m.role IN ('user', 'agent', 'system')
      ORDER BY m.timestamp DESC
      LIMIT $4
    `, [phone, orgId, canal, HISTORY_LIMIT]);
    return rows.reverse().map((r: any) => {
      // Mensagens de sistema (supervisora) entram como 'user' no contexto do Claude
      // para serem interpretadas como ordens/contexto.
      if (r.role === 'system') {
        return { role: 'user', content: r.conteudo };
      }
      return {
        role: r.role === 'agent' ? 'assistant' : 'user',
        content: r.conteudo,
      };
    }) as ChatMessage[];
  } catch (e: any) {
    console.warn(`[PIPELINE] ⚠️ Histórico indisponível: ${e.message}`);
    return [];
  }
}

export interface PipelineRuntimeContext {
  orgId: string;
  agentConfig: ResolvedAgentRuntimeConfig;
}

// ── PIPELINE PRINCIPAL ────────────────────────────────────────
export async function processMessage(msg: InternalMessage, runtimeContext?: PipelineRuntimeContext) {
  const start = Date.now();
  const agentSlug = msg.agentSlug || 'mari';
  const fallbackConfig = runtimeContext ? null : await resolverConfigRuntimeAgente(agentSlug);
  const resolvedContext = runtimeContext || {
    agentConfig: fallbackConfig!,
    orgId: fallbackConfig!.org_id,
  };
  const config = resolvedContext.agentConfig;
  const orgId = resolvedContext.orgId || config.org_id;
  const tag = `[PIPELINE] ${orgId}:${msg.canal}:${msg.phone}`;
  console.log(`${tag} ▶ Início | texto="${(msg.texto || '').substring(0, 60)}"`);

  // Langfuse: inicia trace para esta mensagem
  const trace = langfuse.trace({
    name:      'message-pipeline',
    userId:    msg.phone,
    sessionId: `${msg.canal}:${msg.phone}`,
    tags:      [msg.canal, agentSlug, orgId, 'production'],
    input:     msg.texto || '',
    metadata:  {
      orgId,
      canal:     msg.canal,
      phone:     msg.phone,
      agentSlug,
      agentId:   config.id,
      instancia: msg.instancia,
      nome:      msg.nome,
    },
  });

  // ── ETAPA 1: Input Guard ──────────────────────────────────
  const t1 = Date.now();
  const guardSpan = trace.span({
    name:  '1-input-guard',
    input: { texto: msg.texto, canal: msg.canal, phone: msg.phone },
  });

  const guardResult = await checkInputGuard(msg);

  guardSpan.end({
    output:   {
      action: guardResult.action,
      intent: guardResult.intent,
      reason: guardResult.reason ?? null,
      matchedRules: guardResult.matchedRules ?? [],
      failOpen: guardResult.failOpen ?? false,
      latencyMs: guardResult.latencyMs,
    },
    level:    guardResult.action === 'escalate' ? 'WARNING' : guardResult.action === 'drop' ? 'ERROR' : 'DEFAULT',
    metadata: {
      action: guardResult.action,
      intent: guardResult.intent,
      reason: guardResult.reason ?? null,
      matched_rules: guardResult.matchedRules ?? [],
      fail_open: guardResult.failOpen ?? false,
    },
  });

  console.log(
    `${tag} [1/7] InputGuard → action=${guardResult.action} intent=${guardResult.intent}` +
    `${guardResult.reason ? ` reason="${guardResult.reason}"` : ''}` +
    `${guardResult.failOpen ? ' failOpen=true' : ''}` +
    ` (${Date.now() - t1}ms)`,
  );

  if (guardResult.action === 'drop') {
    console.log(`${tag} 🛑 Descartada pelo guard`);
    trace.update({
      output: 'dropped',
      metadata: {
        reason: 'input_guard_drop',
        input_guard_reason: guardResult.reason ?? null,
        input_guard_rules: guardResult.matchedRules ?? [],
        input_guard_fail_open: guardResult.failOpen ?? false,
      },
    });
    await lf_flush();
    return;
  }
  if (guardResult.action === 'escalate') {
    console.log(`${tag} 🚨 Escalando para humano`);
    trace.update({
      output: 'escalated',
      metadata: {
        reason: 'pedido_humano',
        input_guard_reason: guardResult.reason ?? null,
        input_guard_rules: guardResult.matchedRules ?? [],
        input_guard_fail_open: guardResult.failOpen ?? false,
      },
    });
    await lf_flush();
    return;
  }

  // ── ETAPA 2: Contexto em paralelo ────────────────────────
  const t2 = Date.now();
  const ctxSpan = trace.span({
    name:  '2-context-load',
    input: { agentSlug, orgId, phone: msg.phone, canal: msg.canal },
  });

  // Detecta CEP na mensagem corrente; fallback para CEP salvo na conversa ocorre após Promise.all
  const cepDetectado = detectarCepNoTexto(msg.texto || '');

  // Carrega prompts em paralelo: vault (primário) + banco (fallback) + contexto
  // Tom-e-Fluxo.md removido — conteúdo absorvido pelo Identidade.md
  const [vaultSoul, vaultRegras, vaultAntiRep, vaultPensamentos, vaultModoRapido,
         promptBundle, historico, conversaAtual, tabelaPlanos, redeResult] = await Promise.all([
    vaultCarregar('Mari/Identidade.md'),
    vaultCarregar('Mari/Regras-Absolutas.md'),
    vaultCarregar('Mari/Anti-Repeticao.md'),
    vaultCarregar('Mari/Personalidade-Vendas.md'),
    vaultCarregar('Mari/Modo-Rapido.md'),
    buscarPrompts(Number(config.id)).catch(() => ({})),
    buscarHistorico(orgId, msg.phone, msg.canal),
    buscarContextoConversaAtiva(orgId, msg.phone, msg.canal),
    buscarTabelaPlanos().catch(() => []),
    cepDetectado
      ? buscarRedeCredenciada(cepDetectado).catch(() => ({ status: 'erro_servico' } as RedeResult))
      : Promise.resolve(null as RedeResult | null),
  ]);


  // ── Verificar se IA está silenciada ──────────────────────────
  if (conversaAtual?.ia_silenciada) {
    console.log(`${tag} 🔇 IA silenciada para esta conversa — salvando mensagem mas não respondendo`);

    // Salvar a mensagem do cliente no CRM mesmo com IA silenciada,
    // para que o chat continue atualizado e o histórico fique completo
    try {
      await persistInteraction(msg, '', {});
      console.log(`${tag} 🔇 Mensagem do cliente persistida (IA silenciada)`);
    } catch (e: any) {
      console.error(`${tag} ❌ Falha ao persistir msg com IA silenciada: ${e.message}`);
    }

    ctxSpan.end({ output: { skipped: true, reason: 'ia_silenciada' } });
    trace.update({
      output: 'skipped_ia_silenciada',
      metadata: { reason: 'ia_silenciada', total_latency_ms: Date.now() - start },
    });
    await lf_flush();
    return;
  }

  // Vault tem prioridade; banco serve de fallback quando arquivo ainda não existe
  const promptsResolvidos = {
    soul:           vaultSoul           || (promptBundle as any)?.soul           || '',
    tom:            (promptBundle as any)?.tom            || '',
    regras:         vaultRegras         || (promptBundle as any)?.regras         || '',
    anti_repeticao: vaultAntiRep        || (promptBundle as any)?.anti_repeticao || '',
    pensamentos:    vaultPensamentos    || (promptBundle as any)?.pensamentos    || '',
    modo_rapido:    vaultModoRapido     || (promptBundle as any)?.modo_rapido    || '',
  };
  const vaultAtivo = !!(vaultSoul || vaultRegras);
  const targetStage = inferTargetStage(msg.texto || '', conversaAtual);
  const greetingOnly = detectGreetingOnly(msg.texto || '');
  const catalogIntent = detectCatalogIntent(msg.texto || '');
  const priceIntent = detectPriceIntent(msg.texto || '');
  const topicalPlanMessage = /(plano|planos|pre[cç]o|valor|cobertura|car[eê]ncia|rede|consulta|exame|cirurgia|manual|pdf)/i.test(msg.texto || '');
  const CATALOG_STAGES = ['apresentacao_planos', 'qualificacao', 'negociacao', 'pre_fechamento', 'fechamento'];
  const stageRequiresCatalog = CATALOG_STAGES.includes(conversaAtual?.etapa || '');
  const includePlanContext = !greetingOnly && (catalogIntent || priceIntent || topicalPlanMessage || stageRequiresCatalog);
  const isFirstContact = historico.length === 0 && !conversaAtual?.tutor_nome;

  // CEP efetivo: mensagem corrente tem prioridade; senão usa o salvo na conversa
  const cepEfetivo = cepDetectado || (conversaAtual as any)?.cep || (conversaAtual as any)?.cp || null;

  // Endereço via ViaCEP — usa CEP efetivo para obter UF
  const enderecoPromise = cepEfetivo
    ? buscarEnderecoPorCep(cepEfetivo).catch(() => null)
    : Promise.resolve(null);

  // Rede credenciada: se não foi carregada no Promise.all (cepDetectado era null) mas há CEP salvo
  // e o cliente fez pergunta sobre cobertura/rede, busca agora
  const redeResultEfetivo: RedeResult | null = await (async () => {
    if (redeResult) return redeResult;
    if (!cepEfetivo || !topicalPlanMessage) return null;
    try { return await buscarRedeCredenciada(cepEfetivo); }
    catch { return { status: 'erro_servico' } as RedeResult; }
  })();

  const [endereco] = await Promise.all([enderecoPromise]);
  const ufDetectada = endereco?.uf || null;

  // KB via RAG — conteúdo migrado do vault para knowledge_chunks via vault-sync
  const kb = await searchKnowledge(msg.texto || '', orgId, config.id, 5, { stage: targetStage });
  const knowledgeBase = kb.conteudo;

  // Rede credenciada: seção de prompt com CEP efetivo (mensagem ou histórico)
  const redeSection = redeResultEfetivo ? formatarSecaoRede(redeResultEfetivo, cepEfetivo!) : '';

  const soulSource = vaultAtivo ? 'vault' : promptsResolvidos.soul ? 'db' : 'fallback';

  ctxSpan.end({
    output: {
      soul_source:       soulSource,
      history_count:     historico.length,
      target_stage:      targetStage,
      rag_mode:          kb.mode,
      rag_latency_ms:    kb.latencyMs,
      rag_docs_count:    kb.fontes.length,
      kb_chars:          knowledgeBase.length,
      rag_sources:       kb.fontes,
    },
    metadata: {
      soul_source:       soulSource,
      history_count:     historico.length,
      target_stage:      targetStage,
      rag_mode:          kb.mode,
      rag_latency_ms:    kb.latencyMs,
      rag_docs_count:    kb.fontes.length,
      kb_chars:          knowledgeBase.length,
    },
  });

  console.log(
    `${tag} [2/7] Contexto | soul=${soulSource} | etapa=${targetStage} | histórico=${historico.length}msgs` +
    ` | rag=${kb.mode} ${kb.fontes.length} docs (${kb.conteudo.length} chars, ${kb.latencyMs}ms)` +
    (cepEfetivo ? ` | cep=${cepEfetivo}${!cepDetectado ? '(histórico)' : ''} status=${redeResultEfetivo?.status}` : '') +
    ` | ${Date.now() - t2}ms`,
  );
  if (kb.fontes.length) console.log(`${tag}     KB fontes: ${kb.fontes.join(', ')}`);
  if (cepEfetivo) console.log(`${tag}     Rede credenciada: CEP=${cepEfetivo} status=${redeResultEfetivo?.status} total=${redeResultEfetivo?.total ?? 0}`);

  // ── ETAPA 3: System prompt ────────────────────────────────
  if (!promptsResolvidos.soul) {
    console.error(
      `${tag} ❌ Mari/Soul.md NÃO carregado do vault — ` +
      `VAULT_SERVER_URL=${process.env.VAULT_SERVER_URL || 'não definido'} | ` +
      `vault_ativo=${vaultAtivo} | soul_db=${!!(promptBundle as any)?.soul}`
    );
  }
  // Fallback mínimo: só o nome — sem instruções de comportamento, para evidenciar falha no vault
  const baseSoul = promptsResolvidos.soul || `Você é ${config.nome || 'Mari'}, assistente da Plamev.`;

  const systemPrompt = buildMariPrompt({
    prompts: { ...promptsResolvidos, soul: baseSoul },
    stage: targetStage,
    conversationState: formatConversationStatePrompt(conversaAtual),
    productCatalog: includePlanContext ? formatProductCatalogPrompt(tabelaPlanos) : '',
    knowledgeBase,
    redeCredenciada: redeSection || undefined,
    catalogIntent,
    includePlanContext,
    // Tabela compacta de pisos injetada sempre (exceto saudações puras)
    priceFloorTable: !greetingOnly && tabelaPlanos.length > 0 ? formatPriceFloorSummary(tabelaPlanos) : undefined,
  });

  const messages: ChatMessage[] = [
    ...historico,
    { role: 'user', content: msg.texto || '' },
  ];

  console.log(`${tag} [3/7] Prompt | ${messages.length} msgs (${systemPrompt.length} chars system)`);

  if (greetingOnly) {
    const greetingResponse = buildGreetingResponse(conversaAtual, isFirstContact);
    console.log(`${tag} [3.2/7] Saudação determinística acionada`);
    const greetSendResult = await sendResponse(msg, greetingResponse);
    await persistInteraction(msg, greetingResponse);
    if (greetSendResult?.msg_id_externo) {
      atualizarMsgIdExterno(msg, greetSendResult.msg_id_externo);
    }
    trace.update({
      output: greetingResponse,
      metadata: {
        total_latency_ms: Date.now() - start,
        deterministic_greeting: true,
        rag_mode: kb.mode,
        rag_sources: kb.fontes,
        target_stage: targetStage,
      },
    });
    trace.score({ name: 'deterministic_greeting', value: 1 });
    await lf_flush();
    console.log(`${tag} ✅ Pipeline completo em ${Date.now() - start}ms (saudação determinística)`);
    return;
  }

  // ── ETAPA 4: Geração LLM ──────────────────────────────────
  // Preços Claude Haiku 4.5 (USD por token)
  const PRICE_INPUT  = 0.80  / 1_000_000;
  const PRICE_OUTPUT = 4.00  / 1_000_000;

  const t4 = Date.now();
  const llmStartTime = new Date();

  // Langfuse: input no formato OpenAI (system + messages) para que
  // Cost e Latency dashboards calculem corretamente
  const llmGenSpan = trace.generation({
    name:            '4-llm-generation',
    model:           config.model,
    startTime:       llmStartTime,
    input:           [{ role: 'system', content: systemPrompt }, ...messages],
    modelParameters: { provider: config.provider, temperature: config.temperature },
    metadata:        { agentSlug, agentId: config.id, orgId, canal: msg.canal, llmConfigId: config.llmConfigId, configSources: config.sources },
  });

  const generation = await generateResponse(systemPrompt, messages, config);
  const llmLatency = Date.now() - t4;

  const tokensIn  = generation?._uso?.input_tokens  ?? 0;
  const tokensOut = generation?._uso?.output_tokens ?? 0;

  llmGenSpan.end({
    endTime: new Date(),
    output:  generation?.resposta ?? null,
    usage: {
      input:      tokensIn,
      output:     tokensOut,
      total:      tokensIn + tokensOut,
      unit:       'TOKENS',
      inputCost:  tokensIn  * PRICE_INPUT,
      outputCost: tokensOut * PRICE_OUTPUT,
      totalCost:  (tokensIn * PRICE_INPUT) + (tokensOut * PRICE_OUTPUT),
    },
    level: generation ? 'DEFAULT' : 'ERROR',
  });

  console.log(`${tag} [4/7] LLM ${llmLatency}ms | tokens_in=${generation?._uso?.input_tokens} out=${generation?._uso?.output_tokens}`);

  if (!generation) {
    console.warn(`${tag} ⚠️ Geração retornou null`);
    trace.update({ output: 'llm_null', level: 'ERROR' });
    await lf_flush();
    return;
  }

  // ── VERIFICAÇÃO DE PREÇO POR PLANO ────────────────────────────────────────
  // Roda em TODA resposta do LLM que contenha preços.
  // Três checks com gates distintos:
  //   1. Cross-plan (preço não existe no plano citado) → sempre ativo
  //   2. Floor + escalação (preço abaixo do piso)      → só quando usuário mencionou R$
  //   3. Global (preço não existe em nenhum plano)      → só quando usuário mencionou R$
  // O gate no floor/global evita falsa escalação quando o LLM apresenta catálogo
  // e a detecção de plano associa preço ao plano errado.
  let priceEscalationNeeded = false;
  const userMentionedPrice = /R\$/.test(msg.texto || '');

  if (generation.resposta && tabelaPlanos.length > 0) {
    const planPriceData = new Map<string, { valid: Set<string>; floor: number | null }>();
    const globalValidPrices = new Set<string>();

    for (const row of tabelaPlanos) {
      const slug = (row as any).slug as string;
      if (!planPriceData.has(slug)) planPriceData.set(slug, { valid: new Set(), floor: null });
      const info = planPriceData.get(slug)!;
      for (const campo of ['valor_tabela', 'valor_promocional', 'valor_oferta']) {
        const v = (row as any)[campo];
        if (v != null && !isNaN(Number(v))) {
          const s = Number(v).toFixed(2);
          info.valid.add(s);
          globalValidPrices.add(s);
        }
      }
      const limite = (row as any)['valor_limite'];
      if (limite != null && !isNaN(Number(limite))) {
        const f = Number(limite);
        info.valid.add(f.toFixed(2));
        globalValidPrices.add(f.toFixed(2));
        if (info.floor === null || f < info.floor) info.floor = f;
      }
    }

    const priceRegex = /R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}/g;
    const responseText = generation.resposta;
    let priceBlockReason: string | null = null;
    let pm: RegExpExecArray | null;
    priceRegex.lastIndex = 0;

    while ((pm = priceRegex.exec(responseText)) !== null) {
      const raw = pm[0];
      const val = parseFloat(raw.replace(/R\$\s*/i, '').replace(/\./g, '').replace(',', '.'));
      if (isNaN(val) || val <= 0) continue;
      const valStr = val.toFixed(2);

      const slug = detectPlanSlugForPrice(responseText, pm.index, raw.length);
      const info = slug ? planPriceData.get(slug) : undefined;

      if (info) {
        // Check 2: piso — só quando usuário negociando (evita falsa escalação por plano errado)
        if (userMentionedPrice && info.floor !== null && val < info.floor) {
          priceBlockReason = `Preço R$${raw} abaixo do piso R$${info.floor.toFixed(2).replace('.', ',')} do plano "${slug}"`;
          priceEscalationNeeded = true;
          break;
        }
        // Check 1: cross-plan — sempre ativo (preço atribuído a plano que não o possui)
        if (!info.valid.has(valStr)) {
          priceBlockReason = `Preço R$${raw} não pertence ao plano "${slug}"`;
          break;
        }
      } else {
        // Check 3: global — só quando usuário negociando (evita falso positivo em totais calculados)
        if (userMentionedPrice && !globalValidPrices.has(valStr)) {
          priceBlockReason = `Preço R$${raw} não existe em nenhum plano`;
          break;
        }
      }
    }

    if (priceBlockReason) {
      console.warn(`${tag} ⛔ [PRICE-GUARD] ${priceBlockReason} — escalação=${priceEscalationNeeded}`);
      generation.resposta = priceEscalationNeeded
        ? 'Nesse preço realmente está fora da minha alçada 😅 Vou chamar meu supervisor e ele conversa contigo, tá bom?'
        : 'Quero te confirmar o valor certinho pra você — só um instante 😊';
    }
  }

  // ── ETAPA 5: Output Guard ─────────────────────────────────
  const t5 = Date.now();
  const outGuardSpan = trace.span({
    name:  '5-output-guard',
    input: { resposta: generation.resposta },
  });

  const validation = await validateClaims(generation, systemPrompt, config.guard_model, {
    historico,
    conversa: conversaAtual,
    ragSources: kb.fontes,
    ragMode: kb.mode,
  });
  const wasBlocked = !validation.isValid;
  const wasRewritten = Boolean(validation.rewrittenText && validation.rewrittenText !== generation.resposta);

  outGuardSpan.end({
    output:   {
      isValid: validation.isValid,
      reason: validation.reason ?? null,
      matchedRules: validation.matchedRules ?? [],
      severity: validation.severity ?? null,
      wasBlocked,
      wasRewritten,
    },
    level:    wasBlocked ? 'ERROR' : wasRewritten ? 'WARNING' : 'DEFAULT',
    metadata: {
      is_valid: validation.isValid,
      was_blocked: wasBlocked,
      was_rewritten: wasRewritten,
      reason: validation.reason ?? null,
      matched_rules: validation.matchedRules ?? [],
      severity: validation.severity ?? null,
    },
  });

  console.log(
    `${tag} [5/7] OutputGuard → válido=${validation.isValid}` +
    `${wasBlocked ? ' blocked=true' : ''}` +
    `${wasRewritten ? ' rewritten=true' : ''}` +
    ` (${Date.now() - t5}ms)` +
    `${validation.reason ? ' | ' + validation.reason : ''}`,
  );

  if (validation.rewrittenText) {
    generation.resposta = validation.rewrittenText;
  } else if (wasBlocked) {
    generation.resposta = chooseNonRepeatingFallback(validation.reason, historico);
  }

  const resposta = generation.resposta;
  if (!resposta) {
    console.warn(`${tag} ⚠️ Resposta vazia`);
    trace.update({ output: 'empty_response', level: 'ERROR' });
    await lf_flush();
    return;
  }

  // ── ETAPA 6: Persistir no CRM primeiro (garante dados de pet/score no DB
  //              antes do nova_msg disparado pelo envio da resposta)
  const t6 = Date.now();
  const crmSpan = trace.span({ name: '6-persist-crm', input: { phone: msg.phone, canal: msg.canal } });
  try {
    await persistInteraction(msg, resposta, {
      etapa: generation.etapa || undefined,
      dados_extraidos: generation.dados_extraidos || undefined,
      custo: tokensIn > 0
        ? { input_tokens: tokensIn, output_tokens: tokensOut, model: config.model || 'claude-haiku-4-5-20251001' }
        : undefined,
      silenciarIa: priceEscalationNeeded || undefined,
    });
    crmSpan.end({ output: { ok: true }, metadata: { latency_ms: Date.now() - t6 } });
    console.log(`${tag} [6/7] Persistido no CRM (etapa=${generation.etapa} tokens=${tokensIn}+${tokensOut})`);
  } catch (e: any) {
    crmSpan.end({ output: { ok: false, error: e.message }, level: 'WARNING' });
    console.error(`${tag} ❌ Falha ao salvar no CRM: ${e.message}`);
  }

  // ── ETAPA 7: Enviar resposta ao cliente ───────────────────
  const t7 = Date.now();
  console.log(`${tag} [7/7] Enviando: "${resposta.substring(0, 80)}..."`);
  const sendSpan = trace.span({ name: '7-send-response', input: { canal: msg.canal, phone: msg.phone } });
  try {
    const sendResult = await sendResponse(msg, resposta);
    sendSpan.end({ output: { ok: true }, metadata: { latency_ms: Date.now() - t7 } });
    console.log(`${tag} ✅ Resposta entregue`);
    if (sendResult?.msg_id_externo) {
      atualizarMsgIdExterno(msg, sendResult.msg_id_externo);
    }
  } catch (e: any) {
    sendSpan.end({ output: { ok: false, error: e.message }, level: 'ERROR' });
    console.error(`${tag} ❌ Falha ao entregar resposta: ${e.message}`);
  }

  const totalLatency = Date.now() - start;

  // ── KB source summary (log + score) ──────────────────────
  const kbSource = kb.conteudo.length > 0 ? 'rag' : 'none';
  console.log(
    `${tag} KB injetado: source=${kbSource} | rag=${kb.conteudo.length} chars (${kb.fontes.length} docs, mode=${kb.mode})`
  );

  // ── Scores Langfuse (alimentam dashboards customizados) ───
  trace.score({ name: 'rag_hit',        value: kb.fontes.length > 0 ? 1 : 0, comment: kb.fontes.join(', ') || 'none' });
  if (cepEfetivo) trace.score({ name: 'rede_credenciada_hit', value: redeResultEfetivo?.status === 'ok' ? 1 : 0, comment: `CEP=${cepEfetivo} status=${redeResultEfetivo?.status} total=${redeResultEfetivo?.total ?? 0}` });
  trace.score({ name: 'rag_vector_hit', value: kb.mode === 'vector_rerank' ? 1 : 0, comment: kb.mode });
  trace.score({ name: 'output_blocked', value: wasBlocked ? 1 : 0, comment: validation.reason || 'none' });
  trace.score({ name: 'was_rewritten',  value: wasRewritten ? 1 : 0 });
  trace.score({ name: 'guard_passed',   value: guardResult.action === 'process' ? 1 : 0 });
  trace.score({ name: 'has_history',    value: historico.length > 0 ? 1 : 0, comment: `${historico.length} msgs` });
  trace.score({ name: 'total_latency_s', value: parseFloat((totalLatency / 1000).toFixed(2)) });

  // Finaliza trace com output e metadados globais
  trace.update({
    output: resposta,
    metadata: {
      total_latency_ms:   totalLatency,
      llm_latency_ms:     llmLatency,
      kb_source:          kbSource,
      rag_mode:           kb.mode,
      rag_latency_ms:     kb.latencyMs,
      rag_docs_count:     kb.fontes.length,
      kb_chars_injected:  knowledgeBase.length,
      rag_sources:        kb.fontes,
      target_stage:       targetStage,
      history_msgs_count: historico.length,
      guard_intent:       guardResult.intent,
      guard_action:       guardResult.action,
      guard_reason:       guardResult.reason ?? null,
      guard_rules:        guardResult.matchedRules ?? [],
      guard_fail_open:    guardResult.failOpen ?? false,
      output_guard_reason: validation.reason ?? null,
      output_guard_rules: validation.matchedRules ?? [],
      output_guard_severity: validation.severity ?? null,
      output_guard_blocked: wasBlocked,
      was_rewritten:      wasRewritten,
      tokens_in:          generation._uso?.input_tokens  ?? 0,
      tokens_out:         generation._uso?.output_tokens ?? 0,
      model:              config.model,
      provider:           config.provider,
    },
  });

  // ── Cotação: disparo não-bloqueante após pipeline ─────────────
  // Trigger 1: LLM explicitamente incluiu a ação no JSON
  const llmPediuCotacao = generation.acoes?.includes('solicitar_cotacao');
  // Trigger 2: fallback por texto — LLM prometeu cotação mas não setou a ação
  const textoPediuCotacao = !llmPediuCotacao && /gerando sua cotação|mando o pdf|enviando (a cotação|o pdf)|estou gerando|aqui está (sua cotação|o pdf)|gerando agora|aqui (vai|vai) (sua cotação|o pdf)/i.test(resposta);

  if (llmPediuCotacao || textoPediuCotacao) {
    if (textoPediuCotacao) console.log(`${tag} 🧾 Cotação detectada por texto (fallback) — disparando cotação`);
    else console.log(`${tag} 🧾 Ação solicitar_cotacao detectada — disparando cotação`);
    dispararCotacao(msg, generation.dados_extraidos ?? {}, conversaAtual).catch(() => {});
  }

  lf_flush(); // async, errors already logged inside lf_flush

  console.log(`${tag} ✅ Pipeline completo em ${totalLatency}ms`);
}
