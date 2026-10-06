import { useEffect, useRef, useState } from 'react';
import { api } from './api';

const STEP_LABELS = {
  thought: 'Thinking',
  search: 'Web search',
  search_results: 'Search results',
  fetch_page: 'Read page',
  check_our_history: 'Checked our records',
  profile_saved: 'Profile saved',
};

function domainFromEmail(email) {
  return String(email || '').split('@')[1] || '';
}

function fmtSecs(ms) {
  return `${Math.round((ms || 0) / 1000)}s`;
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object') return [parsed];
    } catch {
      /* plain text */
    }
    return [value];
  }
  return typeof value === 'object' ? [value] : [];
}

function sourced(value, key) {
  return asList(value)
    .map((item) => (typeof item === 'string' ? { [key]: item, source_url: '' } : item))
    .filter((item) => item && typeof item === 'object' && item[key]);
}

function SourceLink({ url }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      source
    </a>
  );
}

function normalizeRun(run) {
  return {
    run_id: run.id ?? run.run_id,
    event: run.event || { id: run.event_id, name: run.event_name },
    recipient: run.recipient || {
      name: run.recipient_name,
      email: run.recipient_email,
      company: run.company,
      domain: run.domain,
    },
    profile: run.profile || {},
    steps: run.steps || [],
    email: run.email || {},
    usage: run.usage || {},
    cost_usd: Number(run.cost_usd || 0),
    duration_ms: run.duration_ms,
    model: run.model,
    sent_to: run.sent_to,
    sent_at: run.sent_at,
  };
}

function Step({ step }) {
  const label = STEP_LABELS[step.type] || step.type;
  let body = null;
  if (step.type === 'thought') body = <span className="muted">{step.text}</span>;
  else if (step.type === 'search') body = <code>{step.query}</code>;
  else if (step.type === 'search_results')
    body = step.error ? (
      <span className="error-text">{step.error}</span>
    ) : (
      <ul>
        {(step.results || []).map((r) => (
          <li key={r.url}>
            <a href={r.url} target="_blank" rel="noreferrer">
              {r.title || r.url}
            </a>
          </li>
        ))}
      </ul>
    );
  else if (step.type === 'fetch_page')
    body = (
      <>
        <a href={step.input?.url} target="_blank" rel="noreferrer">
          {step.input?.url}
        </a>
        {step.result?.error ? (
          <span className="error-text"> · {step.result.error}</span>
        ) : (
          <span className="muted">
            {' '}
            · {step.result?.title || ''} · {step.result?.chars || 0} chars read
          </span>
        )}
      </>
    );
  else if (step.type === 'check_our_history') {
    const r = step.result || {};
    body = r.error ? (
      <span className="error-text">{r.error}</span>
    ) : (
      <span className="muted">
        {r.emails_to_this_person || 0} emails to this person ·{' '}
        {(r.company_invites_by_event || []).reduce((n, e) => n + (e.contacts_invited || 0), 0)} colleagues
        invited · {r.meeting_requests || 0} meeting requests
      </span>
    );
  } else if (step.type === 'profile_saved')
    body = <span className="muted">confidence {Math.round((step.confidence || 0) * 100)}%</span>;

  return (
    <li className={`ai-step ai-step-${step.type}`}>
      <strong>{label}</strong>
      <div>{body}</div>
    </li>
  );
}

export default function AiPanel({ events, currentEventId, user }) {
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState({
    event_id: currentEventId || '',
    name: 'Satheesh',
    email: 'satheesh@xinfin.org',
    company: 'XDC for Payments',
    domain: 'xdcforpayments.org',
    instructions: '',
  });
  const [testTo, setTestTo] = useState(user?.email || '');
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(null);
  const [runs, setRuns] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sending, setSending] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    api.aiStatus().then(setStatus).catch(() => setStatus({ configured: false }));
    loadRuns();
  }, []);

  useEffect(() => {
    if (!form.event_id && currentEventId) setForm((f) => ({ ...f, event_id: currentEventId }));
  }, [currentEventId]);

  useEffect(() => () => clearInterval(timer.current), []);

  async function loadRuns() {
    try {
      const data = await api.aiRuns();
      setRuns(data.items || []);
    } catch {
      /* list is optional */
    }
  }

  function set(field, value) {
    setForm((f) => {
      const next = { ...f, [field]: value };
      if (field === 'email' && (!f.domain || f.domain === domainFromEmail(f.email))) {
        next.domain = domainFromEmail(value);
      }
      return next;
    });
  }

  async function run(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    setRunning(true);
    setElapsed(0);
    const started = Date.now();
    timer.current = setInterval(() => setElapsed(Date.now() - started), 1000);
    try {
      const data = await api.aiPersonalize({ ...form, event_id: Number(form.event_id) });
      setResult(normalizeRun(data));
      if (!testTo) setTestTo(form.email);
      loadRuns();
    } catch (err) {
      setError(err.message);
    } finally {
      clearInterval(timer.current);
      setRunning(false);
    }
  }

  async function openRun(id) {
    setError('');
    try {
      setResult(normalizeRun(await api.aiRun(id)));
    } catch (err) {
      setError(err.message);
    }
  }

  async function sendTest() {
    if (!result?.run_id) return;
    setSending(true);
    setError('');
    try {
      const r = await api.aiSendRun(result.run_id, { to: testTo });
      setNotice(`Test sent to ${r.to} via ${r.provider}`);
      setResult((prev) => ({ ...prev, sent_to: r.to, sent_at: new Date().toISOString() }));
      loadRuns();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  const p = result?.profile || {};
  const em = result?.email || {};
  const hooks = sourced(p.personalization_hooks, 'hook');
  const developments = sourced(p.recent_developments, 'fact');
  const claims = sourced(em.claims, 'claim');
  const person = p.person && typeof p.person === 'object' ? p.person : null;
  const textOf = (v) => {
    if (v == null) return '';
    if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join('; ');
    if (typeof v === 'object') return '';
    return String(v);
  };

  return (
    <main className="panel ai-panel">
      <div className="panel-head row">
        <div>
          <h2>AI Personalize <span className="tag">beta</span></h2>
          <p className="muted">
            An AI research agent looks up the recipient's company (web search, company pages, our own send
            history and meeting requests), then writes a short personal invite for the selected event.
            {status && (
              <>
                {' '}
                Model: <code>{status.model || '—'}</code>
                {!status.configured && <strong className="error-text"> · not configured</strong>}
              </>
            )}
          </p>
        </div>
      </div>

      {(error || notice) && (
        <div className="banners">
          {error && <div className="banner error">{error}</div>}
          {notice && <div className="banner ok">{notice}</div>}
        </div>
      )}

      <div className="ai-layout">
        <aside className="ai-side">
          <form className="ai-form" onSubmit={run}>
            <label>
              Event (invite content and sender come from this event)
              <select value={form.event_id} onChange={(e) => set('event_id', e.target.value)} required>
                <option value="">Select event…</option>
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Name
              <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="First name" />
            </label>
            <label>
              Email
              <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} required />
            </label>
            <label>
              Company
              <input value={form.company} onChange={(e) => set('company', e.target.value)} placeholder="Optional" />
            </label>
            <label>
              Company website / domain
              <input value={form.domain} onChange={(e) => set('domain', e.target.value)} placeholder="e.g. hsbc.com" />
            </label>
            <label>
              Extra instructions <span className="muted">(optional)</span>
              <textarea
                rows={3}
                value={form.instructions}
                onChange={(e) => set('instructions', e.target.value)}
                placeholder="e.g. Mention the Oct 1 Showcase session; keep it under 100 words"
              />
            </label>
            <button className="primary" type="submit" disabled={running || status?.configured === false}>
              {running ? `Researching & writing… ${fmtSecs(elapsed)}` : 'Research & write email'}
            </button>
            {running && <p className="muted small">Usually 40–90 seconds. The agent is searching and reading pages.</p>}
          </form>

          <div className="ai-runs">
            <h3>Recent runs</h3>
            {!runs.length && <p className="muted small">No runs yet.</p>}
            <ul>
              {runs.map((r) => (
                <li key={r.id} className={result?.run_id === r.id ? 'active' : ''} onClick={() => openRun(r.id)}>
                  <strong>{r.recipient_name || r.recipient_email}</strong>
                  <span>
                    {r.company || r.domain} · {r.event_name}
                  </span>
                  <span className="muted small">
                    {new Date(r.created_at).toLocaleString()} · ${Number(r.cost_usd || 0).toFixed(3)}
                    {r.sent_to ? ` · sent to ${r.sent_to}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <section className="ai-main">
          {!result && !running && (
            <div className="ai-empty muted">Fill in a recipient and run the agent to see its research and the email.</div>
          )}
          {running && !result && <div className="ai-empty muted">Working… {fmtSecs(elapsed)}</div>}

          {result && (
            <>
              <div className="ai-meta">
                <span>
                  <strong>{result.recipient?.name || result.recipient?.email}</strong> ·{' '}
                  {p.company_name || result.recipient?.company}
                </span>
                <span className="muted">
                  {result.event?.name} · confidence {Math.round((p.confidence || 0) * 100)}% ·{' '}
                  {fmtSecs(result.duration_ms)} · {result.usage?.web_searches || 0} searches · ≈$
                  {Number(result.cost_usd || 0).toFixed(3)}
                </span>
              </div>

              <div className="ai-card">
                <div className="ai-card-head">
                  <h3>Email</h3>
                  <div className="ai-send">
                    <input
                      type="email"
                      value={testTo}
                      onChange={(e) => setTestTo(e.target.value)}
                      placeholder="test recipient"
                    />
                    <button className="primary" onClick={sendTest} disabled={sending || !testTo}>
                      {sending ? 'Sending…' : 'Send test'}
                    </button>
                  </div>
                </div>
                <p className="ai-subject">
                  <span className="muted">Subject:</span> {em.subject}
                </p>
                {em.preheader && (
                  <p className="ai-subject muted small">Preview line: {em.preheader}</p>
                )}
                {result.sent_to && (
                  <p className="muted small">
                    Last sent to {result.sent_to}
                    {result.sent_at ? ` at ${new Date(result.sent_at).toLocaleTimeString()}` : ''}
                  </p>
                )}
                <iframe className="ai-preview" title="Email preview" srcDoc={em.html || ''} />
              </div>

              <div className="ai-grid">
                <div className="ai-card">
                  <h3>What the agent found</h3>
                  <p>{textOf(p.what_they_do)}</p>
                  <dl className="ai-facts">
                    {textOf(p.industry) && (
                      <>
                        <dt>Industry</dt>
                        <dd>{textOf(p.industry)}</dd>
                      </>
                    )}
                    {textOf(p.headquarters) && (
                      <>
                        <dt>HQ</dt>
                        <dd>{textOf(p.headquarters)}</dd>
                      </>
                    )}
                    {textOf(person?.role) && (
                      <>
                        <dt>Person</dt>
                        <dd>
                          {textOf(person.name) ? `${textOf(person.name)} · ` : ''}
                          {textOf(person.role)}
                        </dd>
                      </>
                    )}
                    {textOf(p.our_relationship) && (
                      <>
                        <dt>Our history</dt>
                        <dd>{textOf(p.our_relationship)}</dd>
                      </>
                    )}
                    {textOf(p.relevance_to_event) && (
                      <>
                        <dt>Why relevant</dt>
                        <dd>{textOf(p.relevance_to_event)}</dd>
                      </>
                    )}
                  </dl>
                  {!!hooks.length && (
                    <>
                      <h4>Personalization angles</h4>
                      <ul className="ai-sourced">
                        {hooks.map((h, i) => (
                          <li key={i}>
                            {textOf(h.hook)} <SourceLink url={textOf(h.source_url)} />
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {!!developments.length && (
                    <>
                      <h4>Recent developments</h4>
                      <ul className="ai-sourced">
                        {developments.map((d, i) => (
                          <li key={i}>
                            {textOf(d.fact)} <SourceLink url={textOf(d.source_url)} />
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {textOf(p.gaps) && (
                    <p className="muted small">
                      <strong>Couldn't verify:</strong> {textOf(p.gaps)}
                    </p>
                  )}
                </div>

                <div className="ai-card">
                  <h3>How it got there</h3>
                  <ol className="ai-steps">
                    {asList(result.steps).map((s, i) => (
                      <Step key={i} step={s} />
                    ))}
                  </ol>
                  {!!claims.length && (
                    <>
                      <h4>Claims used in the email</h4>
                      <ul className="ai-sourced">
                        {claims.map((c, i) => (
                          <li key={i}>
                            {textOf(c.claim)} <SourceLink url={textOf(c.source_url)} />
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
