/**
 * config/migrations.ts — tabelas extras da Fase 6 (V5-only, no banco mari_intelligence).
 * Rodam idempotentemente no startup.
 */
import { poolIntel } from './db';
import { logger } from './logger';

export async function inicializarTabelasV5(): Promise<void> {
  try {
    await poolIntel.query(`
      CREATE TABLE IF NOT EXISTS dashv5_audit_log (
        id         BIGSERIAL PRIMARY KEY,
        ator_email VARCHAR(200),
        ator_ip    VARCHAR(64),
        acao       VARCHAR(80) NOT NULL,
        alvo_tipo  VARCHAR(50),
        alvo_id    TEXT,
        detalhe    JSONB DEFAULT '{}'::jsonb,
        criado_em  TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_audit_criado ON dashv5_audit_log(criado_em DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_acao   ON dashv5_audit_log(acao);
      CREATE INDEX IF NOT EXISTS idx_audit_ator   ON dashv5_audit_log(ator_email);
    `);

    await poolIntel.query(`
      CREATE TABLE IF NOT EXISTS dashv5_templates (
        id         SERIAL PRIMARY KEY,
        categoria  VARCHAR(60) DEFAULT 'geral',
        atalho     VARCHAR(30) UNIQUE,
        titulo     VARCHAR(200) NOT NULL,
        corpo      TEXT NOT NULL,
        uso_count  INT DEFAULT 0,
        criado_por VARCHAR(200),
        criado_em  TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Seed de templates úteis se estiver vazio
    const { rows } = await poolIntel.query<any>(`SELECT COUNT(*)::int AS n FROM dashv5_templates`);
    if ((rows[0]?.n ?? 0) === 0) {
      await poolIntel.query(`
        INSERT INTO dashv5_templates (categoria, atalho, titulo, corpo) VALUES
          ('abertura', '/oi',        'Saudação',         'Oi! Tudo bem? 😊'),
          ('abertura', '/boastard',  'Boa tarde',        'Oi, boa tarde! Tudo bem?'),
          ('followup', '/voltou',    'Cliente sumiu',    'Oi, passando pra saber se ainda tem interesse em proteger seu pet com a Plamev. Posso te ajudar?'),
          ('fechamento','/obrigado', 'Agradecer',        'Perfeito! Muito obrigada pela confiança. Qualquer dúvida, é só chamar aqui 💛'),
          ('cep',      '/semcobertura','Sem cobertura',  'Infelizmente ainda não temos clínicas credenciadas Plamev em sua região. Assim que chegar, te avisamos!'),
          ('negociacao','/limitado', 'Sem desconto',     'Consegui o melhor valor pra você. Já está aplicada a maior condição que posso oferecer.')
        ON CONFLICT (atalho) DO NOTHING;
      `);
    }

    logger.info('✅ Tabelas V5 prontas (dashv5_audit_log, dashv5_templates)');
  } catch (e: any) {
    logger.warn({ err: e.message }, 'Falha ao criar tabelas V5');
  }
}
