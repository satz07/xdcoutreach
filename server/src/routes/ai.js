const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const { aiConfig, aiConfigured, addUsage, emptyUsage } = require('../services/llm');
const { researchRecipient } = require('../services/aiResearch');
const { getEventBrief, writePersonalizedEmail } = require('../services/aiEmail');
const { sendOneForEvent } = require('../services/mailer');

const router = express.Router();
router.use(requireAuth);

const PRICE_IN_PER_M = Number(process.env.AI_PRICE_INPUT_PER_M || 3);
const PRICE_OUT_PER_M = Number(process.env.AI_PRICE_OUTPUT_PER_M || 15);
const PRICE_PER_SEARCH = Number(process.env.AI_PRICE_PER_SEARCH || 0.01);

function estimateCost(u) {
  const usd =
    (u.input_tokens / 1e6) * PRICE_IN_PER_M +
    (u.output_tokens / 1e6) * PRICE_OUT_PER_M +
    u.web_searches * PRICE_PER_SEARCH;
  return Math.round(usd * 10000) / 10000;
}

let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = pool.query(`
      CREATE TABLE IF NOT EXISTS ai_runs (
        id SERIAL PRIMARY KEY,
        event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
        recipient_email TEXT NOT NULL,
        recipient_name TEXT,
        company TEXT,
        domain TEXT,
        instructions TEXT,
        model TEXT,
        profile JSONB,
        steps JSONB,
        email JSONB,
        usage JSONB,
        cost_usd NUMERIC(10,4),
        duration_ms INTEGER,
        sent_to TEXT,
        sent_at TIMESTAMPTZ,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`).catch((err) => {
      tableReady = null;
      throw err;
    });
  }
  return tableReady;
}

router.get('/status', (_req, res) => {
  res.json({ configured: aiConfigured(), model: aiConfig().model, provider: 'anthropic' });
});

/** POST /api/ai/personalize { event_id, email, name?, company?, domain?, instructions? } */
router.post('/personalize', requireSuperAdmin, async (req, res) => {
  const started = Date.now();
  try {
    if (!aiConfigured()) return res.status(400).json({ error: 'AI is not configured (ANTHROPIC_API_KEY missing)' });
    const { event_id, name, company, instructions } = req.body || {};
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!event_id) return res.status(400).json({ error: 'event_id is required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Valid email is required' });
    const domain = String(req.body?.domain || email.split('@')[1] || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '');

    await ensureTable();
    const brief = await getEventBrief(Number(event_id));
    const recipient = { name: name?.trim() || '', email, company: company?.trim() || '', domain };

    const research = await researchRecipient({
      ...recipient,
      event: { ...brief.event, summary: brief.text },
      senderOrg: brief.fromName || (brief.brand === 'contour' ? 'Contour Network' : 'XDC Network'),
    });
    const written = await writePersonalizedEmail({
      profile: research.profile,
      recipient,
      brief,
      instructions: instructions?.trim(),
    });

    const usage = addUsage(addUsage(emptyUsage(), {
      input_tokens: research.usage.input_tokens,
      output_tokens: research.usage.output_tokens,
      server_tool_use: { web_search_requests: research.usage.web_searches },
    }), written.usage);
    const cost = estimateCost(usage);
    const duration = Date.now() - started;

    const { rows } = await pool.query(
      `INSERT INTO ai_runs (event_id, recipient_email, recipient_name, company, domain, instructions, model,
         profile, steps, email, usage, cost_usd, duration_ms, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id, created_at`,
      [
        Number(event_id), email, recipient.name || null, recipient.company || null, domain, instructions || null,
        aiConfig().model, research.profile, JSON.stringify(research.steps), written.email, usage, cost, duration,
        req.user?.id || null,
      ]
    );

    res.json({
      run_id: rows[0].id,
      created_at: rows[0].created_at,
      event: { id: brief.event.id, name: brief.event.name, brand: brief.brand, from: brief.fromEmail },
      recipient,
      profile: research.profile,
      steps: research.steps,
      email: written.email,
      usage,
      cost_usd: cost,
      duration_ms: duration,
      model: aiConfig().model,
    });
  } catch (err) {
    console.error('[ai] personalize failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/ai/runs/:id/send { to, subject?, html? } — send the generated (optionally edited) email as a test */
router.post('/runs/:id/send', requireSuperAdmin, async (req, res) => {
  try {
    await ensureTable();
    const { rows } = await pool.query('SELECT * FROM ai_runs WHERE id = $1', [req.params.id]);
    const run = rows[0];
    if (!run) return res.status(404).json({ error: 'Run not found' });
    const to = String(req.body?.to || run.recipient_email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: 'Valid "to" email is required' });

    const subject = req.body?.subject || run.email.subject;
    const html = req.body?.html || run.email.html;
    const result = await sendOneForEvent(run.event_id, { to, subject, html, text: run.email.text });
    await pool.query('UPDATE ai_runs SET sent_to = $2, sent_at = NOW() WHERE id = $1', [run.id, to]);
    res.json({ ok: true, to, messageId: result.messageId, provider: result.provider });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/runs', async (_req, res) => {
  try {
    await ensureTable();
    const { rows } = await pool.query(
      `SELECT r.id, r.event_id, e.name AS event_name, r.recipient_email, r.recipient_name, r.company, r.domain,
              r.email->>'subject' AS subject, (r.profile->>'confidence')::float AS confidence,
              r.cost_usd, r.duration_ms, r.sent_to, r.sent_at, r.created_at
       FROM ai_runs r LEFT JOIN events e ON e.id = r.event_id
       ORDER BY r.created_at DESC LIMIT 30`
    );
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/runs/:id', async (req, res) => {
  try {
    await ensureTable();
    const { rows } = await pool.query(
      `SELECT r.*, e.name AS event_name FROM ai_runs r LEFT JOIN events e ON e.id = r.event_id WHERE r.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Run not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
