/**
 * Contour Network — Sibos breakfast & experts panel invitation (bankers audience).
 * Same brand bar, navy strip and footer as the Contour @ Sibos email; hero is the Luma
 * "Opening Bell" cover. Assets served from /events/contour-sibos/.
 *
 * Text fields support **bold** and [label](https://url).
 */
const { escapeHtml, resolveAssetBase, btn } = require('./contourSibosEmail');

const P = 'font-family:Arial,Helvetica,sans-serif;';

function linesOf(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function rich(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#182752;font-weight:700;">$1</strong>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" style="color:#F2661F;font-weight:700;text-decoration:underline;">$1</a>'
    );
}

/** "Label | https://url" per line → [{ label, url }] (url optional). */
function parseMediaLines(text) {
  return linesOf(text).map((line) => {
    const idx = line.lastIndexOf('|');
    if (idx > -1) {
      const maybeUrl = line.slice(idx + 1).trim();
      if (/^https?:\/\//i.test(maybeUrl)) {
        return { label: line.slice(0, idx).trim(), url: maybeUrl };
      }
    }
    return { label: line, url: '' };
  });
}

function linkify(text) {
  return escapeHtml(text).replace(
    /(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g,
    '<a href="$1" style="color:#F6C3A8;text-decoration:underline;">$1</a>'
  );
}

function defaultContourBreakfastContent() {
  return {
    templateKind: 'contour-breakfast',
    eyebrow: 'Sibos Miami · Tuesday, September 29, 2026 · 7:30 – 9:30 AM',
    headline: 'Unlocking Velocity in Global Trade to Payments',
    subheadline: 'Institutional breakfast & global experts panel · The Bass Art Museum, Miami Beach',
    showHero: true,
    greeting: '',
    intro:
      '[Contour Network](https://www.contour.network), along with co-hosts **SAP** and **Eastnets** is convening an institutional breakfast event and global experts panel on the above topic at Sibos Miami featuring global industry leaders:',
    speakersText: [
      'Alexandre Kech, CEO, **Global Legal Entity Identifier Foundation (GLEIF)**',
      'Sulabh Agarwal, Global Payments Lead, **Accenture**',
      'Kiran Mistry, Regional VP, Head of Financial Services APAC, **SAP**',
      'Baiba Miezere, Group Product Development Director, **Eastnets**',
      'Moderator: Rahul Bhargava, Interim COO, **Contour Network**',
    ].join('\n'),
    seatsText: 'As there are limited seats left, we welcome you to register at the earliest.',
    eventWhen: 'Tuesday, September 29, from 7:30 to 9:30 a.m. EDT',
    eventWhere: 'The Bass Art Museum in Miami Beach (walkable to the venue)',
    eventNote: 'Grab one of the limited seats left - register now!',
    registerCtaLabel: 'I want to register',
    registerUrl: 'https://luma.com/Unlockingvelocity',
    audience:
      'We are expecting a curated audience of senior executives across banking, regulators, corporates, payments and fintech — the stakeholders enabling a trade to payments settlement ecosystem end-to-end.',
    discussionIntro:
      'The interactive discussion aims at shedding light on key underlying problems and practical solutions, with topics such as:',
    topicsText: [
      'Global standards',
      'Frameworks aligned with MLETR and verifiable credentials',
      'Institutional application of regulated stablecoins, for settlement in a sandwich model between fiat accounts',
      'The state today of application of AI and AI agents in trade and payment workflows',
      'The evolution of compliance — and much more!',
    ].join('\n'),
    questions:
      'Come armed with questions and comments for an insightful and exciting start to Day 2 at Sibos!',
    continuedIntro:
      'If you are unable to make it on 29th, or otherwise missed the opportunity, or need more information - please join the continued conversation at the **Contour** showcase at this time:',
    continuedTitle: 'Contour Showcase · Discover Stage',
    continuedWhen: 'October 1st, 9.45 - 10.15 AM',
    continuedWhere: 'Discover Stage',
    continuedNote: 'Express your seats and join the conversation on the future of Trade to Payments!',
    continuedCtaLabel: 'Register here',
    continuedCtaUrl: 'https://luma.com/tnotpk0e',
    boothLine: 'Or visit us at the **Contour** booth in the Discovery Zone, Booth #DISS43!',
    mediaIntro: 'As additional reference - some media coverage around this Sibos breakfast event:',
    mediaText: [
      'Post by Global Trade Review | LinkedIn | https://www.linkedin.com/posts/sibos2026-tradefinance-payments-share-7508895620678541313-tESZ/',
      'Contour Convenes Industry Leaders on Unlocking Velocity in Global "Trade to Payments" Flow | Yellow | https://yellow.com/press-releases/contour-convenes-industry-leaders-on-unlocking-velocity-in-global-trade-to-payments-flow',
      'Fintech Finance News | LinkedIn | https://www.linkedin.com/posts/ffnewsmediapartner-sibosmiami2026-share-7508835008627818496-JbMq/',
      'Miami Fintech Club | Instagram | https://www.instagram.com/p/DdTx0PPij3P/',
    ].join('\n'),
    signOff: 'Regards,\nTeam Contour',
    footerNote: 'Contour Network · Sibos Miami 2026 · Booth #DISS43',
    disclaimer:
      'This message and any attachments are confidential and meant for the intended recipients only. If you received this email in error, please notify us immediately and delete this message and any attachments from your system. Do not copy or disclose the contents to any other person. Contour is committed to ensuring the security and integrity of all personal data that we process. Any personal data collected during email correspondence with Contour shall be processed in accordance with our Privacy Policy at https://contour.network/privacy-policy',
    preheader:
      'Sibos breakfast & experts panel with GLEIF, SAP, Accenture and Eastnets · Sep 29, 7:30 – 9:30 AM, Miami Beach',
  };
}

const CONTOUR_BREAKFAST_SUBJECT =
  'Invitation | Sibos breakfast event & panel on "Unlocking Velocity in Global Trade to Payments"!';

function buildContourBreakfastEmailHtml(overrides = {}) {
  const c = { ...defaultContourBreakfastContent(), ...overrides };
  const assetBase = resolveAssetBase(c.assetBase);
  const img = (name) => `${assetBase}/${name}`;

  const logo = c.logoSrc || c.contourLogoSrc || 'cid:contour-logo';
  const hero = c.heroImgSrc || img('opening-bell.jpg');
  const showHero = !(c.showHero === false || c.showHero === 'false');
  const registerUrl = c.registerUrl || 'https://luma.com/Unlockingvelocity';

  const para = (text, margin = '0 0 16px') =>
    text ? `<p style="margin:${margin};">${rich(text)}</p>` : '';

  const bullets = (text, margin = '0 0 16px') => {
    const items = linesOf(text);
    return items.length
      ? `<ul style="margin:${margin};padding:0 0 0 20px;">
        ${items
          .map((t) => `<li style="margin:0 0 6px;padding-left:2px;">${rich(t)}</li>`)
          .join('')}
      </ul>`
      : '';
  };

  const signOffHtml = escapeHtml(c.signOff)
    .split('\n')
    .map((line) => line || '&nbsp;')
    .join('<br/>');

  const detailRow = (label, value) =>
    value
      ? `<p style="margin:0 0 6px;${P}font-size:14px;line-height:1.55;color:#4A5568;"><strong style="color:#182752;">${label}:</strong> ${rich(value)}</p>`
      : '';

  const media = parseMediaLines(c.mediaText);
  const mediaHtml = media.length
    ? `<tr>
            <td class="email-pad" style="padding:8px 24px 4px;${P}font-size:14px;line-height:1.7;color:#243447;background-color:#ffffff;">
              <p style="margin:0 0 8px;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:#F2661F;font-weight:700;">In the media</p>
              ${para(c.mediaIntro, '0 0 10px')}
              <ul style="margin:0;padding:0 0 0 20px;">
                ${media
                  .map(({ label, url }) =>
                    url
                      ? `<li style="margin:0 0 6px;"><a href="${escapeHtml(url)}" style="color:#182752;font-weight:700;text-decoration:underline;">${escapeHtml(label)}</a></li>`
                      : `<li style="margin:0 0 6px;color:#182752;font-weight:700;">${escapeHtml(label)}</li>`
                  )
                  .join('')}
              </ul>
            </td>
          </tr>`
    : '';

  const hasEventBox = c.eventWhen || c.eventWhere || c.eventNote || c.registerCtaLabel;
  const eventBox = hasEventBox
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;background-color:#F7F4EF;border:1px solid #E6E0D8;border-left:4px solid #F2661F;border-radius:8px;">
                <tr>
                  <td style="padding:16px 18px 6px;">
                    ${detailRow('When', c.eventWhen)}
                    ${detailRow('Where', c.eventWhere)}
                    ${
                      c.eventNote
                        ? `<p style="margin:10px 0 0;${P}font-size:14px;line-height:1.5;color:#F2661F;font-weight:700;">${rich(c.eventNote)}</p>`
                        : ''
                    }
                  </td>
                </tr>
                ${
                  c.registerCtaLabel
                    ? `<tr>
                  <td style="padding:10px 18px 18px;">
                    ${btn(registerUrl, c.registerCtaLabel, { bg: '#F2661F', full: true })}
                  </td>
                </tr>`
                    : ''
                }
              </table>`
    : '';

  const continuedCard =
    c.continuedTitle || c.continuedIntro
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;background-color:#ffffff;border:1px solid #E6E0D8;border-radius:8px;">
                <tr>
                  <td style="padding:18px 18px 8px;">
                    ${
                      c.continuedTitle
                        ? `<h3 style="margin:0 0 12px;${P}font-size:18px;line-height:1.35;color:#182752;font-weight:700;">${rich(c.continuedTitle)}</h3>`
                        : ''
                    }
                    ${
                      c.continuedIntro
                        ? `<p style="margin:0 0 12px;${P}font-size:14px;line-height:1.6;color:#243447;">${rich(c.continuedIntro)}</p>`
                        : ''
                    }
                    ${detailRow('When', c.continuedWhen)}
                    ${detailRow('Where', c.continuedWhere)}
                    ${
                      c.continuedNote
                        ? `<p style="margin:12px 0 0;${P}font-size:14px;line-height:1.5;color:#F2661F;font-weight:700;">${rich(c.continuedNote)}</p>`
                        : ''
                    }
                  </td>
                </tr>
                ${
                  c.continuedCtaUrl && c.continuedCtaLabel
                    ? `<tr>
                  <td style="padding:8px 18px 20px;">
                    ${btn(c.continuedCtaUrl, c.continuedCtaLabel, { bg: '#182752', full: true })}
                  </td>
                </tr>`
                    : ''
                }
              </table>`
      : '';

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="x-apple-disable-message-reformatting"/>
  <meta name="color-scheme" content="light only"/>
  <meta name="supported-color-schemes" content="light only"/>
  <title>${escapeHtml(c.headline)}</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td { font-family: Arial, Helvetica, sans-serif !important; }
  </style>
  <![endif]-->
  <style type="text/css">
    :root { color-scheme: light only; supported-color-schemes: light only; }
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; border-collapse: collapse !important; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; display: block; }
    a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
    @media only screen and (max-width: 620px) {
      .email-shell { width: 100% !important; }
      .email-pad { padding-left: 16px !important; padding-right: 16px !important; }
      .email-headline { font-size: 22px !important; line-height: 1.3 !important; }
      .email-btn a { display: block !important; width: 100% !important; text-align: center !important; box-sizing: border-box !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#EDE8E1;width:100%;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
    ${escapeHtml(c.preheader)}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#EDE8E1;width:100%;">
    <tr>
      <td align="center" style="padding:20px 10px;">
        <table role="presentation" class="email-shell" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #DDD5CA;">

          <!-- Brand bar -->
          <tr>
            <td bgcolor="#F7F4EF" style="background-color:#F7F4EF;padding:16px 24px;border-bottom:1px solid #E6E0D8;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" valign="middle">
                    <img src="${escapeHtml(logo)}" alt="CONTOUR NETWORK" width="160" height="43"
                      style="width:160px;max-width:55%;height:auto;display:block;border:0;${P}font-size:16px;font-weight:700;letter-spacing:1px;color:#182752;"/>
                  </td>
                  <td align="right" valign="middle">
                    <p style="margin:0;${P}font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:#182752;font-weight:700;">
                      Sibos 2026
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${
            showHero
              ? `<!-- Hero: Luma event cover -->
          <tr>
            <td bgcolor="#F4EDE4" style="padding:0;line-height:0;font-size:0;background-color:#F4EDE4;">
              <a href="${escapeHtml(registerUrl)}" style="display:block;">
                <img src="${escapeHtml(hero)}" alt="Opening Bell: Institutional Breakfast · Unlocking Velocity in Trade &amp; Payments · Sibos Miami 2026" width="600"
                  style="width:100%;max-width:600px;height:auto;display:block;border:0;${P}font-size:16px;line-height:1.4;font-weight:700;color:#182752;text-align:center;"/>
              </a>
            </td>
          </tr>`
              : ''
          }

          <!-- Navy strip -->
          <tr>
            <td bgcolor="#182752" class="email-pad" style="background-color:#182752;padding:22px 24px;">
              <p style="margin:0 0 8px;${P}font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:#F6C3A8;font-weight:700;">
                ${escapeHtml(c.eyebrow)}
              </p>
              <h1 class="email-headline" style="margin:0 0 8px;${P}font-size:24px;line-height:1.3;color:#ffffff;font-weight:700;">
                ${escapeHtml(c.headline)}
              </h1>
              <p style="margin:0 0 16px;${P}font-size:14px;line-height:1.55;color:#C9D3E8;">
                ${escapeHtml(c.subheadline)}
              </p>
              ${btn(registerUrl, c.registerCtaLabel || 'Register', { bg: '#F2661F' })}
            </td>
          </tr>

          <!-- Orange accent -->
          <tr>
            <td bgcolor="#F2661F" style="background-color:#F2661F;height:4px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <!-- Body -->
          <tr>
            <td class="email-pad" style="padding:26px 24px 8px;${P}font-size:15px;line-height:1.75;color:#243447;background-color:#ffffff;">
              ${
                c.greeting
                  ? `<p style="margin:0 0 16px;font-weight:600;color:#182752;">${rich(c.greeting)}</p>`
                  : ''
              }
              ${para(c.intro, '0 0 8px')}
              ${bullets(c.speakersText)}
              ${para(c.seatsText, '0 0 14px')}
              ${eventBox}
              ${para(c.audience)}
              ${para(c.discussionIntro, '0 0 8px')}
              ${bullets(c.topicsText)}
              ${
                c.questions
                  ? `<p style="margin:0;font-weight:700;color:#182752;">${rich(c.questions)}</p>`
                  : ''
              }
            </td>
          </tr>

          <!-- Continued conversation -->
          <tr>
            <td class="email-pad" style="padding:20px 24px 4px;background-color:#F7F4EF;">
              ${continuedCard}
              ${
                c.boothLine
                  ? `<p style="margin:0 0 18px;text-align:center;${P}font-size:14px;line-height:1.6;color:#182752;">${rich(c.boothLine)}</p>`
                  : ''
              }
            </td>
          </tr>

          <tr><td style="height:14px;font-size:0;line-height:0;background-color:#ffffff;">&nbsp;</td></tr>
          ${mediaHtml}

          <!-- Sign-off -->
          <tr>
            <td class="email-pad" style="padding:20px 24px 24px;${P}font-size:15px;line-height:1.75;color:#182752;background-color:#ffffff;">
              <p style="margin:0;">${signOffHtml}</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td bgcolor="#182752" style="background-color:#182752;padding:22px 24px;">
              <p style="margin:0 0 8px;text-align:center;${P}font-size:12px;color:#C9D3E8;font-weight:600;">
                ${escapeHtml(c.footerNote)}
              </p>
              <p style="margin:0;text-align:center;${P}font-size:12px;line-height:1.7;">
                <a href="https://www.contour.network" style="color:#F2661F;text-decoration:none;font-weight:700;">contour.network</a>
              </p>
              ${
                c.disclaimer
                  ? `<p style="margin:16px 0 0;padding-top:14px;border-top:1px solid #2C3C6B;${P}font-size:10.5px;line-height:1.6;color:#9AA7C4;text-align:left;">${linkify(c.disclaimer)}</p>`
                  : ''
              }
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = {
  buildContourBreakfastEmailHtml,
  defaultContourBreakfastContent,
  CONTOUR_BREAKFAST_SUBJECT,
};
