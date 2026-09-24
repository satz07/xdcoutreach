const { pool } = require('./pool');

const SCHEMA = `
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
`;

const DEFAULT_SUBJECT =
  'Meet XDC Network & Contour at Sibos 2026: Agentic Payments, Trade Finance & Real-Time Settlement';

const DEFAULT_TEXT = `Join XDC Network & Contour at Sibos 2026
Miami Beach Convention Center | September 28 – October 1, 2026
Location: Booth #DISS 43

Dear Partner,

As financial institutions prepare for an AI-driven economy, infrastructure must move beyond faster processing to autonomous execution, programmable liquidity, and compliant digital settlement.

At Sibos 2026, XDC Network and Contour are showcasing how institutions can unify enterprise Layer 1 blockchain rails with digitized trade and dollar-stable settlement to power modern commercial finance and the emerging agentic economy.

Core Solutions & Product Lineup
• Instant Domestic & Cross-Border Settlement: Native USDC on XDC delivers sub-second finality and near-zero transaction fees for corporate treasury, institutional transfers, and multi-corridor remittances.
• Everyday & Corporate Cards: Instant card top-ups using native USDC on XDC for virtual and physical debit spending worldwide.
• Global Payouts & QR Retail Rails: Seamless disbursement routing to over 70 jurisdictions, alongside local merchant QR code point-of-sale settlement.
• Digitized Trade Finance (Contour): Fully paperless Letters of Credit (LCs), electronic documentation, and milestone-based smart contract settlement integrated with ISO 20022 messaging.
• Autonomous Agentic Commerce (XDC AI): Native HTTP 402 (x402) payment rails and gasless smart accounts enabling autonomous AI agents to initiate, reconcile, and settle expenses, compute, and API services compliantly.

Connect with Leadership at Booth #DISS 43

Schedule a Meeting: support@xdcforpayments.org

Best regards,
The XDC Network & Contour Delegation

Disclaimer: All banking, payment processing, card issuance, and regulated financial services are facilitated exclusively through appropriately authorized and licensed third-party financial institutions and partner entities in their respective jurisdictions. XDC Network is a decentralized enterprise blockchain protocol provider and does not directly provide banking, deposit-taking, or custodial financial services.
`;

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(SCHEMA);

    const eventRes = await client.query(
      `INSERT INTO events (name, slug, location, dates)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         location = EXCLUDED.location,
         dates = EXCLUDED.dates
       RETURNING id`,
      [
        'Sibos 2026',
        'sibos-2026',
        'Miami, Florida, USA',
        'September 28 – October 1, 2026',
      ]
    );
    const eventId = eventRes.rows[0].id;

    const existing = await client.query(
      `SELECT id FROM email_templates WHERE event_id = $1 AND is_default = TRUE LIMIT 1`,
      [eventId]
    );

    if (existing.rows.length === 0) {
      const { buildSibosEmailHtml } = require('../templates/sibosEmail');
      const html = buildSibosEmailHtml();
      await client.query(
        `INSERT INTO email_templates (event_id, name, subject, html_body, text_body, is_default)
         VALUES ($1, $2, $3, $4, $5, TRUE)`,
        [eventId, 'Sibos 2026 Invitation', DEFAULT_SUBJECT, html, DEFAULT_TEXT]
      );
      console.log('Seeded default Sibos 2026 template');
    } else {
      console.log('Default template already exists');
    }

    console.log('Database migration complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  migrate().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}

module.exports = { migrate, DEFAULT_SUBJECT, DEFAULT_TEXT };
