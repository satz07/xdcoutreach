const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const LOGOS_DIR = path.join(__dirname, '../../../public/logos');

function getTransporter() {
  const port = Number(process.env.SMTP_PORT || 587);
  const secure =
    String(process.env.SMTP_SECURE) === 'true' || port === 465;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    // Railway / cloud hosts often need longer SMTP connect windows
    connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT || 25000),
    greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT || 25000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT || 45000),
    tls: {
      minVersion: 'TLSv1.2',
      servername: process.env.SMTP_HOST || 'smtp.gmail.com',
    },
    requireTLS: !secure && port === 587,
  });
}

/**
 * Send with primary SMTP settings; if connect times out on 587,
 * retry once over SSL 465 (common fix on Railway / cloud hosts).
 */
async function sendMailWithFallback(mailOptions) {
  const transporter = getTransporter();
  try {
    return await transporter.sendMail(mailOptions);
  } catch (err) {
    const port = Number(process.env.SMTP_PORT || 587);
    const isConnectTimeout =
      err.code === 'ETIMEDOUT' ||
      err.code === 'ESOCKET' ||
      /timeout|connect/i.test(err.message || '');

    if (!isConnectTimeout || port === 465 || process.env.SMTP_NO_FALLBACK === 'true') {
      throw err;
    }

    console.warn(
      `SMTP ${port} failed (${err.message}); retrying smtp.gmail.com:465 SSL…`
    );
    const fallback = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      connectionTimeout: 25000,
      greetingTimeout: 25000,
      socketTimeout: 45000,
      tls: {
        minVersion: 'TLSv1.2',
        servername: process.env.SMTP_HOST || 'smtp.gmail.com',
      },
    });
    return fallback.sendMail(mailOptions);
  }
}

function logoAttachments() {
  const files = [
    { filename: 'xdc-logo.png', cid: 'xdc-logo', path: path.join(LOGOS_DIR, 'xdc.png') },
    { filename: 'contour-logo.png', cid: 'contour-logo', path: path.join(LOGOS_DIR, 'contour.png') },
    { filename: 'xdc-logo.svg', cid: 'xdc-logo', path: path.join(LOGOS_DIR, 'xdc.svg') },
    { filename: 'contour-logo.svg', cid: 'contour-logo', path: path.join(LOGOS_DIR, 'contour.svg') },
  ];

  const used = new Set();
  const attachments = [];
  for (const f of files) {
    if (used.has(f.cid)) continue;
    if (fs.existsSync(f.path)) {
      attachments.push({
        filename: f.filename,
        path: f.path,
        cid: f.cid,
        contentDisposition: 'inline',
      });
      used.add(f.cid);
    }
  }
  return attachments;
}

/**
 * Prefer PNG over SVG for email client compatibility.
 */
function resolveLogoAttachments() {
  const preferred = [
    { filename: 'xdc-logo.png', cid: 'xdc-logo', candidates: ['xdc.png', 'xdc-dark.png', 'xdc.svg'] },
    { filename: 'contour-logo.png', cid: 'contour-logo', candidates: ['contour.png', 'Contour_0.png', 'Contour_2.jpeg', 'contour-mark.jpeg'] },
  ];

  return preferred
    .map(({ filename, cid, candidates }) => {
      for (const name of candidates) {
        const p = path.join(LOGOS_DIR, name);
        if (fs.existsSync(p)) {
          return { filename: name.endsWith('.svg') ? name : filename, path: p, cid, contentDisposition: 'inline' };
        }
      }
      return null;
    })
    .filter(Boolean);
}

async function sendOneEmail({ to, subject, html, text, includeLogos = true, fromName }) {
  const from = process.env.SMTP_FROM || process.env.OTP_EMAIL_FROM || process.env.SMTP_USER;
  const name = fromName || 'XDC Network & Contour';

  const info = await sendMailWithFallback({
    from: `"${name}" <${from}>`,
    to,
    subject,
    html,
    text: text || undefined,
    attachments: includeLogos ? resolveLogoAttachments() : [],
  });

  return {
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
  };
}

function parseRecipients(raw) {
  if (!raw) return [];
  const list = String(raw)
    .split(/[,;\n]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const valid = [];
  const invalid = [];
  const seen = new Set();

  for (const email of list) {
    if (!emailRe.test(email)) {
      invalid.push(email);
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    valid.push(email);
  }

  return { valid, invalid };
}

module.exports = {
  getTransporter,
  sendOneEmail,
  parseRecipients,
  resolveLogoAttachments,
  logoAttachments,
};
