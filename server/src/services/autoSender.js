const { pool } = require('../db/pool');
const { sendCampaignEmails } = require('./mailer');

const BATCH_SIZE = Number(process.env.AUTO_SEND_BATCH || 20);
const INTERVAL_MS = Number(process.env.AUTO_SEND_INTERVAL_MS || 60_000);

let timer = null;
let running = false; // tick in progress
let enabled = false;
let lastTick = null;
let lastError = null;
let startedBy = null;

async function ensureSettingsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function setEnabledFlag(on, userId = null) {
  await ensureSettingsTable();
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('auto_send_enabled', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [on ? 'true' : 'false']
  );
  if (userId != null) {
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('auto_send_started_by', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [String(userId)]
    );
  }
}

async function loadEnabledFlag() {
  await ensureSettingsTable();
  const { rows } = await pool.query(
    `SELECT value FROM app_settings WHERE key = 'auto_send_enabled' LIMIT 1`
  );
  return rows[0]?.value === 'true';
}

async function reclaimStaleSending() {
  // Any leftover 'sending' from a crashed tick → back to pending
  await pool.query(
    `UPDATE email_sends
     SET status = 'pending', error_message = NULL
     WHERE status = 'sending'`
  );
}

/**
 * Claim next N pending rows (ordered by id) and mark as sending.
 */
async function claimBatch(limit = BATCH_SIZE) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id FROM email_sends
       WHERE status = 'pending'
       ORDER BY id ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [limit]
    );
    if (rows.length === 0) {
      await client.query('COMMIT');
      return [];
    }
    const ids = rows.map((r) => r.id);
    await client.query(
      `UPDATE email_sends SET status = 'sending', error_message = NULL WHERE id = ANY($1::int[])`,
      [ids]
    );
    const full = await client.query(
      `SELECT * FROM email_sends WHERE id = ANY($1::int[]) ORDER BY id ASC`,
      [ids]
    );
    await client.query('COMMIT');
    return full.rows;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

async function applyResults(rows, campaignResult, userId = null) {
  const idByEmail = new Map(rows.map((r) => [r.recipient_email.toLowerCase(), r.id]));
  let success = 0;
  let failure = 0;

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
        [r.messageId || null, sendId, userId]
      );
    } else {
      failure += 1;
      await pool.query(
        `UPDATE email_sends
         SET status = 'failed', error_message = $1,
             sent_by_user_id = COALESCE(sent_by_user_id, $3)
         WHERE id = $2`,
        [r.error || 'send failed', sendId, userId]
      );
    }
  }

  // Any still 'sending' → failed
  const ids = rows.map((r) => r.id);
  const stuck = await pool.query(
    `UPDATE email_sends
     SET status = 'failed', error_message = COALESCE(error_message, 'no provider result')
     WHERE id = ANY($1::int[]) AND status = 'sending'
     RETURNING id`,
    [ids]
  );
  failure += stuck.rowCount || 0;

  return { success, failure };
}

async function processOneTick() {
  if (running) return { skipped: true, reason: 'already_running' };
  running = true;
  const startedAt = new Date().toISOString();
  try {
    await reclaimStaleSending();
    const rows = await claimBatch(BATCH_SIZE);
    if (rows.length === 0) {
      lastTick = {
        at: startedAt,
        claimed: 0,
        success: 0,
        failure: 0,
        note: 'queue empty — auto-send still on',
      };
      lastError = null;
      return lastTick;
    }

    // Group by subject+html so mixed campaigns still work
    const groups = new Map();
    for (const row of rows) {
      const key = `${row.subject}||${row.html_body}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }

    let success = 0;
    let failure = 0;
    let provider = null;

    for (const group of groups.values()) {
      const campaignResult = await sendCampaignEmails({
        recipients: group.map((r) => r.recipient_email),
        subject: group[0].subject,
        html: group[0].html_body,
        broadcast: group.length > 1,
      });
      provider = campaignResult.provider || provider;
      const counts = await applyResults(group, campaignResult, startedBy);
      success += counts.success;
      failure += counts.failure;
    }

    lastTick = {
      at: startedAt,
      claimed: rows.length,
      success,
      failure,
      provider,
      firstId: rows[0].id,
      lastId: rows[rows.length - 1].id,
    };
    lastError = null;
    console.log(
      `[auto-send] batch ${rows.length}: ${success} sent, ${failure} failed (ids ${rows[0].id}-${rows[rows.length - 1].id})`
    );
    return lastTick;
  } catch (err) {
    lastError = err.message;
    lastTick = { at: startedAt, error: err.message };
    console.error('[auto-send] tick failed:', err.message);
    return lastTick;
  } finally {
    running = false;
  }
}

function schedule() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    if (!enabled) return;
    processOneTick().catch((err) => {
      lastError = err.message;
      console.error('[auto-send]', err);
    });
  }, INTERVAL_MS);
  // run soon after start (don't wait full minute)
  setTimeout(() => {
    if (enabled) {
      processOneTick().catch((err) => {
        lastError = err.message;
      });
    }
  }, 2000);
}

async function startAutoSend(userId = null) {
  enabled = true;
  startedBy = userId;
  await setEnabledFlag(true, userId);
  schedule();
  return getStatus();
}

async function stopAutoSend() {
  enabled = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  await setEnabledFlag(false);
  return getStatus();
}

async function getStatus() {
  const pending = await pool.query(
    `SELECT COUNT(*)::int AS n FROM email_sends WHERE status = 'pending'`
  );
  const sending = await pool.query(
    `SELECT COUNT(*)::int AS n FROM email_sends WHERE status = 'sending'`
  );
  const etaMin =
    pending.rows[0].n > 0 ? Math.ceil(pending.rows[0].n / BATCH_SIZE) : 0;

  return {
    enabled,
    running,
    batchSize: BATCH_SIZE,
    intervalMs: INTERVAL_MS,
    intervalLabel: `${Math.round(INTERVAL_MS / 1000)}s`,
    pending: pending.rows[0].n,
    sending: sending.rows[0].n,
    etaMinutes: etaMin,
    lastTick,
    lastError,
    startedBy,
  };
}

/** Resume from DB after process restart */
async function initAutoSend() {
  try {
    const on = await loadEnabledFlag();
    if (on) {
      enabled = true;
      schedule();
      console.log(
        `[auto-send] resumed (batch ${BATCH_SIZE} every ${INTERVAL_MS}ms)`
      );
    } else {
      console.log('[auto-send] idle (stopped)');
    }
  } catch (err) {
    console.warn('[auto-send] init skipped:', err.message);
  }
}

module.exports = {
  startAutoSend,
  stopAutoSend,
  getStatus,
  initAutoSend,
  processOneTick,
  BATCH_SIZE,
  INTERVAL_MS,
};
