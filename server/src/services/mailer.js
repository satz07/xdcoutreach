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

async function sendViaPostmark({ from, to, subject, html, text, attachments, messageStream }) {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) throw new Error('POSTMARK_SERVER_TOKEN not set');

  const payload = {
    From: from,
    To: to,
    Subject: subject,
    HtmlBody: html,
    TextBody: text || undefined,
    MessageStream:
      messageStream ||
      process.env.POSTMARK_MESSAGE_STREAM ||
      'outbound',
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

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function htmlWithPublicLogos(html) {
  const base = (process.env.APP_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
  if (!base) return html;
  return String(html || '')
    .replace(/cid:xdc-logo/gi, `${base}/logos/xdc.png`)
    .replace(/cid:contour-logo/gi, `${base}/logos/contour.png`);
}

/**
 * Broadcast the same message to many recipients via Postmark Bulk API
 * (MessageStream: broadcast). Content+attachments sent once per chunk.
 * Falls back to /email/batch if bulk is unavailable.
 */
async function sendBroadcastEmails({
  from,
  subject,
  html,
  text,
  recipients,
  includeLogos = true,
}) {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) throw new Error('POSTMARK_SERVER_TOKEN not set');

  const stream = process.env.POSTMARK_BROADCAST_STREAM || 'broadcast';
  const chunkSize = Math.min(Number(process.env.POSTMARK_BULK_CHUNK || 500), 2000);
  const delayMs = Number(process.env.POSTMARK_BULK_DELAY_MS || 250);
  // Hosted logo URLs keep bulk payloads small (content sent once per chunk)
  const htmlBody = htmlWithPublicLogos(html);

  const chunks = chunkArray(recipients, chunkSize);
  const results = [];
  const bulkIds = [];

  for (let c = 0; c < chunks.length; c += 1) {
    const chunk = chunks[c];
    try {
      const bulkPayload = {
        From: from,
        Subject: subject,
        HtmlBody: htmlBody,
        TextBody: text || undefined,
        MessageStream: stream,
        Messages: chunk.map((to) => ({ To: to })),
      };

      const res = await fetch('https://api.postmarkapp.com/email/bulk', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Postmark-Server-Token': token,
        },
        body: JSON.stringify(bulkPayload),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && (data.Id || data.ID) && !data.ErrorCode) {
        const bulkId = data.Id || data.ID;
        bulkIds.push(bulkId);
        for (const to of chunk) {
          results.push({
            email: to,
            status: 'sent',
            messageId: `bulk:${bulkId}`,
            provider: 'postmark-bulk',
          });
        }
      } else if (
        data.ErrorCode === 1226 ||
        /message stream|broadcast|bulk/i.test(data.Message || '') ||
        res.status === 404 ||
        res.status === 422
      ) {
        console.warn(
          `Postmark bulk/broadcast unavailable (${data.Message || res.status}); using batch…`
        );
        const batchResults = await sendBatchViaPostmark({
          from,
          subject,
          html: htmlBody,
          text,
          recipients: chunk,
          messageStream: stream,
        });
        results.push(...batchResults);
      } else {
        throw new Error(data.Message || `Postmark bulk failed (${res.status})`);
      }
    } catch (err) {
      try {
        const batchResults = await sendBatchViaPostmark({
          from,
          subject,
          html: htmlBody,
          text,
          recipients: chunk,
          messageStream: stream,
        });
        results.push(...batchResults);
      } catch (batchErr) {
        try {
          const outboundResults = await sendBatchViaPostmark({
            from,
            subject,
            html: htmlBody,
            text,
            recipients: chunk,
            messageStream: process.env.POSTMARK_MESSAGE_STREAM || 'outbound',
          });
          results.push(...outboundResults);
        } catch (outboundErr) {
          for (const to of chunk) {
            results.push({
              email: to,
              status: 'failed',
              error: outboundErr.message || batchErr.message || err.message,
            });
          }
        }
      }
    }

    if (c < chunks.length - 1 && delayMs > 0) await sleep(delayMs);
  }

  return {
    provider: 'postmark-broadcast',
    bulkIds,
    results,
    success: results.filter((r) => r.status === 'sent').length,
    failure: results.filter((r) => r.status === 'failed').length,
  };
}

/** Postmark /email/batch — up to 500 messages per request */
async function sendBatchViaPostmark({
  from,
  subject,
  html,
  text,
  recipients,
  messageStream,
  attachments,
}) {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) throw new Error('POSTMARK_SERVER_TOKEN not set');

  const stream = messageStream || process.env.POSTMARK_MESSAGE_STREAM || 'outbound';
  const batchSize = Math.min(Number(process.env.POSTMARK_BATCH_SIZE || 100), 500);
  const delayMs = Number(process.env.POSTMARK_BULK_DELAY_MS || 200);
  const chunks = chunkArray(recipients, batchSize);
  const results = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const payload = chunk.map((to) => {
      const msg = {
        From: from,
        To: to,
        Subject: subject,
        HtmlBody: html,
        TextBody: text || undefined,
        MessageStream: stream,
      };
      if (attachments?.length) msg.Attachments = attachments;
      return msg;
    });

    const res = await fetch('https://api.postmarkapp.com/email/batch', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': token,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok && !Array.isArray(data)) {
      throw new Error(data.Message || `Postmark batch failed (${res.status})`);
    }

    const rows = Array.isArray(data) ? data : [];
    for (let j = 0; j < chunk.length; j += 1) {
      const row = rows[j] || {};
      if (row.ErrorCode === 0 || row.MessageID) {
        results.push({
          email: chunk[j],
          status: 'sent',
          messageId: row.MessageID,
          provider: 'postmark-batch',
        });
      } else {
        results.push({
          email: chunk[j],
          status: 'failed',
          error: row.Message || `Error ${row.ErrorCode || res.status}`,
        });
      }
    }

    if (i < chunks.length - 1 && delayMs > 0) await sleep(delayMs);
  }

  return results;
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
 * Postmark HTTPS only when MAIL_PROVIDER=postmark (default with token).
 * SMTP is disabled unless MAIL_PROVIDER=smtp explicitly.
 */
async function sendMailWithFallback(mailOptions) {
  const provider = (process.env.MAIL_PROVIDER || 'postmark').toLowerCase();

  if (provider === 'postmark' || (provider !== 'smtp' && process.env.POSTMARK_SERVER_TOKEN)) {
    return sendViaPostmark({
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject,
      html: mailOptions.html,
      text: mailOptions.text,
      attachments: mailOptions.attachments,
    });
  }

  if (provider !== 'smtp') {
    throw new Error('Mail not configured. Set MAIL_PROVIDER=postmark and POSTMARK_SERVER_TOKEN.');
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

async function sendCampaignEmails({
  recipients,
  subject,
  html,
  text,
  fromName,
  broadcast = false,
}) {
  const fromAddr = process.env.SMTP_FROM || process.env.OTP_EMAIL_FROM || process.env.SMTP_USER;
  const name = fromName || 'XDC Network & Contour';
  const from = `"${name}" <${fromAddr}>`;
  const list = Array.isArray(recipients) ? recipients : [];
  const threshold = Number(process.env.BROADCAST_THRESHOLD || 2);
  const useBroadcast = broadcast || list.length >= threshold;

  if (useBroadcast && list.length > 1 && process.env.POSTMARK_SERVER_TOKEN) {
    return sendBroadcastEmails({
      from,
      subject,
      html,
      text,
      recipients: list,
      includeLogos: true,
    });
  }

  const results = [];
  for (const to of list) {
    try {
      const info = await sendOneEmail({ to, subject, html, text, includeLogos: true, fromName });
      results.push({ email: to, status: 'sent', messageId: info.messageId, provider: info.provider });
    } catch (err) {
      results.push({ email: to, status: 'failed', error: err.message });
    }
  }
  return {
    provider: 'postmark',
    bulkIds: [],
    results,
    success: results.filter((r) => r.status === 'sent').length,
    failure: results.filter((r) => r.status === 'failed').length,
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
  sendCampaignEmails,
  sendBroadcastEmails,
  parseRecipients,
  resolveLogoAttachments,
  logoAttachments,
  diagnoseSmtp,
};
