import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  logoUrl,
  getToken,
  getStoredUser,
  setSession,
  clearSession,
  getInviteTokenFromUrl,
} from './api';
import LoginScreen from './LoginScreen';

const DEFAULT_SUBJECT =
  'Meet XDC Network & Contour at Sibos 2026: Agentic Payments, Trade Finance & Real-Time Settlement';

const DEFAULT_CONTENT = {
  headline: 'Join XDC Network & Contour at Sibos 2026',
  location: 'Miami Beach Convention Center',
  dates: 'September 28 – October 1, 2026',
  booth: 'Booth #DISS 43',
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
  leadershipTitle: 'Connect with Leadership at Booth #DISS 43',
  cta: '',
  closing: '',
  signOff: 'Best regards,\nThe XDC Network & Contour Delegation',
  disclaimer:
    'Disclaimer: All banking, payment processing, card issuance, and regulated financial services are facilitated exclusively through appropriately authorized and licensed third-party financial institutions and partner entities in their respective jurisdictions. XDC Network is a decentralized enterprise blockchain protocol provider and does not directly provide banking, deposit-taking, or custodial financial services.',
  ctaEmail: 'support@xdcforpayments.org',
  ctaMailtoSubject: 'Sibos 2026 - Meeting Request (Booth #DISS 43)',
  ctaMailtoBody:
    'Hello,\n\nI would like to schedule a meeting with the XDC Network & Contour delegation at Sibos 2026 (Booth #DISS 43).\n\nPreferred times:\n\nThank you.',
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

/** Extract emails from paste/CSV text (handles email,email or column rows). */
function extractEmailsFromText(text) {
  const matches = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const seen = new Set();
  const out = [];
  for (const m of matches) {
    const e = m.toLowerCase();
    if (seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export default function App() {
  const [user, setUser] = useState(() => (getToken() ? getStoredUser() : null));
  const [authChecking, setAuthChecking] = useState(() => Boolean(getToken()));

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
  const [statusCounts, setStatusCounts] = useState({});
  const [historyPage, setHistoryPage] = useState(1);
  const HISTORY_PAGE_SIZE = 50;
  const [filterQ, setFilterQ] = useState('');
  const [filterStatus, setFilterStatus] = useState('pending');
  const [selected, setSelected] = useState(new Set());
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sendingSelected, setSendingSelected] = useState(false);
  const [autoSend, setAutoSend] = useState(null);
  const [autoSendBusy, setAutoSendBusy] = useState(false);

  const [newEvent, setNewEvent] = useState({ name: '', slug: '', location: '', dates: '' });

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLimit, setInviteLimit] = useState('');
  const [users, setUsers] = useState([]);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteLinkNotice, setInviteLinkNotice] = useState('');
  const [quota, setQuota] = useState(null);
  const [limitEdits, setLimitEdits] = useState({});

  const isSuperAdmin = user?.role === 'superadmin';
  const inviteToken = getInviteTokenFromUrl();

  const contentPayload = useMemo(
    () => ({
      ...content,
      solutions: parseSolutions(content.solutionsText),
      xdcLogoSrc: logoUrl('xdc.png'),
      contourLogoSrc: logoUrl('contour.png'),
    }),
    [content]
  );

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (!getToken()) {
        setAuthChecking(false);
        return;
      }
      try {
        const { user: me, quota: q } = await api.me();
        if (!cancelled) {
          setUser(me);
          setQuota(q || null);
          setSession(getToken(), me);
        }
      } catch {
        if (!cancelled) {
          clearSession();
          setUser(null);
        }
      } finally {
        if (!cancelled) setAuthChecking(false);
      }
    }
    check();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadBase = useCallback(async () => {
    if (!user) return;
    try {
      const [h, ev, tm] = await Promise.all([api.health(), api.events(), api.templates()]);
      setHealth(h);
      setEvents(ev);
      setTemplates(tm);
      if (tm[0]) {
        setTemplateId(tm[0].id);
        setEventId(tm[0].event_id);
      }
      if (ev[0] && !eventId) setEventId(ev[0].id);
    } catch (err) {
      if (/auth|session|Authentication/i.test(err.message)) {
        clearSession();
        setUser(null);
      }
      setError(err.message);
    }
  }, [eventId, user]);

  const loadUsers = useCallback(async () => {
    if (!isSuperAdmin) return;
    try {
      const data = await api.listUsers();
      setUsers(data.users || []);
    } catch (err) {
      setError(err.message);
    }
  }, [isSuperAdmin]);

  const refreshPreview = useCallback(async () => {
    if (!user) return;
    try {
      const { html } = await api.preview(contentPayload);
      setPreviewHtml(html);
    } catch (err) {
      setError(err.message);
    }
  }, [contentPayload, user]);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const params = {
        limit: HISTORY_PAGE_SIZE,
        offset: (historyPage - 1) * HISTORY_PAGE_SIZE,
      };
      if (filterQ) params.q = filterQ;
      if (filterStatus) params.status = filterStatus;
      const data = await api.sends(params);
      setSends(data.items);
      setSendsTotal(data.total);
      setStatusCounts(data.statusCounts || {});
      setSelected(new Set());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingHistory(false);
    }
  }, [filterQ, filterStatus, historyPage]);

  const historyPageCount = Math.max(1, Math.ceil(sendsTotal / HISTORY_PAGE_SIZE));

  const loadAutoSend = useCallback(async () => {
    try {
      const status = await api.autoSendStatus();
      setAutoSend(status);
    } catch (_) {
      /* ignore if route not deployed yet */
    }
  }, []);

  useEffect(() => {
    setHistoryPage(1);
  }, [filterQ, filterStatus]);

  useEffect(() => {
    if (user) loadBase();
  }, [loadBase, user]);

  useEffect(() => {
    if (user) refreshPreview();
  }, [refreshPreview, user]);

  useEffect(() => {
    if (user && tab === 'history') {
      loadHistory();
      loadAutoSend();
    }
  }, [tab, loadHistory, loadAutoSend, user]);

  useEffect(() => {
    if (!(user && tab === 'history')) return undefined;
    const id = setInterval(() => {
      loadAutoSend();
      loadHistory();
    }, 20000);
    return () => clearInterval(id);
  }, [user, tab, loadAutoSend, loadHistory]);

  useEffect(() => {
    if (user && tab === 'admins' && isSuperAdmin) loadUsers();
  }, [tab, loadUsers, user, isSuperAdmin]);

  async function handleAutoSendToggle() {
    setAutoSendBusy(true);
    setError('');
    try {
      const res = autoSend?.enabled ? await api.autoSendStop() : await api.autoSendStart();
      setAutoSend(res);
      setNotice(res.message || (res.enabled ? 'Auto-send started' : 'Auto-send stopped'));
      loadHistory();
    } catch (err) {
      setError(err.message);
    } finally {
      setAutoSendBusy(false);
    }
  }
  function updateField(key, value) {
    setContent((c) => ({ ...c, [key]: value }));
  }

  function logout() {
    clearSession();
    setUser(null);
    setError('');
    setNotice('');
  }

  async function handleInvite(e) {
    e.preventDefault();
    setInviteBusy(true);
    setError('');
    setNotice('');
    setInviteLinkNotice('');
    try {
      const res = await api.inviteUser(inviteEmail.trim(), inviteLimit);
      setNotice(res.message || `Invite created for ${inviteEmail.trim()}`);
      if (res.inviteLink) setInviteLinkNotice(res.inviteLink);
      setInviteEmail('');
      loadUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setInviteBusy(false);
    }
  }

  async function handleSaveLimit(id) {
    setError('');
    try {
      const raw = limitEdits[id];
      const email_send_limit = raw === '' || raw == null ? null : Number(raw);
      await api.updateUser(id, { email_send_limit });
      setNotice('Send limit updated');
      loadUsers();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeactivate(id) {
    setError('');
    try {
      await api.deactivateUser(id);
      setNotice('Admin deactivated');
      loadUsers();
    } catch (err) {
      setError(err.message);
    }
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
      // Pending History rows store their own html copy — keep them in sync
      const sync = await api.syncPending({
        subject,
        html_body: html,
        template_id: templateId,
      });
      setNotice(
        `Template saved. Updated ${sync.updated || 0} pending History row(s) to match.`
      );
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

      const count = recipientCount(recipients);
      const result = await api.send({
        recipients,
        subject,
        html_body: html,
        template_id: templateId,
        event_id: eventId,
        broadcast: count > 1,
      });
      setSendResult(result);
      const mode = result.broadcast ? 'broadcast' : 'send';
      setNotice(
        `Campaign #${result.campaignId} (${mode}${result.provider ? ` · ${result.provider}` : ''}): ${result.success} sent, ${result.failure} failed.`
      );
      if (result.quota) setQuota(result.quota);
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

  async function handleSendSelected() {
    if (selected.size === 0) return;
    setError('');
    setSendingSelected(true);
    try {
      const result = await api.sendSelected([...selected]);
      setNotice(
        `Sent ${result.success}/${selected.size}` +
          (result.failure ? `, ${result.failure} failed` : '') +
          (result.provider ? ` · ${result.provider}` : '')
      );
      if (result.quota) setQuota(result.quota);
      setSelected(new Set());
      loadHistory();
    } catch (err) {
      setError(err.message);
    } finally {
      setSendingSelected(false);
    }
  }

  async function handleBulkResend() {
    if (selected.size === 0) return;
    setError('');
    setSendingSelected(true);
    try {
      const result = await api.resendBulk([...selected]);
      const ok = result.results.filter((r) => r.status === 'sent').length;
      setNotice(`Resent ${ok}/${selected.size}`);
      setSelected(new Set());
      loadHistory();
    } catch (err) {
      setError(err.message);
    } finally {
      setSendingSelected(false);
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

  function toggleSelectAllPage() {
    const ids = sends.map((s) => s.id);
    const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
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

  if (authChecking) {
    return (
      <div className="app auth-app">
        <div className="auth-card">
          <p className="eyebrow">XDC Outreach</p>
          <h1>Checking session…</h1>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginScreen
        inviteToken={inviteToken}
        onAuthenticated={(u, q) => {
          setUser(u);
          setQuota(q || null);
        }}
      />
    );
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
          <span className="pill user-pill" title={user.email}>
            {isSuperAdmin ? 'Superadmin' : 'Admin'} · {user.email}
          </span>
          {quota?.limited && (
            <span className="pill">
              Sends left: {quota.remaining}/{quota.limit}
            </span>
          )}
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
            {isSuperAdmin && (
              <button className={tab === 'admins' ? 'active' : ''} onClick={() => setTab('admins')}>
                Invite Admins
              </button>
            )}
          </nav>
          <button type="button" className="ghost logout-btn" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      {(error || notice) && (
        <div className="banners">
          {error && <div className="banner error">{error}</div>}
          {notice && <div className="banner ok">{notice}</div>}
        </div>
      )}

      {tab === 'admins' && isSuperAdmin && (
        <main className="panel invite-panel">
          <div className="panel-head">
            <h2>Invite admins</h2>
            <p>
              Only invited emails can access. They set a password from the invite link, then sign
              in. You can cap how many outreach emails each admin may send.
            </p>
          </div>

          <form className="invite-form" onSubmit={handleInvite}>
            <label>
              Admin email
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@xinfin.org"
              />
            </label>
            <label>
              Email send limit
              <input
                type="number"
                min="0"
                step="1"
                value={inviteLimit}
                onChange={(e) => setInviteLimit(e.target.value)}
                placeholder="e.g. 100 (blank = unlimited)"
              />
            </label>
            <p className="hint">Leave blank for unlimited. Counts successful sends only.</p>
            <button type="submit" className="primary" disabled={inviteBusy}>
              {inviteBusy ? 'Creating invite…' : 'Invite admin'}
            </button>
          </form>

          {inviteLinkNotice && (
            <div className="banner ok invite-link-box">
              <strong>Invite link</strong> (share if email delivery fails):
              <br />
              <code>{inviteLinkNotice}</code>
              <button
                type="button"
                className="ghost"
                onClick={() => navigator.clipboard?.writeText(inviteLinkNotice)}
              >
                Copy link
              </button>
            </div>
          )}

          <div className="users-table-wrap">
            <h3>People with access</h3>
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Sent / Limit</th>
                  <th>Last login</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td>{u.role}</td>
                    <td>
                      {!u.active
                        ? 'Inactive'
                        : u.pending_invite
                          ? 'Pending invite'
                          : u.has_password
                            ? 'Active'
                            : 'Needs password'}
                    </td>
                    <td>
                      {u.role === 'superadmin' ? (
                        'Unlimited'
                      ) : (
                        <div className="limit-edit">
                          <span>{u.emails_sent ?? 0} / </span>
                          <input
                            type="number"
                            min="0"
                            className="limit-input"
                            placeholder="∞"
                            value={
                              limitEdits[u.id] !== undefined
                                ? limitEdits[u.id]
                                : u.email_send_limit ?? ''
                            }
                            onChange={(e) =>
                              setLimitEdits((prev) => ({ ...prev, [u.id]: e.target.value }))
                            }
                          />
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => handleSaveLimit(u.id)}
                          >
                            Save
                          </button>
                        </div>
                      )}
                    </td>
                    <td>{formatTime(u.last_login_at)}</td>
                    <td>
                      {u.role !== 'superadmin' && u.active && (
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => handleDeactivate(u.id)}
                        >
                          Deactivate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </main>
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
                  placeholder="support@xdcforpayments.org"
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
              Recipients{' '}
              <span className="hint">(comma, semicolon, newline, or CSV — upload below)</span>
              <textarea
                rows={6}
                placeholder="alice@bank.com, bob@corp.com&#10;or paste a column of emails from Excel…"
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
              />
            </label>
            <div className="actions" style={{ marginTop: 8, gap: 12, flexWrap: 'wrap' }}>
              <label className="ghost" style={{ cursor: 'pointer', display: 'inline-block' }}>
                Upload CSV / TXT
                <input
                  type="file"
                  accept=".csv,.txt,.tsv,text/csv,text/plain"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      const emails = extractEmailsFromText(String(reader.result || ''));
                      if (emails.length === 0) {
                        setError('No email addresses found in that file.');
                        return;
                      }
                      setError('');
                      setRecipients((prev) => {
                        const merged = extractEmailsFromText(`${prev}\n${emails.join('\n')}`);
                        return merged.join('\n');
                      });
                      setNotice(`Loaded ${emails.length} email(s) from ${file.name}.`);
                    };
                    reader.onerror = () => setError('Could not read file.');
                    reader.readAsText(file);
                  }}
                />
              </label>
              <button
                type="button"
                className="ghost"
                disabled={!recipients.trim()}
                onClick={() => {
                  const emails = extractEmailsFromText(recipients);
                  setRecipients(emails.join('\n'));
                  setNotice(`Normalized to ${emails.length} unique recipient(s).`);
                }}
              >
                Clean / dedupe list
              </button>
            </div>
            <p className="meta-line">
              {recipientCount(recipients)} recipient(s)
              {recipientCount(recipients) > 1
                ? ' · will send via Postmark broadcast/bulk'
                : ''}
            </p>

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
                {sending
                  ? `Sending to ${recipientCount(recipients)}…`
                  : recipientCount(recipients) > 1
                    ? `Broadcast to ${recipientCount(recipients)}`
                    : `Send to ${recipientCount(recipients) || '…'}`}
              </button>
            </div>

            {sendResult && (
              <div className="result-card">
                <h3>Last send</h3>
                <p>
                  Status: <strong>{sendResult.status}</strong> · success {sendResult.success} ·
                  failed {sendResult.failure}
                  {sendResult.broadcast ? ' · broadcast' : ''}
                  {sendResult.provider ? ` · ${sendResult.provider}` : ''}
                </p>
                {sendResult.bulkIds?.length > 0 && (
                  <p className="meta-line">Bulk ID(s): {sendResult.bulkIds.join(', ')}</p>
                )}
                {sendResult.invalidCount > 0 && (
                  <p className="warn">
                    Invalid skipped: {sendResult.invalidCount}
                    {sendResult.invalid?.length
                      ? ` (e.g. ${sendResult.invalid.slice(0, 5).join(', ')})`
                      : ''}
                  </p>
                )}
                {sendResult.resultsTruncated && (
                  <p className="meta-line">Showing a sample of results — full list is in History.</p>
                )}
                <ul>
                  {sendResult.results?.slice(0, 100).map((r) => (
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
              <h2>Send queue</h2>
              <p>
                {sendsTotal} shown filter · pending {statusCounts.pending || 0} · sent{' '}
                {statusCounts.sent || 0} · failed {statusCounts.failed || 0}
              </p>
            </div>
            <div className="filters">
              <input
                placeholder="Search email…"
                value={filterQ}
                onChange={(e) => setFilterQ(e.target.value)}
              />
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="">All statuses</option>
                <option value="pending">Pending</option>
                <option value="sending">Sending</option>
                <option value="sent">Sent</option>
                <option value="failed">Failed</option>
              </select>
              <button className="ghost" onClick={loadHistory} disabled={loadingHistory}>
                {loadingHistory ? 'Loading…' : 'Refresh'}
              </button>
              <button
                className={autoSend?.enabled ? 'danger' : 'primary'}
                disabled={autoSendBusy}
                onClick={handleAutoSendToggle}
                title="Send next 20 pending emails every minute, in ID order"
              >
                {autoSendBusy
                  ? '…'
                  : autoSend?.enabled
                    ? 'Stop auto-send (20/min)'
                    : 'Start auto-send (20/min)'}
              </button>
              <button
                className="primary"
                disabled={selected.size === 0 || sendingSelected}
                onClick={handleSendSelected}
              >
                {sendingSelected
                  ? `Sending ${selected.size}…`
                  : `Send selected (${selected.size})`}
              </button>
              <button
                className="ghost"
                disabled={selected.size === 0 || sendingSelected}
                onClick={handleBulkResend}
                title="Creates new send rows (for already-sent / failed)"
              >
                Resend selected
              </button>
            </div>
          </div>

          {autoSend && (
            <p className={`auto-send-banner ${autoSend.enabled ? 'on' : 'off'}`}>
              Auto-send:{' '}
              <strong>{autoSend.enabled ? 'RUNNING' : 'stopped'}</strong>
              {' · '}
              {autoSend.batchSize}/min
              {' · '}
              pending {autoSend.pending ?? '—'}
              {autoSend.enabled && autoSend.etaMinutes != null
                ? ` · ~${autoSend.etaMinutes} min left`
                : ''}
              {autoSend.lastTick?.at
                ? ` · last batch: ${autoSend.lastTick.success ?? 0} sent / ${autoSend.lastTick.failure ?? 0} failed`
                : ''}
              {autoSend.lastError ? ` · error: ${autoSend.lastError}` : ''}
            </p>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      title="Select all on this page"
                      checked={sends.length > 0 && sends.every((s) => selected.has(s.id))}
                      onChange={toggleSelectAllPage}
                    />
                  </th>
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
                      {s.status === 'pending' ? (
                        <button
                          className="ghost small"
                          disabled={sendingSelected}
                          onClick={async () => {
                            setSelected(new Set([s.id]));
                            setSendingSelected(true);
                            setError('');
                            try {
                              const result = await api.sendSelected([s.id]);
                              setNotice(
                                result.success
                                  ? `Sent ${s.recipient_email}`
                                  : `Failed: ${result.results?.[0]?.error || 'error'}`
                              );
                              loadHistory();
                            } catch (err) {
                              setError(err.message);
                            } finally {
                              setSendingSelected(false);
                            }
                          }}
                        >
                          Send
                        </button>
                      ) : (
                        <button className="ghost small" onClick={() => handleResend(s.id)}>
                          Resend
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {sends.length === 0 && (
                  <tr>
                    <td colSpan={8} className="empty">
                      No rows for this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <button
              className="ghost"
              disabled={historyPage <= 1 || loadingHistory}
              onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
            >
              ← Prev
            </button>
            <span className="meta-line">
              Page {historyPage} of {historyPageCount} · {HISTORY_PAGE_SIZE} / page
            </span>
            <button
              className="ghost"
              disabled={historyPage >= historyPageCount || loadingHistory}
              onClick={() => setHistoryPage((p) => p + 1)}
            >
              Next →
            </button>
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
