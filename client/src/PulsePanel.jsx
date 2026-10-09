import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, pulseDataSource, pulseShareUrl } from './api';
import CompanyReport from './CompanyReport';

const EMPTY_FILTERS = {
  period: '30d',
  source: '',
  voice: '',
  topic: '',
  industry: '',
  region: '',
  sentiment: '',
  audience: '',
  opportunity: '',
  q: '',
};

const FILTER_FIELDS = [
  ['source', 'sources', 'All sources'],
  ['voice', 'voices', 'All voices'],
  ['topic', 'topics', 'All topics'],
  ['industry', 'industries', 'All industries'],
  ['region', 'regions', 'All regions'],
  ['sentiment', 'sentiments', 'Any sentiment'],
  ['audience', 'audiences', 'All audiences'],
];

const SENTIMENT_COLORS = { positive: '#2fb47c', neutral: '#9db4cf', negative: '#e05a4f' };

function flag(code) {
  if (!/^[A-Z]{2}$/.test(code || '')) return '';
  return String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

function fmtDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtPrice(n) {
  if (n == null) return '–';
  return `$${Number(n).toFixed(n < 1 ? 4 : 2)}`;
}

function pct(part, whole) {
  return whole ? Math.round((part / whole) * 100) : 0;
}

function Delta({ now, before }) {
  if (!before && !now) return null;
  if (!before) return <span className="pulse-delta up">new</span>;
  const change = Math.round(((now - before) / before) * 100);
  if (change === 0) return <span className="pulse-delta">0%</span>;
  return <span className={`pulse-delta ${change > 0 ? 'up' : 'down'}`}>{change > 0 ? '▲' : '▼'} {Math.abs(change)}%</span>;
}

function BarList({ rows, labels, filterKey, active, onPick, showDelta, renderLabel }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (!rows.length) return <p className="muted small pulse-none">No data for these filters yet.</p>;
  return (
    <ul className="pulse-bars">
      {rows.map((r) => (
        <li key={r.key}>
          <button
            type="button"
            className={active === r.key ? 'active' : ''}
            onClick={() => onPick?.(filterKey, active === r.key ? '' : r.key)}
            title={onPick ? 'Filter by this' : undefined}
          >
            <span className="pulse-bar-label">{renderLabel ? renderLabel(r) : labels?.[r.key] || r.key}</span>
            <span className="pulse-bar-track">
              <span className="pulse-bar-fill" style={{ width: `${(r.count / max) * 100}%` }} />
            </span>
            <span className="pulse-bar-count">
              {r.count}
              {showDelta && <Delta now={r.count} before={r.previous} />}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function DailyChart({ daily, days }) {
  const series = useMemo(() => {
    const map = new Map(daily.map((d) => [d.day, d]));
    const out = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
      out.push(map.get(d) || { day: d, positive: 0, neutral: 0, negative: 0 });
    }
    return out;
  }, [daily, days]);
  const max = Math.max(1, ...series.map((d) => d.positive + d.neutral + d.negative));
  const W = 640;
  const H = 150;
  const bw = W / series.length;

  return (
    <div className="pulse-chart">
      <svg viewBox={`0 0 ${W} ${H + 18}`} preserveAspectRatio="none" role="img" aria-label="Mentions per day">
        {[0.5, 1].map((f) => (
          <line key={f} x1="0" x2={W} y1={H - H * f} y2={H - H * f} className="pulse-gridline" />
        ))}
        {series.map((d, i) => {
          let y = H;
          return (
            <g key={d.day}>
              <title>{`${d.day}: ${d.positive + d.neutral + d.negative} mentions (${d.positive} positive, ${d.neutral} neutral, ${d.negative} negative)`}</title>
              {['negative', 'neutral', 'positive'].map((k) => {
                const h = (d[k] / max) * (H - 6);
                y -= h;
                return h > 0 ? (
                  <rect key={k} x={i * bw + bw * 0.15} y={y} width={bw * 0.7} height={h} rx={Math.min(3, bw * 0.2)} fill={SENTIMENT_COLORS[k]} />
                ) : null;
              })}
            </g>
          );
        })}
        <text x="0" y={H + 14} className="pulse-axis">{fmtDate(series[0]?.day)}</text>
        <text x={W} y={H + 14} textAnchor="end" className="pulse-axis">Today</text>
      </svg>
      <div className="pulse-legend">
        {Object.entries(SENTIMENT_COLORS).map(([k, c]) => (
          <span key={k}>
            <i style={{ background: c }} /> {k}
          </span>
        ))}
      </div>
    </div>
  );
}

function PriceCard({ market }) {
  if (!market?.length) return null;
  const prices = market.map((m) => m.price).filter((p) => p != null);
  const first = prices[0];
  const last = prices[prices.length - 1];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const W = 200;
  const H = 46;
  const points = prices
    .map((p, i) => `${(i / Math.max(1, prices.length - 1)) * W},${H - ((p - min) / (max - min || 1)) * H}`)
    .join(' ');
  const change = first ? ((last - first) / first) * 100 : 0;
  return (
    <div className="pulse-kpi pulse-price">
      <span className="pulse-kpi-label">XDC price</span>
      <strong>{fmtPrice(last)}</strong>
      <span className={`pulse-delta ${change >= 0 ? 'up' : 'down'}`}>
        {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(1)}% in period
      </span>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="pulse-spark" aria-hidden="true">
        <polyline points={points} fill="none" strokeWidth="2" className={change >= 0 ? 'up' : 'down'} />
      </svg>
    </div>
  );
}

function BriefList({ title, items, lead }) {
  if (!items?.length) return null;
  return (
    <div>
      <h4>{title}</h4>
      <ul>
        {items.map((item, i) =>
          typeof item === 'string' ? (
            <li key={i}>{item}</li>
          ) : (
            <li key={i}>
              {item[lead] && <strong>{item[lead]}: </strong>}
              {item.insight}
              {item.url && (
                <>
                  {' '}
                  <a href={item.url} target="_blank" rel="noreferrer">
                    source
                  </a>
                </>
              )}
            </li>
          )
        )}
      </ul>
    </div>
  );
}

function BriefCard({ brief, canGenerate, generating, onGenerate }) {
  const c = brief?.content;
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="panel pulse-brief">
      <div className="pulse-section-head">
        <div>
          <p className="eyebrow">Founder brief</p>
          <h3>{c?.headline || 'No brief yet'}</h3>
          {brief && (
            <p className="muted small">
              {fmtDate(brief.period_start)} – {fmtDate(brief.period_end)} · based on {brief.item_count} mentions
            </p>
          )}
        </div>
        {canGenerate && (
          <div className="pulse-brief-actions">
            <button type="button" className="ghost small" disabled={generating} onClick={() => onGenerate(7)}>
              {generating ? 'Writing…' : 'New 7-day brief'}
            </button>
            <button type="button" className="ghost small" disabled={generating} onClick={() => onGenerate(30)}>
              30-day brief
            </button>
          </div>
        )}
      </div>
      {!c ? (
        <p className="muted">A brief is written automatically every Monday once mentions have been collected.</p>
      ) : (
        <>
          <p className="pulse-brief-summary">{c.summary}</p>
          <div className="pulse-brief-grid">
            <BriefList title="Key takeaways" items={c.takeaways} />
            <BriefList title="What people are interested in" items={c.people_asking} />
          </div>
          {expanded && (
            <div className="pulse-brief-grid">
              <BriefList title="Rising topics" items={c.rising_topics} lead="topic" />
              <BriefList title="Opportunities" items={c.opportunities} lead="title" />
              <BriefList title="Regions" items={c.regions} lead="region" />
              <BriefList title="Industries" items={c.industries} lead="industry" />
              <BriefList title="Watch-outs" items={c.risks} />
              <BriefList title="Suggested actions" items={c.actions} />
            </div>
          )}
          <button type="button" className="ghost small pulse-brief-toggle" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Show less' : 'Show full brief: rising topics, opportunities, regions, industries, actions'}
          </button>
        </>
      )}
    </section>
  );
}

function SourceBadge({ source, labels }) {
  return <span className={`pulse-src pulse-src-${source}`}>{labels?.[source] || source}</span>;
}

function ShareLink() {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    setMsg('');
    if (!token) {
      try {
        setToken((await api.pulseShare()).token);
      } catch (e) {
        setMsg(e.message);
      }
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(pulseShareUrl(token));
      setMsg('Link copied.');
    } catch {
      setMsg('Copy failed. Select the link and copy it manually.');
    }
  }

  async function rotate() {
    if (!window.confirm('Reset the link? Anyone using the current link will lose access.')) return;
    setBusy(true);
    try {
      setToken((await api.pulseRotateShare()).token);
      setMsg('New link created. The old link no longer works.');
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pulse-share">
      <button type="button" className="ghost" onClick={toggle} aria-expanded={open}>
        Share link
      </button>
      {open && (
        <div className="pulse-share-pop" role="dialog" aria-label="Public share link">
          <strong>Read-only founder link</strong>
          <p className="muted small">
            Anyone with this link can view the dashboard without signing in. They can't refresh or change anything.
          </p>
          <div className="pulse-share-row">
            <input readOnly value={token ? pulseShareUrl(token) : 'Loading…'} onFocus={(e) => e.target.select()} />
            <button type="button" className="primary small" disabled={!token} onClick={copy}>
              Copy
            </button>
          </div>
          <div className="pulse-share-row">
            <button type="button" className="ghost small" disabled={!token || busy} onClick={rotate}>
              {busy ? 'Resetting…' : 'Reset link'}
            </button>
            {msg && <span className="muted small">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PulsePanel({ isSuperAdmin = false, shareToken = '' }) {
  const data = useMemo(() => pulseDataSource(shareToken), [shareToken]);
  const canManage = isSuperAdmin && !shareToken;
  const [meta, setMeta] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [search, setSearch] = useState('');
  const [summary, setSummary] = useState(null);
  const [feed, setFeed] = useState({ items: [], total: 0, page: 1, page_size: 25 });
  const [page, setPage] = useState(1);
  const [brief, setBrief] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [generating, setGenerating] = useState(false);
  const pollRef = useRef(null);

  const tx = meta?.taxonomy || {};
  const params = useMemo(
    () => Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
    [filters]
  );

  const loadSummary = useCallback(async () => {
    const s = await data.summary(params);
    setSummary(s);
    return s;
  }, [params, data]);

  useEffect(() => {
    data.meta().then(setMeta).catch((e) => setError(e.message));
    data.brief().then((r) => setBrief(r.brief)).catch(() => {});
  }, [data]);

  useEffect(() => {
    setPage(1);
  }, [params]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([loadSummary(), data.items({ ...params, page })])
      .then(([, items]) => !cancelled && setFeed(items))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [params, page, loadSummary, data]);

  useEffect(() => {
    clearInterval(pollRef.current);
    if (summary?.running) {
      pollRef.current = setInterval(async () => {
        const s = await loadSummary().catch(() => null);
        if (s && !s.running) {
          clearInterval(pollRef.current);
          setNotice('Collection finished.');
          data.items({ ...params, page: 1 }).then(setFeed).catch(() => {});
          data.brief().then((r) => setBrief(r.brief)).catch(() => {});
        }
      }, 8000);
    }
    return () => clearInterval(pollRef.current);
  }, [summary?.running, loadSummary, params, data]);

  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === search ? f : { ...f, q: search })), 400);
    return () => clearTimeout(t);
  }, [search]);

  function pick(key, value) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  async function refresh() {
    setError('');
    setNotice('');
    try {
      await api.pulseRefresh();
      setNotice('Collecting from news, X, LinkedIn and the web. This takes 3–5 minutes; the dashboard updates itself.');
      setSummary((s) => (s ? { ...s, running: true } : s));
    } catch (e) {
      setError(e.message);
    }
  }

  async function generate(days) {
    setGenerating(true);
    setError('');
    try {
      const r = await api.pulseGenerateBrief(days);
      setBrief(r.brief);
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  }

  const t = summary?.totals;
  const activeFilters =
    FILTER_FIELDS.filter(([k]) => filters[k]).length + (filters.q ? 1 : 0) + (filters.opportunity ? 1 : 0);
  const lastRun = summary?.last_run;
  const pages = Math.max(1, Math.ceil((feed.total || 0) / (feed.page_size || 25)));

  return (
    <main className="pulse">
      <section className="panel pulse-head">
        <div className="pulse-section-head">
          <div>
            <h2>Market Pulse</h2>
            <p className="muted">
              What people are saying about XDC across news, X, LinkedIn and the web, tagged by AI by topic, region,
              industry and sentiment.
            </p>
          </div>
          <div className="pulse-head-actions">
            <span className="muted small">
              {summary?.running
                ? 'Collecting now…'
                : lastRun?.finished_at
                  ? `Updated ${new Date(lastRun.finished_at).toLocaleString()}`
                  : 'Not collected yet'}
            </span>
            {canManage && <ShareLink />}
            {canManage && (
              <button type="button" className="primary" disabled={summary?.running} onClick={refresh}>
                {summary?.running ? 'Collecting…' : 'Refresh now'}
              </button>
            )}
          </div>
        </div>

        <div className="pulse-filters">
          <div className="pulse-periods" role="group" aria-label="Period">
            {['7d', '30d', '90d'].map((p) => (
              <button
                key={p}
                type="button"
                className={filters.period === p ? 'active' : ''}
                onClick={() => pick('period', p)}
              >
                {p.replace('d', ' days')}
              </button>
            ))}
          </div>
          {FILTER_FIELDS.map(([key, dict, placeholder]) => (
            <select key={key} value={filters[key]} onChange={(e) => pick(key, e.target.value)} aria-label={placeholder}>
              <option value="">{placeholder}</option>
              {Object.entries(tx[dict] || {}).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          ))}
          <input
            type="search"
            placeholder="Search mentions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {activeFilters > 0 && (
            <button
              type="button"
              className="ghost small"
              onClick={() => {
                setSearch('');
                setFilters((f) => ({ ...EMPTY_FILTERS, period: f.period }));
              }}
            >
              Clear filters ({activeFilters})
            </button>
          )}
        </div>
        {error && <div className="banner error">{error}</div>}
        {notice && <div className="banner ok">{notice}</div>}
      </section>

      {!summary && loading ? (
        <div className="pulse-skeleton-grid">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="pulse-skeleton" />
          ))}
        </div>
      ) : summary ? (
        <>
          <section className="pulse-kpis">
            <div className="pulse-kpi">
              <span className="pulse-kpi-label">Mentions</span>
              <strong>{t.mentions}</strong>
              <span className="muted small">
                vs {t.previous_mentions} previous period <Delta now={t.mentions} before={t.previous_mentions} />
              </span>
            </div>
            <div className="pulse-kpi">
              <span className="pulse-kpi-label">Sentiment</span>
              <strong>{pct(t.positive, t.mentions)}% positive</strong>
              <span className="muted small">{pct(t.negative, t.mentions)}% negative</span>
            </div>
            <div className="pulse-kpi">
              <span className="pulse-kpi-label">Distinct voices</span>
              <strong>{t.voices}</strong>
              <span className="muted small">
                {summary.voices.find((v) => v.key === 'external')?.count || 0} external mentions
              </span>
            </div>
            <button type="button" className="pulse-kpi pulse-kpi-btn" onClick={() => pick('opportunity', filters.opportunity ? '' : 'true')}>
              <span className="pulse-kpi-label">Opportunities</span>
              <strong>{t.opportunities}</strong>
              <span className="muted small">{filters.opportunity ? 'Showing only opportunities' : 'Click to filter'}</span>
            </button>
            <PriceCard market={summary.market} />
          </section>

          <BriefCard brief={brief} canGenerate={canManage} generating={generating} onGenerate={generate} />

          <CompanyReport data={data} canRun={canManage} />

          <section className="pulse-grid">
            <div className="panel pulse-wide">
              <h3>Mentions over time</h3>
              <DailyChart daily={summary.daily} days={summary.period_days} />
            </div>
            <div className="panel">
              <h3>Trending topics</h3>
              <p className="muted small">Change vs the previous period of the same length.</p>
              <BarList rows={summary.topics} labels={tx.topics} filterKey="topic" active={filters.topic} onPick={pick} showDelta />
            </div>
            <div className="panel">
              <h3>Regions</h3>
              <BarList rows={summary.regions} labels={tx.regions} filterKey="region" active={filters.region} onPick={pick} />
              {!!summary.countries.length && (
                <div className="pulse-countries">
                  {summary.countries.map((c) => (
                    <span key={c.key} className="pulse-chip">
                      {flag(c.key)} {c.key} · {c.count}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="panel">
              <h3>Industries</h3>
              <BarList rows={summary.industries} labels={tx.industries} filterKey="industry" active={filters.industry} onPick={pick} />
            </div>
            <div className="panel">
              <h3>Who is talking</h3>
              <BarList rows={summary.voices} labels={tx.voices} filterKey="voice" active={filters.voice} onPick={pick} />
              <h4 className="pulse-sub">Audience</h4>
              <BarList rows={summary.audiences} labels={tx.audiences} filterKey="audience" active={filters.audience} onPick={pick} />
            </div>
            <div className="panel">
              <h3>Sources</h3>
              <BarList rows={summary.sources} labels={tx.sources} filterKey="source" active={filters.source} onPick={pick} />
              <h4 className="pulse-sub">Sentiment</h4>
              <BarList rows={summary.sentiments} labels={tx.sentiments} filterKey="sentiment" active={filters.sentiment} onPick={pick} />
            </div>
            <div className="panel">
              <h3>Opportunities to follow up</h3>
              {!summary.opportunities.length ? (
                <p className="muted small pulse-none">No commercial signals for these filters.</p>
              ) : (
                <ul className="pulse-opps">
                  {summary.opportunities.map((o) => (
                    <li key={o.id}>
                      <a href={o.url} target="_blank" rel="noreferrer">
                        {o.summary || o.title}
                      </a>
                      <span className="muted small">
                        {o.opportunity_note} · {tx.sources?.[o.source] || o.source} · {fmtDate(o.ts)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="panel pulse-feed">
            <div className="pulse-section-head">
              <h3>Mentions ({feed.total})</h3>
              {loading && <span className="muted small">Loading…</span>}
            </div>
            {!feed.items.length ? (
              <p className="muted pulse-none">
                {summary.last_run
                  ? 'No mentions match these filters.'
                  : canManage
                    ? 'Nothing collected yet. Click "Refresh now" to run the first collection.'
                    : 'Nothing collected yet.'}
              </p>
            ) : (
              <ul className="pulse-items">
                {feed.items.map((i) => (
                  <li key={i.id}>
                    <div className="pulse-item-top">
                      <SourceBadge source={i.source} labels={tx.sources} />
                      <span className={`pulse-sent pulse-sent-${i.sentiment}`}>{i.sentiment}</span>
                      {i.voice && <span className="pulse-chip">{tx.voices?.[i.voice] || i.voice}</span>}
                      {i.opportunity && <span className="pulse-chip pulse-chip-opp">Opportunity</span>}
                      <span className="muted small pulse-item-date">{fmtDate(i.ts)}</span>
                    </div>
                    <a href={i.url} target="_blank" rel="noreferrer" className="pulse-item-title">
                      {i.summary || i.title}
                    </a>
                    <div className="pulse-item-meta muted small">
                      {i.author && <span>{i.author}</span>}
                      {(i.topics || []).map((tp) => (
                        <button key={tp} type="button" className="pulse-tag" onClick={() => pick('topic', tp)}>
                          {tx.topics?.[tp] || tp}
                        </button>
                      ))}
                      {i.industry && i.industry !== 'general' && <span>{tx.industries?.[i.industry]}</span>}
                      {i.region && i.region !== 'global' && (
                        <span>
                          {flag(i.country)} {tx.regions?.[i.region]}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {pages > 1 && (
              <div className="pagination">
                <button type="button" className="ghost small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  ← Prev
                </button>
                <span className="muted small">
                  Page {page} of {pages}
                </span>
                <button type="button" className="ghost small" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                  Next →
                </button>
              </div>
            )}
          </section>

          <p className="muted small pulse-footnote">
            X, LinkedIn and web posts come from public search-engine results, so they show notable posts rather than
            every post. News comes from the GDELT global news index; price from CoinGecko. Regions are only set when a
            post states or clearly implies a location.
          </p>
        </>
      ) : null}
    </main>
  );
}
