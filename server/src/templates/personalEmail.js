/**
 * Minimal "personal letter" layout for AI-personalized emails.
 * Deliberately plain (no hero image, one small button) so it reads like a 1:1 email.
 */

const ACCENTS = { contour: '#F2661F', xdc: '#2A5ADA' };

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function paragraphHtml(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br/>');
}

function buildPersonalEmailHtml({
  subject = '',
  preheader = '',
  greeting = 'Hello,',
  paragraphs = [],
  ctaLabel = '',
  ctaUrl = '',
  closing = '',
  signature = '',
  footerNote = '',
  brand = 'xdc',
}) {
  const accent = ACCENTS[brand] || ACCENTS.xdc;
  const p = (html) =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1f2933;">${html}</p>`;
  const cta =
    ctaLabel && ctaUrl
      ? `<p style="margin:4px 0 22px;"><a href="${esc(ctaUrl)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:6px;">${esc(ctaLabel)}</a></p>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
    <tr><td align="left" style="padding:24px 20px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;font-family:Arial,Helvetica,sans-serif;">
        <tr><td>
          ${p(paragraphHtml(greeting))}
          ${paragraphs.map((t) => p(paragraphHtml(t))).join('\n          ')}
          ${cta}
          ${closing ? p(paragraphHtml(closing)) : ''}
          ${signature ? p(paragraphHtml(signature)) : ''}
          ${footerNote ? `<p style="margin:28px 0 0;padding-top:14px;border-top:1px solid #e5e7eb;font-size:11px;line-height:1.5;color:#8a94a6;">${paragraphHtml(footerNote)}</p>` : ''}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = { buildPersonalEmailHtml };
