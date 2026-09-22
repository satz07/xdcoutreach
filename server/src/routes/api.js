const express = require('express');
const { pool } = require('../db/pool');
const { sendOneEmail, parseRecipients } = require('../services/mailer');
const { buildSibosEmailHtml } = require('../templates/sibosEmail');

const router = express.Router();

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

/** Send campaign to comma-separated recipients */
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
    } = req.body;

    const { valid, invalid } = parseRecipients(recipients);
    if (valid.length === 0) {
      return res.status(400).json({
        error: 'No valid recipients. Provide emails separated by commas.',
        invalid,
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

    await client.query('BEGIN');

    const campaign = await client.query(
      `INSERT INTO email_campaigns
        (event_id, template_id, subject, html_body, recipients_raw, total_recipients, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'sending')
       RETURNING *`,
      [eventId, templateId, subjectFinal, htmlFinal, recipients, valid.length]
    );
    const campaignId = campaign.rows[0].id;

    let success = 0;
    let failure = 0;
    const results = [];

    for (const email of valid) {
      const sendRow = await client.query(
        `INSERT INTO email_sends
          (campaign_id, event_id, recipient_email, subject, html_body, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         RETURNING id`,
        [campaignId, eventId, email, subjectFinal, htmlFinal]
      );
      const sendId = sendRow.rows[0].id;

      try {
        const info = await sendOneEmail({
          to: email,
          subject: subjectFinal,
          html: htmlFinal,
          text: textFinal,
        });
        await client.query(
          `UPDATE email_sends
           SET status = 'sent', message_id = $1, sent_at = NOW(), error_message = NULL
           WHERE id = $2`,
          [info.messageId, sendId]
        );
        success += 1;
        results.push({ email, status: 'sent', messageId: info.messageId });
      } catch (err) {
        await client.query(
          `UPDATE email_sends
           SET status = 'failed', error_message = $1
           WHERE id = $2`,
          [err.message, sendId]
        );
        failure += 1;
        results.push({ email, status: 'failed', error: err.message });
      }
    }

    const status = failure === 0 ? 'completed' : success === 0 ? 'failed' : 'partial';
    await client.query(
      `UPDATE email_campaigns
       SET success_count = $1, failure_count = $2, status = $3
       WHERE id = $4`,
      [success, failure, status, campaignId]
    );

    await client.query('COMMIT');

    res.json({
      campaignId,
      status,
      success,
      failure,
      invalid,
      results,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/** Resend a previous send by id */
router.post('/sends/:id/resend', async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`SELECT * FROM email_sends WHERE id = $1`, [req.params.id]);
    const original = rows[0];
    if (!original) return res.status(404).json({ error: 'Send record not found' });

    const newRow = await client.query(
      `INSERT INTO email_sends
        (campaign_id, event_id, recipient_email, subject, html_body, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING *`,
      [
        original.campaign_id,
        original.event_id,
        original.recipient_email,
        original.subject,
        original.html_body,
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
      res.json({ ok: true, send: updated[0] });
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

/** Bulk resend selected send ids */
router.post('/sends/resend-bulk', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array required' });
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
          (campaign_id, event_id, recipient_email, subject, html_body, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         RETURNING id`,
        [
          original.campaign_id,
          original.event_id,
          original.recipient_email,
          original.subject,
          original.html_body,
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

/** Send history with filters */
router.get('/sends', async (req, res) => {
  try {
    const { q, status, limit = 100, offset = 0, campaignId } = req.query;
    const clauses = [];
    const params = [];

    if (q) {
      params.push(`%${q}%`);
      clauses.push(`recipient_email ILIKE $${params.length}`);
    }
    if (status) {
      params.push(status);
      clauses.push(`status = $${params.length}`);
    }
    if (campaignId) {
      params.push(campaignId);
      clauses.push(`campaign_id = $${params.length}`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(Number(limit));
    params.push(Number(offset));

    const { rows } = await pool.query(
      `SELECT s.*, c.status AS campaign_status
       FROM email_sends s
       LEFT JOIN email_campaigns c ON c.id = s.campaign_id
       ${where}
       ORDER BY COALESCE(s.sent_at, s.created_at) DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM email_sends s ${where}`,
      params.slice(0, params.length - 2)
    );

    res.json({ items: rows, total: countRes.rows[0].total });
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

/** SMTP health check (no email sent) */
router.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
