const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const api = require('./routes/api');
const auth = require('./routes/auth');
const { pool } = require('./db/pool');
const { SUPERADMIN_EMAIL } = require('./middleware/auth');

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
app.use(express.json({ limit: '10mb' }));
app.use('/logos', express.static(path.join(__dirname, '../../public/logos')));
app.use('/api/auth', auth);
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
    const { initAutoSend } = require('./services/autoSender');
    initAutoSend().catch((err) => console.warn('auto-send init:', err.message));
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
      CREATE INDEX IF NOT EXISTS idx_email_sends_event ON email_sends(event_id);

      CREATE TABLE IF NOT EXISTS event_participants (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        name TEXT,
        company TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (event_id, email)
      );
      CREATE INDEX IF NOT EXISTS idx_event_participants_event ON event_participants(event_id);
      CREATE INDEX IF NOT EXISTS idx_event_participants_email ON event_participants(email);

      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin',
        active BOOLEAN NOT NULL DEFAULT TRUE,
        invited_by TEXT,
        password_hash TEXT,
        invite_token TEXT,
        invite_token_expires_at TIMESTAMPTZ,
        email_send_limit INTEGER,
        last_login_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS login_otps (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        code TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_login_otps_email ON login_otps(email);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    `);

    // Migrations for existing DBs (must run before indexes on new columns)
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_token TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_token_expires_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email_send_limit INTEGER;
      ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS sent_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS sent_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS content_json JSONB;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_email_sends_sent_by ON email_sends(sent_by_user_id);
      CREATE INDEX IF NOT EXISTS idx_email_sends_event ON email_sends(event_id);
      CREATE INDEX IF NOT EXISTS idx_users_invite_token ON users(invite_token);
    `);

    // Backfill participants from existing send history (once)
    await client.query(`
      INSERT INTO event_participants (event_id, email)
      SELECT DISTINCT s.event_id, LOWER(TRIM(s.recipient_email))
      FROM email_sends s
      WHERE s.event_id IS NOT NULL
        AND s.recipient_email IS NOT NULL
        AND TRIM(s.recipient_email) <> ''
      ON CONFLICT (event_id, email) DO NOTHING
    `);

    const { ensureMailProvidersSeeded } = require('./services/mailProviders');
    await ensureMailProvidersSeeded(client);
    console.log('Mail providers seeded (Postmark + SendGrid Contour)');

    const { hashPassword } = require('./middleware/auth');
    const superPass = process.env.SUPERADMIN_PASSWORD || 'ChangeMeNow!2026';
    const superHash = await hashPassword(superPass);

    await client.query(
      `INSERT INTO users (email, role, active, password_hash, email_send_limit)
       VALUES ($1, 'superadmin', TRUE, $2, NULL)
       ON CONFLICT (email) DO UPDATE SET
         role = 'superadmin',
         active = TRUE,
         password_hash = COALESCE(users.password_hash, EXCLUDED.password_hash),
         email_send_limit = NULL`,
      [SUPERADMIN_EMAIL, superHash]
    );

    // If SUPERADMIN_PASSWORD is explicitly set, always sync it
    if (process.env.SUPERADMIN_PASSWORD) {
      await client.query(`UPDATE users SET password_hash = $2 WHERE email = $1`, [
        SUPERADMIN_EMAIL,
        superHash,
      ]);
      console.log('Superadmin password synced from SUPERADMIN_PASSWORD');
    } else {
      const check = await client.query(
        `SELECT password_hash FROM users WHERE email = $1`,
        [SUPERADMIN_EMAIL]
      );
      if (!check.rows[0]?.password_hash) {
        await client.query(`UPDATE users SET password_hash = $2 WHERE email = $1`, [
          SUPERADMIN_EMAIL,
          superHash,
        ]);
        console.log('Superadmin password initialized (set SUPERADMIN_PASSWORD in production)');
      }
    }

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
      console.log('Default Sibos template already exists (left unchanged)');
    }
  } finally {
    client.release();
  }
}

start();
