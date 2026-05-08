import { Router } from 'express';
import { autenticar } from '../middleware/auth';
import { query, queryOne } from '../config/db';

const router = Router();
router.use(autenticar);

const ORG = '00000000-0000-0000-0000-000000000000';

// GET /api/contatos?search=&canal=&status=&page=1&limit=50
router.get('/', async (req, res) => {
  try {
    const search  = ((req.query.search  as string) || '').trim();
    const canal   = (req.query.canal   as string) || '';
    const status  = (req.query.status  as string) || '';
    const page    = Math.max(1, parseInt((req.query.page  as string) || '1', 10));
    const limit   = Math.min(100, Math.max(10, parseInt((req.query.limit as string) || '50', 10)));
    const offset  = (page - 1) * limit;

    const conditions: string[] = ['(c.org_id = $1 OR c.org_id IS NULL)'];
    const params: any[] = [ORG];
    let p = 2;

    if (search) {
      conditions.push(`(c.nome ILIKE $${p} OR c.telefone ILIKE $${p} OR c.numero_externo ILIKE $${p})`);
      params.push(`%${search}%`); p++;
    }
    if (canal) { conditions.push(`c.canal = $${p}`); params.push(canal); p++; }
    if (status) { conditions.push(`c.status = $${p}`); params.push(status); p++; }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = await query<any>(`
      SELECT * FROM vw_contatos c
      ${where}
      ORDER BY c.ultima_interacao DESC NULLS LAST, c.criado_em DESC
      LIMIT $${p} OFFSET $${p + 1}
    `, [...params, limit, offset]);

    const total = await queryOne<any>(`
      SELECT COUNT(*)::int AS n FROM vw_contatos c ${where}
    `, params);

    res.json({ ok: true, contatos: rows, total: total?.n ?? 0, page, limit });
  } catch (e: any) {
    console.error('[contatos] GET /', e);
    res.status(500).json({ erro: e.message });
  }
});

// GET /api/contatos/:id — detalhe completo com histórico de msgs
router.get('/:id', async (req, res) => {
  try {
    const contato = await queryOne<any>(
      `SELECT * FROM vw_contatos WHERE id = $1`, [req.params.id]
    );
    if (!contato) { res.status(404).json({ erro: 'Contato não encontrado' }); return; }

    const historico = contato.conversa_id
      ? await query<any>(
          `SELECT role, enviado_por, conteudo, timestamp
           FROM mensagens
           WHERE conversa_id = $1
           ORDER BY timestamp DESC
           LIMIT 100`,
          [contato.conversa_id]
        )
      : [];

    res.json({ ok: true, contato, historico });
  } catch (e: any) {
    res.status(500).json({ erro: e.message });
  }
});

// POST /api/contatos/:id/followup — registra mensagem de follow-up na conversa ativa
router.post('/:id/followup', async (req, res) => {
  try {
    const { mensagem } = req.body;
    if (!mensagem?.trim()) { res.status(400).json({ erro: 'mensagem obrigatória' }); return; }

    const contato = await queryOne<any>(
      `SELECT id, conversa_id FROM vw_contatos WHERE id = $1`, [req.params.id]
    );
    if (!contato?.conversa_id) {
      res.status(404).json({ erro: 'Nenhuma conversa ativa para este contato' }); return;
    }

    await query(
      `INSERT INTO mensagens (conversa_id, role, enviado_por, conteudo, timestamp)
       VALUES ($1, 'supervisor', 'humano', $2, NOW())`,
      [contato.conversa_id, mensagem.trim()]
    );

    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ erro: e.message });
  }
});

export default router;
