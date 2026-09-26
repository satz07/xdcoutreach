const express = require('express');
const { pool } = require('../db/pool');
const { sendOneEmail, sendCampaignEmails, sendOneVerifiedTransactional, sendOneForEvent, parseRecipients } = require('../services/mailer');
const { buildSibosEmailHtml } = require('../templates/sibosEmail');
const {
  buildContourSibosEmailHtml,
  defaultContourSibosContent,
  CONTOUR_SIBOS_SUBJECT,
} = require('../templates/contourSibosEmail');
const { requireAuth, requireSuperAdmin, getRemainingQuota } = require('../middleware/auth');
const {
  listProviders,
  getProviderById,
  publicProvider,
  ensureMailProvidersSeeded,
} = require('../services/mailProviders');
const {
  getLatestEventTemplate,
  contentForSendRow,
  syncEventQueueFromTemplate,
} = require('../services/eventTemplate');

const router = express.Router();

/** Pick email builder from content.templateKind (default: Sibos XDC). */
function buildEventEmailHtml(content = {}) {
  const base = (process.env.APP_URL || '').replace(/\/$/, '');
  const withAssets = {
    ...content,
    // Always embed logos as CID for send/save; preview client overrides with hosted URLs
    xdcLogoSrc: content.xdcLogoSrc || 'cid:xdc-logo',
    contourLogoSrc: content.contourLogoSrc || 'cid:contour-logo',
    ...(content.templateKind === 'contour-sibos' && base
      ? {
          assetBase: content.assetBase || `${base}/events/contour-sibos`,
          logoSrc: content.logoSrc || content.contourLogoSrc || 'cid:contour-logo',
        }
      : {}),
  };
  if (withAssets.templateKind === 'contour-sibos') {
    return buildContourSibosEmailHtml(withAssets);
  }
  return buildSibosEmailHtml(withAssets);
}

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

/** List mail providers (Postmark / SMTP profiles) — no secrets */
router.get('/mail-providers', async (_req, res) => {
  try {
    await ensureMailProvidersSeeded();
    res.json(await listProviders({ activeOnly: true }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Add an SMTP profile to the list */
router.post('/mail-providers', requireSuperAdmin, async (req, res) => {
  try {
    const {
      name,
      slug,
      type = 'smtp',
      from_email,
      from_name,
      smtp_host,
      smtp_port = 587,
      smtp_secure = false,
      smtp_user,
      smtp_pass,
      smtp_pass_env,
      notes,
    } = req.body || {};
    if (!name || !slug || !from_email) {
      return res.status(400).json({ error: 'name, slug, and from_email are required' });
    }
    if (type === 'smtp' && !smtp_host) {
      return res.status(400).json({ error: 'smtp_host required for SMTP providers' });
    }
    const { rows } = await pool.query(
      `INSERT INTO mail_providers
        (name, slug, type, from_email, from_name, smtp_host, smtp_port, smtp_secure,
         smtp_user, smtp_pass, smtp_pass_env, notes, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, TRUE)
       RETURNING *`,
      [
        name,
        slug,
        type === 'postmark' ? 'postmark' : 'smtp',
        from_email,
        from_name || 'XDC Network & Contour',
        smtp_host || null,
        Number(smtp_port) || 587,
        Boolean(smtp_secure),
        smtp_user || null,
        smtp_pass || null,
        smtp_pass_env || null,
        notes || null,
      ]
    );
    res.status(201).json(publicProvider(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** List events (with mail provider) */
router.get('/events', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.*,
              mp.name AS mail_provider_name,
              mp.slug AS mail_provider_slug,
              mp.type AS mail_provider_type,
              mp.from_email AS mail_from_email
       FROM events e
       LEFT JOIN mail_providers mp ON mp.id = e.mail_provider_id
       ORDER BY e.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Create event + default invite template for that event */
router.post('/events', async (req, res) => {
  try {
    const { name, slug, location, dates, mail_provider_id } = req.body;
    if (!name || !slug) {
      return res.status(400).json({ error: 'name and slug are required' });
    }
    if (!mail_provider_id) {
      return res.status(400).json({
        error: 'mail_provider_id is required — choose Postmark or an SMTP profile',
      });
    }
    const provider = await getProviderById(Number(mail_provider_id));
    if (!provider || !provider.active) {
      return res.status(400).json({ error: 'Invalid or inactive mail provider' });
    }

    const { rows } = await pool.query(
      `INSERT INTO events (name, slug, location, dates, mail_provider_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, slug, location || null, dates || null, provider.id]
    );
    const event = rows[0];
    event.mail_provider_name = provider.name;
    event.mail_provider_slug = provider.slug;
    event.mail_provider_type = provider.type;
    event.mail_from_email = provider.from_email;

    const content = {
      headline: `Join XDC Network & Contour at ${name}`,
      location: location || '',
      dates: dates || '',
      booth: '',
      greeting: 'Dear Partner,',
      intro:
        'As financial institutions prepare for an AI-driven economy, infrastructure must move beyond faster processing to autonomous execution, programmable liquidity, and compliant digital settlement.',
      showcase: `At ${name}, XDC Network and Contour are showcasing how institutions can unify enterprise Layer 1 blockchain rails with digitized trade and dollar-stable settlement.`,
      solutionsTitle: 'Core Solutions & Product Lineup',
      solutions: [
        {
          title: 'Instant Domestic & Cross-Border Settlement',
          body: 'Native USDC on XDC delivers sub-second finality and near-zero transaction fees for corporate treasury, institutional transfers, and multi-corridor remittances.',
        },
        {
          title: 'Everyday & Corporate Cards',
          body: 'Instant card top-ups using native USDC on XDC for virtual and physical debit spending worldwide.',
        },
        {
          title: 'Global Payouts & QR Retail Rails',
          body: 'Seamless disbursement routing to over 70 jurisdictions, alongside local merchant QR code point-of-sale settlement.',
        },
        {
          title: 'Digitized Trade Finance (Contour)',
          body: 'Fully paperless Letters of Credit (LCs), electronic documentation, and milestone-based smart contract settlement integrated with ISO 20022 messaging.',
        },
        {
          title: 'Autonomous Agentic Commerce (XDC AI)',
          body: 'Native HTTP 402 (x402) payment rails and gasless smart accounts enabling autonomous AI agents to initiate, reconcile, and settle expenses, compute, and API services compliantly.',
        },
      ],
      leadershipTitle: `Connect with Leadership at ${name}`,
      signOff: 'Best regards,\nThe XDC Network & Contour Delegation',
      disclaimer:
        'Disclaimer: All banking, payment processing, card issuance, and regulated financial services are facilitated exclusively through appropriately authorized and licensed third-party financial institutions and partner entities in their respective jurisdictions. XDC Network is a decentralized enterprise blockchain protocol provider and does not directly provide banking, deposit-taking, or custodial financial services.',
      ctaEmail: 'support@xdcforpayments.org',
      ctaMailtoSubject: `${name} - Meeting Request`,
      ctaMailtoBody: `Hello,\n\nI would like to schedule a meeting with the XDC Network & Contour delegation at ${name}.\n\nPreferred times:\n\nThank you.`,
      ctaLinkType: 'mailto',
      ctaLabel: 'Schedule a Meeting',
    };
    const subject = `Meet XDC Network & Contour at ${name}`;
    const html = buildSibosEmailHtml(content);
    const tpl = await pool.query(
      `INSERT INTO email_templates
        (event_id, name, subject, html_body, text_body, is_default, content_json)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6)
       RETURNING *`,
      [event.id, `${name} Invitation`, subject, html, null, JSON.stringify(content)]
    );

    res.status(201).json({ ...event, template: tpl.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** List participants for an event */
router.get('/events/:id/participants', async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    const { q, limit = 500, offset = 0 } = req.query;
    const params = [eventId];
    let where = 'WHERE event_id = $1';
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (email ILIKE $${params.length} OR name ILIKE $${params.length} OR company ILIKE $${params.length})`;
    }
    const lim = Math.min(Number(limit) || 500, 5000);
    const off = Math.max(Number(offset) || 0, 0);
    params.push(lim, off);
    const { rows } = await pool.query(
      `SELECT * FROM event_participants ${where}
       ORDER BY email ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM event_participants ${where}`,
      params.slice(0, params.length - 2)
    );
    res.json({ items: rows, total: countRes.rows[0].total, eventId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Add / upsert participants for an event */
router.post('/events/:id/participants', async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    const ev = await pool.query(`SELECT id FROM events WHERE id = $1`, [eventId]);
    if (!ev.rows[0]) return res.status(404).json({ error: 'Event not found' });

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    let list = [];
    if (Array.isArray(req.body?.participants)) {
      list = req.body.participants;
    } else if (Array.isArray(req.body?.emails)) {
      list = req.body.emails.map((e) => ({ email: e }));
    } else if (req.body?.email) {
      list = [req.body];
    } else if (req.body?.recipients) {
      const { valid } = parseRecipients(req.body.recipients);
      list = valid.map((email) => ({ email }));
    }

    const seen = new Set();
    const valid = [];
    const invalid = [];
    for (const row of list) {
      const email = String(row.email || '')
        .trim()
        .toLowerCase();
      if (!email || !emailRe.test(email)) {
        if (email) invalid.push(email);
        continue;
      }
      if (seen.has(email)) continue;
      seen.add(email);
      valid.push({
        email,
        name: row.name ? String(row.name).trim() : null,
        company: row.company ? String(row.company).trim() : null,
        notes: row.notes ? String(row.notes).trim() : null,
      });
    }
    if (valid.length === 0) {
      return res.status(400).json({ error: 'No valid participants', invalid });
    }

    let inserted = 0;
    let updated = 0;
    for (let i = 0; i < valid.length; i += 100) {
      const slice = valid.slice(i, i + 100);
      for (const p of slice) {
        const r = await pool.query(
          `INSERT INTO event_participants (event_id, email, name, company, notes)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (event_id, email) DO UPDATE SET
             name = COALESCE(EXCLUDED.name, event_participants.name),
             company = COALESCE(EXCLUDED.company, event_participants.company),
             notes = COALESCE(EXCLUDED.notes, event_participants.notes),
             updated_at = NOW()
           RETURNING (xmax = 0) AS is_insert`,
          [eventId, p.email, p.name, p.company, p.notes]
        );
        if (r.rows[0]?.is_insert) inserted += 1;
        else updated += 1;
      }
    }

    res.json({ ok: true, eventId, inserted, updated, invalidCount: invalid.length, invalid: invalid.slice(0, 20) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Delete one participant */
router.delete('/events/:id/participants/:pid', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM event_participants WHERE id = $1 AND event_id = $2 RETURNING id, email`,
      [req.params.pid, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Participant not found' });
    res.json({ ok: true, deleted: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Queue pending email_sends for this event's participants (uses event default template).
 * Skips emails already pending/sending/sent for the event.
 */
router.post('/events/:id/participants/queue', async (req, res) => {
  const client = await pool.connect();
  try {
    const eventId = Number(req.params.id);
    const { onlyPendingMissing = true } = req.body || {};

    const tpl = await client.query(
      `SELECT * FROM email_templates WHERE event_id = $1 ORDER BY is_default DESC, updated_at DESC LIMIT 1`,
      [eventId]
    );
    if (!tpl.rows[0]) {
      return res.status(400).json({ error: 'No template for this event — save one in Compose first' });
    }
    const template = tpl.rows[0];

    let participants;
    if (onlyPendingMissing) {
      const { requeueSent = false } = req.body || {};
      const skipStatuses = requeueSent
        ? ['pending', 'sending']
        : ['pending', 'sending', 'sent'];
      const r = await client.query(
        `SELECT p.email FROM event_participants p
         WHERE p.event_id = $1
           AND NOT EXISTS (
             SELECT 1 FROM email_sends s
             WHERE s.event_id = p.event_id
               AND LOWER(s.recipient_email) = p.email
               AND s.status = ANY($2::text[])
           )
         ORDER BY p.email`,
        [eventId, skipStatuses]
      );
      participants = r.rows;
    } else {
      const r = await client.query(
        `SELECT email FROM event_participants WHERE event_id = $1 ORDER BY email`,
        [eventId]
      );
      participants = r.rows;
    }

    if (participants.length === 0) {
      return res.json({ ok: true, queued: 0, message: 'Nothing new to queue' });
    }

    await client.query('BEGIN');
    const campaign = await client.query(
      `INSERT INTO email_campaigns
        (event_id, template_id, subject, html_body, recipients_raw, total_recipients, status, sent_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
       RETURNING id`,
      [
        eventId,
        template.id,
        template.subject,
        template.html_body,
        `${participants.length} from participants`,
        participants.length,
        req.user.id,
      ]
    );
    const campaignId = campaign.rows[0].id;
    let queued = 0;
    for (let i = 0; i < participants.length; i += 200) {
      const slice = participants.slice(i, i + 200);
      const values = [];
      const params = [];
      let p = 1;
      for (const row of slice) {
        values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, 'pending', $${p++})`);
        params.push(campaignId, eventId, row.email, template.subject, template.html_body, req.user.id);
      }
      await client.query(
        `INSERT INTO email_sends
          (campaign_id, event_id, recipient_email, subject, html_body, status, sent_by_user_id)
         VALUES ${values.join(', ')}`,
        params
      );
      queued += slice.length;
    }
    await client.query('COMMIT');
    res.json({ ok: true, eventId, campaignId, queued, templateId: template.id });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
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
    const { subject, html_body, text_body, name, rebuildDefault, content, content_json } = req.body;

    let html = html_body;
    let text = text_body;
    let subj = subject;
    let contentJson = content_json || content || null;

    if (rebuildDefault) {
      const c = content || {};
      html = buildEventEmailHtml(c);
      if (c.subject) subj = c.subject;
      contentJson = c;
    }

    const { rows } = await pool.query(
      `UPDATE email_templates
       SET subject = COALESCE($1, subject),
           html_body = COALESCE($2, html_body),
           text_body = COALESCE($3, text_body),
           name = COALESCE($4, name),
           content_json = COALESCE($5::jsonb, content_json),
           updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [
        subj || null,
        html || null,
        text || null,
        name || null,
        contentJson ? JSON.stringify(contentJson) : null,
        req.params.id,
      ]
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
    const html = buildEventEmailHtml(req.body.content || req.body || {});
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
        eventId,
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
    const eventId = rows[0].event_id;
    const recipients = rows.map((r) => r.recipient_email);
    const idByEmail = new Map(rows.map((r) => [r.recipient_email.toLowerCase(), r.id]));

    // Prefer latest Compose template for this event
    let subjectFinal = subject;
    let htmlFinal = html;
    if (eventId) {
      const tpl = await getLatestEventTemplate(eventId);
      if (tpl?.html_body) {
        subjectFinal = tpl.subject || subject;
        htmlFinal = tpl.html_body;
        await pool.query(
          `UPDATE email_sends SET subject = $1, html_body = $2
           WHERE id = ANY($3::int[])`,
          [subjectFinal, htmlFinal, rows.map((r) => r.id)]
        );
      }
    }

    const campaignResult = await sendCampaignEmails({
      recipients,
      subject: subjectFinal,
      html: htmlFinal,
      broadcast: recipients.length > 1,
      eventId,
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
    const { recipients, clear = false, subject, html_body, event_id, alsoParticipants = true } =
      req.body || {};
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
    let eventId = event_id ? Number(event_id) : null;
    let templateId = null;

    if (!eventId) {
      return res.status(400).json({ error: 'event_id is required — imports are per-event' });
    }

    if (!subjectFinal || !htmlFinal) {
      const t = await client.query(
        `SELECT * FROM email_templates WHERE event_id = $1 ORDER BY is_default DESC, updated_at DESC LIMIT 1`,
        [eventId]
      );
      if (t.rows[0]) {
        subjectFinal = subjectFinal || t.rows[0].subject;
        htmlFinal = htmlFinal || t.rows[0].html_body;
        templateId = t.rows[0].id;
      }
    }

    if (!subjectFinal || !htmlFinal) {
      return res.status(400).json({ error: 'No template for this event; provide subject and html_body' });
    }

    await client.query('BEGIN');

    if (clear) {
      // Wipe only this event's queue — leave other events untouched
      await client.query(`DELETE FROM email_sends WHERE event_id = $1`, [eventId]);
      await client.query(`DELETE FROM email_campaigns WHERE event_id = $1`, [eventId]);
    }

    if (alsoParticipants) {
      for (let i = 0; i < valid.length; i += 200) {
        const slice = valid.slice(i, i + 200);
        const values = [];
        const params = [];
        let p = 1;
        for (const email of slice) {
          values.push(`($${p++}, $${p++})`);
          params.push(eventId, email);
        }
        await client.query(
          `INSERT INTO event_participants (event_id, email)
           VALUES ${values.join(', ')}
           ON CONFLICT (event_id, email) DO NOTHING`,
          params
        );
      }
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

/**
 * Push latest Compose template onto pending/failed History rows for this event.
 */
router.post('/sends/sync-pending', async (req, res) => {
  try {
    let { subject, html_body, template_id, event_id } = req.body || {};
    let eventId = event_id ? Number(event_id) : null;

    if (subject && html_body && eventId) {
      const statuses = ['pending', 'failed'];
      const { rowCount } = await pool.query(
        `UPDATE email_sends
         SET subject = $1, html_body = $2
         WHERE event_id = $3 AND status = ANY($4::text[])`,
        [subject, html_body, eventId, statuses]
      );
      await pool.query(
        `UPDATE email_campaigns
         SET subject = $1, html_body = $2
         WHERE event_id = $3 AND status = 'pending'`,
        [subject, html_body, eventId]
      );
      return res.json({ ok: true, updated: rowCount, subject, eventId });
    }

    if (!eventId && template_id) {
      const t = await pool.query(`SELECT event_id FROM email_templates WHERE id = $1`, [template_id]);
      eventId = t.rows[0]?.event_id || null;
    }
    if (!eventId) {
      return res.status(400).json({ error: 'event_id required to sync without mixing events' });
    }

    const result = await syncEventQueueFromTemplate(eventId, { includeFailed: true });
    if (!result.templateId && !subject) {
      return res.status(400).json({ error: 'No template found for this event — save in Compose first' });
    }
    res.json({ ok: true, ...result, eventId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Send selected pending rows one-by-one on transactional (outbound) stream,
 * and only mark sent after Postmark Activity confirms the MessageID.
 */
router.post('/sends/send-verified', async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array required' });
    }
    if (ids.length > 50) {
      return res.status(400).json({ error: 'Max 50 ids per verified send' });
    }

    const { rows } = await pool.query(
      `SELECT * FROM email_sends WHERE id = ANY($1::int[]) AND status IN ('pending', 'failed') ORDER BY id ASC`,
      [ids.map(Number)]
    );
    if (rows.length === 0) {
      return res.status(400).json({ error: 'No pending/failed rows in selection' });
    }

    const results = [];
    let success = 0;
    let failure = 0;
    const templateCache = new Map();

    for (const row of rows) {
      try {
        const content = await contentForSendRow(row, templateCache);
        // Keep History row in sync with latest Compose template before send
        if (content.fromTemplate) {
          await pool.query(
            `UPDATE email_sends SET subject = $1, html_body = $2 WHERE id = $3`,
            [content.subject, content.html, row.id]
          );
        }
        const r = row.event_id
          ? await sendOneForEvent(row.event_id, {
              to: row.recipient_email,
              subject: content.subject,
              html: content.html,
            })
          : await sendOneVerifiedTransactional({
              to: row.recipient_email,
              subject: content.subject,
              html: content.html,
            });
        if (r.status === 'sent') {
          success += 1;
          await pool.query(
            `UPDATE email_sends
             SET status = 'sent', message_id = $1, sent_at = NOW(), error_message = NULL,
                 sent_by_user_id = COALESCE(sent_by_user_id, $3)
             WHERE id = $2`,
            [r.messageId, row.id, req.user.id]
          );
        } else {
          failure += 1;
          await pool.query(
            `UPDATE email_sends
             SET status = 'failed', message_id = $1, error_message = $2,
                 sent_by_user_id = COALESCE(sent_by_user_id, $4)
             WHERE id = $3`,
            [r.messageId || null, r.error || 'verify failed', row.id, req.user.id]
          );
        }
        results.push({ id: row.id, ...r, usedTemplateId: content.templateId });
      } catch (err) {
        failure += 1;
        await pool.query(
          `UPDATE email_sends
           SET status = 'failed', error_message = $1, sent_by_user_id = COALESCE(sent_by_user_id, $3)
           WHERE id = $2`,
          [err.message, row.id, req.user.id]
        );
        results.push({
          id: row.id,
          email: row.recipient_email,
          status: 'failed',
          error: err.message,
        });
      }
    }

    res.json({
      ok: true,
      success,
      failure,
      stream: 'outbound',
      verified: true,
      results,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Auto-send: 20 pending / minute — start / stop / status */
router.get('/sends/auto', async (_req, res) => {
  try {
    const { getStatus } = require('../services/autoSender');
    res.json(await getStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sends/auto/start', async (req, res) => {
  try {
    const { startAutoSend, getStatus } = require('../services/autoSender');
    const eventId = req.body?.eventId || req.body?.event_id || null;
    await startAutoSend(req.user?.id || null, eventId);
    const status = await getStatus();
    res.json({
      ok: true,
      message: `Verified auto-send started: ${status.batchSize}/min` +
        (status.eventId ? ` for event #${status.eventId}` : ' (all events)'),
      ...status,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sends/auto/stop', async (_req, res) => {
  try {
    const { stopAutoSend } = require('../services/autoSender');
    const status = await stopAutoSend();
    res.json({ ok: true, message: 'Verified auto-send stopped', ...status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Requeue rows marked sent that Postmark Activity cannot confirm (Error 701).
 * Run this before restarting auto-send after ghost "sent" marks.
 */
router.post('/sends/requeue-unverified', requireSuperAdmin, async (_req, res) => {
  try {
    const { requeueUnverifiedSent, getStatus } = require('../services/autoSender');
    // Respond after job starts if we want async — for now run sync (may take a few min)
    const result = await requeueUnverifiedSent({ concurrency: 20 });
    const status = await getStatus();
    res.json({ ...result, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Send history with filters */
router.get('/sends', async (req, res) => {
  try {
    const { q, status, limit = 50, offset = 0, campaignId, eventId } = req.query;
    const clauses = [];
    const params = [];

    if (eventId) {
      params.push(Number(eventId));
      clauses.push(`s.event_id = $${params.length}`);
    }
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
      `SELECT s.*, c.status AS campaign_status, e.name AS event_name
       FROM email_sends s
       LEFT JOIN email_campaigns c ON c.id = s.campaign_id
       LEFT JOIN events e ON e.id = s.event_id
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

    const statusParams = eventId ? [Number(eventId)] : [];
    const statusWhere = eventId ? 'WHERE event_id = $1' : '';
    const statusCounts = await pool.query(
      `SELECT status, COUNT(*)::int AS count FROM email_sends ${statusWhere} GROUP BY status`,
      statusParams
    );

    res.json({
      items: rows,
      total: countRes.rows[0].total,
      limit: lim,
      offset: off,
      eventId: eventId ? Number(eventId) : null,
      statusCounts: Object.fromEntries(statusCounts.rows.map((r) => [r.status, r.count])),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Campaign list */
router.get('/campaigns', async (req, res) => {
  try {
    const { eventId } = req.query;
    if (eventId) {
      const { rows } = await pool.query(
        `SELECT * FROM email_campaigns WHERE event_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [Number(eventId)]
      );
      return res.json(rows);
    }
    const { rows } = await pool.query(
      `SELECT * FROM email_campaigns ORDER BY created_at DESC LIMIT 50`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
