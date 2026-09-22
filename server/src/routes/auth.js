const express = require('express');
const { pool } = require('../db/pool');
const { sendOneEmail } = require('../services/mailer');
const {
  SUPERADMIN_EMAIL,
  signToken,
  requireAuth,
  requireSuperAdmin,
  normalizeEmail,
  isValidEmail,
  generateOtp,
} = require('../middleware/auth');

const router = express.Router();

const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 10);
const APP_NAME = 'XDC Outreach';

function otpEmailHtml(code, purpose) {
  return `<!DOCTYPE html>
<html><body style="font-family:Arial,Helvetica,sans-serif;background:#F4F7FB;padding:24px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #D5E0EE;border-radius:12px;">
    <tr><td style="padding:28px 28px 8px;background:#15294C;color:#fff;border-radius:12px 12px 0 0;">
      <p style="margin:0;font-size:12px;letter-spacing:1.4px;text-transform:uppercase;color:#8EB4E0;">${APP_NAME}</p>
      <h1 style="margin:8px 0 0;font-size:22px;">Verification code</h1>
    </td></tr>
    <tr><td style="padding:24px 28px;color:#243447;font-size:15px;line-height:1.6;">
      <p style="margin:0 0 12px;">${purpose}</p>
      <p style="margin:0 0 8px;font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:#254C82;font-weight:700;">Your OTP</p>
      <p style="margin:0;font-size:32px;letter-spacing:8px;font-weight:700;color:#15294C;">${code}</p>
      <p style="margin:18px 0 0;font-size:13px;color:#6B7C8F;">This code expires in ${OTP_TTL_MINUTES} minutes. If you did not request it, ignore this email.</p>
    </td></tr>
  </table>
</body></html>`;
}

async function ensureUserCanLogin(email) {
  const { rows } = await pool.query(`SELECT * FROM users WHERE email = $1`, [email]);
  let user = rows[0];

  if (!user && email === SUPERADMIN_EMAIL) {
    const inserted = await pool.query(
      `INSERT INTO users (email, role, active)
       VALUES ($1, 'superadmin', TRUE)
       ON CONFLICT (email) DO UPDATE SET role = 'superadmin', active = TRUE
       RETURNING *`,
      [email]
    );
    user = inserted.rows[0];
  }

  if (!user) {
    return { ok: false, error: 'This email is not authorized. Ask the superadmin to invite you.' };
  }
  if (user.active === false) {
    return { ok: false, error: 'This account is inactive.' };
  }
  return { ok: true, user };
}

/** POST /auth/request-otp { email } */
router.post('/request-otp', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    const gate = await ensureUserCanLogin(email);
    if (!gate.ok) return res.status(403).json({ error: gate.error });

    const code = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await pool.query(`UPDATE login_otps SET used = TRUE WHERE email = $1 AND used = FALSE`, [email]);
    await pool.query(
      `INSERT INTO login_otps (email, code, expires_at) VALUES ($1, $2, $3)`,
      [email, code, expiresAt]
    );

    await sendOneEmail({
      to: email,
      subject: `${APP_NAME} login code: ${code}`,
      html: otpEmailHtml(code, 'Use this one-time code to sign in to XDC Outreach.'),
      text: `Your ${APP_NAME} login code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`,
      includeLogos: false,
      fromName: APP_NAME,
    });

    res.json({
      ok: true,
      message: 'OTP sent to your email',
      email,
      expiresInMinutes: OTP_TTL_MINUTES,
    });
  } catch (err) {
    console.error('request-otp error:', err);
    res.status(500).json({ error: err.message || 'Failed to send OTP' });
  }
});

/** POST /auth/verify-otp { email, code } */
router.post('/verify-otp', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const code = String(req.body.code || '').trim();

    if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Email and 6-digit OTP are required' });
    }

    const gate = await ensureUserCanLogin(email);
    if (!gate.ok) return res.status(403).json({ error: gate.error });

    const { rows } = await pool.query(
      `SELECT * FROM login_otps
       WHERE email = $1 AND code = $2 AND used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [email, code]
    );

    if (!rows[0]) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    await pool.query(`UPDATE login_otps SET used = TRUE WHERE id = $1`, [rows[0].id]);
    await pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [gate.user.id]);

    const token = signToken(gate.user);
    res.json({
      ok: true,
      token,
      user: {
        id: gate.user.id,
        email: gate.user.email,
        role: gate.user.role,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /auth/me */
router.get('/me', requireAuth, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
    },
  });
});

/** GET /auth/users — superadmin only */
router.get('/users', requireAuth, requireSuperAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, role, active, invited_by, created_at, last_login_at
       FROM users
       ORDER BY
         CASE role WHEN 'superadmin' THEN 0 ELSE 1 END,
         created_at ASC`
    );
    res.json({ users: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /auth/invite { email } — superadmin only */
router.post('/invite', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    if (email === SUPERADMIN_EMAIL) {
      return res.status(400).json({ error: 'That email is already the superadmin' });
    }

    const existing = await pool.query(`SELECT id, email, role, active FROM users WHERE email = $1`, [
      email,
    ]);
    if (existing.rows[0]) {
      if (existing.rows[0].active) {
        return res.status(409).json({ error: 'User already invited', user: existing.rows[0] });
      }
      const revived = await pool.query(
        `UPDATE users SET active = TRUE, role = 'admin', invited_by = $2 WHERE id = $1
         RETURNING id, email, role, active, invited_by, created_at`,
        [existing.rows[0].id, req.user.email]
      );
      await sendInviteEmail(email, req.user.email);
      return res.json({ ok: true, user: revived.rows[0], reactivated: true });
    }

    const { rows } = await pool.query(
      `INSERT INTO users (email, role, active, invited_by)
       VALUES ($1, 'admin', TRUE, $2)
       RETURNING id, email, role, active, invited_by, created_at`,
      [email, req.user.email]
    );

    await sendInviteEmail(email, req.user.email);
    res.status(201).json({ ok: true, user: rows[0] });
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
      `UPDATE users SET active = FALSE WHERE id = $1
       RETURNING id, email, role, active`,
      [user.id]
    );
    res.json({ ok: true, user: updated.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function sendInviteEmail(to, invitedBy) {
  const appUrl = process.env.FRONTEND_URL || process.env.APP_URL || 'https://xdcoutreach.vercel.app';
  const html = `<!DOCTYPE html>
<html><body style="font-family:Arial,Helvetica,sans-serif;background:#F4F7FB;padding:24px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #D5E0EE;border-radius:12px;">
    <tr><td style="padding:28px;background:#15294C;color:#fff;border-radius:12px 12px 0 0;">
      <h1 style="margin:0;font-size:22px;">You're invited to XDC Outreach</h1>
    </td></tr>
    <tr><td style="padding:24px 28px;color:#243447;font-size:15px;line-height:1.65;">
      <p style="margin:0 0 14px;">${invitedBy} invited you as an <strong>admin</strong> on XDC Outreach.</p>
      <p style="margin:0 0 14px;">You can compose and send event emails. Only the superadmin can invite new people.</p>
      <p style="margin:0 0 18px;">Sign in with your email — you'll receive a one-time OTP code.</p>
      <a href="${appUrl}" style="display:inline-block;padding:12px 22px;background:#254C82;color:#fff;text-decoration:none;border-radius:6px;font-weight:700;">Open XDC Outreach</a>
    </td></tr>
  </table>
</body></html>`;

  await sendOneEmail({
    to,
    subject: 'You are invited to XDC Outreach (admin)',
    html,
    text: `${invitedBy} invited you to XDC Outreach as an admin. Sign in at ${appUrl} with your email + OTP.`,
    includeLogos: false,
    fromName: APP_NAME,
  });
}

module.exports = router;
