const nodemailer = require('nodemailer');
const dns = require('dns');
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const path = require('path');

// Prefer IPv4 — cloud hosts often hang on IPv6 SMTP AAAA routes
try {
  dns.setDefaultResultOrder('ipv4first');
} catch (_) {
  /* older Node */
}

const LOGOS_DIR = path.join(__dirname, '../../../public/logos');

function ipv4Lookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, family: 4 }, callback);
}

function smtpBaseOptions(overrides = {}) {
  const port = Number(overrides.port ?? process.env.SMTP_PORT ?? 587);
  const secure =
    overrides.secure != null
      ? overrides.secure
      : String(process.env.SMTP_SECURE) === 'true' || port === 465;
  const host = overrides.host || process.env.SMTP_HOST || 'smtp.gmail.com';

  return {
    host,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT || 15000),
    greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT || 15000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT || 30000),
    tls: {
      minVersion: 'TLSv1.2',
      servername: host,
    },
    requireTLS: !secure && port === 587,
    lookup: ipv4Lookup,
    ...overrides,
  };
}

function getTransporter(overrides = {}) {
  return nodemailer.createTransport(smtpBaseOptions(overrides));
}

function guessContentType(filename = '') {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

async function sendViaPostmark({ from, to, subject, html, text, attachments }) {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) throw new Error('POSTMARK_SERVER_TOKEN not set');

  const payload = {
    From: from,
    To: to,
    Subject: subject,
    HtmlBody: html,
    TextBody: text || undefined,
    MessageStream: process.env.POSTMARK_MESSAGE_STREAM || 'outbound',
  };

  if (attachments && attachments.length) {
    payload.Attachments = attachments.map((a) => ({
      Name: a.filename,
      Content: fs.readFileSync(a.path).toString('base64'),
      ContentType: guessContentType(a.filename),
      ContentID: a.cid ? `cid:${a.cid}` : undefined,
    }));
  }

  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': token,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ErrorCode) {
    throw new Error(data.Message || `Postmark failed (${res.status})`);
  }
  return {
    messageId: data.MessageID,
    accepted: [to],
    rejected: [],
    provider: 'postmark',
  };
}

function usePostmark() {
  const provider = (process.env.MAIL_PROVIDER || '').toLowerCase();
  if (!process.env.POSTMARK_SERVER_TOKEN) return false;
  return !provider || provider === 'postmark';
}

/**
 * Probe TCP/TLS reachability (used by /api/health/smtp).
 */
function probeHost(host, port, secure, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const done = (ok, detail) => {
      resolve({ host, port, secure, ok, detail, ms: Date.now() - started });
    };
    const timer = setTimeout(() => {
      try {
        socket.destroy();
      } catch (_) {}
      done(false, 'timeout');
    }, timeoutMs);

    let socket;
    const onConnect = () => {
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch (_) {}
      done(true, 'connected');
    };
    const onError = (err) => {
      clearTimeout(timer);
      done(false, err.message);
    };

    try {
      if (secure) {
        socket = tls.connect({ host, port, servername: host, lookup: ipv4Lookup }, onConnect);
      } else {
        socket = net.connect({ host, port, lookup: ipv4Lookup }, onConnect);
      }
      socket.on('error', onError);
    } catch (err) {
      clearTimeout(timer);
      done(false, err.message);
    }
  });
}

async function diagnoseSmtp() {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const probes = await Promise.all([
    probeHost(host, 465, true),
    probeHost(host, 587, false),
    probeHost('api.postmarkapp.com', 443, true),
  ]);
  return {
    smtpHost: host,
    smtpPort: process.env.SMTP_PORT,
    smtpSecure: process.env.SMTP_SECURE,
    smtpUser: process.env.SMTP_USER ? 'set' : 'missing',
    postmarkToken: process.env.POSTMARK_SERVER_TOKEN ? 'set' : 'missing',
    mailProvider: process.env.MAIL_PROVIDER || (usePostmark() ? 'postmark' : 'smtp'),
    probes,
  };
}

/**
 * Prefer Postmark HTTPS when configured; else SMTP with IPv4 + 465 fallback (local).
 */
async function sendMailWithFallback(mailOptions) {
  if (usePostmark()) {
    return sendViaPostmark({
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject,
      html: mailOptions.html,
      text: mailOptions.text,
      attachments: mailOptions.attachments,
    });
  }

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
      if (isConnectTimeout && process.env.POSTMARK_SERVER_TOKEN) {
        console.warn(`SMTP failed (${err.message}); falling back to Postmark HTTPS…`);
        return sendViaPostmark({
          from: mailOptions.from,
          to: mailOptions.to,
          subject: mailOptions.subject,
          html: mailOptions.html,
          text: mailOptions.text,
          attachments: mailOptions.attachments,
        });
      }
      throw err;
    }

    console.warn(
      `SMTP ${port} failed (${err.message}); retrying ${process.env.SMTP_HOST || 'smtp.gmail.com'}:465 SSL…`
    );
    const fallback = getTransporter({ port: 465, secure: true });
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
    {
      filename: 'contour-logo.png',
      cid: 'contour-logo',
      candidates: ['contour.png', 'Contour_0.png', 'Contour_2.jpeg', 'contour-mark.jpeg'],
    },
  ];

  return preferred
    .map(({ filename, cid, candidates }) => {
      for (const name of candidates) {
        const p = path.join(LOGOS_DIR, name);
        if (fs.existsSync(p)) {
          return {
            filename: name.endsWith('.svg') ? name : filename,
            path: p,
            cid,
            contentDisposition: 'inline',
          };
        }
      }
      return null;
    })
    .filter(Boolean);
}

async function sendOneEmail({ to, subject, html, text, includeLogos = true, fromName }) {
  const fromAddr = process.env.SMTP_FROM || process.env.OTP_EMAIL_FROM || process.env.SMTP_USER;
  const name = fromName || 'XDC Network & Contour';
  const from = `"${name}" <${fromAddr}>`;

  const info = await sendMailWithFallback({
    from,
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
    provider: info.provider || 'smtp',
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
  diagnoseSmtp,
};
