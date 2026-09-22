const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const api = require('./routes/api');
const { pool } = require('./db/pool');

const app = express();
const PORT = Number(process.env.PORT || 5050);

const allowedOrigins = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      return cb(null, allowedOrigins.includes('*') ? true : false);
    },
  })
);
app.use(express.json({ limit: '2mb' }));
app.use('/logos', express.static(path.join(__dirname, '../../public/logos')));
app.use('/api', api);

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'xdcoutreach-api',
    health: '/api/health',
  });
});

const clientDist = path.join(__dirname, '../../client/dist');
if (fs.existsSync(clientDist) && process.env.SERVE_CLIENT === 'true') {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/logos')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

async function start() {
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    console.error('Cannot connect to PostgreSQL. Check DATABASE_URL.');
    console.error(err.message);
    process.exit(1);
  }

  try {
    await ensureSchema();
  } catch (err) {
    console.error('Schema init failed:', err.message);
    process.exit(1);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Email Agent API running on port ${PORT}`);
  });
}

async function ensureSchema() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        location TEXT,
        dates TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS email_templates (
        id SERIAL PRIMARY KEY,
        event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        subject TEXT NOT NULL,
        html_body TEXT NOT NULL,
        text_body TEXT,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS email_campaigns (
        id SERIAL PRIMARY KEY,
        event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
        template_id INTEGER REFERENCES email_templates(id) ON DELETE SET NULL,
        subject TEXT NOT NULL,
        html_body TEXT NOT NULL,
        recipients_raw TEXT NOT NULL,
        total_recipients INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS email_sends (
        id SERIAL PRIMARY KEY,
        campaign_id INTEGER REFERENCES email_campaigns(id) ON DELETE CASCADE,
        event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
        recipient_email TEXT NOT NULL,
        subject TEXT NOT NULL,
        html_body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        error_message TEXT,
        message_id TEXT,
        sent_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_email_sends_recipient ON email_sends(recipient_email);
      CREATE INDEX IF NOT EXISTS idx_email_sends_campaign ON email_sends(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_email_sends_sent_at ON email_sends(sent_at DESC);
    `);

    const eventRes = await client.query(
      `INSERT INTO events (name, slug, location, dates)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         location = EXCLUDED.location,
         dates = EXCLUDED.dates
       RETURNING id`,
      ['Sibos 2026', 'sibos-2026', 'Miami Beach Convention Center', 'September 28 – October 1, 2026']
    );
    const eventId = eventRes.rows[0].id;

    const { buildSibosEmailHtml } = require('./templates/sibosEmail');
    const { DEFAULT_SUBJECT, DEFAULT_TEXT } = require('./db/migrate');
    const html = buildSibosEmailHtml();

    const existing = await client.query(
      `SELECT id FROM email_templates WHERE event_id = $1 AND is_default = TRUE LIMIT 1`,
      [eventId]
    );

    if (existing.rows.length === 0) {
      await client.query(
        `INSERT INTO email_templates (event_id, name, subject, html_body, text_body, is_default)
         VALUES ($1, $2, $3, $4, $5, TRUE)`,
        [eventId, 'Sibos 2026 Invitation', DEFAULT_SUBJECT, html, DEFAULT_TEXT]
      );
      console.log('Seeded default Sibos 2026 template');
    } else {
      await client.query(
        `UPDATE email_templates
         SET subject = $1, html_body = $2, text_body = $3, name = $4, updated_at = NOW()
         WHERE id = $5`,
        [DEFAULT_SUBJECT, html, DEFAULT_TEXT, 'Sibos 2026 Invitation', existing.rows[0].id]
      );
      console.log('Refreshed default Sibos 2026 template');
    }
  } finally {
    client.release();
  }
}

start();
