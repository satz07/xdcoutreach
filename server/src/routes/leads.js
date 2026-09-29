const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const { LEAD_STATUSES, getNotifyEmails, setNotifyEmails, meetingUrl } = require('../services/leads');

const router = express.Router();
router.use(requireAuth);

const STATUS_LABELS = {
  new: 'New',
  contacted: 'Contacted',
  meeting_booked: 'Meeting booked',
  closed: 'Closed',
};

const LEAD_SELECT = `
  SELECT l.*, e.name AS event_name, u.email AS owner_email,
    (SELECT COUNT(*)::int FROM lead_notes n WHERE n.lead_id = l.id AND n.kind = 'note') AS notes_count
  FROM meeting_leads l
  LEFT JOIN events e ON e.id = l.event_id
  LEFT JOIN users u ON u.id = l.owner_user_id`;

/** GET /api/leads?eventId=&status=&owner=(id|me|none)&q= */
router.get('/', async (req, res) => {
  try {
    const where = [];
    const params = [];
    const add = (sql, v) => {
      params.push(v);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (req.query.eventId) add('l.event_id = ?', Number(req.query.eventId));
    if (req.query.owner === 'me') add('l.owner_user_id = ?', req.user.id);
    else if (req.query.owner === 'none') where.push('l.owner_user_id IS NULL');
    else if (req.query.owner) add('l.owner_user_id = ?', Number(req.query.owner));
    if (req.query.q) {
      params.push(`%${String(req.query.q).trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
      const p = `$${params.length}`;
      where.push(
        `(l.email ILIKE ${p} OR l.name ILIKE ${p} OR l.company ILIKE ${p} OR l.topic ILIKE ${p} OR l.message ILIKE ${p})`
      );
    }
    const baseWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const counts = await pool.query(
      `SELECT l.status, COUNT(*)::int AS n FROM meeting_leads l ${baseWhere} GROUP BY l.status`,
      params
    );
    const statusCounts = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0]));
    for (const r of counts.rows) statusCounts[r.status] = r.n;

    const listParams = [...params];
    let listWhere = baseWhere;
    if (req.query.status && LEAD_STATUSES.includes(req.query.status)) {
      listParams.push(req.query.status);
      listWhere += `${listWhere ? ' AND' : 'WHERE'} l.status = $${listParams.length}`;
    }
    const { rows } = await pool.query(
      `${LEAD_SELECT} ${listWhere}
       ORDER BY CASE l.status WHEN 'new' THEN 0 WHEN 'contacted' THEN 1 WHEN 'meeting_booked' THEN 2 ELSE 3 END,
                l.last_submitted_at DESC
       LIMIT 2000`,
      listParams
    );
    res.json({ items: rows, statusCounts, statuses: STATUS_LABELS });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/leads/owners — active users that can own leads */
router.get('/owners', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, role FROM users WHERE active = TRUE ORDER BY email ASC`
    );
    res.json({ owners: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/leads/settings */
router.get('/settings', async (req, res) => {
  try {
    res.json({
      notifyEmails: await getNotifyEmails(),
      canEdit: req.user.role === 'superadmin',
      genericFormUrl: meetingUrl({ eventId: req.query.eventId ? Number(req.query.eventId) : null }),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/leads/settings { notifyEmails } — superadmin */
router.put('/settings', requireSuperAdmin, async (req, res) => {
  try {
    const list = await setNotifyEmails(req.body?.notifyEmails || '');
    res.json({ ok: true, notifyEmails: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/leads/:id — lead + activity timeline */
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`${LEAD_SELECT} WHERE l.id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Lead not found' });
    const notes = await pool.query(
      `SELECT n.id, n.body, n.kind, n.created_at, u.email AS user_email
       FROM lead_notes n LEFT JOIN users u ON u.id = n.user_id
       WHERE n.lead_id = $1 ORDER BY n.created_at DESC`,
      [req.params.id]
    );
    res.json({ lead: rows[0], notes: notes.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /api/leads/:id { status?, owner_user_id? } — changes are logged in the timeline */
router.patch('/:id', async (req, res) => {
  try {
    const cur = await pool.query(
      `SELECT l.*, u.email AS owner_email FROM meeting_leads l
       LEFT JOIN users u ON u.id = l.owner_user_id WHERE l.id = $1`,
      [req.params.id]
    );
    const lead = cur.rows[0];
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const logs = [];
    let status = lead.status;
    if (req.body?.status !== undefined) {
      if (!LEAD_STATUSES.includes(req.body.status)) {
        return res.status(400).json({ error: `status must be one of ${LEAD_STATUSES.join(', ')}` });
      }
      if (req.body.status !== lead.status) {
        status = req.body.status;
        logs.push(`Status: ${STATUS_LABELS[lead.status] || lead.status} → ${STATUS_LABELS[status]}`);
      }
    }
    let owner = lead.owner_user_id;
    if (req.body?.owner_user_id !== undefined) {
      const next = req.body.owner_user_id ? Number(req.body.owner_user_id) : null;
      if (next !== owner) {
        let nextEmail = null;
        if (next) {
          const u = await pool.query(`SELECT email FROM users WHERE id = $1 AND active = TRUE`, [next]);
          if (!u.rows[0]) return res.status(400).json({ error: 'Owner not found or inactive' });
          nextEmail = u.rows[0].email;
        }
        owner = next;
        logs.push(`Owner: ${lead.owner_email || 'unassigned'} → ${nextEmail || 'unassigned'}`);
      }
    }

    if (logs.length) {
      await pool.query(
        `UPDATE meeting_leads SET status = $2, owner_user_id = $3, updated_at = NOW() WHERE id = $1`,
        [lead.id, status, owner]
      );
      for (const body of logs) {
        await pool.query(
          `INSERT INTO lead_notes (lead_id, user_id, body, kind) VALUES ($1, $2, $3, 'system')`,
          [lead.id, req.user.id, body]
        );
      }
    }
    const { rows } = await pool.query(`${LEAD_SELECT} WHERE l.id = $1`, [lead.id]);
    res.json({ ok: true, lead: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/leads/:id/notes { body } */
router.post('/:id/notes', async (req, res) => {
  try {
    const body = String(req.body?.body || '').trim().slice(0, 5000);
    if (!body) return res.status(400).json({ error: 'Note cannot be empty' });
    const ex = await pool.query(`SELECT id FROM meeting_leads WHERE id = $1`, [req.params.id]);
    if (!ex.rows[0]) return res.status(404).json({ error: 'Lead not found' });
    const { rows } = await pool.query(
      `INSERT INTO lead_notes (lead_id, user_id, body, kind) VALUES ($1, $2, $3, 'note')
       RETURNING id, body, kind, created_at`,
      [req.params.id, req.user.id, body]
    );
    await pool.query(`UPDATE meeting_leads SET updated_at = NOW() WHERE id = $1`, [req.params.id]);
    res.json({ ok: true, note: { ...rows[0], user_email: req.user.email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/leads/:id — superadmin (spam / test entries) */
router.delete('/:id', requireSuperAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM meeting_leads WHERE id = $1 RETURNING id, email`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Lead not found' });
    res.json({ ok: true, deleted: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
