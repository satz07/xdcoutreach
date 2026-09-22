const express = require('express');
const { pool } = require('../db/pool');
const { sendOneEmail } = require('../services/mailer');
const {
  SUPERADMIN_EMAIL,
  INVITE_TTL_DAYS,
  signToken,
  requireAuth,
  requireSuperAdmin,
  normalizeEmail,
  isValidEmail,
  generateInviteToken,
  hashPassword,
  verifyPassword,
  publicUser,
  countEmailsSent,
  getRemainingQuota,
  frontendUrl,
} = require('../middleware/auth');

const router = express.Router();
const APP_NAME = 'XDC Outreach';

function parseLimit(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    return { error: 'email_send_limit must be a non-negative integer (or empty for unlimited)' };
  }
  return { value: n };
}

/** POST /auth/login { email, password } */
router.post('/login', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');

    if (!isValidEmail(email) || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const { rows } = await pool.query(`SELECT * FROM users WHERE email = $1`, [email]);
    const user = rows[0];

    if (!user || user.active === false) {
      return res.status(403).json({
        error: 'This email is not authorized. Ask the superadmin to invite you.',
      });
    }

    if (!user.password_hash) {
      return res.status(403).json({
        error: 'Account not activated yet. Open your invite link to set a password first.',
      });
    }

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    await pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);
    const emailsSent = await countEmailsSent(user.id);
    const quota = await getRemainingQuota({ ...user, emails_sent: emailsSent });

    res.json({
      ok: true,
      token: signToken(user),
      user: publicUser(user, { emails_sent: emailsSent }),
      quota,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /auth/invite/:token — public, validate invite before set-password */
router.get('/invite/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    const { rows } = await pool.query(
      `SELECT id, email, role, active, invite_token_expires_at, password_hash
       FROM users
       WHERE invite_token = $1`,
      [token]
    );
    const user = rows[0];
    if (!user || !user.active) {
      return res.status(404).json({ error: 'Invite not found or revoked' });
    }
    if (user.password_hash) {
      return res.status(410).json({ error: 'Invite already used. Please sign in with your password.' });
    }
    if (user.invite_token_expires_at && new Date(user.invite_token_expires_at) < new Date()) {
      return res.status(410).json({ error: 'Invite has expired. Ask the superadmin to re-invite you.' });
    }
    res.json({ ok: true, email: user.email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /auth/set-password { token, password } */
router.post('/set-password', async (req, res) => {
  try {
    const token = String(req.body.token || '').trim();
    const password = String(req.body.password || '');

    if (!token || password.length < 8) {
      return res.status(400).json({ error: 'Invite token and a password of at least 8 characters are required' });
    }

    const { rows } = await pool.query(`SELECT * FROM users WHERE invite_token = $1`, [token]);
    const user = rows[0];
    if (!user || !user.active) {
      return res.status(404).json({ error: 'Invite not found or revoked' });
    }
    if (user.invite_token_expires_at && new Date(user.invite_token_expires_at) < new Date()) {
      return res.status(410).json({ error: 'Invite has expired. Ask the superadmin to re-invite you.' });
    }

    const passwordHash = await hashPassword(password);
    const updated = await pool.query(
      `UPDATE users
       SET password_hash = $1,
           invite_token = NULL,
           invite_token_expires_at = NULL,
           last_login_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [passwordHash, user.id]
    );
    const u = updated.rows[0];
    const emailsSent = await countEmailsSent(u.id);

    res.json({
      ok: true,
      token: signToken(u),
      user: publicUser(u, { emails_sent: emailsSent }),
      quota: await getRemainingQuota(u),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /auth/me */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const emailsSent = await countEmailsSent(req.user.id);
    const quota = await getRemainingQuota({ ...req.user, emails_sent: emailsSent });
    res.json({
      user: publicUser(req.user, { emails_sent: emailsSent }),
      quota,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /auth/users — superadmin only */
router.get('/users', requireAuth, requireSuperAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         u.id, u.email, u.role, u.active, u.invited_by, u.created_at, u.last_login_at,
         u.email_send_limit,
         (u.password_hash IS NOT NULL) AS has_password,
         (u.invite_token IS NOT NULL) AS pending_invite,
         COALESCE((
           SELECT COUNT(*)::int FROM email_sends s
           WHERE s.sent_by_user_id = u.id AND s.status = 'sent'
         ), 0) AS emails_sent
       FROM users u
       ORDER BY
         CASE u.role WHEN 'superadmin' THEN 0 ELSE 1 END,
         u.created_at ASC`
    );
    res.json({ users: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /auth/invite { email, email_send_limit? }
 * Superadmin only. Creates/reactivates admin and returns invite link.
 */
router.post('/invite', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    if (email === SUPERADMIN_EMAIL) {
      return res.status(400).json({ error: 'That email is already the superadmin' });
    }

    const limitParsed = parseLimit(req.body.email_send_limit);
    if (limitParsed.error) return res.status(400).json({ error: limitParsed.error });
    const emailSendLimit = limitParsed.value ?? null;

    const inviteToken = generateInviteToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const inviteLink = `${frontendUrl()}/?invite=${inviteToken}`;

    const existing = await pool.query(`SELECT * FROM users WHERE email = $1`, [email]);
    let user;

    if (existing.rows[0]) {
      if (existing.rows[0].role === 'superadmin') {
        return res.status(400).json({ error: 'Cannot invite superadmin' });
      }
      const updated = await pool.query(
        `UPDATE users SET
           active = TRUE,
           role = 'admin',
           invited_by = $2,
           email_send_limit = $3,
           password_hash = NULL,
           invite_token = $4,
           invite_token_expires_at = $5
         WHERE id = $1
         RETURNING id, email, role, active, invited_by, email_send_limit, created_at`,
        [existing.rows[0].id, req.user.email, emailSendLimit, inviteToken, expiresAt]
      );
      user = updated.rows[0];
    } else {
      const inserted = await pool.query(
        `INSERT INTO users
           (email, role, active, invited_by, email_send_limit, invite_token, invite_token_expires_at)
         VALUES ($1, 'admin', TRUE, $2, $3, $4, $5)
         RETURNING id, email, role, active, invited_by, email_send_limit, created_at`,
        [email, req.user.email, emailSendLimit, inviteToken, expiresAt]
      );
      user = inserted.rows[0];
    }

    let emailSent = false;
    let emailError = null;
    try {
      await sendInviteEmail(email, req.user.email, inviteLink);
      emailSent = true;
    } catch (err) {
      console.error('invite email failed:', err.message);
      emailError = err.message;
    }

    res.status(existing.rows[0] ? 200 : 201).json({
      ok: true,
      user,
      inviteLink,
      emailSent,
      emailError,
      message: emailSent
        ? `Invite sent to ${email}`
        : `Invite created. Email could not be sent — share this link with them: ${inviteLink}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /auth/users/:id { email_send_limit?, active? } — superadmin */
router.patch('/users/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [req.params.id]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'superadmin') {
      return res.status(400).json({ error: 'Cannot edit superadmin this way' });
    }

    let emailSendLimit = user.email_send_limit;
    if ('email_send_limit' in req.body) {
      const parsed = parseLimit(req.body.email_send_limit);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      emailSendLimit = parsed.value ?? null;
    }

    let active = user.active;
    if (typeof req.body.active === 'boolean') {
      active = req.body.active;
    }

    const updated = await pool.query(
      `UPDATE users SET email_send_limit = $2, active = $3
       WHERE id = $1
       RETURNING id, email, role, active, invited_by, email_send_limit, created_at, last_login_at`,
      [user.id, emailSendLimit, active]
    );

    const emailsSent = await countEmailsSent(user.id);
    res.json({
      ok: true,
      user: { ...updated.rows[0], emails_sent: emailsSent, has_password: Boolean(user.password_hash) },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /auth/users/:id/deactivate — superadmin only */
router.post('/users/:id/deactivate', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [req.params.id]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'superadmin') {
      return res.status(400).json({ error: 'Cannot deactivate superadmin' });
    }
    const updated = await pool.query(
      `UPDATE users SET active = FALSE, invite_token = NULL WHERE id = $1
       RETURNING id, email, role, active, email_send_limit`,
      [user.id]
    );
    res.json({ ok: true, user: updated.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function sendInviteEmail(to, invitedBy, inviteLink) {
  const html = `<!DOCTYPE html>
<html><body style="font-family:Arial,Helvetica,sans-serif;background:#F4F7FB;padding:24px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #D5E0EE;border-radius:12px;">
    <tr><td style="padding:28px;background:#15294C;color:#fff;border-radius:12px 12px 0 0;">
      <h1 style="margin:0;font-size:22px;">You're invited to XDC Outreach</h1>
    </td></tr>
    <tr><td style="padding:24px 28px;color:#243447;font-size:15px;line-height:1.65;">
      <p style="margin:0 0 14px;">${invitedBy} invited you as an <strong>admin</strong> on XDC Outreach.</p>
      <p style="margin:0 0 14px;">Set your password using the button below, then sign in to compose and send event emails.</p>
      <p style="margin:0 0 18px;">Only invited emails can access the platform.</p>
      <a href="${inviteLink}" style="display:inline-block;padding:12px 22px;background:#254C82;color:#fff;text-decoration:none;border-radius:6px;font-weight:700;">Set password &amp; activate</a>
      <p style="margin:18px 0 0;font-size:12px;color:#6B7C8F;word-break:break-all;">Or open: ${inviteLink}</p>
    </td></tr>
  </table>
</body></html>`;

  await sendOneEmail({
    to,
    subject: 'Activate your XDC Outreach admin account',
    html,
    text: `${invitedBy} invited you to XDC Outreach. Set your password: ${inviteLink}`,
    includeLogos: false,
    fromName: APP_NAME,
  });
}

module.exports = router;
