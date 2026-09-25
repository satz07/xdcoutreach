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
      if (idx === -1) return { title: line, body: '' };
      return { title: line.slice(0, idx).trim(), body: line.slice(idx + 1).trim() };
    });
}

function solutionsToText(solutions) {
  if (!Array.isArray(solutions)) return '';
  return solutions
    .map((s) => (s.body ? `${s.title}: ${s.body}` : s.title || ''))
    .filter(Boolean)
    .join('\n');
}

/** Hydrate editor fields from a saved template (+ optional event metadata) */
function hydrateFromTemplate(tpl, event) {
  let cj = tpl?.content_json;
  if (typeof cj === 'string') {
    try {
      cj = JSON.parse(cj);
    } catch {
      cj = null;
    }
  }
  if (cj && typeof cj === 'object') {
    const solutionsText =
      cj.solutionsText ||
      solutionsToText(cj.solutions) ||
      DEFAULT_CONTENT.solutionsText;
    return {
      subject: tpl.subject || DEFAULT_SUBJECT,
      content: { ...DEFAULT_CONTENT, ...cj, solutionsText },
    };
  }
  return {
    subject: tpl?.subject || DEFAULT_SUBJECT,
    content: {
      ...DEFAULT_CONTENT,
      headline: event
        ? `Join XDC Network & Contour at ${event.name}`
        : DEFAULT_CONTENT.headline,
      location: event?.location || DEFAULT_CONTENT.location,
      dates: event?.dates || DEFAULT_CONTENT.dates,
    },
  };
}

function extractEmailsFromText(text) {
  const re = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const found = String(text || '').match(re) || [];
  const seen = new Set();
  const out = [];
  for (const e of found) {
    const email = e.toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

function recipientCount(text) {
  return extractEmailsFromText(text).length;
}

function formatTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
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
  const [sendingVerified, setSendingVerified] = useState(false);
  const [autoSend, setAutoSend] = useState(null);
  const [autoSendBusy, setAutoSendBusy] = useState(false);

  const [participants, setParticipants] = useState([]);
  const [participantsTotal, setParticipantsTotal] = useState(0);
  const [participantEmail, setParticipantEmail] = useState('');
  const [participantBusy, setParticipantBusy] = useState(false);
  const [participantPaste, setParticipantPaste] = useState('');

  const [newEvent, setNewEvent] = useState({
    name: '',
    slug: '',
    location: '',
    dates: '',
    mail_provider_id: '',
  });
  const [mailProviders, setMailProviders] = useState([]);
  const [newSmtp, setNewSmtp] = useState({
    name: '',
    slug: '',
    from_email: '',
    smtp_host: 'smtp.sendgrid.net',
    smtp_port: '587',
    smtp_user: '',
    smtp_pass: '',
    notes: '',
  });
  const [smtpBusy, setSmtpBusy] = useState(false);

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

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === eventId) || null,
    [events, eventId]
  );

  const loadBase = useCallback(async () => {
    if (!user) return;
    try {
      const [h, ev, providers] = await Promise.all([
        api.health(),
        api.events(),
        api.mailProviders().catch(() => []),
      ]);
      setHealth(h);
      setEvents(ev);
      setMailProviders(providers || []);
      setNewEvent((prev) => {
        if (prev.mail_provider_id) return prev;
        const sendgrid = (providers || []).find((p) => p.slug === 'sendgrid-contour');
        const fallback = sendgrid || (providers || []).find((p) => p.type === 'smtp') || providers?.[0];
        return { ...prev, mail_provider_id: fallback ? String(fallback.id) : '' };
      });
      setEventId((prev) => {
        if (prev && ev.some((e) => e.id === prev)) return prev;
        return ev[0]?.id || null;
      });
    } catch (err) {
      if (/auth|session|Authentication/i.test(err.message)) {
        clearSession();
        setUser(null);
      }
      setError(err.message);
    }
  }, [user]);

  const loadParticipants = useCallback(async () => {
    if (!eventId || !user) return;
    try {
      const data = await api.participants(eventId, { limit: 2000 });
      setParticipants(data.items || []);
      setParticipantsTotal(data.total || 0);
    } catch (err) {
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
    if (!eventId) return;
    setLoadingHistory(true);
    try {
      const params = {
        limit: HISTORY_PAGE_SIZE,
        offset: (historyPage - 1) * HISTORY_PAGE_SIZE,
        eventId,
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
  }, [filterQ, filterStatus, historyPage, eventId]);

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
  }, [filterQ, filterStatus, eventId]);

  useEffect(() => {
    if (user) loadBase();
  }, [loadBase, user]);

  useEffect(() => {
    if (!(user && eventId)) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const tm = await api.templates(eventId);
        if (cancelled) return;
        setTemplates(tm);
        const tpl = tm[0] || null;
        setTemplateId(tpl?.id || null);
        const event = events.find((e) => e.id === eventId);
        const hydrated = hydrateFromTemplate(tpl, event);
        setSubject(hydrated.subject);
        setContent(hydrated.content);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only re-hydrate when the selected event changes (not when events list refreshes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, eventId]);
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
    if (user && tab === 'participants' && eventId) loadParticipants();
  }, [tab, eventId, loadParticipants, user]);

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
      const res = autoSend?.enabled
        ? await api.autoSendStop()
        : await api.autoSendStart(eventId);
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
      const contentForSave = {
        ...contentPayload,
        solutions: parseSolutions(content.solutionsText),
      };
      const { html } = await api.preview(contentForSave);
      await api.updateTemplate(templateId, {
        subject,
        html_body: html,
        rebuildDefault: false,
        name: content.headline.slice(0, 80),
        content: contentForSave,
      });
      const sync = await api.syncPending({
        subject,
        html_body: html,
        template_id: templateId,
        event_id: eventId,
      });
      setNotice(
        `Template saved for ${selectedEvent?.name || 'event'}. Updated ${sync.updated || 0} pending row(s).`
      );
      const tm = await api.templates(eventId);
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
        `Broadcast ${result.success}/${selected.size}` +
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

  /** Transactional 1-by-1; marks sent only after Postmark Activity confirms */
  async function handleSendVerifiedSelected() {
    if (selected.size === 0) return;
    setError('');
    setSendingVerified(true);
    const ids = [...selected];
    const CHUNK = 50;
    let success = 0;
    let failure = 0;
    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        setNotice(
          `Verified send ${Math.min(i + CHUNK, ids.length)}/${ids.length}… (Postmark confirm)`
        );
        const result = await api.sendVerified(chunk);
        success += result.success || 0;
        failure += result.failure || 0;
        loadHistory();
        loadAutoSend();
      }
      setNotice(
        `Verified outbound: ${success} sent (Postmark-confirmed)` +
          (failure ? `, ${failure} failed/retry` : '')
      );
      setSelected(new Set());
      loadHistory();
    } catch (err) {
      setError(err.message);
    } finally {
      setSendingVerified(false);
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
      if (!newEvent.mail_provider_id) {
        setError('Choose a mail provider (Postmark or SMTP) for this event');
        return;
      }
      const ev = await api.createEvent({
        ...newEvent,
        slug,
        mail_provider_id: Number(newEvent.mail_provider_id),
      });
      setEvents((prev) => [ev, ...prev]);
      setEventId(ev.id);
      const sendgrid = mailProviders.find((p) => p.slug === 'sendgrid-contour');
      setNewEvent({
        name: '',
        slug: '',
        location: '',
        dates: '',
        mail_provider_id: sendgrid ? String(sendgrid.id) : newEvent.mail_provider_id,
      });
      setNotice(
        `Event "${ev.name}" created · mail: ${ev.mail_provider_name || ev.mail_provider_type || 'set'}`
      );
      setTab('compose');
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCreateSmtp(e) {
    e.preventDefault();
    if (!isSuperAdmin) return;
    setSmtpBusy(true);
    setError('');
    try {
      const slug =
        newSmtp.slug ||
        newSmtp.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '');
      const created = await api.createMailProvider({
        name: newSmtp.name,
        slug,
        type: 'smtp',
        from_email: newSmtp.from_email,
        smtp_host: newSmtp.smtp_host,
        smtp_port: Number(newSmtp.smtp_port) || 587,
        smtp_secure: false,
        smtp_user: newSmtp.smtp_user,
        smtp_pass: newSmtp.smtp_pass || undefined,
        notes: newSmtp.notes || undefined,
      });
      setMailProviders((prev) => [...prev, created]);
      setNewEvent((prev) => ({ ...prev, mail_provider_id: String(created.id) }));
      setNewSmtp({
        name: '',
        slug: '',
        from_email: '',
        smtp_host: 'smtp.sendgrid.net',
        smtp_port: '587',
        smtp_user: '',
        smtp_pass: '',
        notes: '',
      });
      setNotice(`SMTP profile "${created.name}" added — select it when creating an event`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSmtpBusy(false);
    }
  }
  async function handleAddParticipant(e) {
    e?.preventDefault?.();
    if (!eventId || !participantEmail.trim()) return;
    setParticipantBusy(true);
    setError('');
    try {
      await api.addParticipants(eventId, { email: participantEmail.trim() });
      setParticipantEmail('');
      setNotice('Participant added');
      loadParticipants();
    } catch (err) {
      setError(err.message);
    } finally {
      setParticipantBusy(false);
    }
  }

  async function handleImportParticipants() {
    if (!eventId || !participantPaste.trim()) return;
    setParticipantBusy(true);
    setError('');
    try {
      const res = await api.addParticipants(eventId, { recipients: participantPaste });
      setParticipantPaste('');
      setNotice(
        `Imported ${res.inserted || 0} new` +
          (res.updated ? `, updated ${res.updated}` : '') +
          ` for ${selectedEvent?.name || 'event'}`
      );
      loadParticipants();
    } catch (err) {
      setError(err.message);
    } finally {
      setParticipantBusy(false);
    }
  }

  async function handleDeleteParticipant(pid) {
    if (!eventId) return;
    setError('');
    try {
      await api.deleteParticipant(eventId, pid);
      loadParticipants();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleQueueParticipants() {
    if (!eventId) return;
    setParticipantBusy(true);
    setError('');
    try {
      const res = await api.queueParticipants(eventId);
      setNotice(
        res.queued
          ? `Queued ${res.queued} pending send(s) for ${selectedEvent?.name || 'event'}`
          : res.message || 'Nothing new to queue'
      );
      if (res.queued) setTab('history');
    } catch (err) {
      setError(err.message);
    } finally {
      setParticipantBusy(false);
    }
  }

  async function handleLoadParticipantsToCompose() {
    if (!eventId) return;
    setError('');
    try {
      const data = await api.participants(eventId, { limit: 5000 });
      const emails = (data.items || []).map((p) => p.email);
      setRecipients(emails.join('\n'));
      setNotice(`Loaded ${emails.length} participant(s) into Compose recipients`);
      setTab('compose');
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
          <label className="event-switcher" title="All work is scoped to this event">
            <span className="eyebrow">Event</span>
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
            <button
              className={tab === 'participants' ? 'active' : ''}
              onClick={() => setTab('participants')}
            >
              Participants
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
              <p>
                Editing template for{' '}
                <strong>{selectedEvent?.name || 'selected event'}</strong>
                {templateId ? ` · template #${templateId}` : ''}
                {selectedEvent?.mail_provider_name
                  ? ` · mail: ${selectedEvent.mail_provider_name}`
                  : ''}
                .
              </p>
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

            {templates.length > 1 && (
              <label>
                Template
                <select
                  value={templateId || ''}
                  onChange={(e) => {
                    const id = Number(e.target.value) || null;
                    setTemplateId(id);
                    const tpl = templates.find((t) => t.id === id);
                    const hydrated = hydrateFromTemplate(tpl, selectedEvent);
                    setSubject(hydrated.subject);
                    setContent(hydrated.content);
                  }}
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.is_default ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
              <span className="hint">(comma, semicolon, newline, or CSV — or load from Participants)</span>
              <textarea
                rows={6}
                placeholder="alice@bank.com, bob@corp.com&#10;or paste a column of emails from Excel…"
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
              />
            </label>
            <div className="actions" style={{ marginTop: 8, gap: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="ghost"
                disabled={!eventId}
                onClick={handleLoadParticipantsToCompose}
              >
                Load event participants
              </button>
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
              <button
                type="button"
                className="ghost"
                disabled={!eventId || !recipients.trim() || participantBusy}
                onClick={async () => {
                  setParticipantBusy(true);
                  try {
                    const res = await api.addParticipants(eventId, { recipients });
                    setNotice(
                      `Saved ${res.inserted || 0} new participant(s) to ${selectedEvent?.name || 'event'}`
                    );
                    loadParticipants();
                  } catch (err) {
                    setError(err.message);
                  } finally {
                    setParticipantBusy(false);
                  }
                }}
              >
                Save recipients as participants
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
              <h2>Send queue — {selectedEvent?.name || 'Event'}</h2>
              <p>
                {sendsTotal} shown filter · pending {statusCounts.pending || 0} · sent{' '}
                {statusCounts.sent || 0} · failed {statusCounts.failed || 0}
              </p>
            </div>
            <div className="filters">
              <select
                value={eventId || ''}
                onChange={(e) => setEventId(Number(e.target.value) || null)}
                title="Filter by event"
              >
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name}
                  </option>
                ))}
              </select>
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
                disabled={autoSendBusy || sendingVerified || !eventId}
                onClick={handleAutoSendToggle}
                title="Queue: transactional outbound 1-by-1 for this event. Marks sent only after Postmark Activity confirms."
              >
                {autoSendBusy
                  ? '…'
                  : autoSend?.enabled
                    ? 'Stop verified auto-send'
                    : 'Start verified auto-send'}
              </button>
              <button
                className="primary"
                disabled={selected.size === 0 || sendingSelected || sendingVerified || autoSend?.enabled}
                onClick={handleSendVerifiedSelected}
                title="Send selected now, one-by-one on transactional stream. Marks sent only after Postmark confirms."
              >
                {sendingVerified
                  ? `Verifying ${selected.size}…`
                  : `Send selected verified (${selected.size})`}
              </button>
              <button
                className="ghost"
                disabled={selected.size === 0 || sendingSelected || sendingVerified}
                onClick={handleSendSelected}
                title="Broadcast/bulk stream (keep for later once Bulk API is approved)"
              >
                {sendingSelected
                  ? `Broadcasting ${selected.size}…`
                  : `Broadcast selected (${selected.size})`}
              </button>
              <button
                className="ghost"
                disabled={selected.size === 0 || sendingSelected || sendingVerified}
                onClick={handleBulkResend}
                title="Creates new send rows (for already-sent / failed)"
              >
                Resend selected
              </button>
            </div>
          </div>

          {autoSend && (
            <p className={`auto-send-banner ${autoSend.enabled ? 'on' : 'off'}`}>
              Verified auto-send (transactional):{' '}
              <strong>{autoSend.enabled ? 'RUNNING' : 'stopped'}</strong>
              {autoSend.eventName || autoSend.eventId
                ? ` · event: ${autoSend.eventName || `#${autoSend.eventId}`}`
                : ' · all events'}
              {' · marks sent only after Postmark confirms'}
              {autoSend.mode ? ` · ${autoSend.mode}` : ''}
              {' · '}
              {autoSend.batchSize}/{autoSend.intervalLabel || 'min'}
              {' · '}
              pending {autoSend.pending ?? '—'}
              {autoSend.sent != null ? ` · sent ${autoSend.sent}` : ''}
              {autoSend.enabled && autoSend.etaMinutes != null
                ? ` · ~${autoSend.etaMinutes} min left`
                : ''}
              {autoSend.lastTick?.at
                ? ` · last: ${autoSend.lastTick.success ?? 0} ok / ${autoSend.lastTick.failure ?? 0} retry`
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
                      {s.status === 'pending' || s.status === 'failed' ? (
                        <button
                          className="ghost small"
                          disabled={sendingSelected || sendingVerified || autoSend?.enabled}
                          title="Transactional 1-by-1; marks sent only after Postmark confirms"
                          onClick={async () => {
                            setSendingVerified(true);
                            setError('');
                            try {
                              const result = await api.sendVerified([s.id]);
                              setNotice(
                                result.success
                                  ? `Verified sent ${s.recipient_email}`
                                  : `Failed: ${result.results?.[0]?.error || 'error'}`
                              );
                              loadHistory();
                              loadAutoSend();
                            } catch (err) {
                              setError(err.message);
                            } finally {
                              setSendingVerified(false);
                            }
                          }}
                        >
                          Send verified
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

      {tab === 'participants' && (
        <main className="history">
          <div className="panel-head row">
            <div>
              <h2>Participants — {selectedEvent?.name || 'Select an event'}</h2>
              <p>
                {participantsTotal} contact(s) stored for this event only. Queue them to Send History
                when ready.
              </p>
            </div>
            <div className="filters">
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
              <button className="ghost" onClick={loadParticipants} disabled={!eventId}>
                Refresh
              </button>
              <button
                className="ghost"
                disabled={!eventId || participantsTotal === 0}
                onClick={handleLoadParticipantsToCompose}
              >
                Load into Compose
              </button>
              <button
                className="primary"
                disabled={!eventId || participantBusy || participantsTotal === 0}
                onClick={handleQueueParticipants}
              >
                {participantBusy ? 'Queuing…' : 'Queue pending sends'}
              </button>
            </div>
          </div>

          <div className="panel" style={{ marginBottom: 16 }}>
            <form className="event-form" onSubmit={handleAddParticipant}>
              <label>
                Add email
                <input
                  type="email"
                  placeholder="name@company.com"
                  value={participantEmail}
                  onChange={(e) => setParticipantEmail(e.target.value)}
                />
              </label>
              <button className="primary" type="submit" disabled={participantBusy || !eventId}>
                Add
              </button>
            </form>
            <label>
              Paste / import list
              <textarea
                rows={4}
                placeholder="Paste emails (comma, newline, or CSV)…"
                value={participantPaste}
                onChange={(e) => setParticipantPaste(e.target.value)}
              />
            </label>
            <div className="actions" style={{ gap: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="primary"
                disabled={participantBusy || !participantPaste.trim() || !eventId}
                onClick={handleImportParticipants}
              >
                Import to this event
              </button>
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
                      setParticipantPaste(String(reader.result || ''));
                      setNotice(`Loaded file ${file.name} — click Import to save`);
                    };
                    reader.readAsText(file);
                  }}
                />
              </label>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Company</th>
                  <th>Added</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {participants.map((p) => (
                  <tr key={p.id}>
                    <td>{p.email}</td>
                    <td>{p.name || '—'}</td>
                    <td>{p.company || '—'}</td>
                    <td>{formatTime(p.created_at)}</td>
                    <td>
                      <button
                        className="ghost small"
                        onClick={() => handleDeleteParticipant(p.id)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {participants.length === 0 && (
                  <tr>
                    <td colSpan={5} className="empty">
                      No participants for this event yet. Import a list above.
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
                <li
                  key={ev.id}
                  onClick={() => {
                    setEventId(ev.id);
                    setNotice(`Switched to ${ev.name}`);
                  }}
                  className={ev.id === eventId ? 'active' : ''}
                >
                  <strong>{ev.name}</strong>
                  <span>
                    {ev.location || '—'} · {ev.dates || '—'}
                  </span>
                  <span>
                    Mail:{' '}
                    {ev.mail_provider_name || 'not set'}
                    {ev.mail_provider_type ? ` (${ev.mail_provider_type})` : ''}
                    {ev.mail_from_email ? ` · ${ev.mail_from_email}` : ''}
                  </span>
                  <code>{ev.slug}</code>
                  {ev.id === eventId ? <em> · selected</em> : null}
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Add event</h2>
              <p>Pick which mail stack this event uses (Postmark for Sibos, SMTP for others).</p>
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
              <label>
                Mail provider
                <select
                  required
                  value={newEvent.mail_provider_id}
                  onChange={(e) =>
                    setNewEvent({ ...newEvent, mail_provider_id: e.target.value })
                  }
                >
                  <option value="">Select…</option>
                  {mailProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.type}
                      {p.from_email ? ` · ${p.from_email}` : ''}
                      {p.type === 'smtp' && p.smtp_host ? ` · ${p.smtp_host}` : ''}
                      {p.type === 'smtp' && !p.smtp_pass_set ? ' (set password on server)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <p className="meta-line">
                Sibos → Postmark. New events → usually SendGrid SMTP (Contour).
              </p>
              <button className="primary" type="submit">
                Create event
              </button>
            </form>
            <p className="hint-block">
              Each event has its own template, participants, send history, and mail provider.
            </p>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Mail providers</h2>
              <p>Profiles available when creating events.</p>
            </div>
            <ul className="event-list">
              {mailProviders.map((p) => (
                <li key={p.id}>
                  <strong>{p.name}</strong>
                  <span>
                    {p.type}
                    {p.from_email ? ` · from ${p.from_email}` : ''}
                    {p.type === 'smtp' && p.smtp_host
                      ? ` · ${p.smtp_host}:${p.smtp_port || 587}`
                      : ''}
                  </span>
                  <span className="meta-line">
                    {p.notes || ''}
                    {p.type === 'smtp'
                      ? p.smtp_pass_set
                        ? ' · password OK'
                        : ` · set ${p.smtp_pass_env || 'SMTP_PASS'} on server`
                      : p.postmark_token_set
                        ? ' · Postmark token OK'
                        : ' · set POSTMARK_SERVER_TOKEN'}
                  </span>
                </li>
              ))}
            </ul>

            {isSuperAdmin && (
              <>
                <div className="panel-head" style={{ marginTop: 20 }}>
                  <h2>Add SMTP profile</h2>
                </div>
                <form className="event-form" onSubmit={handleCreateSmtp}>
                  <label>
                    Name
                    <input
                      required
                      value={newSmtp.name}
                      onChange={(e) => setNewSmtp({ ...newSmtp, name: e.target.value })}
                      placeholder="SendGrid Contour"
                    />
                  </label>
                  <label>
                    From email
                    <input
                      required
                      type="email"
                      value={newSmtp.from_email}
                      onChange={(e) => setNewSmtp({ ...newSmtp, from_email: e.target.value })}
                      placeholder="support@contour.network"
                    />
                  </label>
                  <label>
                    SMTP host
                    <input
                      required
                      value={newSmtp.smtp_host}
                      onChange={(e) => setNewSmtp({ ...newSmtp, smtp_host: e.target.value })}
                    />
                  </label>
                  <label>
                    Port
                    <input
                      value={newSmtp.smtp_port}
                      onChange={(e) => setNewSmtp({ ...newSmtp, smtp_port: e.target.value })}
                    />
                  </label>
                  <label>
                    Username
                    <input
                      required
                      value={newSmtp.smtp_user}
                      onChange={(e) => setNewSmtp({ ...newSmtp, smtp_user: e.target.value })}
                      placeholder="apikey or xdc"
                    />
                  </label>
                  <label>
                    Password / API key
                    <input
                      type="password"
                      value={newSmtp.smtp_pass}
                      onChange={(e) => setNewSmtp({ ...newSmtp, smtp_pass: e.target.value })}
                      placeholder="optional if set via env"
                    />
                  </label>
                  <button className="primary" type="submit" disabled={smtpBusy}>
                    {smtpBusy ? 'Saving…' : 'Add SMTP'}
                  </button>
                </form>
              </>
            )}
          </section>
        </main>
      )}
    </div>
  );
}
