const express = require('express');
const { pool } = require('../db/pool');
const { verifyMeetingToken, notifyNewLead } = require('../services/leads');
const { getLatestEventTemplate } = require('../services/eventTemplate');

const router = express.Router();

const FIELD_LIMITS = {
  name: 120,
  company: 160,
  job_title: 120,
  phone: 40,
  preferred_date: 60,
  preferred_time: 60,
  meeting_mode: 40,
  topic: 200,
  message: 3000,
};

// Simple per-IP throttle; the form is public and unauthenticated.
const hits = new Map();
function throttled(ip) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(ip, list);
  return list.length > 15;
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')
    .split(',')[0]
    .trim();
}

async function eventInfo(eventId) {
  if (!eventId) return null;
  const { rows } = await pool.query(`SELECT id, name, location, dates FROM events WHERE id = $1`, [eventId]);
  const ev = rows[0];
  if (!ev) return null;
  const tpl = await getLatestEventTemplate(eventId);
  const kind = tpl?.content_json?.templateKind || '';
  return { ...ev, brand: String(kind).startsWith('contour') ? 'contour' : 'xdc' };
}

/** GET /api/public/meet?token=…&event=… — form bootstrap (prefill + branding) */
router.get('/meet', async (req, res) => {
  try {
    const t = req.query.token ? verifyMeetingToken(String(req.query.token)) : null;
    if (req.query.token && !t) {
      return res.status(400).json({ error: 'This link is invalid. You can still fill in the form below.' });
    }
    const eventId = t?.eventId || Number(req.query.event) || null;
    const event = await eventInfo(eventId);
    let name = null;
    let company = null;
    let alreadySubmitted = false;
    if (t) {
      const p = await pool.query(
        `SELECT name, company FROM event_participants WHERE email = $1
         ORDER BY (event_id = $2::int) DESC NULLS LAST, updated_at DESC LIMIT 1`,
        [t.email, eventId]
      );
      name = p.rows[0]?.name || null;
      company = p.rows[0]?.company || null;
      const prev = await pool.query(
        `SELECT name, company, job_title, phone FROM meeting_leads
         WHERE email = $1 AND event_id IS NOT DISTINCT FROM $2
         ORDER BY created_at DESC LIMIT 1`,
        [t.email, eventId]
      );
      if (prev.rows[0]) {
        alreadySubmitted = true;
        name = prev.rows[0].name || name;
        company = prev.rows[0].company || company;
      }
    }
    res.json({
      email: t?.email || null,
      verified: Boolean(t),
      name,
      company,
      alreadySubmitted,
      event,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/public/meet — submit / update a meeting request */
router.post('/meet', async (req, res) => {
  try {
    const body = req.body || {};
    if (body.website) return res.json({ ok: true }); // honeypot: bots fill hidden field
    const ip = clientIp(req);
    if (throttled(ip)) {
      return res.status(429).json({ error: 'Too many submissions. Please try again later.' });
    }

    const t = body.token ? verifyMeetingToken(String(body.token)) : null;
    const email = (t?.email || String(body.email || '').trim().toLowerCase()).slice(0, 200);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }
    const eventId = t?.eventId || Number(body.event_id) || null;
    const event = await eventInfo(eventId);

    const f = {};
    for (const [k, max] of Object.entries(FIELD_LIMITS)) {
      const v = body[k] == null ? '' : String(body[k]).trim();
      f[k] = v ? v.slice(0, max) : null;
    }
    if (!f.name) return res.status(400).json({ error: 'Please enter your name' });

    const ua = String(req.headers['user-agent'] || '').slice(0, 300);
    const open = await pool.query(
      `SELECT id FROM meeting_leads
       WHERE email = $1 AND event_id IS NOT DISTINCT FROM $2 AND status <> 'closed'
       ORDER BY created_at DESC LIMIT 1`,
      [email, event?.id || null]
    );

    let lead;
    let resubmitted = false;
    if (open.rows[0]) {
      resubmitted = true;
      const r = await pool.query(
        `UPDATE meeting_leads SET
           name = $2, company = COALESCE($3, company), job_title = COALESCE($4, job_title),
           phone = COALESCE($5, phone), preferred_date = $6, preferred_time = $7,
           meeting_mode = $8, topic = $9, message = $10,
           verified = verified OR $11, submit_count = submit_count + 1,
           ip = $12, user_agent = $13, last_submitted_at = NOW(), updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [
          open.rows[0].id, f.name, f.company, f.job_title, f.phone, f.preferred_date,
          f.preferred_time, f.meeting_mode, f.topic, f.message, Boolean(t), ip, ua,
        ]
      );
      lead = r.rows[0];
      await pool.query(
        `INSERT INTO lead_notes (lead_id, body, kind) VALUES ($1, $2, 'system')`,
        [lead.id, 'Recipient re-submitted the meeting form (details updated).']
      );
    } else {
      const r = await pool.query(
        `INSERT INTO meeting_leads
           (event_id, email, name, company, job_title, phone, preferred_date, preferred_time,
            meeting_mode, topic, message, verified, ip, user_agent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [
          event?.id || null, email, f.name, f.company, f.job_title, f.phone, f.preferred_date,
          f.preferred_time, f.meeting_mode, f.topic, f.message, Boolean(t), ip, ua,
        ]
      );
      lead = r.rows[0];
    }

    if (event?.id && (f.name || f.company)) {
      await pool.query(
        `INSERT INTO event_participants (event_id, email, name, company) VALUES ($1, $2, $3, $4)
         ON CONFLICT (event_id, email) DO UPDATE SET
           name = COALESCE(event_participants.name, EXCLUDED.name),
           company = COALESCE(event_participants.company, EXCLUDED.company),
           updated_at = NOW()`,
        [event.id, email, f.name, f.company]
      );
    }

    notifyNewLead(lead, { eventName: event?.name, resubmitted }).catch((err) =>
      console.error('[leads] notify error:', err.message)
    );

    res.json({ ok: true, resubmitted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
