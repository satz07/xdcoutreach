const { pool } = require('../db/pool');

/**
 * Resolve SMTP password: stored value first, else env var named in smtp_pass_env.
 */
function resolveSmtpPass(provider) {
  if (provider.smtp_pass) return provider.smtp_pass;
  const key = provider.smtp_pass_env || 'SMTP_PASS';
  return process.env[key] || process.env.SMTP_PASS || '';
}

function resolvePostmarkToken(provider) {
  const key = provider.postmark_token_env || 'POSTMARK_SERVER_TOKEN';
  return process.env[key] || process.env.POSTMARK_SERVER_TOKEN || '';
}

/** Public shape — never expose raw passwords */
function publicProvider(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    type: row.type,
    from_email: row.from_email,
    from_name: row.from_name,
    smtp_host: row.smtp_host,
    smtp_port: row.smtp_port,
    smtp_secure: row.smtp_secure,
    smtp_user: row.smtp_user,
    smtp_pass_env: row.smtp_pass_env,
    smtp_pass_set: Boolean(row.smtp_pass || resolveSmtpPass(row)),
    postmark_token_env: row.postmark_token_env,
    postmark_token_set: row.type === 'postmark' ? Boolean(resolvePostmarkToken(row)) : null,
    active: row.active,
    notes: row.notes,
    created_at: row.created_at,
  };
}

async function listProviders({ activeOnly = true } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM mail_providers
     ${activeOnly ? 'WHERE active = TRUE' : ''}
     ORDER BY type ASC, name ASC`
  );
  return rows.map(publicProvider);
}

async function getProviderById(id) {
  const { rows } = await pool.query(`SELECT * FROM mail_providers WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function getProviderForEvent(eventId) {
  if (!eventId) return null;
  const { rows } = await pool.query(
    `SELECT mp.*
     FROM events e
     LEFT JOIN mail_providers mp ON mp.id = e.mail_provider_id
     WHERE e.id = $1`,
    [eventId]
  );
  return rows[0] || null;
}

async function ensureMailProvidersSeeded(client = pool) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS mail_providers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('postmark', 'smtp')),
      from_email TEXT NOT NULL,
      from_name TEXT,
      smtp_host TEXT,
      smtp_port INTEGER,
      smtp_secure BOOLEAN NOT NULL DEFAULT FALSE,
      smtp_user TEXT,
      smtp_pass TEXT,
      smtp_pass_env TEXT,
      postmark_token_env TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    ALTER TABLE events
      ADD COLUMN IF NOT EXISTS mail_provider_id INTEGER REFERENCES mail_providers(id) ON DELETE SET NULL
  `);

  // Postmark — Sibos / transactional Activity-verified
  await client.query(
    `INSERT INTO mail_providers
      (name, slug, type, from_email, from_name, postmark_token_env, notes, active)
     VALUES ($1, $2, 'postmark', $3, $4, $5, $6, TRUE)
     ON CONFLICT (slug) DO UPDATE SET
       from_email = EXCLUDED.from_email,
       from_name = EXCLUDED.from_name,
       notes = EXCLUDED.notes,
       active = TRUE`,
    [
      'Postmark (Sibos / outbound)',
      'postmark',
      process.env.SMTP_FROM || 'support@xdcforpayments.org',
      'XDC Network & Contour',
      'POSTMARK_SERVER_TOKEN',
      'Use for Sibos. Marks sent only after Postmark Activity confirms.',
    ]
  );

  // SendGrid SMTP — Contour for new events
  const sgFrom =
    process.env.SENDGRID_FROM ||
    process.env.CONTOUR_SMTP_FROM ||
    'events@contour.network';
  const sgHost = process.env.SMTP_HOST || 'smtp.sendgrid.net';
  const sgPort = Number(process.env.SMTP_PORT || 587);
  const sgSecure = String(process.env.SMTP_SECURE || 'false') === 'true' || sgPort === 465;
  // SendGrid API keys require username "apikey"
  const sgUser = process.env.SMTP_USER || 'apikey';

  await client.query(
    `INSERT INTO mail_providers
      (name, slug, type, from_email, from_name, smtp_host, smtp_port, smtp_secure,
       smtp_user, smtp_pass_env, notes, active)
     VALUES ($1, $2, 'smtp', $3, $4, $5, $6, $7, $8, $9, $10, TRUE)
     ON CONFLICT (slug) DO UPDATE SET
       from_email = EXCLUDED.from_email,
       from_name = EXCLUDED.from_name,
       smtp_host = EXCLUDED.smtp_host,
       smtp_port = EXCLUDED.smtp_port,
       smtp_secure = EXCLUDED.smtp_secure,
       smtp_user = EXCLUDED.smtp_user,
       smtp_pass_env = EXCLUDED.smtp_pass_env,
       notes = EXCLUDED.notes,
       active = TRUE`,
    [
      'SendGrid SMTP (Contour)',
      'sendgrid-contour',
      sgFrom,
      'XDC Network & Contour',
      sgHost,
      sgPort,
      sgSecure,
      sgUser,
      'SENDGRID_SMTP_PASS',
      'SendGrid SMTP for non-Sibos events. From events@contour.network. Password = SENDGRID_SMTP_PASS.',
    ]
  );

  // Default Sibos → Postmark
  await client.query(
    `UPDATE events e
     SET mail_provider_id = mp.id
     FROM mail_providers mp
     WHERE e.slug = 'sibos-2026'
       AND mp.slug = 'postmark'
       AND (e.mail_provider_id IS NULL OR e.mail_provider_id <> mp.id)`
  );
}

module.exports = {
  listProviders,
  getProviderById,
  getProviderForEvent,
  publicProvider,
  resolveSmtpPass,
  resolvePostmarkToken,
  ensureMailProvidersSeeded,
};
