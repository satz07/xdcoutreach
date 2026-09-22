import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, logoUrl } from './api';

const DEFAULT_SUBJECT =
  'Meet XDC Network & Contour at Sibos 2026 (Booth #DIS 43): Real-Time Settlement, Trade Finance & Agentic Payments';

const DEFAULT_CONTENT = {
  headline: 'Join XDC Network & Contour at Sibos 2026',
  location: 'Miami Beach Convention Center',
  dates: 'September 28 – October 1, 2026',
  booth: 'Booth #DIS 43',
  greeting: 'Dear Partner,',
  intro:
    'As financial institutions prepare for an AI-driven economy, infrastructure must move beyond faster processing to autonomous execution, programmable liquidity, and compliant digital settlement.',
  showcase:
    'At Sibos 2026, XDC Network and Contour are showcasing how institutions can unify enterprise Layer 1 blockchain rails with digitized trade and dollar-stable settlement to power modern commercial finance and the emerging agentic economy.',
  solutionsTitle: 'Core Solutions & Product Lineup',
  solutionsText: [
    'Instant Domestic & Cross-Border Settlement: Native USDC on XDC delivers sub-second finality and near-zero transaction fees for corporate treasury, institutional transfers, and multi-corridor remittances.',
    'Everyday & Corporate Cards: Instant card top-ups using native USDC on XDC for virtual and physical debit spending worldwide.',
    'Global Payouts & QR Retail Rails: Seamless disbursement routing to over 70 jurisdictions, alongside local merchant QR code point-of-sale settlement.',
    'Digitized Trade Finance (Contour): Fully paperless Letters of Credit (LCs), electronic documentation, and milestone-based smart contract settlement integrated with ISO 20022 messaging.',
    'Autonomous Agentic Commerce (XDC AI): Native HTTP 402 (x402) payment rails and gasless smart accounts enabling autonomous AI agents to initiate, reconcile, and settle expenses, compute, and API services compliantly.',
  ].join('\n'),
  leadershipTitle: 'Connect with Leadership at Booth #DIS 43',
  cta: 'Visit us at Booth #DIS 43 or schedule a dedicated 1-on-1 session with our executive delegation to explore institutional pilots, banking integrations, and liquidity partnership opportunities.',
  closing: 'We look forward to meeting you at Booth #DIS 43 in Miami Beach!',
  signOff: 'Best regards,\nThe XDC Network & Contour Delegation',
  disclaimer:
    'Disclaimer: All banking, payment processing, card issuance, and regulated financial services are facilitated exclusively through appropriately authorized and licensed third-party financial institutions and partner entities in their respective jurisdictions. XDC Network and Contour provide technology infrastructure and do not themselves offer regulated banking or payment services.',
  ctaEmail: 'santosh@xinfin.org',
  ctaMailtoSubject: 'Sibos 2026 - Meeting Request (Booth #DIS 43)',
  ctaMailtoBody:
    'Hello,\n\nI would like to schedule a meeting with the XDC Network & Contour delegation at Sibos 2026 (Booth #DIS 43).\n\nPreferred times:\n\nThank you.',
  ctaLinkType: 'mailto',
  ctaLabel: 'Schedule a Meeting',
};

function parseSolutions(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf(':');
      if (idx > 0) {
        return { title: line.slice(0, idx).trim(), body: line.slice(idx + 1).trim() };
      }
      return { title: line, body: '' };
    });
}

function recipientCount(raw) {
  return String(raw || '')
    .split(/[,;\n]+/)
    .map((e) => e.trim())
    .filter(Boolean).length;
}

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export default function App() {
  const [tab, setTab] = useState('compose');
  const [health, setHealth] = useState(null);
  const [events, setEvents] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState(null);
  const [eventId, setEventId] = useState(null);

  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [content, setContent] = useState(DEFAULT_CONTENT);
  const [recipients, setRecipients] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendResult, setSendResult] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [sends, setSends] = useState([]);
  const [sendsTotal, setSendsTotal] = useState(0);
  const [filterQ, setFilterQ] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [newEvent, setNewEvent] = useState({ name: '', slug: '', location: '', dates: '' });

  const contentPayload = useMemo(
    () => ({
      ...content,
      solutions: parseSolutions(content.solutionsText),
      xdcLogoSrc: logoUrl('xdc.png'),
      contourLogoSrc: logoUrl('contour.png'),
    }),
    [content]
  );

  const loadBase = useCallback(async () => {
    try {
      const [h, ev, tm] = await Promise.all([api.health(), api.events(), api.templates()]);
      setHealth(h);
      setEvents(ev);
      setTemplates(tm);
      if (tm[0]) {
        setTemplateId(tm[0].id);
        setEventId(tm[0].event_id);
        // Keep editor on the latest compose defaults; DB holds last saved HTML for sends
      }
      if (ev[0] && !eventId) setEventId(ev[0].id);
    } catch (err) {
      setError(err.message);
    }
  }, [eventId]);

  const refreshPreview = useCallback(async () => {
    try {
      const { html } = await api.preview(contentPayload);
      setPreviewHtml(html);
    } catch (err) {
      setError(err.message);
    }
  }, [contentPayload]);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const params = { limit: 100 };
      if (filterQ) params.q = filterQ;
      if (filterStatus) params.status = filterStatus;
      const data = await api.sends(params);
      setSends(data.items);
      setSendsTotal(data.total);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingHistory(false);
    }
  }, [filterQ, filterStatus]);

  useEffect(() => {
    loadBase();
  }, [loadBase]);

  useEffect(() => {
    refreshPreview();
  }, [refreshPreview]);

  useEffect(() => {
    if (tab === 'history') loadHistory();
  }, [tab, loadHistory]);

  function updateField(key, value) {
    setContent((c) => ({ ...c, [key]: value }));
  }

  async function saveTemplate() {
    if (!templateId) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { html } = await api.preview({
        ...contentPayload,
        xdcLogoSrc: 'cid:xdc-logo',
        contourLogoSrc: 'cid:contour-logo',
      });
      await api.updateTemplate(templateId, {
        subject,
        html_body: html,
        rebuildDefault: false,
        name: content.headline.slice(0, 80),
      });
      setNotice('Template saved. Future sends will use this content.');
      const tm = await api.templates();
      setTemplates(tm);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSend() {
    setSending(true);
    setError('');
    setSendResult(null);
    setNotice('');
    try {
      const { html } = await api.preview({
        ...contentPayload,
        xdcLogoSrc: 'cid:xdc-logo',
        contourLogoSrc: 'cid:contour-logo',
      });

      // Persist latest edits before send
      if (templateId) {
        await api.updateTemplate(templateId, {
          subject,
          html_body: html,
          name: content.headline.slice(0, 80),
        });
      }

      const result = await api.send({
        recipients,
        subject,
        html_body: html,
        template_id: templateId,
        event_id: eventId,
      });
      setSendResult(result);
      setNotice(
        `Campaign #${result.campaignId}: ${result.success} sent, ${result.failure} failed.`
      );
      if (tab !== 'history') {
        // keep compose; user can switch
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function handleResend(id) {
    setError('');
    try {
      await api.resend(id);
      setNotice(`Resent #${id}`);
      loadHistory();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleBulkResend() {
    if (selected.size === 0) return;
    setError('');
    try {
      const result = await api.resendBulk([...selected]);
      const ok = result.results.filter((r) => r.status === 'sent').length;
      setNotice(`Resent ${ok}/${selected.size}`);
      setSelected(new Set());
      loadHistory();
    } catch (err) {
      setError(err.message);
    }
  }

  async function createEvent(e) {
    e.preventDefault();
    setError('');
    try {
      const slug =
        newEvent.slug ||
        newEvent.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '');
      const ev = await api.createEvent({ ...newEvent, slug });
      setEvents((prev) => [ev, ...prev]);
      setEventId(ev.id);
      setNewEvent({ name: '', slug: '', location: '', dates: '' });
      setNotice(`Event "${ev.name}" created. Create/update a template and send.`);
    } catch (err) {
      setError(err.message);
    }
  }

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-logos">
            <img src={logoUrl('xdc.png')} alt="XDC Network" className="brand-xdc" />
            <img src={logoUrl('contour.png')} alt="Contour" className="brand-contour" />
          </div>
          <div>
            <p className="eyebrow">Event Outreach</p>
            <h1>Email Agent</h1>
          </div>
        </div>
        <div className="topbar-meta">
          <span className={`pill ${health?.ok ? 'ok' : 'bad'}`}>
            {health?.ok ? 'DB connected' : 'DB offline'}
          </span>
          <nav className="tabs">
            <button className={tab === 'compose' ? 'active' : ''} onClick={() => setTab('compose')}>
              Compose & Send
            </button>
            <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
              Send History
            </button>
            <button className={tab === 'events' ? 'active' : ''} onClick={() => setTab('events')}>
              Events
            </button>
          </nav>
        </div>
      </header>

      {(error || notice) && (
        <div className="banners">
          {error && <div className="banner error">{error}</div>}
          {notice && <div className="banner ok">{notice}</div>}
        </div>
      )}

      {tab === 'compose' && (
        <main className="layout">
          <section className="panel editor">
            <div className="panel-head">
              <h2>Message</h2>
              <p>Edit the invitation, then send to any number of recipients.</p>
            </div>

            <label>
              Event
              <select
                value={eventId || ''}
                onChange={(e) => setEventId(Number(e.target.value) || null)}
              >
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Subject
              <input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </label>

            <label>
              Headline
              <input
                value={content.headline}
                onChange={(e) => updateField('headline', e.target.value)}
              />
            </label>

            <div className="row-2">
              <label>
                Location
                <input
                  value={content.location}
                  onChange={(e) => updateField('location', e.target.value)}
                />
              </label>
              <label>
                Dates
                <input
                  value={content.dates}
                  onChange={(e) => updateField('dates', e.target.value)}
                />
              </label>
            </div>

            <label>
              Booth
              <input
                value={content.booth}
                onChange={(e) => updateField('booth', e.target.value)}
              />
            </label>

            <label>
              Greeting
              <input
                value={content.greeting}
                onChange={(e) => updateField('greeting', e.target.value)}
              />
            </label>

            <label>
              Intro
              <textarea
                rows={3}
                value={content.intro}
                onChange={(e) => updateField('intro', e.target.value)}
              />
            </label>

            <label>
              Showcase paragraph
              <textarea
                rows={4}
                value={content.showcase}
                onChange={(e) => updateField('showcase', e.target.value)}
              />
            </label>

            <label>
              Solutions section title
              <input
                value={content.solutionsTitle}
                onChange={(e) => updateField('solutionsTitle', e.target.value)}
              />
            </label>

            <label>
              Solutions <span className="hint">(one per line — Title: description)</span>
              <textarea
                rows={8}
                value={content.solutionsText}
                onChange={(e) => updateField('solutionsText', e.target.value)}
              />
            </label>

            <label>
              Leadership section title
              <input
                value={content.leadershipTitle}
                onChange={(e) => updateField('leadershipTitle', e.target.value)}
              />
            </label>

            <label>
              Meeting / booth CTA text
              <textarea
                rows={3}
                value={content.cta}
                onChange={(e) => updateField('cta', e.target.value)}
              />
            </label>

            <div className="row-2">
              <label>
                CTA button label
                <input
                  value={content.ctaLabel}
                  onChange={(e) => updateField('ctaLabel', e.target.value)}
                />
              </label>
              <label>
                Schedule meeting email (To)
                <input
                  type="email"
                  placeholder="santosh@xinfin.org"
                  value={content.ctaEmail}
                  onChange={(e) => updateField('ctaEmail', e.target.value)}
                />
              </label>
            </div>

              <label>
              Open meeting link in
              <select
                value={content.ctaLinkType}
                onChange={(e) => updateField('ctaLinkType', e.target.value)}
              >
                <option value="mailto">Mail / Gmail app (best on mobile)</option>
                <option value="gmail">Gmail website (desktop browser)</option>
              </select>
            </label>

            <label>
              Meeting email subject
              <input
                value={content.ctaMailtoSubject}
                onChange={(e) => updateField('ctaMailtoSubject', e.target.value)}
              />
            </label>

            <label>
              Meeting email body
              <textarea
                rows={5}
                value={content.ctaMailtoBody}
                onChange={(e) => updateField('ctaMailtoBody', e.target.value)}
              />
            </label>

            <label>
              Closing line
              <input
                value={content.closing}
                onChange={(e) => updateField('closing', e.target.value)}
              />
            </label>

            <label>
              Sign-off
              <textarea
                rows={2}
                value={content.signOff}
                onChange={(e) => updateField('signOff', e.target.value)}
              />
            </label>

            <label>
              Disclaimer
              <textarea
                rows={3}
                value={content.disclaimer}
                onChange={(e) => updateField('disclaimer', e.target.value)}
              />
            </label>

            <label>
              Recipients <span className="hint">(comma, semicolon, or new-line separated)</span>
              <textarea
                rows={4}
                placeholder="alice@bank.com, bob@corp.com, ..."
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
              />
            </label>
            <p className="meta-line">{recipientCount(recipients)} recipient(s)</p>

            <div className="actions">
              <button type="button" className="ghost" onClick={refreshPreview}>
                Refresh preview
              </button>
              <button type="button" className="ghost" disabled={saving} onClick={saveTemplate}>
                {saving ? 'Saving…' : 'Save template'}
              </button>
              <button
                type="button"
                className="primary"
                disabled={sending || recipientCount(recipients) === 0}
                onClick={handleSend}
              >
                {sending ? 'Sending…' : `Send to ${recipientCount(recipients) || '…'}`}
              </button>
            </div>

            {sendResult && (
              <div className="result-card">
                <h3>Last send</h3>
                <p>
                  Status: <strong>{sendResult.status}</strong> · success {sendResult.success} ·
                  failed {sendResult.failure}
                </p>
                {sendResult.invalid?.length > 0 && (
                  <p className="warn">Invalid skipped: {sendResult.invalid.join(', ')}</p>
                )}
                <ul>
                  {sendResult.results?.map((r) => (
                    <li key={r.email} className={r.status}>
                      {r.email} — {r.status}
                      {r.error ? `: ${r.error}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="panel preview">
            <div className="panel-head">
              <h2>Live preview</h2>
              <p>Approximate inbox rendering with XDC & Contour logos.</p>
            </div>
            <div className="preview-frame" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </section>
        </main>
      )}

      {tab === 'history' && (
        <main className="history">
          <div className="panel-head row">
            <div>
              <h2>Send history</h2>
              <p>{sendsTotal} records · Postgres-backed audit log</p>
            </div>
            <div className="filters">
              <input
                placeholder="Search email…"
                value={filterQ}
                onChange={(e) => setFilterQ(e.target.value)}
              />
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="">All statuses</option>
                <option value="sent">Sent</option>
                <option value="failed">Failed</option>
                <option value="pending">Pending</option>
              </select>
              <button className="ghost" onClick={loadHistory} disabled={loadingHistory}>
                {loadingHistory ? 'Loading…' : 'Refresh'}
              </button>
              <button
                className="primary"
                disabled={selected.size === 0}
                onClick={handleBulkResend}
              >
                Resend selected ({selected.size})
              </button>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>ID</th>
                  <th>Recipient</th>
                  <th>Subject</th>
                  <th>Status</th>
                  <th>Sent at</th>
                  <th>Error</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sends.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(s.id)}
                        onChange={() => toggleSelect(s.id)}
                      />
                    </td>
                    <td>{s.id}</td>
                    <td>{s.recipient_email}</td>
                    <td className="ellipsis">{s.subject}</td>
                    <td>
                      <span className={`status ${s.status}`}>{s.status}</span>
                    </td>
                    <td>{formatTime(s.sent_at || s.created_at)}</td>
                    <td className="ellipsis muted">{s.error_message || '—'}</td>
                    <td>
                      <button className="ghost small" onClick={() => handleResend(s.id)}>
                        Resend
                      </button>
                    </td>
                  </tr>
                ))}
                {sends.length === 0 && (
                  <tr>
                    <td colSpan={8} className="empty">
                      No sends yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </main>
      )}

      {tab === 'events' && (
        <main className="events">
          <section className="panel">
            <div className="panel-head">
              <h2>Events</h2>
              <p>Reuse this app for Sibos and future conferences.</p>
            </div>
            <ul className="event-list">
              {events.map((ev) => (
                <li key={ev.id}>
                  <strong>{ev.name}</strong>
                  <span>
                    {ev.location || '—'} · {ev.dates || '—'}
                  </span>
                  <code>{ev.slug}</code>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Add event</h2>
            </div>
            <form className="event-form" onSubmit={createEvent}>
              <label>
                Name
                <input
                  required
                  value={newEvent.name}
                  onChange={(e) => setNewEvent({ ...newEvent, name: e.target.value })}
                />
              </label>
              <label>
                Slug (optional)
                <input
                  placeholder="auto-from-name"
                  value={newEvent.slug}
                  onChange={(e) => setNewEvent({ ...newEvent, slug: e.target.value })}
                />
              </label>
              <label>
                Location
                <input
                  value={newEvent.location}
                  onChange={(e) => setNewEvent({ ...newEvent, location: e.target.value })}
                />
              </label>
              <label>
                Dates
                <input
                  value={newEvent.dates}
                  onChange={(e) => setNewEvent({ ...newEvent, dates: e.target.value })}
                />
              </label>
              <button className="primary" type="submit">
                Create event
              </button>
            </form>
            <p className="hint-block">
              After creating an event, open Compose, select it, edit the message, save the template,
              and send. Templates are stored in Postgres with full send history for audit/resend.
            </p>
          </section>
        </main>
      )}
    </div>
  );
}
