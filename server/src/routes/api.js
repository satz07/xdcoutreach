const express = require('express');
const { pool } = require('../db/pool');
const { sendOneEmail, sendCampaignEmails, parseRecipients } = require('../services/mailer');
const { buildSibosEmailHtml } = require('../templates/sibosEmail');
const { requireAuth, requireSuperAdmin, getRemainingQuota } = require('../middleware/auth');

const router = express.Router();

/** SMTP health check (no email sent) — public */
router.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** SMTP connectivity probe — public (no secrets) */
router.get('/health/smtp', async (_req, res) => {
  try {
    const { diagnoseSmtp } = require('../services/mailer');
    const report = await diagnoseSmtp();
    res.json({ ok: true, ...report });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.use(requireAuth);

/** List events */
router.get('/events', async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM events ORDER BY created_at DESC`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Create event (for future events) */
router.post('/events', async (req, res) => {
  try {
    const { name, slug, location, dates } = req.body;
    if (!name || !slug) {
      return res.status(400).json({ error: 'name and slug are required' });
    }
    const { rows } = await pool.query(
      `INSERT INTO events (name, slug, location, dates)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, slug, location || null, dates || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Get default / latest template (optionally by event) */
router.get('/templates', async (req, res) => {
  try {
    const { eventId } = req.query;
    let result;
    if (eventId) {
      result = await pool.query(
        `SELECT t.*, e.name AS event_name, e.location, e.dates AS event_dates
         FROM email_templates t
         LEFT JOIN events e ON e.id = t.event_id
         WHERE t.event_id = $1
         ORDER BY t.is_default DESC, t.updated_at DESC`,
        [eventId]
      );
    } else {
      result = await pool.query(
        `SELECT t.*, e.name AS event_name, e.location, e.dates AS event_dates
         FROM email_templates t
         LEFT JOIN events e ON e.id = t.event_id
         ORDER BY t.is_default DESC, t.updated_at DESC`
      );
    }
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Get one template */
router.get('/templates/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM email_templates WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Template not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Update template content */
router.put('/templates/:id', async (req, res) => {
  try {
    const { subject, html_body, text_body, name, rebuildDefault } = req.body;

    let html = html_body;
    let text = text_body;
    let subj = subject;

    if (rebuildDefault) {
      const content = req.body.content || {};
      html = buildSibosEmailHtml(content);
      if (content.subject) subj = content.subject;
    }

    const { rows } = await pool.query(
      `UPDATE email_templates
       SET subject = COALESCE($1, subject),
           html_body = COALESCE($2, html_body),
           text_body = COALESCE($3, text_body),
           name = COALESCE($4, name),
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [subj || null, html || null, text || null, name || null, req.params.id]
    );

    if (!rows[0]) return res.status(404).json({ error: 'Template not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Preview HTML (rebuild from structured fields without saving) */
router.post('/templates/preview', (req, res) => {
  try {
    const html = buildSibosEmailHtml(req.body.content || req.body || {});
    res.json({ html });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Send campaign (broadcast/bulk for 2+ recipients via Postmark) */
router.post('/send', async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      recipients,
      subject,
      html_body,
      text_body,
      template_id,
      event_id,
      broadcast,
    } = req.body;

    const { valid, invalid } = parseRecipients(recipients);
    if (valid.length === 0) {
      return res.status(400).json({
        error: 'No valid recipients. Provide emails separated by commas, newlines, or CSV.',
        invalid,
      });
    }

    const maxRecipients = Number(process.env.MAX_RECIPIENTS_PER_SEND || 10000);
    if (valid.length > maxRecipients) {
      return res.status(400).json({
        error: `Too many recipients (${valid.length}). Max per send is ${maxRecipients}.`,
      });
    }

    const quota = await getRemainingQuota(req.user);
    if (quota.limited && valid.length > quota.remaining) {
      return res.status(403).json({
        error: `Send limit exceeded. You can send ${quota.remaining} more email(s) (limit ${quota.limit}, used ${quota.used}). Ask the superadmin to raise your limit.`,
        quota,
      });
    }

    let subjectFinal = subject;
    let htmlFinal = html_body;
    let textFinal = text_body;
    let eventId = event_id || null;
    let templateId = template_id || null;

    if (template_id && (!htmlFinal || !subjectFinal)) {
      const t = await client.query(`SELECT * FROM email_templates WHERE id = $1`, [template_id]);
      if (t.rows[0]) {
        subjectFinal = subjectFinal || t.rows[0].subject;
        htmlFinal = htmlFinal || t.rows[0].html_body;
        textFinal = textFinal || t.rows[0].text_body;
        eventId = eventId || t.rows[0].event_id;
        templateId = t.rows[0].id;
      }
    }

    if (!subjectFinal || !htmlFinal) {
      return res.status(400).json({ error: 'subject and html_body (or template_id) are required' });
    }

    const senderId = req.user.id;
    const useBroadcast = Boolean(broadcast) || valid.length >= Number(process.env.BROADCAST_THRESHOLD || 2);

    await client.query('BEGIN');

    const campaign = await client.query(
      `INSERT INTO email_campaigns
        (event_id, template_id, subject, html_body, recipients_raw, total_recipients, status, sent_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'sending', $7)
       RETURNING *`,
      [
        eventId,
        templateId,
        subjectFinal,
        htmlFinal,
        typeof recipients === 'string' ? recipients.slice(0, 50000) : String(valid.length),
        valid.length,
        senderId,
      ]
    );
    const campaignId = campaign.rows[0].id;

    // Insert pending rows in batches
    const sendIdByEmail = new Map();
    const insertChunk = 200;
    for (let i = 0; i < valid.length; i += insertChunk) {
      const slice = valid.slice(i, i + insertChunk);
      const values = [];
      const params = [];
      let p = 1;
      for (const email of slice) {
        values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, 'pending', $${p++})`);
        params.push(campaignId, eventId, email, subjectFinal, htmlFinal, senderId);
      }
      const { rows } = await client.query(
        `INSERT INTO email_sends
          (campaign_id, event_id, recipient_email, subject, html_body, status, sent_by_user_id)
         VALUES ${values.join(', ')}
         RETURNING id, recipient_email`,
        params
      );
      for (const row of rows) {
        sendIdByEmail.set(row.recipient_email.toLowerCase(), row.id);
      }
    }

    await client.query('COMMIT');

    // Send outside the DB transaction (bulk can take minutes)
    let campaignResult;
    try {
      campaignResult = await sendCampaignEmails({
        recipients: valid,
        subject: subjectFinal,
        html: htmlFinal,
        text: textFinal,
        broadcast: useBroadcast,
      });
    } catch (err) {
      await pool.query(
        `UPDATE email_campaigns SET status = 'failed', failure_count = $1 WHERE id = $2`,
        [valid.length, campaignId]
      );
      await pool.query(
        `UPDATE email_sends SET status = 'failed', error_message = $1 WHERE campaign_id = $2`,
        [err.message, campaignId]
      );
      return res.status(500).json({ error: err.message, campaignId });
    }

    const results = campaignResult.results || [];
    let success = 0;
    let failure = 0;

    for (const r of results) {
      const sendId = sendIdByEmail.get(String(r.email).toLowerCase());
      if (!sendId) continue;
      if (r.status === 'sent') {
        success += 1;
        await pool.query(
          `UPDATE email_sends
           SET status = 'sent', message_id = $1, sent_at = NOW(), error_message = NULL
           WHERE id = $2`,
          [r.messageId || null, sendId]
        );
      } else {
        failure += 1;
        await pool.query(
          `UPDATE email_sends
           SET status = 'failed', error_message = $1
           WHERE id = $2`,
          [r.error || 'send failed', sendId]
        );
      }
    }

    // Any pending left (shouldn't happen) mark failed
    await pool.query(
      `UPDATE email_sends SET status = 'failed', error_message = 'no provider result'
       WHERE campaign_id = $1 AND status = 'pending'`,
      [campaignId]
    );

    const status = failure === 0 ? 'completed' : success === 0 ? 'failed' : 'partial';
    await pool.query(
      `UPDATE email_campaigns
       SET success_count = $1, failure_count = $2, status = $3
       WHERE id = $4`,
      [success, failure, status, campaignId]
    );

    // Cap result payload for large broadcasts
    const resultPreview =
      results.length > 200
        ? [
            ...results.filter((r) => r.status === 'failed').slice(0, 100),
            ...results.filter((r) => r.status === 'sent').slice(0, 50),
          ]
        : results;

    res.json({
      campaignId,
      status,
      success,
      failure,
      invalid: invalid.slice(0, 50),
      invalidCount: invalid.length,
      provider: campaignResult.provider,
      bulkIds: campaignResult.bulkIds || [],
      broadcast: useBroadcast && valid.length > 1,
      results: resultPreview,
      resultsTruncated: results.length > resultPreview.length,
      quota: await getRemainingQuota(req.user),
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* already committed or idle */
    }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});
/** Resend a previous send by id */
router.post('/sends/:id/resend', async (req, res) => {
  const client = await pool.connect();
  try {
    const quota = await getRemainingQuota(req.user);
    if (quota.limited && quota.remaining < 1) {
      return res.status(403).json({
        error: `Send limit reached (${quota.used}/${quota.limit}). Ask the superadmin to raise your limit.`,
        quota,
      });
    }

    const { rows } = await client.query(`SELECT * FROM email_sends WHERE id = $1`, [req.params.id]);
    const original = rows[0];
    if (!original) return res.status(404).json({ error: 'Send record not found' });

    const newRow = await client.query(
      `INSERT INTO email_sends
        (campaign_id, event_id, recipient_email, subject, html_body, status, sent_by_user_id)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)
       RETURNING *`,
      [
        original.campaign_id,
        original.event_id,
        original.recipient_email,
        original.subject,
        original.html_body,
        req.user.id,
      ]
    );

    try {
      const info = await sendOneEmail({
        to: original.recipient_email,
        subject: original.subject,
        html: original.html_body,
      });
      const { rows: updated } = await client.query(
        `UPDATE email_sends
         SET status = 'sent', message_id = $1, sent_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [info.messageId, newRow.rows[0].id]
      );
      res.json({ ok: true, send: updated[0], quota: await getRemainingQuota(req.user) });
    } catch (err) {
      const { rows: updated } = await client.query(
        `UPDATE email_sends
         SET status = 'failed', error_message = $1
         WHERE id = $2
         RETURNING *`,
        [err.message, newRow.rows[0].id]
      );
      res.status(502).json({ ok: false, send: updated[0], error: err.message });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/** Bulk resend selected send ids (creates new rows) */
router.post('/sends/resend-bulk', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array required' });
    }

    const quota = await getRemainingQuota(req.user);
    if (quota.limited && ids.length > quota.remaining) {
      return res.status(403).json({
        error: `Send limit exceeded. You can send ${quota.remaining} more email(s).`,
        quota,
      });
    }

    const results = [];
    for (const id of ids) {
      const { rows } = await pool.query(`SELECT * FROM email_sends WHERE id = $1`, [id]);
      const original = rows[0];
      if (!original) {
        results.push({ id, status: 'not_found' });
        continue;
      }

      const inserted = await pool.query(
        `INSERT INTO email_sends
          (campaign_id, event_id, recipient_email, subject, html_body, status, sent_by_user_id)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6)
         RETURNING id`,
        [
          original.campaign_id,
          original.event_id,
          original.recipient_email,
          original.subject,
          original.html_body,
          req.user.id,
        ]
      );

      try {
        const info = await sendOneEmail({
          to: original.recipient_email,
          subject: original.subject,
          html: original.html_body,
        });
        await pool.query(
          `UPDATE email_sends SET status='sent', message_id=$1, sent_at=NOW() WHERE id=$2`,
          [info.messageId, inserted.rows[0].id]
        );
        results.push({ id, newId: inserted.rows[0].id, email: original.recipient_email, status: 'sent' });
      } catch (err) {
        await pool.query(
          `UPDATE email_sends SET status='failed', error_message=$1 WHERE id=$2`,
          [err.message, inserted.rows[0].id]
        );
        results.push({ id, newId: inserted.rows[0].id, email: original.recipient_email, status: 'failed', error: err.message });
      }
    }

    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Send selected pending rows in place (broadcast/bulk).
 * Used from History: select N pending → Send selected.
 */
router.post('/sends/send-selected', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array required' });
    }
    if (ids.length > 500) {
      return res.status(400).json({ error: 'Max 500 recipients per Send selected. Paginate and send in batches.' });
    }

    const { rows } = await pool.query(
      `SELECT * FROM email_sends WHERE id = ANY($1::int[]) AND status = 'pending' ORDER BY id ASC`,
      [ids.map(Number)]
    );

    if (rows.length === 0) {
      return res.status(400).json({
        error: 'No pending rows in selection. Filter by Pending, or use Resend for already-sent rows.',
      });
    }

    const quota = await getRemainingQuota(req.user);
    if (quota.limited && rows.length > quota.remaining) {
      return res.status(403).json({
        error: `Send limit exceeded. You can send ${quota.remaining} more email(s).`,
        quota,
      });
    }

    const subject = rows[0].subject;
    const html = rows[0].html_body;
    const recipients = rows.map((r) => r.recipient_email);
    const idByEmail = new Map(rows.map((r) => [r.recipient_email.toLowerCase(), r.id]));

    const campaignResult = await sendCampaignEmails({
      recipients,
      subject,
      html,
      broadcast: recipients.length > 1,
    });

    let success = 0;
    let failure = 0;
    const results = [];

    for (const r of campaignResult.results || []) {
      const sendId = idByEmail.get(String(r.email).toLowerCase());
      if (!sendId) continue;
      if (r.status === 'sent') {
        success += 1;
        await pool.query(
          `UPDATE email_sends
           SET status = 'sent', message_id = $1, sent_at = NOW(), error_message = NULL,
               sent_by_user_id = COALESCE(sent_by_user_id, $3)
           WHERE id = $2`,
          [r.messageId || null, sendId, req.user.id]
        );
      } else {
        failure += 1;
        await pool.query(
          `UPDATE email_sends SET status = 'failed', error_message = $1, sent_by_user_id = COALESCE(sent_by_user_id, $3) WHERE id = $2`,
          [r.error || 'send failed', sendId, req.user.id]
        );
      }
      results.push({ id: sendId, email: r.email, status: r.status, error: r.error });
    }

    res.json({
      success,
      failure,
      provider: campaignResult.provider,
      bulkIds: campaignResult.bulkIds || [],
      results,
      quota: await getRemainingQuota(req.user),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Wipe send history and import recipients as pending queue rows.
 * Superadmin only. Body: { recipients: string|string[], clear: true, subject?, html_body? }
 */
router.post('/sends/import', requireSuperAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const { recipients, clear = true, subject, html_body } = req.body || {};
    let valid = [];
    let invalid = [];
    if (Array.isArray(recipients)) {
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const seen = new Set();
      for (const item of recipients) {
        const email = String(item || '')
          .trim()
          .toLowerCase();
        if (!email) continue;
        if (!emailRe.test(email)) {
          invalid.push(email);
          continue;
        }
        if (seen.has(email)) continue;
        seen.add(email);
        valid.push(email);
      }
    } else {
      ({ valid, invalid } = parseRecipients(recipients));
    }

    if (valid.length === 0) {
      return res.status(400).json({ error: 'No valid recipients to import', invalid });
    }

    let subjectFinal = subject;
    let htmlFinal = html_body;
    let eventId = null;
    let templateId = null;

    if (!subjectFinal || !htmlFinal) {
      const t = await client.query(
        `SELECT * FROM email_templates WHERE is_default = TRUE ORDER BY updated_at DESC LIMIT 1`
      );
      if (t.rows[0]) {
        subjectFinal = subjectFinal || t.rows[0].subject;
        htmlFinal = htmlFinal || t.rows[0].html_body;
        eventId = t.rows[0].event_id;
        templateId = t.rows[0].id;
      }
    }

    if (!subjectFinal || !htmlFinal) {
      return res.status(400).json({ error: 'No default template found; provide subject and html_body' });
    }

    await client.query('BEGIN');

    if (clear) {
      // Wipe queue and reset SERIAL ids so History starts at 1 again
      await client.query('TRUNCATE TABLE email_sends, email_campaigns RESTART IDENTITY CASCADE');
      await client.query(`ALTER SEQUENCE IF EXISTS email_sends_id_seq RESTART WITH 1`);
      await client.query(`ALTER SEQUENCE IF EXISTS email_campaigns_id_seq RESTART WITH 1`);
    }

    const campaign = await client.query(
      `INSERT INTO email_campaigns
        (event_id, template_id, subject, html_body, recipients_raw, total_recipients, status, sent_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
       RETURNING id`,
      [
        eventId,
        templateId,
        subjectFinal,
        htmlFinal,
        `${valid.length} imported`,
        valid.length,
        req.user.id,
      ]
    );
    const campaignId = campaign.rows[0].id;

    const insertChunk = 200;
    let inserted = 0;
    for (let i = 0; i < valid.length; i += insertChunk) {
      const slice = valid.slice(i, i + insertChunk);
      const values = [];
      const params = [];
      let p = 1;
      for (const email of slice) {
        values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, 'pending', $${p++})`);
        params.push(campaignId, eventId, email, subjectFinal, htmlFinal, req.user.id);
      }
      await client.query(
        `INSERT INTO email_sends
          (campaign_id, event_id, recipient_email, subject, html_body, status, sent_by_user_id)
         VALUES ${values.join(', ')}`,
        params
      );
      inserted += slice.length;
    }

    await client.query('COMMIT');

    res.json({
      ok: true,
      campaignId,
      imported: inserted,
      invalidCount: invalid.length,
      invalid: invalid.slice(0, 20),
      cleared: Boolean(clear),
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/** Delete a send row (superadmin) — used to prune queue duplicates */
router.delete('/sends/:id', requireSuperAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM email_sends WHERE id = $1 RETURNING id, recipient_email, status`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Send not found' });
    res.json({ ok: true, deleted: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Send history with filters */
router.get('/sends', async (req, res) => {
  try {
    const { q, status, limit = 50, offset = 0, campaignId } = req.query;
    const clauses = [];
    const params = [];

    if (q) {
      params.push(`%${q}%`);
      clauses.push(`s.recipient_email ILIKE $${params.length}`);
    }
    if (status) {
      params.push(status);
      clauses.push(`s.status = $${params.length}`);
    }
    if (campaignId) {
      params.push(campaignId);
      clauses.push(`s.campaign_id = $${params.length}`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const lim = Math.min(Number(limit) || 50, 200);
    const off = Math.max(Number(offset) || 0, 0);
    params.push(lim);
    params.push(off);

    const { rows } = await pool.query(
      `SELECT s.*, c.status AS campaign_status
       FROM email_sends s
       LEFT JOIN email_campaigns c ON c.id = s.campaign_id
       ${where}
       ORDER BY
         CASE s.status WHEN 'pending' THEN 0 WHEN 'failed' THEN 1 ELSE 2 END,
         s.id ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM email_sends s ${where}`,
      params.slice(0, params.length - 2)
    );

    const statusCounts = await pool.query(
      `SELECT status, COUNT(*)::int AS count FROM email_sends GROUP BY status`
    );

    res.json({
      items: rows,
      total: countRes.rows[0].total,
      limit: lim,
      offset: off,
      statusCounts: Object.fromEntries(statusCounts.rows.map((r) => [r.status, r.count])),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Campaign list */
router.get('/campaigns', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM email_campaigns ORDER BY created_at DESC LIMIT 50`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
