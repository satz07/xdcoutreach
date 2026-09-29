const crypto = require('crypto');
const { pool } = require('../db/pool');
const { jwtSecret, frontendUrl, SUPERADMIN_EMAIL } = require('../middleware/auth');
const { MEETING_PLACEHOLDER } = require('../templates/meeting');

const LEAD_STATUSES = ['new', 'contacted', 'meeting_booked', 'closed'];

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(payload) {
  return b64url(crypto.createHmac('sha256', `meet:${jwtSecret()}`).update(payload).digest()).slice(0, 24);
}

/** Non-expiring signed token so a recipient can open the form weeks after the email. */
function signMeetingToken({ eventId, email }) {
  const payload = b64url(JSON.stringify({ e: Number(eventId) || null, m: String(email).trim().toLowerCase() }));
  return `${payload}.${sign(payload)}`;
}

function verifyMeetingToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = sign(payload);
  if (!sig || sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (!data.m) return null;
    return { eventId: data.e || null, email: data.m };
  } catch {
    return null;
  }
}

function meetingUrl({ eventId, email } = {}) {
  const base = `${frontendUrl()}/?meet=`;
  return email ? base + signMeetingToken({ eventId, email }) : `${base}${eventId ? `&event=${eventId}` : ''}`;
}

/** Swap the template placeholder for this recipient's personal form link. */
function personalizeHtml(html, { eventId, email } = {}) {
  const s = String(html || '');
  if (!s.includes(MEETING_PLACEHOLDER)) return s;
  return s.split(MEETING_PLACEHOLDER).join(meetingUrl({ eventId, email }));
}

async function getSetting(key) {
  try {
    const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = $1`, [key]);
    return rows[0]?.value ?? null;
  } catch {
    return null;
  }
}

async function setSetting(key, value) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, String(value ?? '')]
  );
}

function splitEmails(raw) {
  return String(raw || '')
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
}

async function getNotifyEmails() {
  const saved = await getSetting('leads_notify_emails');
  if (saved != null) return splitEmails(saved);
  const env = splitEmails(process.env.LEADS_NOTIFY_EMAIL);
  return env.length ? env : [SUPERADMIN_EMAIL];
}

async function setNotifyEmails(raw) {
  const list = splitEmails(raw);
  await setSetting('leads_notify_emails', list.join(','));
  return list;
}

function esc(s = '') {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function notifyNewLead(lead, { eventName, resubmitted = false } = {}) {
  const to = await getNotifyEmails();
  if (!to.length) return { skipped: true };
  const { sendOneEmail } = require('./mailer');
  const rows = [
    ['Name', lead.name],
    ['Email', lead.email],
    ['Company', lead.company],
    ['Job title', lead.job_title],
    ['Phone', lead.phone],
    ['Event', eventName],
    ['Preferred date', lead.preferred_date],
    ['Preferred time', lead.preferred_time],
    ['Format', lead.meeting_mode],
    ['Topic', lead.topic],
    ['Message', lead.message],
  ].filter(([, v]) => v);
  const link = `${frontendUrl()}/?tab=leads&lead=${lead.id}`;
  const who = lead.name || lead.email;
  const subject = `${resubmitted ? 'Updated' : 'New'} meeting request: ${who}${lead.company ? ` (${lead.company})` : ''}`;
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;background:#F4F7FB;padding:24px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #D5E0EE;border-radius:12px;">
    <tr><td style="padding:22px 26px;background:#15294C;color:#fff;border-radius:12px 12px 0 0;">
      <h1 style="margin:0;font-size:20px;">${esc(subject)}</h1>
    </td></tr>
    <tr><td style="padding:20px 26px;color:#243447;font-size:14px;line-height:1.6;">
      <table cellpadding="0" cellspacing="0" style="width:100%;">
        ${rows
          .map(
            ([k, v]) =>
              `<tr><td style="padding:6px 12px 6px 0;color:#6B7C8F;vertical-align:top;white-space:nowrap;">${esc(k)}</td><td style="padding:6px 0;white-space:pre-wrap;">${esc(v)}</td></tr>`
          )
          .join('')}
      </table>
      <p style="margin:20px 0 0;"><a href="${esc(link)}" style="display:inline-block;padding:11px 20px;background:#254C82;color:#fff;text-decoration:none;border-radius:6px;font-weight:700;">Open in Leads</a></p>
    </td></tr>
  </table></body></html>`;
  const text = `${subject}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nOpen: ${link}`;
  const results = [];
  for (const addr of to) {
    try {
      await sendOneEmail({ to: addr, subject, html, text, includeLogos: false, fromName: 'XDC Outreach Leads' });
      results.push({ to: addr, ok: true });
    } catch (err) {
      console.error('[leads] notify failed', addr, err.message);
      results.push({ to: addr, ok: false, error: err.message });
    }
  }
  return { results };
}

module.exports = {
  MEETING_PLACEHOLDER,
  LEAD_STATUSES,
  signMeetingToken,
  verifyMeetingToken,
  meetingUrl,
  personalizeHtml,
  getNotifyEmails,
  setNotifyEmails,
  notifyNewLead,
};
