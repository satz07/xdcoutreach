const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');

const SUPERADMIN_EMAIL = (process.env.SUPERADMIN_EMAIL || 'satheesh@xinfin.org')
  .trim()
  .toLowerCase();

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

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const payload = verifyToken(token);
    const { rows } = await pool.query(
      `SELECT id, email, role, active, created_at FROM users WHERE id = $1`,
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

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

module.exports = {
  SUPERADMIN_EMAIL,
  signToken,
  verifyToken,
  requireAuth,
  requireSuperAdmin,
  normalizeEmail,
  isValidEmail,
  generateOtp,
  jwtSecret,
};
