const { pool } = require('../db/pool');
const { sendOneVerifiedTransactional } = require('./mailer');

// Verified outbound is slower — default 10/min keeps headroom for Activity confirm
const BATCH_SIZE = Number(process.env.AUTO_SEND_BATCH || 10);
const INTERVAL_MS = Number(process.env.AUTO_SEND_INTERVAL_MS || 60_000);

let timer = null;
let running = false;
let enabled = false;
let lastTick = null;
let lastError = null;
let startedBy = null;
let scopedEventId = null;
let requeueRunning = false;
let lastRequeue = null;

async function ensureSettingsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function setEnabledFlag(on, userId = null, eventId = null) {
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
  if (eventId != null) {
    scopedEventId = Number(eventId) || null;
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('auto_send_event_id', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [scopedEventId ? String(scopedEventId) : '']
    );
  } else if (on === false) {
    // keep last event scope when stopping
  }
}

async function loadEnabledFlag() {
  await ensureSettingsTable();
  const { rows } = await pool.query(
    `SELECT value FROM app_settings WHERE key = 'auto_send_enabled' LIMIT 1`
  );
  const ev = await pool.query(
    `SELECT value FROM app_settings WHERE key = 'auto_send_event_id' LIMIT 1`
  );
  const raw = ev.rows[0]?.value;
  scopedEventId = raw && /^\d+$/.test(raw) ? Number(raw) : null;
  return rows[0]?.value === 'true';
}

async function reclaimStaleSending() {
  await pool.query(
    `UPDATE email_sends
     SET status = 'pending', error_message = NULL
     WHERE status = 'sending'`
  );
}

async function claimBatch(limit = BATCH_SIZE) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let rows;
    if (scopedEventId) {
      const r = await client.query(
        `SELECT id FROM email_sends
         WHERE status = 'pending' AND event_id = $1
         ORDER BY id ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [scopedEventId, limit]
      );
      rows = r.rows;
    } else {
      const r = await client.query(
        `SELECT id FROM email_sends
         WHERE status = 'pending'
         ORDER BY id ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [limit]
      );
      rows = r.rows;
    }
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

async function fetchSuppressions() {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) return new Set();
  const out = new Set();
  for (const stream of ['outbound', 'broadcast']) {
    try {
      const res = await fetch(
        `https://api.postmarkapp.com/message-streams/${stream}/suppressions/dump`,
        {
          headers: {
            Accept: 'application/json',
            'X-Postmark-Server-Token': token,
          },
        }
      );
      const data = await res.json().catch(() => ({}));
      for (const row of data.Suppressions || []) {
        if (row.EmailAddress) out.add(String(row.EmailAddress).toLowerCase());
      }
    } catch (_) {
      /* ignore */
    }
  }
  return out;
}

async function postmarkMessageExists(messageId) {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token || !messageId || String(messageId).startsWith('bulk:')) {
    return false;
  }
  const res = await fetch(`https://api.postmarkapp.com/messages/outbound/${messageId}/details`, {
    headers: {
      Accept: 'application/json',
      'X-Postmark-Server-Token': token,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ErrorCode === 701) return false;
  return Boolean(data.MessageID);
}

/**
 * Find rows marked sent that Postmark Activity cannot confirm → back to pending.
 * Suppressed addresses → failed (won't deliver).
 */
async function requeueUnverifiedSent({ concurrency = 15 } = {}) {
  if (requeueRunning) {
    return { ok: false, error: 'requeue already running', ...lastRequeue };
  }
  requeueRunning = true;
  const startedAt = new Date().toISOString();
  let checked = 0;
  let confirmed = 0;
  let requeued = 0;
  let suppressed = 0;
  let noMessageId = 0;

  try {
    const suppressions = await fetchSuppressions();
    const { rows: sentRows } = await pool.query(
      `SELECT id, recipient_email, message_id
       FROM email_sends
       WHERE status = 'sent'
       ORDER BY id ASC`
    );

    const queue = [...sentRows];
    async function worker() {
      while (queue.length) {
        const row = queue.shift();
        if (!row) return;
        checked += 1;
        const email = String(row.recipient_email || '').toLowerCase();

        if (suppressions.has(email)) {
          suppressed += 1;
          await pool.query(
            `UPDATE email_sends
             SET status = 'failed',
                 error_message = 'Postmark suppressed (bounce/manual) — not requeued'
             WHERE id = $1`,
            [row.id]
          );
          continue;
        }

        if (!row.message_id) {
          noMessageId += 1;
          requeued += 1;
          await pool.query(
            `UPDATE email_sends
             SET status = 'pending', message_id = NULL, sent_at = NULL,
                 error_message = 'requeued: marked sent without message_id'
             WHERE id = $1`,
            [row.id]
          );
          continue;
        }

        let exists = false;
        try {
          exists = await postmarkMessageExists(row.message_id);
        } catch (_) {
          exists = false;
        }

        if (exists) {
          confirmed += 1;
        } else {
          requeued += 1;
          await pool.query(
            `UPDATE email_sends
             SET status = 'pending', message_id = NULL, sent_at = NULL,
                 error_message = 'requeued: Postmark Activity missing MessageID'
             WHERE id = $1`,
            [row.id]
          );
        }
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, 20) }, () => worker());
    await Promise.all(workers);

    lastRequeue = {
      at: startedAt,
      finishedAt: new Date().toISOString(),
      checked,
      confirmed,
      requeued,
      suppressed,
      noMessageId,
    };
    console.log('[requeue]', lastRequeue);
    return { ok: true, ...lastRequeue };
  } catch (err) {
    lastRequeue = { at: startedAt, error: err.message, checked, confirmed, requeued };
    throw err;
  } finally {
    requeueRunning = false;
  }
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
        mode: 'outbound-verified',
        note: 'queue empty — auto-send still on',
      };
      lastError = null;
      return lastTick;
    }

    let success = 0;
    let failure = 0;
    const suppressions = await fetchSuppressions();

    for (const row of rows) {
      const email = String(row.recipient_email || '').toLowerCase();
      if (suppressions.has(email)) {
        failure += 1;
        await pool.query(
          `UPDATE email_sends
           SET status = 'failed',
               error_message = 'Postmark suppressed (bounce/manual)',
               sent_by_user_id = COALESCE(sent_by_user_id, $2)
           WHERE id = $1`,
          [row.id, startedBy]
        );
        continue;
      }

      try {
        const r = await sendOneVerifiedTransactional({
          to: row.recipient_email,
          subject: row.subject,
          html: row.html_body,
        });
        if (r.status === 'sent') {
          success += 1;
          await pool.query(
            `UPDATE email_sends
             SET status = 'sent', message_id = $1, sent_at = NOW(), error_message = NULL,
                 sent_by_user_id = COALESCE(sent_by_user_id, $3)
             WHERE id = $2`,
            [r.messageId, row.id, startedBy]
          );
        } else {
          failure += 1;
          // Back to pending so we can retry later (don't burn the queue on transient verify lag)
          await pool.query(
            `UPDATE email_sends
             SET status = 'pending', message_id = $1,
                 error_message = $2,
                 sent_by_user_id = COALESCE(sent_by_user_id, $4)
             WHERE id = $3`,
            [r.messageId || null, r.error || 'verify failed', row.id, startedBy]
          );
        }
      } catch (err) {
        failure += 1;
        await pool.query(
          `UPDATE email_sends
           SET status = 'pending',
               error_message = $1,
               sent_by_user_id = COALESCE(sent_by_user_id, $3)
           WHERE id = $2`,
          [err.message, row.id, startedBy]
        );
      }
    }

    lastTick = {
      at: startedAt,
      claimed: rows.length,
      success,
      failure,
      mode: 'outbound-verified',
      firstId: rows[0].id,
      lastId: rows[rows.length - 1].id,
    };
    lastError = null;
    console.log(
      `[auto-send] verified outbound ${rows.length}: ${success} sent, ${failure} failed/retry (ids ${rows[0].id}-${rows[rows.length - 1].id})`
    );
    return lastTick;
  } catch (err) {
    lastError = err.message;
    lastTick = { at: startedAt, error: err.message, mode: 'outbound-verified' };
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
  setTimeout(() => {
    if (enabled) {
      processOneTick().catch((err) => {
        lastError = err.message;
      });
    }
  }, 2000);
}

async function startAutoSend(userId = null, eventId = null) {
  enabled = true;
  startedBy = userId;
  if (eventId != null && eventId !== '') {
    scopedEventId = Number(eventId) || null;
  }
  await setEnabledFlag(true, userId, scopedEventId);
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
  const scopeClause = scopedEventId ? 'AND event_id = $1' : '';
  const scopeParams = scopedEventId ? [scopedEventId] : [];
  const pending = await pool.query(
    `SELECT COUNT(*)::int AS n FROM email_sends WHERE status = 'pending' ${scopeClause}`,
    scopeParams
  );
  const sending = await pool.query(
    `SELECT COUNT(*)::int AS n FROM email_sends WHERE status = 'sending' ${scopeClause}`,
    scopeParams
  );
  const sent = await pool.query(
    `SELECT COUNT(*)::int AS n FROM email_sends WHERE status = 'sent' ${scopeClause}`,
    scopeParams
  );
  const failed = await pool.query(
    `SELECT COUNT(*)::int AS n FROM email_sends WHERE status = 'failed' ${scopeClause}`,
    scopeParams
  );
  const etaMin = pending.rows[0].n > 0 ? Math.ceil(pending.rows[0].n / BATCH_SIZE) : 0;

  let eventName = null;
  if (scopedEventId) {
    const ev = await pool.query(`SELECT name FROM events WHERE id = $1`, [scopedEventId]);
    eventName = ev.rows[0]?.name || null;
  }

  return {
    enabled,
    running,
    mode: 'outbound-verified',
    eventId: scopedEventId,
    eventName,
    batchSize: BATCH_SIZE,
    intervalMs: INTERVAL_MS,
    intervalLabel: `${Math.round(INTERVAL_MS / 1000)}s`,
    pending: pending.rows[0].n,
    sending: sending.rows[0].n,
    sent: sent.rows[0].n,
    failed: failed.rows[0].n,
    etaMinutes: etaMin,
    lastTick,
    lastError,
    lastRequeue,
    requeueRunning,
    startedBy,
  };
}

async function initAutoSend() {
  try {
    const on = await loadEnabledFlag();
    if (on) {
      enabled = true;
      schedule();
      console.log(
        `[auto-send] resumed outbound-verified (batch ${BATCH_SIZE} every ${INTERVAL_MS}ms)`
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
  requeueUnverifiedSent,
  BATCH_SIZE,
  INTERVAL_MS,
};
