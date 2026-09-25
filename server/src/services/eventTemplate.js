const { pool } = require('../db/pool');

/** Latest saved Compose template for an event */
async function getLatestEventTemplate(eventId) {
  if (!eventId) return null;
  const { rows } = await pool.query(
    `SELECT id, event_id, subject, html_body, content_json, updated_at
     FROM email_templates
     WHERE event_id = $1
     ORDER BY is_default DESC, updated_at DESC
     LIMIT 1`,
    [eventId]
  );
  return rows[0] || null;
}

/**
 * Subject/HTML to send for a History row — always prefers the event's
 * latest saved template so Compose → Save is what goes out.
 */
async function contentForSendRow(row, cache = null) {
  if (!row?.event_id) {
    return { subject: row.subject, html: row.html_body, templateId: null, fromTemplate: false };
  }
  let tpl;
  if (cache) {
    if (!cache.has(row.event_id)) {
      cache.set(row.event_id, await getLatestEventTemplate(row.event_id));
    }
    tpl = cache.get(row.event_id);
  } else {
    tpl = await getLatestEventTemplate(row.event_id);
  }
  if (!tpl?.html_body) {
    return { subject: row.subject, html: row.html_body, templateId: null, fromTemplate: false };
  }
  return {
    subject: tpl.subject || row.subject,
    html: tpl.html_body,
    templateId: tpl.id,
    fromTemplate: true,
  };
}

/** Push latest template onto pending (+ optional failed) queue rows for an event */
async function syncEventQueueFromTemplate(eventId, { includeFailed = true } = {}) {
  const tpl = await getLatestEventTemplate(eventId);
  if (!tpl) return { updated: 0, templateId: null };
  const statuses = includeFailed ? ['pending', 'failed'] : ['pending'];
  const { rowCount } = await pool.query(
    `UPDATE email_sends
     SET subject = $1, html_body = $2
     WHERE event_id = $3 AND status = ANY($4::text[])`,
    [tpl.subject, tpl.html_body, eventId, statuses]
  );
  await pool.query(
    `UPDATE email_campaigns
     SET subject = $1, html_body = $2
     WHERE event_id = $3 AND status = 'pending'`,
    [tpl.subject, tpl.html_body, eventId]
  );
  return { updated: rowCount, templateId: tpl.id, subject: tpl.subject };
}

module.exports = {
  getLatestEventTemplate,
  contentForSendRow,
  syncEventQueueFromTemplate,
};
