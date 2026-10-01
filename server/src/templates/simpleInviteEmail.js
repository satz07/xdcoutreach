/**
 * Generic single-brand event invite: logo, greeting, paragraphs, highlight line,
 * bullet list, event card, one CTA. Used for non-XDC/Contour events (e.g. WGF Expo).
 */

const FONT = "'Noto Sans Gujarati','Noto Sans',Shruti,Arial,Helvetica,sans-serif";

function defaultSimpleInviteContent() {
  return {
    templateKind: 'simple-invite',
    headline: 'Event invitation',
    assetFolder: '',
    logoFile: 'logo.png',
    logoUrl: '',
    logoAlt: '',
    logoWidth: 200,
    primaryColor: '#1C3F94',
    accentColor: '#C8922A',
    ctaColor: '#E07B1F',
    greeting: 'Hello {{first_name}},',
    intro: '',
    highlight: '',
    body: '',
    bulletsTitle: '',
    bulletsText: '',
    eventTitle: '',
    eventDetailsText: '',
    tagline: '',
    ctaLabel: 'Register',
    ctaUrl: '',
    closing: '',
    signOff: '',
    footerNote: '',
  };
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** **bold** and [label](https://url) inside escaped text */
function inline(text, linkColor) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g,
      (_, label, url) => `<a href="${url}" style="color:${linkColor};text-decoration:underline;">${label}</a>`
    )
    .replace(/\n/g, '<br/>');
}

function paragraphs(text) {
  return String(text || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function lines(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.replace(/^\s*[•\-*]\s*/, '').trim())
    .filter(Boolean);
}

function buildSimpleInviteEmailHtml(overrides = {}) {
  const c = { ...defaultSimpleInviteContent(), ...overrides };
  const primary = c.primaryColor || '#1C3F94';
  const accent = c.accentColor || '#C8922A';
  const ctaColor = c.ctaColor || accent;
  const base = String(c.assetBase || '').replace(/\/$/, '');
  const logo = c.logoUrl || (base && c.logoFile ? `${base}/${c.logoFile}` : '');

  const p = (html, extra = '') =>
    `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.7;color:#1f2933;${extra}">${html}</p>`;

  const bullets = lines(c.bulletsText);
  const details = lines(c.eventDetailsText);

  const highlight = c.highlight
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 20px;">
        <tr><td align="center" style="padding:14px 10px;border-top:1px solid ${accent};border-bottom:1px solid ${accent};font-family:${FONT};font-size:20px;font-weight:700;color:${primary};">${inline(c.highlight, primary)}</td></tr>
      </table>`
    : '';

  const bulletList = bullets.length
    ? `${c.bulletsTitle ? p(`<strong>${inline(c.bulletsTitle, primary)}</strong>`, 'margin-bottom:10px;') : ''}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
        ${bullets
          .map(
            (b) => `<tr>
          <td width="28" valign="top" style="padding:3px 0 9px;font-family:${FONT};font-size:16px;line-height:1.6;color:${accent};font-weight:700;">&#10003;</td>
          <td valign="top" style="padding:3px 0 9px;font-family:${FONT};font-size:16px;line-height:1.6;color:#1f2933;">${inline(b, primary)}</td>
        </tr>`
          )
          .join('')}
      </table>`
    : '';

  const cta =
    c.ctaLabel && c.ctaUrl
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 6px;">
          <tr><td align="center">
            <a href="${esc(c.ctaUrl)}" style="display:inline-block;background:${ctaColor};color:#ffffff;text-decoration:none;font-family:${FONT};font-size:16px;font-weight:700;padding:14px 30px;border-radius:8px;">${esc(c.ctaLabel)}</a>
          </td></tr>
        </table>`
      : '';

  const eventCard =
    c.eventTitle || details.length || c.tagline || cta
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;background:${primary};border-radius:12px;">
          <tr><td align="center" style="padding:26px 22px;">
            ${c.eventTitle ? `<div style="font-family:${FONT};font-size:24px;font-weight:800;color:#ffffff;letter-spacing:0.3px;">${esc(c.eventTitle)}</div>` : ''}
            ${details
              .map(
                (d) =>
                  `<div style="font-family:${FONT};font-size:16px;line-height:1.6;color:#ffffff;margin-top:8px;">${inline(d, '#ffffff')}</div>`
              )
              .join('')}
            ${c.tagline ? `<div style="font-family:${FONT};font-size:14px;line-height:1.5;color:${accent};font-style:italic;margin-top:14px;">${esc(c.tagline)}</div>` : ''}
            ${cta}
          </td></tr>
        </table>`
      : '';

  return `<!DOCTYPE html>
<html lang="gu">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="x-apple-disable-message-reformatting"/>
  <meta name="color-scheme" content="light only"/>
  <title>${esc(c.headline)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f2ec;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f2ec;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border-radius:14px;overflow:hidden;border-top:5px solid ${accent};">
        ${
          logo
            ? `<tr><td align="center" style="padding:28px 24px 8px;">
          <img src="${esc(logo)}" width="${Number(c.logoWidth) || 200}" alt="${esc(c.logoAlt || c.eventTitle || c.headline)}" style="display:block;width:${Number(c.logoWidth) || 200}px;max-width:70%;height:auto;border:0;"/>
        </td></tr>`
            : ''
        }
        <tr><td style="padding:20px 32px 8px;">
          ${c.greeting ? p(`<strong>${inline(c.greeting, primary)}</strong>`) : ''}
          ${paragraphs(c.intro).map((t) => p(inline(t, primary))).join('\n')}
          ${highlight}
          ${paragraphs(c.body).map((t) => p(inline(t, primary))).join('\n')}
          ${bulletList}
          ${eventCard}
          ${paragraphs(c.closing).map((t) => p(inline(t, primary))).join('\n')}
          ${c.signOff ? p(inline(c.signOff, primary), 'margin-top:8px;') : ''}
        </td></tr>
        ${
          c.footerNote
            ? `<tr><td style="padding:14px 32px 24px;border-top:1px solid #eee7da;font-family:${FONT};font-size:12px;line-height:1.6;color:#8a8170;">${inline(c.footerNote, '#8a8170')}</td></tr>`
            : ''
        }
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = { buildSimpleInviteEmailHtml, defaultSimpleInviteContent };
