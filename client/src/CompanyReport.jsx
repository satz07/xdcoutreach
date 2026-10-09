import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

const asList = (v) => (Array.isArray(v) ? v : []);
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function Src({ url }) {
  if (!url) return null;
  return (
    <>
      {' '}
      <a href={url} target="_blank" rel="noreferrer" className="company-src">
        source
      </a>
    </>
  );
}

function Section({ title, items, render }) {
  const list = asList(items).filter(Boolean);
  if (!list.length) return null;
  return (
    <div className="company-section">
      <h4>{title}</h4>
      <ul>
        {list.map((item, i) => (
          <li key={i}>{render ? render(item) : typeof item === 'string' ? item : item.point}</li>
        ))}
      </ul>
    </div>
  );
}

const sourcedPoint = (item) =>
  typeof item === 'string' ? (
    item
  ) : (
    <>
      {item.point}
      <Src url={item.url} />
    </>
  );

function ReportView({ report, onTrack, isTracked }) {
  const [showSources, setShowSources] = useState(false);
  const c = report.content || {};
  const p = c.profile && typeof c.profile === 'object' ? c.profile : {};
  const facts = [
    ['Industry', p.industry],
    ['Headquarters', p.headquarters],
    ['Founded', p.founded],
    ['Size', p.size],
  ].filter(([, v]) => v);
  const sources = asList(report.sources);

  return (
    <article className="company-report">
      <header className="company-report-head">
        <div>
          <p className="eyebrow">
            Company report · {fmtDate(report.finished_at || report.created_at)}
          </p>
          <h3>{report.company}</h3>
          {(p.website || report.website) && (
            <a href={/^https?:/.test(p.website || report.website) ? p.website || report.website : `https://${p.website || report.website}`} target="_blank" rel="noreferrer" className="small">
              {p.website || report.website}
            </a>
          )}
        </div>
        <div className="company-report-actions">
          {c.sentiment && <span className={`company-sentiment s-${c.sentiment}`}>{c.sentiment} coverage</span>}
          {onTrack &&
            (isTracked ? (
              <span className="muted small">Tracked in Market Pulse</span>
            ) : (
              <button
                type="button"
                className="ghost small"
                onClick={() =>
                  onTrack({
                    name: report.company,
                    website: p.website || report.website || '',
                    description: String(p.what_they_do || '').slice(0, 200),
                  })
                }
              >
                Track in Market Pulse
              </button>
            ))}
        </div>
      </header>

      {c.headline && <p className="company-headline">{c.headline}</p>}
      {c.summary && <p className="company-summary">{c.summary}</p>}

      {(p.what_they_do || facts.length > 0) && (
        <div className="company-profile">
          {p.what_they_do && <p>{p.what_they_do}</p>}
          {facts.length > 0 && (
            <dl>
              {facts.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}

      <div className="company-grid">
        <Section
          title="Recent news"
          items={c.recent_news}
          render={(n) => (
            <>
              {n.date && <span className="muted small">{n.date} · </span>}
              <strong>{n.title}</strong>
              {n.summary ? ` — ${n.summary}` : ''}
              <Src url={n.url} />
            </>
          )}
        />
        <Section title="What people are saying" items={c.what_people_say} render={sourcedPoint} />
        <Section title="Opportunities for XDC" items={c.opportunities} render={sourcedPoint} />
        <Section title="Partnerships" items={c.partnerships} render={sourcedPoint} />
        <Section
          title="Key people"
          items={c.key_people}
          render={(k) => (
            <>
              <strong>{k.name}</strong>
              {k.role ? ` · ${k.role}` : ''}
              <Src url={k.url} />
            </>
          )}
        />
        <Section title="Products & services" items={c.products} />
        <Section title="Markets" items={c.markets} />
        <Section title="Risks & watch-outs" items={c.risks} render={sourcedPoint} />
        <Section title="Suggested next steps" items={c.next_steps} />
      </div>

      {c.sentiment_note && <p className="muted small">Tone: {c.sentiment_note}</p>}
      {c.gaps && (
        <p className="muted small">
          <strong>Couldn't verify:</strong> {c.gaps}
        </p>
      )}
      {sources.length > 0 && (
        <div className="company-sources">
          <button type="button" className="ghost small" onClick={() => setShowSources((v) => !v)}>
            {showSources ? 'Hide' : 'Show'} {sources.length} sources
          </button>
          {showSources && (
            <ol>
              {sources.map((s, i) => (
                <li key={i}>
                  <span className={`pulse-src pulse-src-${s.source === 'official' ? 'web' : s.source}`}>{s.source}</span>{' '}
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.title || s.url}
                  </a>
                  {s.date && <span className="muted small"> · {s.date}</span>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </article>
  );
}

export default function CompanyReport({ data, canRun, tracked = [], onTrack }) {
  const [reports, setReports] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ company: '', website: '', focus: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pollRef = useRef(null);

  const loadList = useCallback(() => data.companyReports().then((r) => setReports(r.reports || [])).catch(() => {}), [data]);

  const open = useCallback(
    async (id) => {
      setError('');
      try {
        const r = await data.companyReport(id);
        setSelected(r.report);
      } catch (e) {
        setError(e.message);
      }
    },
    [data]
  );

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    clearInterval(pollRef.current);
    if (selected?.status === 'running') {
      pollRef.current = setInterval(async () => {
        const r = await data.companyReport(selected.id).catch(() => null);
        if (r?.report && r.report.status !== 'running') {
          clearInterval(pollRef.current);
          setSelected(r.report);
          loadList();
        }
      }, 4000);
    }
    return () => clearInterval(pollRef.current);
  }, [selected?.id, selected?.status, data, loadList]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.pulseStartCompanyReport(form);
      setSelected({ ...r.report, status: 'running' });
      setForm({ company: '', website: '', focus: '' });
      loadList();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!canRun && !reports.length) return null;

  return (
    <section className="panel company">
      <div className="pulse-section-head">
        <div>
          <p className="eyebrow">Company research</p>
          <h3>Research any company</h3>
          <p className="muted small">
            The AI agent searches news, LinkedIn, X and the web, then writes a one-page report with sources. Takes 1–2
            minutes.
          </p>
        </div>
      </div>

      {canRun && (
        <form className="company-form" onSubmit={submit}>
          <input
            required
            placeholder="Company name, e.g. Emaar Properties"
            value={form.company}
            onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
          />
          <input
            placeholder="Website (optional)"
            value={form.website}
            onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
          />
          <input
            placeholder="What do you want to know? (optional)"
            value={form.focus}
            onChange={(e) => setForm((f) => ({ ...f, focus: e.target.value }))}
          />
          <button type="submit" className="primary" disabled={busy || !form.company.trim()}>
            {busy ? 'Starting…' : 'Research'}
          </button>
        </form>
      )}
      {error && <div className="banner error">{error}</div>}

      {reports.length > 0 && (
        <div className="company-recent">
          <span className="muted small">Recent:</span>
          {reports.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`company-chip ${selected?.id === r.id ? 'active' : ''} ${r.status}`}
              onClick={() => (selected?.id === r.id ? setSelected(null) : open(r.id))}
              title={r.headline || ''}
            >
              {r.company}
              {r.status === 'running' && ' · researching…'}
              {r.status === 'failed' && ' · failed'}
            </button>
          ))}
        </div>
      )}

      {selected?.status === 'running' && (
        <div className="company-running">
          <span className="company-spinner" aria-hidden="true" />
          Researching <strong>{selected.company}</strong>: searching news, LinkedIn, X and the web, then writing the
          report…
        </div>
      )}
      {selected?.status === 'failed' && <div className="banner error">{selected.error || 'Research failed.'}</div>}
      {selected?.status === 'done' && (
        <ReportView
          report={selected}
          onTrack={canRun ? onTrack : null}
          isTracked={tracked.some((e) => e.name.toLowerCase() === selected.company.toLowerCase())}
        />
      )}
    </section>
  );
}
