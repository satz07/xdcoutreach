/**
 * Sibos / event invitation HTML email — mobile-safe tables + solid XDC colors.
 * Logos via CID (cid:xdc-logo / cid:contour-logo) or preview URLs.
 *
 * XDC theme: Navy #15294C · Blue #254C82 · Accent #416BAA · Light #F4F7FB
 */
function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Meeting CTA link.
 * - mailto: best for mobile (opens Gmail / Apple Mail app)
 * - gmail: browser Gmail compose (desktop / web)
 */
function buildMeetingLink({ email, subject, body, type = 'mailto' }) {
  const to = (email || 'santosh@xinfin.org').trim();
  const su = subject || '';
  const bd = body || '';

  if (type === 'gmail') {
    const params = [
      'view=cm',
      'fs=1',
      'tf=1',
      `to=${encodeURIComponent(to)}`,
    ];
    if (su) params.push(`su=${encodeURIComponent(su)}`);
    if (bd) params.push(`body=${encodeURIComponent(bd)}`);
    return `https://mail.google.com/mail/?${params.join('&')}`;
  }

  const parts = [];
  if (su) parts.push(`subject=${encodeURIComponent(su)}`);
  if (bd) parts.push(`body=${encodeURIComponent(bd)}`);
  return `mailto:${to}${parts.length ? `?${parts.join('&')}` : ''}`;
}

function buildMailto(opts) {
  return buildMeetingLink({ ...opts, type: 'mailto' });
}

function parseSolutions(solutions) {
  if (Array.isArray(solutions) && solutions.length) {
    return solutions
      .map((s) => {
        if (typeof s === 'string') {
          const idx = s.indexOf(':');
          if (idx > 0) {
            return { title: s.slice(0, idx).trim(), body: s.slice(idx + 1).trim() };
          }
          return { title: s.trim(), body: '' };
        }
        return { title: s.title || '', body: s.body || '' };
      })
      .filter((s) => s.title);
  }
  return [];
}

function logoPairRows(xdcLogoSrc, contourLogoSrc, { xdcW = 150, contourW = 130 } = {}) {
  // Equal-width cells so Contour never collapses on narrow screens
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center" valign="middle" width="50%" style="width:50%;padding:8px 6px;text-align:center;">
          <img src="${xdcLogoSrc}" alt="XDC Network" width="${xdcW}" height="53"
            style="width:${xdcW}px;max-width:100%;height:auto;display:block;margin:0 auto;border:0;outline:none;text-decoration:none;"/>
        </td>
        <td align="center" valign="middle" width="50%" style="width:50%;padding:8px 6px;text-align:center;border-left:1px solid #C5D0DE;">
          <img src="${contourLogoSrc}" alt="Contour" width="${contourW}" height="35"
            style="width:${contourW}px;max-width:100%;height:auto;display:block;margin:0 auto;border:0;outline:none;text-decoration:none;"/>
        </td>
      </tr>
    </table>`;
}

function buildSibosEmailHtml(overrides = {}) {
  const {
    headline = 'Join XDC Network & Contour at Sibos 2026',
    location = 'Miami Beach Convention Center',
    dates = 'September 28 – October 1, 2026',
    booth = 'Booth #DISS 43',
    greeting = 'Dear Partner,',
    intro = `As financial institutions prepare for an AI-driven economy, infrastructure must move beyond faster processing to autonomous execution, programmable liquidity, and compliant digital settlement.`,
    showcase = `At Sibos 2026, XDC Network and Contour are showcasing how institutions can unify enterprise Layer 1 blockchain rails with digitized trade and dollar-stable settlement to power modern commercial finance and the emerging agentic economy.`,
    solutionsTitle = 'Core Solutions & Product Lineup',
    solutions = [
      {
        title: 'Instant Domestic & Cross-Border Settlement',
        body: 'Native USDC on XDC delivers sub-second finality and near-zero transaction fees for corporate treasury, institutional transfers, and multi-corridor remittances.',
      },
      {
        title: 'Everyday & Corporate Cards',
        body: 'Instant card top-ups using native USDC on XDC for virtual and physical debit spending worldwide.',
      },
      {
        title: 'Global Payouts & QR Retail Rails',
        body: 'Seamless disbursement routing to over 70 jurisdictions, alongside local merchant QR code point-of-sale settlement.',
      },
      {
        title: 'Digitized Trade Finance (Contour)',
        body: 'Fully paperless Letters of Credit (LCs), electronic documentation, and milestone-based smart contract settlement integrated with ISO 20022 messaging.',
      },
      {
        title: 'Autonomous Agentic Commerce (XDC AI)',
        body: 'Native HTTP 402 (x402) payment rails and gasless smart accounts enabling autonomous AI agents to initiate, reconcile, and settle expenses, compute, and API services compliantly.',
      },
    ],
    leadershipTitle = 'Connect with Leadership at Booth #DISS 43',
    cta = '',
    closing = '',
    signOff = 'Best regards,\nThe XDC Network & Contour Delegation',
    disclaimer = `Disclaimer: All banking, payment processing, card issuance, and regulated financial services are facilitated exclusively through appropriately authorized and licensed third-party financial institutions and partner entities in their respective jurisdictions. XDC Network is a decentralized enterprise blockchain protocol provider and does not directly provide banking, deposit-taking, or custodial financial services.`,
    ctaEmail = 'santosh@xinfin.org',
    ctaMailtoSubject = 'Sibos 2026 - Meeting Request (Booth #DISS 43)',
    ctaMailtoBody =
      'Hello,\n\nI would like to schedule a meeting with the XDC Network & Contour delegation at Sibos 2026 (Booth #DISS 43).\n\nPreferred times:\n\nThank you.',
    // mailto works on mobile Gmail/Apple Mail; gmail web URL often fails in mail apps
    ctaLinkType = 'mailto',
    ctaUrl,
    ctaLabel = 'Schedule a Meeting',
    footerNote = 'XDC Network & Contour · Sibos 2026 · Booth #DISS 43',
    xdcLogoSrc = 'cid:xdc-logo',
    contourLogoSrc = 'cid:contour-logo',
    topics,
  } = overrides;

  const meetingHref =
    ctaUrl ||
    buildMeetingLink({
      email: ctaEmail,
      subject: ctaMailtoSubject,
      body: ctaMailtoBody,
      type: ctaLinkType === 'gmail' ? 'gmail' : 'mailto',
    });

  let solutionItems = parseSolutions(solutions);
  if (!solutionItems.length && Array.isArray(topics)) {
    solutionItems = parseSolutions(topics);
  }

  const solutionRows = solutionItems
    .map(
      (s, i) => `
      <tr>
        <td style="padding:14px 0;vertical-align:top;border-bottom:1px solid #E2EAF2;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="vertical-align:top;width:36px;padding-top:1px;">
                <span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;border-radius:50%;background-color:#254C82;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;color:#ffffff;">
                  ${i + 1}
                </span>
              </td>
              <td style="padding-left:10px;vertical-align:top;">
                <p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.4;color:#15294C;font-weight:700;">
                  ${escapeHtml(s.title)}
                </p>
                ${
                  s.body
                    ? `<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.65;color:#3A4A5C;">${escapeHtml(s.body)}</p>`
                    : ''
                }
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    )
    .join('');

  const signOffHtml = escapeHtml(signOff)
    .split('\n')
    .map((line) => line || '&nbsp;')
    .join('<br/>');

  const headerLogos = logoPairRows(xdcLogoSrc, contourLogoSrc, { xdcW: 156, contourW: 136 });
  const footerLogos = logoPairRows(xdcLogoSrc, contourLogoSrc, { xdcW: 140, contourW: 120 });

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="x-apple-disable-message-reformatting"/>
  <meta name="color-scheme" content="light only"/>
  <meta name="supported-color-schemes" content="light only"/>
  <title>${escapeHtml(headline)}</title>
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
<body style="margin:0;padding:0;background-color:#E8EEF6;width:100%;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
    Meet XDC Network &amp; Contour at Sibos 2026 — Booth #DISS 43, Miami Beach.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#E8EEF6;width:100%;">
    <tr>
      <td align="center" style="padding:20px 10px;">
        <table role="presentation" class="email-shell" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #D5E0EE;">

          <!-- Logo bar -->
          <tr>
            <td bgcolor="#F4F7FB" style="background-color:#F4F7FB;padding:18px 16px;border-bottom:1px solid #D5E0EE;">
              ${headerLogos}
            </td>
          </tr>

          <!-- Headline — solid navy (no gradient; mobile-safe) -->
          <tr>
            <td bgcolor="#15294C" class="email-pad" style="background-color:#15294C;padding:26px 24px;">
              <p style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:#8EB4E0;font-weight:700;">
                Sibos 2026 · ${escapeHtml(booth)}
              </p>
              <h1 class="email-headline" style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:1.3;color:#ffffff;font-weight:700;">
                ${escapeHtml(headline)}
              </h1>
              <p style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#C5D6EC;">
                ${escapeHtml(location)}
              </p>
              <p style="margin:6px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#C5D6EC;">
                ${escapeHtml(dates)}&nbsp;&nbsp;·&nbsp;&nbsp;${escapeHtml(booth)}
              </p>
            </td>
          </tr>

          <!-- Accent bar — solid brand blue -->
          <tr>
            <td bgcolor="#254C82" style="background-color:#254C82;height:4px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <!-- Body -->
          <tr>
            <td class="email-pad" style="padding:24px 24px 6px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.75;color:#243447;background-color:#ffffff;">
              <p style="margin:0 0 16px;font-weight:600;color:#15294C;">${escapeHtml(greeting)}</p>
              <p style="margin:0 0 16px;">${escapeHtml(intro)}</p>
              <p style="margin:0;">${escapeHtml(showcase)}</p>
            </td>
          </tr>

          <!-- Solutions -->
          <tr>
            <td class="email-pad" style="padding:20px 16px 8px;background-color:#ffffff;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F7FB;border:1px solid #D5E0EE;">
                <tr>
                  <td style="padding:20px 16px 6px;">
                    <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:#15294C;font-weight:700;">
                      ${escapeHtml(solutionsTitle)}
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:4px 14px 12px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      ${solutionRows}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td class="email-pad" style="padding:22px 24px 8px;background-color:#ffffff;">
              <p style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:#254C82;font-weight:700;">
                ${escapeHtml(leadershipTitle)}
              </p>
              ${
                cta
                  ? `<p style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.75;color:#243447;">${escapeHtml(cta)}</p>`
                  : '<div style="height:10px;line-height:10px;font-size:10px;">&nbsp;</div>'
              }
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="email-btn" style="width:100%;max-width:320px;">
                <tr>
                  <td align="center" bgcolor="#254C82" style="background-color:#254C82;border-radius:6px;">
                    <a href="${escapeHtml(meetingHref)}"
                      style="display:inline-block;padding:14px 24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:6px;width:100%;box-sizing:border-box;text-align:center;">
                      ${escapeHtml(ctaLabel)}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Closing -->
          <tr>
            <td class="email-pad" style="padding:18px 24px 8px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.75;color:#243447;background-color:#ffffff;">
              ${closing ? `<p style="margin:0 0 18px;">${escapeHtml(closing)}</p>` : ''}
              <p style="margin:0;color:#15294C;">${signOffHtml}</p>
            </td>
          </tr>

          <!-- Partner strip — same logos as header, equal columns -->
          <tr>
            <td class="email-pad" style="padding:24px 16px 0;background-color:#ffffff;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #E2EAF2;">
                <tr>
                  <td style="padding:20px 0 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F7FB;border:1px solid #D5E0EE;">
                      <tr>
                        <td align="center" style="padding:16px 10px 8px;">
                          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:#416BAA;font-weight:700;">
                            Powered by
                          </p>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:4px 8px 16px;">
                          ${footerLogos}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Disclaimer -->
          <tr>
            <td class="email-pad" style="padding:20px 24px 28px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.65;color:#7A8B9C;background-color:#ffffff;">
              <p style="margin:0 0 16px;border-top:1px solid #E2EAF2;padding-top:18px;">
                ${escapeHtml(disclaimer)}
              </p>
              <p style="margin:0;text-align:center;color:#15294C;font-weight:600;font-size:12px;">${escapeHtml(footerNote)}</p>
              <p style="margin:10px 0 0;text-align:center;font-size:12px;">
                <a href="https://xinfin.org" style="color:#254C82;text-decoration:none;">xinfin.org</a>
                &nbsp;·&nbsp;
                <a href="https://www.contour.network" style="color:#254C82;text-decoration:none;">contour.network</a>
              </p>
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
  buildSibosEmailHtml,
  buildMeetingLink,
  buildMailto,
  escapeHtml,
  parseSolutions,
};
