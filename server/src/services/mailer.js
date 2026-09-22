const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const LOGOS_DIR = path.join(__dirname, '../../../public/logos');

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE) === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
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
  const transporter = getTransporter();
  const from = process.env.SMTP_FROM || process.env.OTP_EMAIL_FROM || process.env.SMTP_USER;
  const name = fromName || 'XDC Network & Contour';

  const info = await transporter.sendMail({
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
