import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';

const STATUS_ORDER = ['new', 'contacted', 'meeting_booked', 'closed'];
const STATUS_LABELS = {
  new: 'New',
  contacted: 'Contacted',
  meeting_booked: 'Meeting booked',
  closed: 'Closed',
};

function fmt(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function initialLeadFromUrl() {
  try {
    return Number(new URLSearchParams(window.location.search).get('lead')) || null;
  } catch {
    return null;
  }
}

export default function LeadsPanel({ events, currentEventId, user, isSuperAdmin }) {
  const [items, setItems] = useState([]);
  const [statusCounts, setStatusCounts] = useState({});
  const [owners, setOwners] = useState([]);
  const [filters, setFilters] = useState({ eventId: '', status: '', owner: '', q: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [openId, setOpenId] = useState(initialLeadFromUrl);
  const [detail, setDetail] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [settings, setSettings] = useState(null);
  const [notifyDraft, setNotifyDraft] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.leads(filters);
      setItems(d.items || []);
      setStatusCounts(d.statusCounts || {});
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const loadDetail = useCallback(async (id) => {
    if (!id) return setDetail(null);
    try {
      setDetail(await api.lead(id));
    } catch (err) {
      setError(err.message);
      setDetail(null);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(load, filters.q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, filters.q]);

  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    loadDetail(openId);
  }, [openId, loadDetail]);

  useEffect(() => {
    api.leadOwners().then((d) => setOwners(d.owners || [])).catch(() => {});
  }, []);

  useEffect(() => {
    api
      .leadSettings(currentEventId)
      .then((s) => {
        setSettings(s);
        setNotifyDraft((s.notifyEmails || []).join(', '));
      })
      .catch(() => {});
  }, [currentEventId]);

  const total = useMemo(
    () => STATUS_ORDER.reduce((n, s) => n + (statusCounts[s] || 0), 0),
    [statusCounts]
  );

  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  async function patch(id, body) {
    setError('');
    try {
      const { lead } = await api.updateLead(id, body);
      setItems((list) => list.map((l) => (l.id === id ? { ...l, ...lead } : l)));
      if (openId === id) loadDetail(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function addNote() {
    const body = noteDraft.trim();
    if (!body || !openId) return;
    try {
      await api.addLeadNote(openId, body);
      setNoteDraft('');
      loadDetail(openId);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeLead(id) {
    if (!window.confirm('Delete this lead and its notes? This cannot be undone.')) return;
    try {
      await api.deleteLead(id);
      setOpenId(null);
      setNotice('Lead deleted');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveNotify() {
    try {
      const r = await api.saveLeadSettings(notifyDraft);
      setNotifyDraft(r.notifyEmails.join(', '));
      setSettings((s) => ({ ...s, notifyEmails: r.notifyEmails }));
      setNotice(
        r.notifyEmails.length
          ? `New-lead alerts go to: ${r.notifyEmails.join(', ')}`
          : 'New-lead email alerts turned off'
      );
    } catch (err) {
      setError(err.message);
    }
  }

  function exportCsv() {
    const cols = [
      ['Received', (l) => l.last_submitted_at],
      ['First received', (l) => l.created_at],
      ['Status', (l) => STATUS_LABELS[l.status] || l.status],
      ['Owner', (l) => l.owner_email],
      ['Name', (l) => l.name],
      ['Email', (l) => l.email],
      ['Company', (l) => l.company],
      ['Job title', (l) => l.job_title],
      ['Phone', (l) => l.phone],
      ['Event', (l) => l.event_name],
      ['Preferred date', (l) => l.preferred_date],
      ['Preferred time', (l) => l.preferred_time],
      ['Format', (l) => l.meeting_mode],
      ['Topic', (l) => l.topic],
      ['Message', (l) => l.message],
      ['Notes', (l) => l.notes_count],
      ['Verified link', (l) => (l.verified ? 'yes' : 'no')],
    ];
    const lines = [cols.map(([h]) => csvCell(h)).join(',')].concat(
      items.map((l) => cols.map(([, f]) => csvCell(f(l))).join(','))
    );
    const blob = new Blob([`\ufeff${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meeting-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const lead = detail?.lead;

  return (
    <main className="panel leads-panel">
      <div className="panel-head row">
        <div>
          <h2>Meeting leads</h2>
          <p className="muted">
            Everyone who clicked a meeting button in our emails and filled the form. Assign an owner,
            track status and keep notes in one place.
          </p>
        </div>
        <div className="leads-head-actions">
          <button className="ghost" onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button className="primary" onClick={exportCsv} disabled={!items.length}>
            Export CSV ({items.length})
          </button>
        </div>
      </div>

      {(error || notice) && (
        <div className="banners">
          {error && <div className="banner error">{error}</div>}
          {notice && <div className="banner ok">{notice}</div>}
        </div>
      )}

      <div className="lead-status-chips">
        <button
          className={`chip ${filters.status === '' ? 'active' : ''}`}
          onClick={() => setFilter('status', '')}
        >
          All <span>{total}</span>
        </button>
        {STATUS_ORDER.map((s) => (
          <button
            key={s}
            className={`chip status-${s} ${filters.status === s ? 'active' : ''}`}
            onClick={() => setFilter('status', s)}
          >
            {STATUS_LABELS[s]} <span>{statusCounts[s] || 0}</span>
          </button>
        ))}
      </div>

      <div className="leads-filters">
        <input
          placeholder="Search name, email, company, topic…"
          value={filters.q}
          onChange={(e) => setFilter('q', e.target.value)}
        />
        <select value={filters.eventId} onChange={(e) => setFilter('eventId', e.target.value)}>
          <option value="">All events</option>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.name}
            </option>
          ))}
        </select>
        <select value={filters.owner} onChange={(e) => setFilter('owner', e.target.value)}>
          <option value="">Any owner</option>
          <option value="me">Assigned to me</option>
          <option value="none">Unassigned</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.email}
            </option>
          ))}
        </select>
      </div>

      <div className={`leads-layout ${lead ? 'with-detail' : ''}`}>
        <div className="table-wrap">
          <table className="leads-table">
            <thead>
              <tr>
                <th>Received</th>
                <th>Contact</th>
                <th>Event</th>
                <th>Preferred</th>
                <th>Topic</th>
                <th>Status</th>
                <th>Owner</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted empty-row">
                    {loading ? 'Loading…' : 'No meeting requests yet.'}
                  </td>
                </tr>
              )}
              {items.map((l) => (
                <tr
                  key={l.id}
                  className={`lead-row ${openId === l.id ? 'selected' : ''}`}
                  onClick={() => setOpenId(openId === l.id ? null : l.id)}
                >
                  <td className="nowrap">
                    {fmt(l.last_submitted_at)}
                    {l.submit_count > 1 && <span className="tag">×{l.submit_count}</span>}
                  </td>
                  <td>
                    <strong>{l.name || '—'}</strong>
                    <div className="muted small">{l.email}</div>
                    {(l.company || l.job_title) && (
                      <div className="small">{[l.job_title, l.company].filter(Boolean).join(' · ')}</div>
                    )}
                  </td>
                  <td className="small">{l.event_name || '—'}</td>
                  <td className="small">
                    {[l.preferred_date, l.preferred_time].filter(Boolean).join(' · ') || 'Any time'}
                    {l.meeting_mode && <div className="muted">{l.meeting_mode}</div>}
                  </td>
                  <td className="small lead-topic">
                    {l.topic || (l.message ? l.message.slice(0, 80) : '—')}
                    {l.notes_count > 0 && <span className="tag">{l.notes_count} notes</span>}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <select
                      className={`status-select status-${l.status}`}
                      value={l.status}
                      onChange={(e) => patch(l.id, { status: e.target.value })}
                    >
                      {STATUS_ORDER.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <select
                      value={l.owner_user_id || ''}
                      onChange={(e) => patch(l.id, { owner_user_id: e.target.value || null })}
                    >
                      <option value="">Unassigned</option>
                      {owners.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.id === user?.id ? `Me (${o.email})` : o.email}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {lead && (
          <aside className="lead-detail">
            <div className="lead-detail-head">
              <div>
                <h3>{lead.name || lead.email}</h3>
                <p className="muted small">
                  {[lead.job_title, lead.company].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
              <button className="ghost" onClick={() => setOpenId(null)}>
                Close
              </button>
            </div>

            <dl className="lead-facts">
              <dt>Email</dt>
              <dd>
                <a href={`mailto:${lead.email}`}>{lead.email}</a>
                {lead.verified ? (
                  <span className="tag ok" title="Came from their personal email link">verified</span>
                ) : (
                  <span className="tag" title="Typed into the public form">self-reported</span>
                )}
              </dd>
              {lead.phone && (
                <>
                  <dt>Phone</dt>
                  <dd>{lead.phone}</dd>
                </>
              )}
              <dt>Event</dt>
              <dd>{lead.event_name || '—'}</dd>
              <dt>Preferred</dt>
              <dd>
                {[lead.preferred_date, lead.preferred_time, lead.meeting_mode].filter(Boolean).join(' · ') ||
                  'Any time'}
              </dd>
              {lead.topic && (
                <>
                  <dt>Topic</dt>
                  <dd>{lead.topic}</dd>
                </>
              )}
              {lead.message && (
                <>
                  <dt>Message</dt>
                  <dd className="prewrap">{lead.message}</dd>
                </>
              )}
              <dt>Received</dt>
              <dd>
                {fmt(lead.created_at)}
                {lead.submit_count > 1 ? ` · updated ${fmt(lead.last_submitted_at)}` : ''}
              </dd>
            </dl>

            <div className="lead-note-box">
              <textarea
                rows={3}
                placeholder="Add an internal note (call outcome, next step, meeting time…)"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addNote();
                }}
              />
              <button className="primary" onClick={addNote} disabled={!noteDraft.trim()}>
                Add note
              </button>
            </div>

            <ul className="lead-timeline">
              {(detail.notes || []).map((n) => (
                <li key={n.id} className={n.kind}>
                  <div className="small muted">
                    {fmt(n.created_at)} · {n.user_email || 'system'}
                  </div>
                  <div className="prewrap">{n.body}</div>
                </li>
              ))}
              <li className="system">
                <div className="small muted">{fmt(lead.created_at)}</div>
                <div>Meeting request received</div>
              </li>
            </ul>

            {isSuperAdmin && (
              <button className="ghost danger-text" onClick={() => removeLead(lead.id)}>
                Delete lead
              </button>
            )}
          </aside>
        )}
      </div>

      {settings && (
        <div className="leads-settings">
          <div>
            <h3>New-lead email alerts</h3>
            <p className="muted small">
              These addresses get an email each time someone submits the meeting form.
            </p>
            <div className="leads-notify-row">
              <input
                value={notifyDraft}
                onChange={(e) => setNotifyDraft(e.target.value)}
                disabled={!settings.canEdit}
                placeholder="bd@contour.network, pm@xinfin.org"
              />
              {settings.canEdit && (
                <button className="primary" onClick={saveNotify}>
                  Save
                </button>
              )}
            </div>
          </div>
          <div>
            <h3>Shareable form link</h3>
            <p className="muted small">
              Emails carry a personal link automatically. Use this one for LinkedIn, WhatsApp or a QR code at the booth.
            </p>
            <div className="leads-notify-row">
              <input readOnly value={settings.genericFormUrl || ''} onFocus={(e) => e.target.select()} />
              <button
                className="ghost"
                onClick={() => {
                  navigator.clipboard?.writeText(settings.genericFormUrl || '');
                  setNotice('Form link copied');
                }}
              >
                Copy
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
