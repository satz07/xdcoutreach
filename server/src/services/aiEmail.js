const { pool } = require('../db/pool');
const { claude, addUsage, emptyUsage } = require('./llm');
const { htmlToText } = require('./mailer');
const { getProviderForEvent } = require('./mailProviders');
const { buildPersonalEmailHtml } = require('../templates/personalEmail');
const { isInternalDomain } = require('./aiResearch');

/** Event context the writer is allowed to use: details, the live template's text, and its links. */
async function getEventBrief(eventId) {
  const { rows: evRows } = await pool.query('SELECT * FROM events WHERE id = $1', [eventId]);
  const event = evRows[0];
  if (!event) throw new Error('Event not found');

  const { rows: tplRows } = await pool.query(
    `SELECT * FROM email_templates WHERE event_id = $1
     ORDER BY is_default DESC, updated_at DESC LIMIT 1`,
    [eventId]
  );
  const tpl = tplRows[0];
  const html = tpl?.html_body || '';
  const provider = await getProviderForEvent(eventId).catch(() => null);

  const links = [];
  const seen = new Set();
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1].replace(/&amp;/g, '&');
    if (href.includes('{{') || /privacy|unsubscribe|^cid:/i.test(href) || seen.has(href)) continue;
    const label = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    seen.add(href);
    links.push({ label: label.slice(0, 80) || href, url: href });
    if (links.length >= 12) break;
  }

  const kind = tpl?.content_json?.templateKind || '';
  const brand =
    /contour/i.test(kind) || /contour/i.test(provider?.from_email || '') ? 'contour' : 'xdc';

  return {
    event,
    brand,
    subject: tpl?.subject || '',
    text: htmlToText(html).slice(0, 5000),
    links,
    fromName: provider?.from_name || null,
    fromEmail: provider?.from_email || null,
  };
}

const EMAIL_TOOL = {
  name: 'write_email',
  description: 'Return the personalized email.',
  input_schema: {
    type: 'object',
    properties: {
      subject: { type: 'string', description: 'Max ~70 characters, specific, no emoji' },
      preheader: { type: 'string', description: 'Inbox preview line, max ~90 characters' },
      greeting: { type: 'string', description: 'e.g. "Dear Satheesh,"' },
      paragraphs: { type: 'array', items: { type: 'string' }, description: '2-4 short paragraphs' },
      cta_label: { type: 'string' },
      cta_url: { type: 'string', description: 'Must be exactly one of the provided event links' },
      closing: { type: 'string', description: 'One short closing line' },
      signature: { type: 'string', description: 'Sign-off lines separated by \\n, taken from the event email' },
      claims: {
        type: 'array',
        description: 'Every company-specific statement used in the email and the source URL backing it',
        items: {
          type: 'object',
          properties: { claim: { type: 'string' }, source_url: { type: 'string' } },
          required: ['claim', 'source_url'],
        },
      },
    },
    required: ['subject', 'greeting', 'paragraphs', 'signature', 'claims'],
  },
};

async function writePersonalizedEmail({ profile, recipient, brief, instructions }) {
  const usage = emptyUsage();
  const internal = isInternalDomain(recipient.domain || recipient.email.split('@')[1]);
  const system = [
    `You write short, personal B2B invitation emails on behalf of ${brief.fromName || 'the events team'}.`,
    'Style: warm, plain business English, like a person writing one email to one contact. 80-120 words in the body, 3 short paragraphs, short sentences.',
    'Paragraph 1: open with one specific, factual observation about the PERSON (their role, a talk, podcast, article or post) if the profile has one; otherwise about their company. Connect it to why we are reaching out. No flattery words (impressive, amazing, admire, caught our attention).',
    'Only use facts listed in personalization_hooks or person. Never use anything mentioned in gaps, and never use figures or deals that came from a single aggregator listing.',
    internal
      ? 'The recipient works at our own organisation or a sister company. Write as a colleague-to-colleague note (e.g. a heads-up on the booth plan and an ask to drop by or bring contacts), not a sales invitation. Do not explain our own company to them.'
      : '',
    'Paragraph 2: why this particular event/session is relevant to them, using only details from the event brief.',
    'Include the key practical detail (date, place) once. Use exactly one call to action whose URL is one of the provided event links.',
    'If research confidence is below 0.5 or there are no hooks, stay general about their industry instead of inventing specifics.',
    'If our records show prior invites or a meeting request, acknowledge it naturally in one clause.',
    'Never mention research, AI, or "I saw on your website". No emoji, no exclamation marks, no hype words, no "I hope this email finds you well".',
    'Use the sign-off (team / company) from the event brief.',
  ].filter(Boolean).join('\n');

  const content = [
    `RECIPIENT: ${recipient.name || ''} <${recipient.email}>, company: ${recipient.company || profile.company_name || ''}`,
    '',
    `RESEARCH PROFILE (JSON):\n${JSON.stringify(profile, null, 2)}`,
    '',
    `EVENT: ${brief.event.name} · ${brief.event.dates || ''} · ${brief.event.location || ''}`,
    `CURRENT EVENT EMAIL SUBJECT: ${brief.subject}`,
    `EVENT EMAIL TEXT (source of truth for event facts and sign-off):\n${brief.text}`,
    '',
    `ALLOWED LINKS:\n${brief.links.map((l) => `- ${l.label}: ${l.url}`).join('\n') || '(none)'}`,
    instructions ? `\nEXTRA INSTRUCTIONS FROM OUR TEAM:\n${instructions}` : '',
  ].join('\n');

  const resp = await claude({
    system,
    messages: [{ role: 'user', content }],
    tools: [EMAIL_TOOL],
    toolChoice: { type: 'tool', name: 'write_email' },
    maxTokens: 2000,
  });
  addUsage(usage, resp.usage);
  const out = resp.content?.find((b) => b.type === 'tool_use')?.input;
  if (!out) throw new Error('Writer returned no email');

  const unescape = (s) => (typeof s === 'string' ? s.replace(/\\n/g, '\n').trim() : s);
  for (const k of ['greeting', 'closing', 'signature', 'subject', 'preheader']) out[k] = unescape(out[k]);
  out.paragraphs = (out.paragraphs || []).map(unescape).filter(Boolean);

  const allowed = new Set(brief.links.map((l) => l.url));
  if (out.cta_url && !allowed.has(out.cta_url)) {
    out.cta_url_rejected = out.cta_url;
    out.cta_url = '';
    out.cta_label = '';
  }

  const orgName = brief.brand === 'contour' ? 'Contour Network' : 'XDC Network';
  const html = buildPersonalEmailHtml({
    subject: out.subject,
    preheader: out.preheader,
    greeting: out.greeting,
    paragraphs: out.paragraphs || [],
    ctaLabel: out.cta_label,
    ctaUrl: out.cta_url,
    closing: out.closing,
    signature: out.signature,
    footerNote: `You are receiving this as a professional contact of ${orgName}. Reply "unsubscribe" and we will not email you again.`,
    brand: brief.brand,
  });

  return { email: { ...out, html, text: htmlToText(html) }, usage };
}

module.exports = { getEventBrief, writePersonalizedEmail };
