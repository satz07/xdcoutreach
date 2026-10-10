const crypto = require('crypto');
const { pool } = require('../db/pool');
const { frontendUrl } = require('../middleware/auth');

const SPONSOR_STATUSES = ['prospect', 'invited', 'interested', 'confirmed', 'declined'];
const INVOICE_STATUSES = ['draft', 'sent', 'payment_reported', 'paid', 'cancelled'];
const EVENT_STATUSES = ['planning', 'open', 'closed', 'done'];
const DELIVERABLE_KINDS = [
  'linkedin',
  'x',
  'newsletter',
  'blog',
  'website',
  'press',
  'video',
  'asset',
  'speaking',
  'booth',
  'other',
];
const DELIVERABLE_OWNERS = ['sponsor', 'host'];

const DEFAULT_DELIVERABLES = [
  { title: 'Announce the sponsorship on LinkedIn', kind: 'linkedin', owner: 'sponsor' },
  { title: 'Announce the sponsorship on X (Twitter)', kind: 'x', owner: 'sponsor' },
  { title: 'Share the event registration link with their community', kind: 'newsletter', owner: 'sponsor' },
  { title: 'Send logo (SVG/PNG) and a short company description', kind: 'asset', owner: 'sponsor' },
  { title: 'Welcome post on XDC LinkedIn', kind: 'linkedin', owner: 'host' },
  { title: 'Welcome post on XDC X (Twitter)', kind: 'x', owner: 'host' },
  { title: 'Logo on the event website', kind: 'website', owner: 'host' },
];

const MAX_FILE_BYTES = 7 * 1024 * 1024;
const FILE_TYPES = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
};

const DEFAULT_INVITE_SUBJECT = 'Invitation to co-sponsor {{event}}';
const DEFAULT_INVITE_BODY = `Hi {{name}},

We're hosting {{event}} ({{event_details}}) and would love to have {{company}} on board as a co-sponsor.

Your sponsorship page has the packages, benefits and next steps:
{{portal_link}}

Happy to set up a quick call to walk you through it.

Best regards,
{{sender}}`;

async function ensureHostingSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hosted_events (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      tagline TEXT,
      description TEXT,
      venue TEXT,
      city TEXT,
      start_date TEXT,
      end_date TEXT,
      website TEXT,
      currency TEXT NOT NULL DEFAULT 'USD',
      sponsor_target NUMERIC(14,2),
      status TEXT NOT NULL DEFAULT 'planning',
      payment_instructions TEXT,
      invite_subject TEXT,
      invite_body TEXT,
      from_name TEXT,
      prospectus_file_id INTEGER,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sponsor_packages (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES hosted_events(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      price NUMERIC(14,2),
      slots INTEGER,
      benefits TEXT,
      deliverables JSONB NOT NULL DEFAULT '[]'::jsonb,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sponsor_packages_event ON sponsor_packages(event_id);

    CREATE TABLE IF NOT EXISTS event_sponsors (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES hosted_events(id) ON DELETE CASCADE,
      package_id INTEGER REFERENCES sponsor_packages(id) ON DELETE SET NULL,
      company TEXT NOT NULL,
      contact_name TEXT,
      contact_email TEXT,
      cc_emails TEXT,
      website TEXT,
      amount NUMERIC(14,2),
      status TEXT NOT NULL DEFAULT 'prospect',
      portal_token TEXT UNIQUE NOT NULL,
      owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      notes TEXT,
      invited_at TIMESTAMPTZ,
      confirmed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_event_sponsors_event ON event_sponsors(event_id);

    CREATE TABLE IF NOT EXISTS hosted_files (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES hosted_events(id) ON DELETE CASCADE,
      sponsor_id INTEGER REFERENCES event_sponsors(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'other',
      filename TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      data BYTEA NOT NULL,
      uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_hosted_files_sponsor ON hosted_files(sponsor_id);

    CREATE TABLE IF NOT EXISTS sponsor_invoices (
      id SERIAL PRIMARY KEY,
      sponsor_id INTEGER NOT NULL REFERENCES event_sponsors(id) ON DELETE CASCADE,
      number TEXT NOT NULL,
      amount NUMERIC(14,2) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      file_id INTEGER REFERENCES hosted_files(id) ON DELETE SET NULL,
      payment_link TEXT,
      note TEXT,
      payment_reference TEXT,
      sent_at TIMESTAMPTZ,
      reminded_at TIMESTAMPTZ,
      reported_at TIMESTAMPTZ,
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sponsor_invoices_sponsor ON sponsor_invoices(sponsor_id);

    CREATE TABLE IF NOT EXISTS sponsor_deliverables (
      id SERIAL PRIMARY KEY,
      sponsor_id INTEGER NOT NULL REFERENCES event_sponsors(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'other',
      owner TEXT NOT NULL DEFAULT 'sponsor',
      due_date TEXT,
      done BOOLEAN NOT NULL DEFAULT FALSE,
      done_at TIMESTAMPTZ,
      link TEXT,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sponsor_deliverables_sponsor ON sponsor_deliverables(sponsor_id);

    CREATE TABLE IF NOT EXISTS sponsor_activity (
      id SERIAL PRIMARY KEY,
      sponsor_id INTEGER NOT NULL REFERENCES event_sponsors(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      body TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'system',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sponsor_activity_sponsor ON sponsor_activity(sponsor_id);
  `);
}

// ---------- helpers ----------

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function str(v, max = 2000) {
  if (v === undefined) return undefined;
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
}

function num(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) throw httpError(400, `Invalid amount: ${v}`);
  return Math.round(n * 100) / 100;
}

function dateStr(v) {
  if (v === undefined) return undefined;
  if (!v) return null;
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw httpError(400, `Invalid date: ${v}`);
  return s;
}

function url(v) {
  const s = str(v, 1000);
  if (!s) return s;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

function oneOf(v, list, field) {
  if (v === undefined) return undefined;
  if (!list.includes(v)) throw httpError(400, `${field} must be one of ${list.join(', ')}`);
  return v;
}

function emails(raw) {
  return String(raw || '')
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
}

function esc(s = '') {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(amount, currency = 'USD') {
  if (amount == null || amount === '') return '—';
  return `${currency} ${Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: Number(amount) % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(`${d}T00:00:00Z`);
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function eventDates(ev) {
  if (!ev.start_date) return '';
  if (!ev.end_date || ev.end_date === ev.start_date) return fmtDate(ev.start_date);
  const a = new Date(`${ev.start_date}T00:00:00Z`);
  const b = new Date(`${ev.end_date}T00:00:00Z`);
  if (a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()) {
    return `${a.getUTCDate()}–${fmtDate(ev.end_date)}`;
  }
  return `${fmtDate(ev.start_date)} – ${fmtDate(ev.end_date)}`;
}

function eventDetails(ev) {
  return [[ev.venue, ev.city].filter(Boolean).join(', '), eventDates(ev)].filter(Boolean).join(' · ');
}

function portalUrl(token) {
  return `${frontendUrl()}/sponsor/${token}`;
}

function newToken() {
  return crypto.randomBytes(18).toString('base64url');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function log(sponsorId, body, { userId = null, kind = 'system' } = {}) {
  await pool.query(
    `INSERT INTO sponsor_activity (sponsor_id, user_id, body, kind) VALUES ($1, $2, $3, $4)`,
    [sponsorId, userId, String(body).slice(0, 5000), kind]
  );
}

// ---------- files ----------

function decodeUpload(file) {
  if (!file || !file.data) return null;
  const filename = (str(file.filename, 200) || 'file').replace(/[^\x20-\x7E]|[\\/"]/g, '_');
  const mime = String(file.mime || '').toLowerCase();
  if (!FILE_TYPES[mime]) throw httpError(400, 'Upload a PDF, PNG or JPG file.');
  const b64 = String(file.data).replace(/^data:[^;]+;base64,/, '');
  const data = Buffer.from(b64, 'base64');
  if (!data.length) throw httpError(400, 'The file is empty.');
  if (data.length > MAX_FILE_BYTES) throw httpError(400, 'Files must be 7 MB or smaller.');
  if (mime === 'application/pdf' && data.subarray(0, 5).toString() !== '%PDF-') {
    throw httpError(400, 'That file is not a valid PDF.');
  }
  return { filename, mime, data };
}

async function saveFile({ eventId, sponsorId = null, kind, file, userId }) {
  const f = decodeUpload(file);
  if (!f) return null;
  const { rows } = await pool.query(
    `INSERT INTO hosted_files (event_id, sponsor_id, kind, filename, mime, size, data, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, filename, mime, size, created_at`,
    [eventId, sponsorId, kind, f.filename, f.mime, f.data.length, f.data, userId || null]
  );
  return rows[0];
}

async function getFile(id) {
  const { rows } = await pool.query(`SELECT * FROM hosted_files WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function fileMeta(id) {
  if (!id) return null;
  const { rows } = await pool.query(
    `SELECT id, filename, mime, size, created_at FROM hosted_files WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

// ---------- events ----------

const EVENT_COLS = `e.id, e.name, e.tagline, e.description, e.venue, e.city, e.start_date, e.end_date,
  e.website, e.currency, e.sponsor_target::float8 AS sponsor_target, e.status, e.payment_instructions,
  e.invite_subject, e.invite_body, e.from_name, e.prospectus_file_id, e.created_at, e.updated_at`;

function eventFields(body, { creating = false } = {}) {
  const f = {
    name: str(body.name, 200),
    tagline: str(body.tagline, 300),
    description: str(body.description, 5000),
    venue: str(body.venue, 200),
    city: str(body.city, 120),
    start_date: dateStr(body.start_date),
    end_date: dateStr(body.end_date),
    website: url(body.website),
    currency: body.currency === undefined ? undefined : (str(body.currency, 6) || 'USD').toUpperCase(),
    sponsor_target: num(body.sponsor_target),
    status: oneOf(body.status, EVENT_STATUSES, 'status'),
    payment_instructions: str(body.payment_instructions, 5000),
    invite_subject: str(body.invite_subject, 300),
    invite_body: str(body.invite_body, 10000),
    from_name: str(body.from_name, 120),
  };
  if (creating && !f.name) throw httpError(400, 'Event name is required');
  if (!creating && f.name === null) throw httpError(400, 'Event name cannot be empty');
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined));
}

async function getEvent(id) {
  const { rows } = await pool.query(`SELECT ${EVENT_COLS} FROM hosted_events e WHERE e.id = $1`, [id]);
  if (!rows[0]) throw httpError(404, 'Event not found');
  return rows[0];
}

async function createEvent(body, userId) {
  const f = eventFields(body, { creating: true });
  const cols = Object.keys(f);
  const { rows } = await pool.query(
    `INSERT INTO hosted_events (${cols.join(', ')}, created_by)
     VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, $${cols.length + 1})
     RETURNING id`,
    [...Object.values(f), userId]
  );
  return getEvent(rows[0].id);
}

async function updateEvent(id, body) {
  await getEvent(id);
  const f = eventFields(body);
  const cols = Object.keys(f);
  if (cols.length) {
    await pool.query(
      `UPDATE hosted_events SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = NOW()
       WHERE id = $1`,
      [id, ...Object.values(f)]
    );
  }
  return getEvent(id);
}

async function deleteEvent(id) {
  const { rowCount } = await pool.query(`DELETE FROM hosted_events WHERE id = $1`, [id]);
  if (!rowCount) throw httpError(404, 'Event not found');
}

async function setProspectus(eventId, file, userId) {
  const ev = await getEvent(eventId);
  const saved = await saveFile({ eventId, kind: 'prospectus', file, userId });
  if (!saved) throw httpError(400, 'No file uploaded');
  await pool.query(`UPDATE hosted_events SET prospectus_file_id = $2, updated_at = NOW() WHERE id = $1`, [
    eventId,
    saved.id,
  ]);
  if (ev.prospectus_file_id) await pool.query(`DELETE FROM hosted_files WHERE id = $1`, [ev.prospectus_file_id]);
  return saved;
}

async function removeProspectus(eventId) {
  const ev = await getEvent(eventId);
  await pool.query(`UPDATE hosted_events SET prospectus_file_id = NULL, updated_at = NOW() WHERE id = $1`, [eventId]);
  if (ev.prospectus_file_id) await pool.query(`DELETE FROM hosted_files WHERE id = $1`, [ev.prospectus_file_id]);
}

// ---------- packages ----------

const PACKAGE_COLS = `id, event_id, name, price::float8 AS price, slots, benefits, deliverables, sort, created_at`;

function cleanDeliverables(list) {
  if (list === undefined) return undefined;
  if (!Array.isArray(list)) throw httpError(400, 'deliverables must be a list');
  return list
    .map((d) => ({
      title: str(typeof d === 'string' ? d : d?.title, 300),
      kind: DELIVERABLE_KINDS.includes(d?.kind) ? d.kind : 'other',
      owner: DELIVERABLE_OWNERS.includes(d?.owner) ? d.owner : 'sponsor',
    }))
    .filter((d) => d.title)
    .slice(0, 40);
}

function packageFields(body, { creating = false } = {}) {
  const f = {
    name: str(body.name, 120),
    price: num(body.price),
    slots: body.slots === undefined ? undefined : body.slots === '' || body.slots == null ? null : Math.max(0, parseInt(body.slots, 10) || 0),
    benefits: str(body.benefits, 5000),
    sort: body.sort === undefined ? undefined : parseInt(body.sort, 10) || 0,
  };
  const d = cleanDeliverables(body.deliverables);
  if (d !== undefined) f.deliverables = JSON.stringify(d);
  if (creating && !f.name) throw httpError(400, 'Package name is required');
  if (!creating && f.name === null) throw httpError(400, 'Package name cannot be empty');
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined));
}

async function listPackages(eventId) {
  const { rows } = await pool.query(
    `SELECT ${PACKAGE_COLS} FROM sponsor_packages WHERE event_id = $1 ORDER BY sort ASC, price DESC NULLS LAST, id ASC`,
    [eventId]
  );
  return rows;
}

async function createPackage(eventId, body) {
  await getEvent(eventId);
  const f = packageFields(body, { creating: true });
  if (f.deliverables === undefined) f.deliverables = JSON.stringify(DEFAULT_DELIVERABLES);
  const cols = Object.keys(f);
  const { rows } = await pool.query(
    `INSERT INTO sponsor_packages (event_id, ${cols.join(', ')})
     VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})
     RETURNING ${PACKAGE_COLS}`,
    [eventId, ...Object.values(f)]
  );
  return rows[0];
}

async function updatePackage(id, body) {
  const f = packageFields(body);
  const cols = Object.keys(f);
  const { rows } = await pool.query(
    cols.length
      ? `UPDATE sponsor_packages SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}
         WHERE id = $1 RETURNING ${PACKAGE_COLS}`
      : `SELECT ${PACKAGE_COLS} FROM sponsor_packages WHERE id = $1`,
    [id, ...Object.values(f)]
  );
  if (!rows[0]) throw httpError(404, 'Package not found');
  return rows[0];
}

async function deletePackage(id) {
  const { rowCount } = await pool.query(`DELETE FROM sponsor_packages WHERE id = $1`, [id]);
  if (!rowCount) throw httpError(404, 'Package not found');
}

// ---------- sponsors ----------

const SPONSOR_SELECT = `
  SELECT s.id, s.event_id, s.package_id, s.company, s.contact_name, s.contact_email, s.cc_emails,
    s.website, s.amount::float8 AS amount, s.status, s.portal_token, s.owner_user_id, s.notes,
    s.invited_at, s.confirmed_at, s.created_at, s.updated_at,
    p.name AS package_name, p.price::float8 AS package_price,
    COALESCE(s.amount, p.price)::float8 AS value,
    u.email AS owner_email,
    (SELECT COUNT(*)::int FROM sponsor_deliverables d WHERE d.sponsor_id = s.id) AS deliverables_total,
    (SELECT COUNT(*)::int FROM sponsor_deliverables d WHERE d.sponsor_id = s.id AND d.done) AS deliverables_done,
    (SELECT COALESCE(SUM(i.amount), 0)::float8 FROM sponsor_invoices i
      WHERE i.sponsor_id = s.id AND i.status NOT IN ('draft', 'cancelled')) AS invoiced,
    (SELECT COALESCE(SUM(i.amount), 0)::float8 FROM sponsor_invoices i
      WHERE i.sponsor_id = s.id AND i.status = 'paid') AS paid,
    (SELECT i.status FROM sponsor_invoices i
      WHERE i.sponsor_id = s.id AND i.status <> 'cancelled' ORDER BY i.created_at DESC LIMIT 1) AS invoice_status,
    COALESCE((SELECT bool_or(i.due_date < to_char(NOW(), 'YYYY-MM-DD')) FROM sponsor_invoices i
      WHERE i.sponsor_id = s.id AND i.status IN ('sent', 'payment_reported')), FALSE) AS overdue
  FROM event_sponsors s
  LEFT JOIN sponsor_packages p ON p.id = s.package_id
  LEFT JOIN users u ON u.id = s.owner_user_id`;

const STATUS_ORDER_SQL = `CASE s.status WHEN 'confirmed' THEN 0 WHEN 'interested' THEN 1 WHEN 'invited' THEN 2
  WHEN 'prospect' THEN 3 ELSE 4 END`;

async function listSponsors(eventId) {
  const { rows } = await pool.query(
    `${SPONSOR_SELECT} WHERE s.event_id = $1 ORDER BY ${STATUS_ORDER_SQL}, LOWER(s.company) ASC`,
    [eventId]
  );
  return rows;
}

async function getSponsor(id) {
  const { rows } = await pool.query(`${SPONSOR_SELECT} WHERE s.id = $1`, [id]);
  if (!rows[0]) throw httpError(404, 'Sponsor not found');
  return rows[0];
}

function summarize(event, sponsors, packages) {
  const statusCounts = Object.fromEntries(SPONSOR_STATUSES.map((s) => [s, 0]));
  const sum = { committed: 0, pipeline: 0, invoiced: 0, paid: 0, deliverablesDone: 0, deliverablesTotal: 0 };
  const used = {};
  for (const s of sponsors) {
    statusCounts[s.status] = (statusCounts[s.status] || 0) + 1;
    if (s.status === 'confirmed') {
      sum.committed += s.value || 0;
      if (s.package_id) used[s.package_id] = (used[s.package_id] || 0) + 1;
    }
    if (s.status === 'invited' || s.status === 'interested') sum.pipeline += s.value || 0;
    sum.invoiced += s.invoiced || 0;
    sum.paid += s.paid || 0;
    sum.deliverablesDone += s.deliverables_done || 0;
    sum.deliverablesTotal += s.deliverables_total || 0;
  }
  return {
    statusCounts,
    sponsors: sponsors.length,
    target: event.sponsor_target,
    committed: sum.committed,
    pipeline: sum.pipeline,
    invoiced: sum.invoiced,
    paid: sum.paid,
    outstanding: Math.max(0, sum.invoiced - sum.paid),
    overdue: sponsors.filter((s) => s.overdue).length,
    deliverablesDone: sum.deliverablesDone,
    deliverablesTotal: sum.deliverablesTotal,
    packageSlotsUsed: Object.fromEntries((packages || []).map((p) => [p.id, used[p.id] || 0])),
  };
}

async function listEvents() {
  const { rows } = await pool.query(
    `SELECT ${EVENT_COLS} FROM hosted_events e
     ORDER BY CASE e.status WHEN 'done' THEN 1 ELSE 0 END, e.start_date ASC NULLS LAST, e.id DESC`
  );
  return Promise.all(
    rows.map(async (ev) => {
      const [sponsors, packages] = await Promise.all([listSponsors(ev.id), listPackages(ev.id)]);
      return { ...ev, summary: summarize(ev, sponsors, packages) };
    })
  );
}

async function eventOverview(id) {
  const ev = await getEvent(id);
  const [packages, sponsors, prospectus] = await Promise.all([
    listPackages(id),
    listSponsors(id),
    fileMeta(ev.prospectus_file_id),
  ]);
  return {
    event: { ...ev, details: eventDetails(ev) },
    packages,
    sponsors: sponsors.map((s) => ({ ...s, portal_url: portalUrl(s.portal_token) })),
    prospectus,
    summary: summarize(ev, sponsors, packages),
    defaults: { invite_subject: DEFAULT_INVITE_SUBJECT, invite_body: DEFAULT_INVITE_BODY },
  };
}

function sponsorFields(body, { creating = false } = {}) {
  const f = {
    company: str(body.company, 200),
    contact_name: str(body.contact_name, 200),
    contact_email: body.contact_email === undefined ? undefined : emails(body.contact_email)[0] || null,
    cc_emails: body.cc_emails === undefined ? undefined : emails(body.cc_emails).join(', ') || null,
    website: url(body.website),
    amount: num(body.amount),
    package_id:
      body.package_id === undefined ? undefined : body.package_id ? Number(body.package_id) : null,
    owner_user_id:
      body.owner_user_id === undefined ? undefined : body.owner_user_id ? Number(body.owner_user_id) : null,
    notes: str(body.notes, 5000),
    status: oneOf(body.status, SPONSOR_STATUSES, 'status'),
  };
  if (creating && !f.company) throw httpError(400, 'Company name is required');
  if (!creating && f.company === null) throw httpError(400, 'Company name cannot be empty');
  if (body.contact_email && !f.contact_email) throw httpError(400, `Invalid email: ${body.contact_email}`);
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined));
}

async function packageInEvent(packageId, eventId) {
  if (!packageId) return null;
  const { rows } = await pool.query(`SELECT ${PACKAGE_COLS} FROM sponsor_packages WHERE id = $1 AND event_id = $2`, [
    packageId,
    eventId,
  ]);
  if (!rows[0]) throw httpError(400, 'That package does not belong to this event');
  return rows[0];
}

async function addDeliverablesFromPackage(sponsorId, pkg) {
  const list = pkg && Array.isArray(pkg.deliverables) && pkg.deliverables.length ? pkg.deliverables : DEFAULT_DELIVERABLES;
  const { rows } = await pool.query(`SELECT LOWER(title) AS t FROM sponsor_deliverables WHERE sponsor_id = $1`, [
    sponsorId,
  ]);
  const have = new Set(rows.map((r) => r.t));
  let sort = rows.length;
  let added = 0;
  for (const d of list) {
    if (have.has(d.title.toLowerCase())) continue;
    await pool.query(
      `INSERT INTO sponsor_deliverables (sponsor_id, title, kind, owner, sort) VALUES ($1, $2, $3, $4, $5)`,
      [sponsorId, d.title, d.kind || 'other', d.owner || 'sponsor', sort++]
    );
    added += 1;
  }
  return added;
}

async function createSponsors(eventId, list, userId) {
  await getEvent(eventId);
  const created = [];
  for (const body of list.slice(0, 500)) {
    const f = sponsorFields(body, { creating: true });
    const pkg = await packageInEvent(f.package_id, eventId);
    if (f.contact_email) {
      const dup = await pool.query(
        `SELECT id FROM event_sponsors WHERE event_id = $1 AND LOWER(contact_email) = $2`,
        [eventId, f.contact_email]
      );
      if (dup.rows[0]) continue;
    }
    const cols = Object.keys(f);
    const { rows } = await pool.query(
      `INSERT INTO event_sponsors (event_id, portal_token, ${cols.join(', ')})
       VALUES ($1, $2, ${cols.map((_, i) => `$${i + 3}`).join(', ')}) RETURNING id`,
      [eventId, newToken(), ...Object.values(f)]
    );
    const id = rows[0].id;
    await addDeliverablesFromPackage(id, pkg);
    await log(id, `Added as ${f.status || 'prospect'}${pkg ? ` · ${pkg.name} package` : ''}`, { userId });
    created.push(id);
  }
  return created;
}

const STATUS_LABELS = {
  prospect: 'Prospect',
  invited: 'Invited',
  interested: 'Interested',
  confirmed: 'Confirmed',
  declined: 'Declined',
};

async function updateSponsor(id, body, userId) {
  const cur = await getSponsor(id);
  const f = sponsorFields(body);
  const logs = [];
  let pkg = null;
  if (f.package_id !== undefined && f.package_id !== cur.package_id) {
    pkg = await packageInEvent(f.package_id, cur.event_id);
    logs.push(`Package: ${cur.package_name || 'none'} → ${pkg?.name || 'none'}`);
  }
  if (f.status && f.status !== cur.status) {
    logs.push(`Status: ${STATUS_LABELS[cur.status]} → ${STATUS_LABELS[f.status]}`);
    if (f.status === 'confirmed' && !cur.confirmed_at) f.confirmed_at = new Date();
  }
  if (f.amount !== undefined && f.amount !== cur.amount) {
    logs.push(`Amount: ${cur.amount ?? 'package price'} → ${f.amount ?? 'package price'}`);
  }
  const cols = Object.keys(f);
  if (cols.length) {
    await pool.query(
      `UPDATE event_sponsors SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = NOW()
       WHERE id = $1`,
      [id, ...Object.values(f)]
    );
  }
  if (pkg && cur.deliverables_total === 0) await addDeliverablesFromPackage(id, pkg);
  for (const body of logs) await log(id, body, { userId });
  return getSponsor(id);
}

async function deleteSponsor(id) {
  const { rowCount } = await pool.query(`DELETE FROM event_sponsors WHERE id = $1`, [id]);
  if (!rowCount) throw httpError(404, 'Sponsor not found');
}

const INVOICE_COLS = `i.id, i.sponsor_id, i.number, i.amount::float8 AS amount, i.currency, i.due_date, i.status,
  i.file_id, i.payment_link, i.note, i.payment_reference, i.sent_at, i.reminded_at, i.reported_at, i.paid_at,
  i.created_at, f.filename AS file_name, f.size AS file_size`;

async function listInvoices(sponsorId, { publicOnly = false } = {}) {
  const { rows } = await pool.query(
    `SELECT ${INVOICE_COLS} FROM sponsor_invoices i LEFT JOIN hosted_files f ON f.id = i.file_id
     WHERE i.sponsor_id = $1 ${publicOnly ? `AND i.status NOT IN ('draft', 'cancelled')` : ''}
     ORDER BY i.created_at DESC`,
    [sponsorId]
  );
  return rows.map((r) => ({
    ...r,
    overdue: ['sent', 'payment_reported'].includes(r.status) && r.due_date && r.due_date < today(),
  }));
}

async function listDeliverables(sponsorId) {
  const { rows } = await pool.query(
    `SELECT id, sponsor_id, title, kind, owner, due_date, done, done_at, link, sort, created_at
     FROM sponsor_deliverables WHERE sponsor_id = $1 ORDER BY owner DESC, sort ASC, id ASC`,
    [sponsorId]
  );
  return rows;
}

async function sponsorDetail(id) {
  const sponsor = await getSponsor(id);
  const [invoices, deliverables, activity, files] = await Promise.all([
    listInvoices(id),
    listDeliverables(id),
    pool.query(
      `SELECT a.id, a.body, a.kind, a.created_at, u.email AS user_email
       FROM sponsor_activity a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.sponsor_id = $1 ORDER BY a.created_at DESC LIMIT 200`,
      [id]
    ),
    pool.query(
      `SELECT id, kind, filename, mime, size, created_at FROM hosted_files
       WHERE sponsor_id = $1 AND kind <> 'invoice' ORDER BY created_at DESC`,
      [id]
    ),
  ]);
  return {
    sponsor: { ...sponsor, portal_url: portalUrl(sponsor.portal_token) },
    invoices,
    deliverables,
    activity: activity.rows,
    files: files.rows,
  };
}

async function addNote(sponsorId, body, userId) {
  await getSponsor(sponsorId);
  const text = str(body, 5000);
  if (!text) throw httpError(400, 'Note cannot be empty');
  await log(sponsorId, text, { userId, kind: 'note' });
  await pool.query(`UPDATE event_sponsors SET updated_at = NOW() WHERE id = $1`, [sponsorId]);
}

async function rotatePortal(sponsorId, userId) {
  await getSponsor(sponsorId);
  await pool.query(`UPDATE event_sponsors SET portal_token = $2, updated_at = NOW() WHERE id = $1`, [
    sponsorId,
    newToken(),
  ]);
  await log(sponsorId, 'Sponsor page link reset (the old link no longer works)', { userId });
  return getSponsor(sponsorId);
}

// ---------- deliverables ----------

function deliverableFields(body, { creating = false } = {}) {
  const f = {
    title: str(body.title, 300),
    kind: body.kind === undefined ? undefined : DELIVERABLE_KINDS.includes(body.kind) ? body.kind : 'other',
    owner: oneOf(body.owner, DELIVERABLE_OWNERS, 'owner'),
    due_date: dateStr(body.due_date),
    link: url(body.link),
    done: body.done === undefined ? undefined : Boolean(body.done),
  };
  if (creating && !f.title) throw httpError(400, 'Title is required');
  if (!creating && f.title === null) throw httpError(400, 'Title cannot be empty');
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined));
}

async function addDeliverable(sponsorId, body, userId) {
  await getSponsor(sponsorId);
  const f = deliverableFields(body, { creating: true });
  const { rows } = await pool.query(
    `INSERT INTO sponsor_deliverables (sponsor_id, title, kind, owner, due_date, link, sort)
     VALUES ($1, $2, $3, $4, $5, $6, (SELECT COALESCE(MAX(sort), 0) + 1 FROM sponsor_deliverables WHERE sponsor_id = $1))
     RETURNING id`,
    [sponsorId, f.title, f.kind || 'other', f.owner || 'sponsor', f.due_date || null, f.link || null]
  );
  await log(sponsorId, `Added deliverable: ${f.title}`, { userId });
  return rows[0].id;
}

async function getDeliverable(id) {
  const { rows } = await pool.query(`SELECT * FROM sponsor_deliverables WHERE id = $1`, [id]);
  if (!rows[0]) throw httpError(404, 'Deliverable not found');
  return rows[0];
}

async function updateDeliverable(id, body, { userId = null, actor = null } = {}) {
  const cur = await getDeliverable(id);
  const f = deliverableFields(body);
  if (f.done !== undefined) f.done_at = f.done ? new Date() : null;
  const cols = Object.keys(f);
  if (!cols.length) return cur;
  await pool.query(
    `UPDATE sponsor_deliverables SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
    [id, ...Object.values(f)]
  );
  const who = actor ? ` (by ${actor})` : '';
  if (f.done !== undefined && f.done !== cur.done) {
    await log(cur.sponsor_id, `${f.done ? 'Done' : 'Reopened'}: ${cur.title}${who}`, { userId });
  }
  if (f.link && f.link !== cur.link) {
    await log(cur.sponsor_id, `Link added for "${cur.title}": ${f.link}${who}`, { userId });
  }
  return getDeliverable(id);
}

async function deleteDeliverable(id) {
  const { rowCount } = await pool.query(`DELETE FROM sponsor_deliverables WHERE id = $1`, [id]);
  if (!rowCount) throw httpError(404, 'Deliverable not found');
}

async function addDefaultDeliverables(sponsorId, userId) {
  const s = await getSponsor(sponsorId);
  const pkg = s.package_id ? await packageInEvent(s.package_id, s.event_id) : null;
  const added = await addDeliverablesFromPackage(sponsorId, pkg);
  if (added) await log(sponsorId, `Added ${added} standard deliverables`, { userId });
  return added;
}

// ---------- invoices ----------

async function nextInvoiceNumber(eventId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM sponsor_invoices i JOIN event_sponsors s ON s.id = i.sponsor_id
     WHERE s.event_id = $1`,
    [eventId]
  );
  return `INV-${eventId}-${String(rows[0].n + 1).padStart(3, '0')}`;
}

async function getInvoice(id) {
  const { rows } = await pool.query(
    `SELECT ${INVOICE_COLS} FROM sponsor_invoices i LEFT JOIN hosted_files f ON f.id = i.file_id WHERE i.id = $1`,
    [id]
  );
  if (!rows[0]) throw httpError(404, 'Invoice not found');
  return rows[0];
}

async function createInvoice(sponsorId, body, userId) {
  const s = await getSponsor(sponsorId);
  const ev = await getEvent(s.event_id);
  const amount = num(body.amount) ?? s.value;
  if (!amount) throw httpError(400, 'Invoice amount is required');
  const file = body.file ? await saveFile({ eventId: s.event_id, sponsorId, kind: 'invoice', file: body.file, userId }) : null;
  const { rows } = await pool.query(
    `INSERT INTO sponsor_invoices (sponsor_id, number, amount, currency, due_date, file_id, payment_link, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      sponsorId,
      str(body.number, 60) || (await nextInvoiceNumber(s.event_id)),
      amount,
      (str(body.currency, 6) || ev.currency || 'USD').toUpperCase(),
      dateStr(body.due_date) || null,
      file?.id || null,
      url(body.payment_link) || null,
      str(body.note, 3000) || null,
    ]
  );
  const inv = await getInvoice(rows[0].id);
  await log(sponsorId, `Invoice ${inv.number} created · ${money(inv.amount, inv.currency)}${file ? ' · PDF attached' : ''}`, {
    userId,
  });
  return inv;
}

async function updateInvoice(id, body, userId) {
  const cur = await getInvoice(id);
  const s = await getSponsor(cur.sponsor_id);
  const f = {
    number: str(body.number, 60),
    amount: num(body.amount),
    currency: body.currency === undefined ? undefined : (str(body.currency, 6) || cur.currency).toUpperCase(),
    due_date: dateStr(body.due_date),
    payment_link: body.payment_link === undefined ? undefined : url(body.payment_link),
    note: str(body.note, 3000),
    payment_reference: str(body.payment_reference, 300),
    status: oneOf(body.status, INVOICE_STATUSES, 'status'),
  };
  if (f.number === null) throw httpError(400, 'Invoice number cannot be empty');
  if (f.amount === null) throw httpError(400, 'Invoice amount cannot be empty');
  if (body.file) {
    const file = await saveFile({ eventId: s.event_id, sponsorId: s.id, kind: 'invoice', file: body.file, userId });
    f.file_id = file.id;
  }
  if (f.status === 'paid' && cur.status !== 'paid') f.paid_at = new Date();
  if (f.status && f.status !== 'paid' && cur.status === 'paid') f.paid_at = null;
  const set = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined));
  const cols = Object.keys(set);
  if (cols.length) {
    await pool.query(
      `UPDATE sponsor_invoices SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
      [id, ...Object.values(set)]
    );
  }
  if (set.file_id && cur.file_id) await pool.query(`DELETE FROM hosted_files WHERE id = $1`, [cur.file_id]);

  const inv = await getInvoice(id);
  if (set.status && set.status !== cur.status) {
    const labels = { draft: 'Draft', sent: 'Sent', payment_reported: 'Payment reported', paid: 'Paid', cancelled: 'Cancelled' };
    await log(s.id, `Invoice ${inv.number}: ${labels[cur.status]} → ${labels[inv.status]}${inv.payment_reference ? ` (ref ${inv.payment_reference})` : ''}`, {
      userId,
    });
    if (inv.status === 'paid' && s.status !== 'confirmed') {
      await pool.query(
        `UPDATE event_sponsors SET status = 'confirmed', confirmed_at = COALESCE(confirmed_at, NOW()), updated_at = NOW()
         WHERE id = $1`,
        [s.id]
      );
      await log(s.id, `Status: ${STATUS_LABELS[s.status]} → Confirmed (invoice paid)`, { userId });
    }
  } else if (set.file_id) {
    await log(s.id, `Invoice ${inv.number}: new PDF uploaded`, { userId });
  }
  return inv;
}

async function deleteInvoice(id, userId) {
  const inv = await getInvoice(id);
  await pool.query(`DELETE FROM sponsor_invoices WHERE id = $1`, [id]);
  if (inv.file_id) await pool.query(`DELETE FROM hosted_files WHERE id = $1`, [inv.file_id]);
  await log(inv.sponsor_id, `Invoice ${inv.number} deleted`, { userId });
}

// ---------- emails ----------

function linkify(escaped) {
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#254C82;">$1</a>');
}

function textToHtml(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;">${linkify(esc(p)).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function button(label, href, primary = true) {
  return `<a href="${esc(href)}" style="display:inline-block;margin:4px 8px 4px 0;padding:11px 20px;border-radius:6px;font-weight:700;text-decoration:none;${
    primary ? 'background:#254C82;color:#fff;' : 'background:#fff;color:#254C82;border:1px solid #254C82;'
  }">${esc(label)}</a>`;
}

function emailShell({ eyebrow, heading, bodyHtml, buttons = [], footer = '' }) {
  return `<!DOCTYPE html><html><body style="margin:0;font-family:Arial,Helvetica,sans-serif;background:#F4F7FB;padding:24px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #D5E0EE;border-radius:12px;">
    <tr><td style="padding:22px 28px;background:#15294C;color:#fff;border-radius:12px 12px 0 0;">
      ${eyebrow ? `<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#9EC2F5;font-weight:700;">${esc(eyebrow)}</div>` : ''}
      <h1 style="margin:6px 0 0;font-size:21px;line-height:1.3;">${esc(heading)}</h1>
    </td></tr>
    <tr><td style="padding:24px 28px;color:#243447;font-size:15px;line-height:1.6;">
      ${bodyHtml}
      ${buttons.length ? `<div style="margin:18px 0 6px;">${buttons.join('')}</div>` : ''}
    </td></tr>
    ${footer ? `<tr><td style="padding:14px 28px 22px;color:#6B7C8F;font-size:12px;border-top:1px solid #E6EDF5;">${footer}</td></tr>` : ''}
  </table></body></html>`;
}

function mergeVars(ev, s, sender) {
  const first = (s.contact_name || '').trim().split(/\s+/)[0];
  return {
    name: first || s.company || 'there',
    full_name: s.contact_name || '',
    company: s.company || '',
    event: ev.name || '',
    event_details: eventDetails(ev),
    dates: eventDates(ev),
    venue: [ev.venue, ev.city].filter(Boolean).join(', '),
    package: s.package_name || '',
    amount: s.value ? money(s.value, ev.currency) : '',
    portal_link: portalUrl(s.portal_token),
    website: ev.website || '',
    sender: sender || ev.from_name || 'XDC Network',
  };
}

function applyVars(tpl, vars) {
  return String(tpl || '')
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in vars ? vars[k] : m))
    .replace(/\s*\(\s*\)/g, '');
}

function senderName(user) {
  const local = String(user?.email || '').split('@')[0];
  if (!local) return '';
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

function renderInvite(ev, s, { subject, body, user }) {
  const vars = mergeVars(ev, s, senderName(user) ? `${senderName(user)}\n${ev.from_name || 'XDC Network'}` : '');
  const subj = applyVars(subject || ev.invite_subject || DEFAULT_INVITE_SUBJECT, vars);
  const text = applyVars(body || ev.invite_body || DEFAULT_INVITE_BODY, vars);
  const html = emailShell({
    eyebrow: 'Co-sponsorship invitation',
    heading: ev.name,
    bodyHtml: textToHtml(text),
    buttons: [button('View sponsorship details', vars.portal_link)],
    footer: esc(eventDetails(ev)),
  });
  return { subject: subj, text, html };
}

async function fileAttachment(fileId) {
  if (!fileId) return null;
  const f = await getFile(fileId);
  return f ? { filename: f.filename, content: f.data, contentType: f.mime } : null;
}

async function sendInvites(eventId, { sponsorIds = [], subject, body, attachProspectus = true, saveAsDefault = false }, user) {
  const ev = await getEvent(eventId);
  if (saveAsDefault) {
    await pool.query(`UPDATE hosted_events SET invite_subject = $2, invite_body = $3, updated_at = NOW() WHERE id = $1`, [
      eventId,
      str(subject, 300),
      str(body, 10000),
    ]);
  }
  const ids = [...new Set(sponsorIds.map(Number).filter(Boolean))].slice(0, 200);
  if (!ids.length) throw httpError(400, 'Pick at least one sponsor');
  const prospectus = attachProspectus ? await fileAttachment(ev.prospectus_file_id) : null;
  const { sendOneEmail } = require('./mailer');
  const results = [];
  for (const id of ids) {
    let s;
    try {
      s = await getSponsor(id);
      if (s.event_id !== ev.id) throw new Error('Not in this event');
      if (!s.contact_email) throw new Error('No contact email');
      const msg = renderInvite(ev, s, { subject, body, user });
      await sendOneEmail({
        to: s.contact_email,
        cc: s.cc_emails || undefined,
        replyTo: user?.email,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        includeLogos: false,
        fromName: ev.from_name || 'XDC Network',
        attachments: prospectus ? [prospectus] : [],
      });
      await pool.query(
        `UPDATE event_sponsors SET status = CASE WHEN status = 'prospect' THEN 'invited' ELSE status END,
           invited_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [id]
      );
      await log(id, `Invitation emailed to ${s.contact_email}${prospectus ? ' with prospectus' : ''}: "${msg.subject}"`, {
        userId: user?.id,
        kind: 'email',
      });
      results.push({ id, company: s.company, ok: true });
    } catch (err) {
      results.push({ id, company: s?.company, ok: false, error: err.message });
    }
  }
  return { sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}

async function sendInvoice(invoiceId, { message, reminder = false } = {}, user) {
  const inv = await getInvoice(invoiceId);
  if (inv.status === 'cancelled') throw httpError(400, 'This invoice is cancelled');
  if (inv.status === 'paid') throw httpError(400, 'This invoice is already paid');
  const s = await getSponsor(inv.sponsor_id);
  const ev = await getEvent(s.event_id);
  if (!s.contact_email) throw httpError(400, 'Add a contact email for this sponsor first');

  const vars = mergeVars(ev, s);
  const amount = money(inv.amount, inv.currency);
  const due = inv.due_date ? fmtDate(inv.due_date) : '';
  const subject = reminder
    ? `Reminder: invoice ${inv.number} for ${ev.name}${due ? ` (due ${due})` : ''}`
    : `Invoice ${inv.number} · ${ev.name} sponsorship`;
  const intro = reminder
    ? `Hi ${vars.name},\n\nA friendly reminder that invoice ${inv.number} for ${s.company}'s sponsorship of ${ev.name} is ${
        inv.due_date && inv.due_date < today() ? 'now overdue' : 'still open'
      }. If you've already paid, please ignore this or let us know the payment reference.`
    : `Hi ${vars.name},\n\nThank you for sponsoring ${ev.name}! Please find invoice ${inv.number} for ${s.company}${
        s.package_name ? ` (${s.package_name} package)` : ''
      } ${inv.file_id ? 'attached' : 'below'}.`;
  const extra = str(message, 3000);
  const rows = [
    ['Invoice', inv.number],
    ['Amount', amount],
    ['Due date', due],
    ['Event', [ev.name, eventDetails(ev)].filter(Boolean).join(' · ')],
  ].filter(([, v]) => v);
  const facts = `<table cellpadding="0" cellspacing="0" style="margin:6px 0 16px;border-collapse:collapse;">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:5px 14px 5px 0;color:#6B7C8F;white-space:nowrap;">${esc(k)}</td><td style="padding:5px 0;font-weight:${
          k === 'Amount' ? 700 : 400
        };">${esc(v)}</td></tr>`
    )
    .join('')}</table>`;
  const pay = ev.payment_instructions
    ? `<div style="margin:0 0 14px;padding:12px 14px;background:#F4F7FB;border-radius:8px;"><strong>How to pay</strong><br>${linkify(
        esc(ev.payment_instructions)
      ).replace(/\n/g, '<br>')}</div>`
    : '';
  const html = emailShell({
    eyebrow: reminder ? 'Payment reminder' : 'Sponsorship invoice',
    heading: `${ev.name} · ${amount}`,
    bodyHtml: `${textToHtml(intro)}${facts}${pay}${extra ? textToHtml(extra) : ''}${textToHtml(
      `Best regards,\n${senderName(user) ? `${senderName(user)}\n` : ''}${ev.from_name || 'XDC Network'}`
    )}`,
    buttons: [
      ...(inv.payment_link ? [button('Pay now', inv.payment_link)] : []),
      button('View invoice & sponsorship page', vars.portal_link, !inv.payment_link),
    ],
    footer: 'Questions about this invoice? Just reply to this email.',
  });
  const text = [
    intro,
    rows.map(([k, v]) => `${k}: ${v}`).join('\n'),
    ev.payment_instructions ? `How to pay:\n${ev.payment_instructions}` : '',
    extra || '',
    inv.payment_link ? `Pay now: ${inv.payment_link}` : '',
    `Invoice & sponsorship page: ${vars.portal_link}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const pdf = await fileAttachment(inv.file_id);
  const { sendOneEmail } = require('./mailer');
  await sendOneEmail({
    to: s.contact_email,
    cc: s.cc_emails || undefined,
    replyTo: user?.email,
    subject,
    html,
    text,
    includeLogos: false,
    fromName: ev.from_name || 'XDC Network',
    attachments: pdf ? [pdf] : [],
  });
  await pool.query(
    reminder
      ? `UPDATE sponsor_invoices SET reminded_at = NOW() WHERE id = $1`
      : `UPDATE sponsor_invoices SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END, sent_at = NOW() WHERE id = $1`,
    [inv.id]
  );
  await log(s.id, `${reminder ? 'Reminder for' : 'Sent'} invoice ${inv.number} (${amount}) to ${s.contact_email}${pdf ? ' with PDF' : ''}`, {
    userId: user?.id,
    kind: 'email',
  });
  return getInvoice(inv.id);
}

async function notifyTeam(sponsor, ev, subject, lines) {
  try {
    const { getNotifyEmails } = require('./leads');
    const to = sponsor.owner_email ? [sponsor.owner_email] : await getNotifyEmails();
    if (!to.length) return;
    const link = `${frontendUrl()}/?tab=hosting&hostedEvent=${ev.id}&sponsor=${sponsor.id}`;
    const html = emailShell({
      eyebrow: ev.name,
      heading: subject,
      bodyHtml: textToHtml(lines.join('\n')),
      buttons: [button('Open in XDC Outreach', link)],
    });
    const { sendOneEmail } = require('./mailer');
    for (const addr of to) {
      await sendOneEmail({
        to: addr,
        subject: `${subject} · ${ev.name}`,
        html,
        text: `${lines.join('\n')}\n\n${link}`,
        includeLogos: false,
        fromName: 'XDC Outreach Events',
      }).catch((err) => console.error('[hosting] notify failed', addr, err.message));
    }
  } catch (err) {
    console.error('[hosting] notify failed', err.message);
  }
}

// ---------- sponsor page (public) ----------

async function sponsorByToken(token) {
  if (!token || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const { rows } = await pool.query(`${SPONSOR_SELECT} WHERE s.portal_token = $1`, [token]);
  return rows[0] || null;
}

async function portalView(token) {
  const s = await sponsorByToken(token);
  if (!s) return null;
  const ev = await getEvent(s.event_id);
  const [packages, invoices, deliverables, prospectus] = await Promise.all([
    listPackages(ev.id),
    listInvoices(s.id, { publicOnly: true }),
    listDeliverables(s.id),
    fileMeta(ev.prospectus_file_id),
  ]);
  return {
    event: {
      name: ev.name,
      tagline: ev.tagline,
      description: ev.description,
      venue: ev.venue,
      city: ev.city,
      start_date: ev.start_date,
      end_date: ev.end_date,
      details: eventDetails(ev),
      website: ev.website,
      currency: ev.currency,
      payment_instructions: ev.payment_instructions,
    },
    sponsor: {
      company: s.company,
      contact_name: s.contact_name,
      status: s.status,
      package_id: s.package_id,
      package_name: s.package_name,
      value: s.value,
    },
    packages: packages.map((p) => ({ id: p.id, name: p.name, price: p.price, benefits: p.benefits })),
    invoices: invoices.map((i) => ({
      id: i.id,
      number: i.number,
      amount: i.amount,
      currency: i.currency,
      due_date: i.due_date,
      status: i.status,
      overdue: i.overdue,
      payment_link: i.payment_link,
      has_file: Boolean(i.file_id),
      file_id: i.file_id,
      file_name: i.file_name,
      payment_reference: i.payment_reference,
      sent_at: i.sent_at,
      paid_at: i.paid_at,
    })),
    deliverables: deliverables.map((d) => ({
      id: d.id,
      title: d.title,
      kind: d.kind,
      owner: d.owner,
      due_date: d.due_date,
      done: d.done,
      link: d.link,
    })),
    prospectus: prospectus ? { id: prospectus.id, filename: prospectus.filename } : null,
  };
}

async function portalInterest(token, { packageId, message }) {
  const s = await sponsorByToken(token);
  if (!s) throw httpError(404, 'This link is invalid or has been reset.');
  const ev = await getEvent(s.event_id);
  const pkg = packageId ? await packageInEvent(Number(packageId), ev.id) : null;
  const note = str(message, 2000);
  const nextStatus = ['prospect', 'invited', 'declined'].includes(s.status) ? 'interested' : s.status;
  await pool.query(
    `UPDATE event_sponsors SET status = $2, package_id = COALESCE($3, package_id), updated_at = NOW() WHERE id = $1`,
    [s.id, nextStatus, pkg?.id || null]
  );
  if (pkg && s.deliverables_total === 0) await addDeliverablesFromPackage(s.id, pkg);
  const lines = [
    `${s.company} is interested in sponsoring${pkg ? ` (${pkg.name} package, ${money(pkg.price, ev.currency)})` : ''}.`,
    note ? `Message: ${note}` : '',
  ].filter(Boolean);
  await log(s.id, `${lines.join(' ')} (from sponsor page)`, { kind: 'sponsor' });
  await notifyTeam({ ...s }, ev, `${s.company} wants to sponsor`, lines);
}

async function portalReportPayment(token, invoiceId, { reference }) {
  const s = await sponsorByToken(token);
  if (!s) throw httpError(404, 'This link is invalid or has been reset.');
  const inv = await getInvoice(invoiceId);
  if (inv.sponsor_id !== s.id) throw httpError(404, 'Invoice not found');
  if (!['sent', 'payment_reported'].includes(inv.status)) throw httpError(400, 'This invoice is not awaiting payment');
  const ref = str(reference, 300);
  if (!ref) throw httpError(400, 'Add the payment reference or transaction ID');
  await pool.query(
    `UPDATE sponsor_invoices SET status = 'payment_reported', payment_reference = $2, reported_at = NOW() WHERE id = $1`,
    [inv.id, ref]
  );
  const ev = await getEvent(s.event_id);
  await log(s.id, `Sponsor reported payment for invoice ${inv.number} · ref ${ref}`, { kind: 'sponsor' });
  await notifyTeam(s, ev, `${s.company} reported a payment`, [
    `Invoice ${inv.number} · ${money(inv.amount, inv.currency)}`,
    `Reference: ${ref}`,
    'Check the bank account, then mark the invoice as paid.',
  ]);
}

async function portalUpdateDeliverable(token, deliverableId, { link, done }) {
  const s = await sponsorByToken(token);
  if (!s) throw httpError(404, 'This link is invalid or has been reset.');
  const d = await getDeliverable(deliverableId);
  if (d.sponsor_id !== s.id) throw httpError(404, 'Item not found');
  if (d.owner !== 'sponsor') throw httpError(403, 'Only the host can update this item');
  const body = {};
  if (link !== undefined) body.link = link;
  if (done !== undefined) body.done = done;
  if (body.link && body.done === undefined) body.done = true;
  return updateDeliverable(d.id, body, { actor: s.company });
}

async function portalFile(token, fileId) {
  const s = await sponsorByToken(token);
  if (!s) return null;
  const f = await getFile(fileId);
  if (!f) return null;
  if (f.sponsor_id === s.id) return f;
  const ev = await getEvent(s.event_id);
  return ev.prospectus_file_id === f.id ? f : null;
}

module.exports = {
  SPONSOR_STATUSES,
  INVOICE_STATUSES,
  EVENT_STATUSES,
  DELIVERABLE_KINDS,
  DEFAULT_DELIVERABLES,
  ensureHostingSchema,
  listEvents,
  eventOverview,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent,
  setProspectus,
  removeProspectus,
  createPackage,
  updatePackage,
  deletePackage,
  createSponsors,
  getSponsor,
  updateSponsor,
  deleteSponsor,
  sponsorDetail,
  addNote,
  rotatePortal,
  addDeliverable,
  updateDeliverable,
  deleteDeliverable,
  addDefaultDeliverables,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  getInvoice,
  sendInvites,
  sendInvoice,
  renderInvite,
  getFile,
  portalView,
  portalInterest,
  portalReportPayment,
  portalUpdateDeliverable,
  portalFile,
};
