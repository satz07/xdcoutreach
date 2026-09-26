/**
 * Contour Network @ Sibos Miami 2026 — invitation email.
 * Brand: Navy #182752 · Orange #F2661F · Cream #F7F4EF · Ink #1A2332
 * Contour logo: same CID asset as Sibos 2026 email (public/logos/contour.png → cid:contour-logo).
 * Other assets served from /events/contour-sibos/ (public URLs via APP_URL).
 * "Book a meeting" → Calendly (https://calendly.com/rahul-contour).
 */

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resolveAssetBase(override) {
  if (override) return String(override).replace(/\/$/, '');
  const base = (process.env.APP_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
  return base ? `${base}/events/contour-sibos` : '/events/contour-sibos';
}

function btn(href, label, { bg = '#F2661F', color = '#ffffff', full = false } = {}) {
  const width = full ? 'width:100%;box-sizing:border-box;' : '';
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="email-btn" style="${full ? 'width:100%;' : ''}">
      <tr>
        <td align="center" bgcolor="${bg}" style="background-color:${bg};border-radius:6px;">
          <a href="${escapeHtml(href)}"
            style="display:inline-block;padding:12px 22px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:${color};text-decoration:none;border-radius:6px;${width}text-align:center;">
            ${escapeHtml(label)}
          </a>
        </td>
      </tr>
    </table>`;
}

function buildContourSibosEmailHtml(overrides = {}) {
  const assetBase = resolveAssetBase(overrides.assetBase);
  const img = (name) => `${assetBase}/${name}`;

  const {
    headline = 'Meet Contour at Sibos Miami',
    location = 'Miami Beach Convention Center',
    dates = 'September 28 – October 1, 2026',
    booth = 'Booth #DISS43',
    greeting = '',
    intro = `There is rising global momentum behind unlocking the velocity of transactions as they flow from the business/trade transaction to payment settlement and supply chain activation. Contour has supported its members as a best practice standard for trade finance digitisation since 2021, with proven impact to supply chain velocity and working capital gains.`,
    upgrades = `Latest upgrades to the platform include AI-assistance for document conversion and data validation against rulebooks, TradeTrust and GLEIF, as well as integrated payments settlements including stablecoin use cases.`,
    whitelabel = `Contour offers all these services on a whitelabeled basis as well.`,
    enterpriseServices = `Enterprise Services - Firms can also opt to separately use just the Agentic AI services or Payments Settlement services, including stablecoin and interbank settlements to enhance their Treasury and Payments portfolio.`,
    programIntro = `We have carefully curated our Sibos program to fully engage with the Sibos community on the future of trade to payments`,
    boothTitle = 'Meet us at the Contour Booth DISS43',
    boothWhen = 'Sept 28 – October 01, 2026',
    boothWhere = 'Head over to our booth in the Discover Zone, or feel free to request for a meeting',
    boothTime = '',
    boothBody = 'Schedule a private meeting with a Contour Network professional to discuss what’s next for your organization.',
    boothCtaLabel = 'Book a meeting',
    boothCtaUrl = 'https://calendly.com/rahul-contour',
    /** Set false/empty to hide booth photo (date/location already on banner). */
    showBoothImage = false,
    breakfastTitle = 'Industry networking breakfast and Experts Panel',
    breakfastTheme = '',
    breakfastWhen = 'September 29, 2026',
    breakfastTime = '7:30 AM – 9:30 AM EDT',
    breakfastWhere = '',
    breakfastWho = 'You are invited to join us for a refined breakfast, curated networking, and an interactive panel, followed by time for continued conversations before guests return to Sibos Day 2. The panel has industry leaders from SAP, Accenture, Eastnets and GLEIF, moderated by Contour',
    breakfastNote = 'Reserve your place early! Seats are limited!',
    breakfastCtaLabel = 'Reserve your place',
    breakfastCtaUrl = 'https://luma.com/lwtff9cg',
    discoverTitle = 'Discovery Stage Showcase: Contour',
    discoverTheme = '',
    discoverWhen = 'October 01, 2026',
    discoverTime = '9:30 AM – 10:30 AM EDT',
    discoverWhere = 'Discover Stage, Sibos Miami 2026 | Session Code: DS 33',
    discoverWho = 'Presented by: Rahul Bhargava, Interim COO, Contour Network',
    discoverCtaLabel = 'Register your place',
    discoverCtaUrl = 'https://luma.com/tnotpk0e',
    closing = 'Thank you and we look forward to meeting you at Sibos!',
    signOff = 'Regards,\nThe Contour Network Team',
    footerNote = 'Contour Network · Sibos Miami 2026 · Booth #DISS43',
    bannerSrc,
    logoSrc,
    /** Same Contour mark as Sibos 2026 email (cid or preview URL). */
    contourLogoSrc = 'cid:contour-logo',
    boothImgSrc,
    breakfastImgSrc,
    discoverImgSrc,
    preheader = 'Meet Contour at Sibos Miami — Booth DISS43 · Breakfast panel · Discover Stage',
  } = overrides;

  const banner = bannerSrc || img('banner.jpg');
  // Prefer Sibos Contour logo (CID /logos/contour.png); legacy logoSrc still honored
  const logo = logoSrc || contourLogoSrc || 'cid:contour-logo';
  const boothImg = boothImgSrc || img('booth.jpg');
  const breakfastImg = breakfastImgSrc || img('breakfast.jpg');
  const discoverImg = discoverImgSrc || img('discover-stage.jpg');

  const meetingHref = boothCtaUrl || 'https://calendly.com/rahul-contour';

  const signOffHtml = escapeHtml(signOff)
    .split('\n')
    .map((line) => line || '&nbsp;')
    .join('<br/>');

  const programCard = ({ image, title, when, time, where, speaker, note, ctaUrl, ctaLabel }) => `
    <tr>
      <td style="padding:0 0 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border:1px solid #E6E0D8;border-radius:8px;overflow:hidden;">
          ${
            image
              ? `<tr>
            <td>
              <img src="${escapeHtml(image)}" alt="" width="552"
                style="width:100%;max-width:552px;height:auto;display:block;border:0;"/>
            </td>
          </tr>`
              : ''
          }
          <tr>
            <td style="padding:18px 18px 8px;">
              <h3 style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:1.35;color:#182752;font-weight:700;">
                ${escapeHtml(title)}
              </h3>
              ${
                speaker
                  ? `<p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#182752;">${escapeHtml(speaker)}</p>`
                  : ''
              }
              ${
                when
                  ? `<p style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#4A5568;"><strong style="color:#182752;">When:</strong> ${escapeHtml(when)}</p>`
                  : ''
              }
              ${
                time
                  ? `<p style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#4A5568;"><strong style="color:#182752;">Time:</strong> ${escapeHtml(time)}</p>`
                  : ''
              }
              ${
                where
                  ? `<p style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#4A5568;"><strong style="color:#182752;">Where:</strong> ${escapeHtml(where)}</p>`
                  : ''
              }
              ${
                note
                  ? `<p style="margin:12px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#F2661F;font-weight:700;">${escapeHtml(note)}</p>`
                  : ''
              }
            </td>
          </tr>
          <tr>
            <td style="padding:8px 18px 20px;">
              ${btn(ctaUrl, ctaLabel, { bg: '#182752', full: true })}
            </td>
          </tr>
        </table>
      </td>
    </tr>`;

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
<body style="margin:0;padding:0;background-color:#EDE8E1;width:100%;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
    ${escapeHtml(preheader)}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#EDE8E1;width:100%;">
    <tr>
      <td align="center" style="padding:20px 10px;">
        <table role="presentation" class="email-shell" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #DDD5CA;">

          <!-- Brand bar — light so Contour logo (dark mark) stays readable -->
          <tr>
            <td bgcolor="#F7F4EF" style="background-color:#F7F4EF;padding:16px 24px;border-bottom:1px solid #E6E0D8;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" valign="middle">
                    <img src="${escapeHtml(logo)}" alt="Contour Network" width="160"
                      style="width:160px;max-width:55%;height:auto;display:block;border:0;"/>
                  </td>
                  <td align="right" valign="middle">
                    <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:#182752;font-weight:700;">
                      Sibos 2026
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Banner -->
          <tr>
            <td style="padding:0;line-height:0;font-size:0;">
              <img src="${escapeHtml(banner)}" alt="Sibos Miami skyline" width="600"
                style="width:100%;max-width:600px;height:auto;display:block;border:0;"/>
            </td>
          </tr>

          <!-- Banner CTA strip -->
          <tr>
            <td bgcolor="#182752" class="email-pad" style="background-color:#182752;padding:22px 24px;">
              <p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:#F6C3A8;font-weight:700;">
                ${escapeHtml(booth)} · ${escapeHtml(dates)}
              </p>
              <h1 class="email-headline" style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:1.3;color:#ffffff;font-weight:700;">
                ${escapeHtml(headline)}
              </h1>
              <p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#C9D3E8;">
                ${escapeHtml(location)}
              </p>
              ${btn(meetingHref, boothCtaLabel, { bg: '#F2661F', full: false })}
            </td>
          </tr>

          <!-- Orange accent -->
          <tr>
            <td bgcolor="#F2661F" style="background-color:#F2661F;height:4px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <!-- Intro -->
          <tr>
            <td class="email-pad" style="padding:26px 24px 8px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.75;color:#243447;background-color:#ffffff;">
              ${
                greeting
                  ? `<p style="margin:0 0 16px;font-weight:600;color:#182752;">${escapeHtml(greeting)}</p>`
                  : ''
              }
              <p style="margin:0 0 16px;">${escapeHtml(intro)}</p>
              <p style="margin:0 0 16px;">${escapeHtml(upgrades)}</p>
              ${
                whitelabel
                  ? `<p style="margin:0 0 16px;">${escapeHtml(whitelabel)}</p>`
                  : ''
              }
              ${
                enterpriseServices
                  ? `<p style="margin:0;">${escapeHtml(enterpriseServices)}</p>`
                  : ''
              }
            </td>
          </tr>

          <!-- Program intro -->
          <tr>
            <td class="email-pad" style="padding:22px 24px 6px;background-color:#ffffff;">
              <p style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:#F2661F;font-weight:700;">
                Our Sibos program
              </p>
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:#243447;">
                ${escapeHtml(programIntro)}
              </p>
            </td>
          </tr>

          <!-- Program cards -->
          <tr>
            <td class="email-pad" style="padding:16px 24px 4px;background-color:#F7F4EF;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                ${programCard({
                  image: showBoothImage === false || showBoothImage === 'false' ? '' : boothImg,
                  title: boothTitle,
                  when: '',
                  time: '',
                  where: boothWhere,
                  speaker: '',
                  note: '',
                  ctaUrl: meetingHref,
                  ctaLabel: boothCtaLabel,
                })}
                ${programCard({
                  image: breakfastImg,
                  title: breakfastTitle,
                  when: '',
                  time: '',
                  where: breakfastWhere,
                  speaker: breakfastWho,
                  note: breakfastNote,
                  ctaUrl: breakfastCtaUrl,
                  ctaLabel: breakfastCtaLabel,
                })}
                ${programCard({
                  image: discoverImg,
                  title: discoverTitle,
                  when: '',
                  time: '',
                  where: discoverWhere,
                  speaker: discoverWho,
                  note: '',
                  ctaUrl: discoverCtaUrl,
                  ctaLabel: discoverCtaLabel,
                })}
              </table>
            </td>
          </tr>

          <!-- Closing -->
          <tr>
            <td class="email-pad" style="padding:24px 24px 8px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.75;color:#243447;background-color:#ffffff;">
              <p style="margin:0 0 18px;">${escapeHtml(closing)}</p>
              <p style="margin:0;color:#182752;">${signOffHtml}</p>
            </td>
          </tr>

          <!-- Footer — text only, no logo (avoids wrong/oversized CID images) -->
          <tr>
            <td bgcolor="#182752" style="background-color:#182752;padding:22px 24px;">
              <p style="margin:0 0 8px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#C9D3E8;font-weight:600;">
                ${escapeHtml(footerNote)}
              </p>
              <p style="margin:0;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.7;">
                <a href="https://www.contour.network" style="color:#F2661F;text-decoration:none;font-weight:700;">contour.network</a>
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

/** Default structured content for Compose / seeding */
function defaultContourSibosContent() {
  return {
    templateKind: 'contour-sibos',
    headline: 'Meet Contour at Sibos Miami',
    location: 'Miami Beach Convention Center',
    dates: 'September 28 – October 1, 2026',
    booth: 'Booth #DISS43',
    greeting: '',
    intro:
      'There is rising global momentum behind unlocking the velocity of transactions as they flow from the business/trade transaction to payment settlement and supply chain activation. Contour has supported its members as a best practice standard for trade finance digitisation since 2021, with proven impact to supply chain velocity and working capital gains.',
    upgrades:
      'Latest upgrades to the platform include AI-assistance for document conversion and data validation against rulebooks, TradeTrust and GLEIF, as well as integrated payments settlements including stablecoin use cases.',
    whitelabel: 'Contour offers all these services on a whitelabeled basis as well.',
    enterpriseServices:
      'Enterprise Services - Firms can also opt to separately use just the Agentic AI services or Payments Settlement services, including stablecoin and interbank settlements to enhance their Treasury and Payments portfolio.',
    programIntro:
      'We have carefully curated our Sibos program to fully engage with the Sibos community on the future of trade to payments',
    boothTitle: 'Meet us at the Contour Booth DISS43',
    boothWhen: '',
    boothWhere:
      'Head over to our booth in the Discover Zone, or feel free to request for a meeting',
    boothTime: '',
    boothBody:
      'Schedule a private meeting with a Contour Network professional to discuss what’s next for your organization.',
    boothCtaLabel: 'Book a meeting',
    boothCtaUrl: 'https://calendly.com/rahul-contour',
    showBoothImage: false,
    breakfastTitle: 'Industry networking breakfast and Experts Panel',
    breakfastTheme: '',
    breakfastWhen: 'September 29, 2026',
    breakfastTime: '7:30 AM – 9:30 AM EDT',
    breakfastWhere: '',
    breakfastWho:
      'You are invited to join us for a refined breakfast, curated networking, and an interactive panel, followed by time for continued conversations before guests return to Sibos Day 2. The panel has industry leaders from SAP, Accenture, Eastnets and GLEIF, moderated by Contour',
    breakfastNote: 'Reserve your place early! Seats are limited!',
    breakfastCtaLabel: 'Reserve your place',
    breakfastCtaUrl: 'https://luma.com/lwtff9cg',
    discoverTitle: 'Discovery Stage Showcase: Contour',
    discoverTheme: '',
    discoverWhen: 'October 01, 2026',
    discoverTime: '9:30 AM – 10:30 AM EDT',
    discoverWhere: 'Discover Stage, Sibos Miami 2026 | Session Code: DS 33',
    discoverWho: 'Presented by: Rahul Bhargava, Interim COO, Contour Network',
    discoverCtaLabel: 'Register your place',
    discoverCtaUrl: 'https://luma.com/tnotpk0e',
    closing: 'Thank you and we look forward to meeting you at Sibos!',
    signOff: 'Regards,\nThe Contour Network Team',
    footerNote: 'Contour Network · Sibos Miami 2026 · Booth #DISS43',
  };
}

const CONTOUR_SIBOS_SUBJECT =
  'Meet Contour at Sibos Miami — Booth DISS43 · Breakfast panel · Discover Stage';

module.exports = {
  buildContourSibosEmailHtml,
  defaultContourSibosContent,
  CONTOUR_SIBOS_SUBJECT,
  escapeHtml,
  resolveAssetBase,
};
