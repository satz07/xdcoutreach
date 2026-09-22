const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/pool');

const SUPERADMIN_EMAIL = (process.env.SUPERADMIN_EMAIL || 'satheesh@xinfin.org')
  .trim()
  .toLowerCase();

const INVITE_TTL_DAYS = Number(process.env.INVITE_TTL_DAYS || 7);

function jwtSecret() {
  return process.env.JWT_SECRET || 'xdcoutreach-dev-secret-change-me';
}

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
    },
    jwtSecret(),
    { expiresIn: '7d' }
  );
}

function verifyToken(token) {
  return jwt.verify(token, jwtSecret());
}

function publicUser(row, extras = {}) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    email_send_limit: row.email_send_limit ?? null,
    emails_sent: extras.emails_sent ?? row.emails_sent ?? 0,
    has_password: Boolean(row.password_hash || row.has_password),
  };
}

async function countEmailsSent(userId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n
     FROM email_sends
     WHERE sent_by_user_id = $1 AND status = 'sent'`,
    [userId]
  );
  return rows[0]?.n || 0;
}

async function getRemainingQuota(user) {
  if (!user || user.role === 'superadmin' || user.email_send_limit == null) {
    return { limited: false, limit: null, used: 0, remaining: null };
  }
  const used = await countEmailsSent(user.id);
  const limit = Number(user.email_send_limit);
  return {
    limited: true,
    limit,
    used,
    remaining: Math.max(0, limit - used),
  };
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const payload = verifyToken(token);
    const { rows } = await pool.query(
      `SELECT id, email, role, active, email_send_limit, password_hash, created_at
       FROM users WHERE id = $1`,
      [payload.sub]
    );
    const user = rows[0];
    if (!user || user.active === false) {
      return res.status(401).json({ error: 'Invalid or inactive account' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Superadmin only' });
  }
  next();
}

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateInviteToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function verifyPassword(password, hash) {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}

function frontendUrl() {
  return (
    process.env.FRONTEND_URL ||
    process.env.APP_URL ||
    'https://xdcoutreach.vercel.app'
  ).replace(/\/$/, '');
}

module.exports = {
  SUPERADMIN_EMAIL,
  INVITE_TTL_DAYS,
  signToken,
  verifyToken,
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
  jwtSecret,
};
