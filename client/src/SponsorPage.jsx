import { useCallback, useEffect, useState } from 'react';
import { api, logoUrl, sponsorFileUrl } from './api';

const STATUS_TEXT = {
  prospect: 'You are invited to co-sponsor this event.',
  invited: 'You are invited to co-sponsor this event.',
  interested: "Thanks for your interest — our team will be in touch to confirm the details.",
  confirmed: "You're confirmed as a sponsor. Thank you!",
  declined: 'Changed your mind? You can still register interest below.',
};
const INVOICE_TEXT = {
  sent: 'Awaiting payment',
  payment_reported: 'Payment reported — we are confirming it',
  paid: 'Paid',
};
const KIND_LABELS = {
  linkedin: 'LinkedIn',
  x: 'X / Twitter',
  newsletter: 'Newsletter',
  blog: 'Blog',
  website: 'Website',
  press: 'Press',
  video: 'Video',
  asset: 'Assets',
  speaking: 'Speaking',
  booth: 'Booth',
  other: 'Other',
};

function money(v, currency) {
  if (v == null) return '';
  return `${currency} ${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function InvoiceCard({ inv, token, onReported }) {
  const [ref, setRef] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div className={`sp-invoice inv-${inv.status} ${inv.overdue ? 'overdue' : ''}`}>
      <div className="sp-invoice-head">
        <div>
          <strong>Invoice {inv.number}</strong>
          <div className="meet-muted small">
            {inv.due_date ? `Due ${fmtDate(inv.due_date)}` : ''}
            {inv.overdue ? ' · overdue' : ''}
          </div>
        </div>
        <div className="sp-invoice-amount">{money(inv.amount, inv.currency)}</div>
      </div>
      <div className={`sp-status inv-${inv.status}`}>
        {INVOICE_TEXT[inv.status] || inv.status}
        {inv.payment_reference ? ` · ref ${inv.payment_reference}` : ''}
      </div>
      <div className="sp-actions">
        {inv.has_file && (
          <a className="sp-btn ghost" href={sponsorFileUrl(token, inv.file_id)} target="_blank" rel="noreferrer">
            View PDF
          </a>
        )}
        {inv.payment_link && inv.status !== 'paid' && (
          <a className="sp-btn" href={inv.payment_link} target="_blank" rel="noreferrer">
            Pay now
          </a>
        )}
        {inv.status === 'sent' && !open && (
          <button className="sp-btn ghost" onClick={() => setOpen(true)}>
            I've paid
          </button>
        )}
      </div>
      {open && (
        <form
          className="sp-paid-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErr('');
            try {
              await api.sponsorReportPaid(token, inv.id, ref);
              setOpen(false);
              onReported();
            } catch (er) {
              setErr(er.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <input required value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Transfer reference or transaction ID" />
          <button className="sp-btn" disabled={busy || !ref.trim()}>
            {busy ? 'Sending…' : 'Confirm'}
          </button>
          {err && <p className="meet-error">{err}</p>}
        </form>
      )}
    </div>
  );
}

function SponsorItem({ d, token, onSaved }) {
  const [link, setLink] = useState(d.link || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async (body) => {
    setBusy(true);
    setErr('');
    try {
      await api.sponsorUpdateDeliverable(token, d.id, body);
      onSaved();
    } catch (er) {
      setErr(er.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className={d.done ? 'done' : ''}>
      <input type="checkbox" checked={d.done} disabled={busy} onChange={() => save({ done: !d.done })} />
      <div className="sp-item-main">
        <div>
          <span className="sp-item-title">{d.title}</span>
          <span className="sp-kind">{KIND_LABELS[d.kind] || d.kind}</span>
          {d.due_date && <span className="sp-kind">due {fmtDate(d.due_date)}</span>}
        </div>
        <form
          className="sp-link-row"
          onSubmit={(e) => {
            e.preventDefault();
            save({ link });
          }}
        >
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste the link to your post" />
          <button className="sp-btn ghost" disabled={busy || link.trim() === (d.link || '')}>
            Save
          </button>
        </form>
        {err && <p className="meet-error">{err}</p>}
      </div>
    </li>
  );
}

export default function SponsorPage({ token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [pick, setPick] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [thanks, setThanks] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api.sponsorPage(token);
      setData(d);
      setPick((p) => p || (d.sponsor.package_id ? String(d.sponsor.package_id) : ''));
    } catch (err) {
      setError(err.message);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (data?.event?.name) document.title = `${data.event.name} · Sponsorship`;
  }, [data]);

  if (error && !data) {
    return (
      <div className="meet-page meet-theme-xdc">
        <div className="meet-card">
          <h1>Link not available</h1>
          <p className="meet-muted">{error}</p>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="meet-page meet-theme-xdc">
        <div className="meet-card">
          <p className="meet-muted">Loading…</p>
        </div>
      </div>
    );
  }

  const { event, sponsor, packages, invoices, deliverables, prospectus } = data;
  const confirmed = sponsor.status === 'confirmed';
  const mine = deliverables.filter((d) => d.owner === 'sponsor');
  const ours = deliverables.filter((d) => d.owner === 'host');

  return (
    <div className="meet-page meet-theme-xdc sponsor-page">
      <div className="meet-card sp-card">
        <div className="meet-head">
          <div className="meet-logos">
            <img src={logoUrl('xdc.png')} alt="XDC Network" className="meet-logo-xdc" />
          </div>
          <p className="meet-eyebrow">Co-sponsorship · {sponsor.company}</p>
          <h1>{event.name}</h1>
          {event.tagline && <p className="sp-tagline">{event.tagline}</p>}
          <p className="meet-sub">
            {event.details}
            {event.website && (
              <>
                {event.details ? ' · ' : ''}
                <a href={event.website} target="_blank" rel="noreferrer">
                  Event website
                </a>
              </>
            )}
          </p>
        </div>

        <div className={`sp-banner sp-${sponsor.status}`}>
          {STATUS_TEXT[sponsor.status]}
          {confirmed && sponsor.package_name ? ` Package: ${sponsor.package_name}${sponsor.value ? ` (${money(sponsor.value, event.currency)})` : ''}.` : ''}
        </div>

        {event.description && <p className="sp-desc">{event.description}</p>}
        {prospectus && (
          <p>
            <a className="sp-btn ghost" href={sponsorFileUrl(token, prospectus.id)} target="_blank" rel="noreferrer">
              Download sponsorship prospectus
            </a>
          </p>
        )}

        {packages.length > 0 && (
          <section className="sp-section">
            <h2>{confirmed ? 'Packages' : 'Choose a package'}</h2>
            <div className="sp-packages">
              {packages.map((p) => {
                const active = String(p.id) === String(pick);
                const theirs = p.id === sponsor.package_id;
                return (
                  <button
                    type="button"
                    key={p.id}
                    className={`sp-package ${active ? 'active' : ''}`}
                    onClick={() => !confirmed && setPick(String(p.id))}
                    disabled={confirmed && !theirs}
                  >
                    <div className="sp-package-head">
                      <strong>{p.name}</strong>
                      {theirs && <span className="sp-kind">{confirmed ? 'Your package' : 'Proposed'}</span>}
                    </div>
                    {p.price != null && <div className="sp-price">{money(p.price, event.currency)}</div>}
                    {p.benefits && (
                      <ul>
                        {p.benefits
                          .split('\n')
                          .filter((b) => b.trim())
                          .map((b) => (
                            <li key={b}>{b.replace(/^[-•*]\s*/, '')}</li>
                          ))}
                      </ul>
                    )}
                  </button>
                );
              })}
            </div>
            {!confirmed &&
              (thanks ? (
                <p className="meet-note">{thanks}</p>
              ) : (
                <form
                  className="sp-interest"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    setError('');
                    try {
                      await api.sponsorInterest(token, { package_id: pick || undefined, message });
                      setThanks("Thank you! We've let the team know and they'll be in touch shortly.");
                      load();
                    } catch (err) {
                      setError(err.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <textarea
                    rows={2}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Questions or anything you'd like to customise (optional)"
                  />
                  <button className="meet-submit" disabled={busy}>
                    {busy ? 'Sending…' : pick ? "We're interested in this package" : "We're interested"}
                  </button>
                </form>
              ))}
          </section>
        )}

        {invoices.length > 0 && (
          <section className="sp-section">
            <h2>Invoices</h2>
            {invoices.map((inv) => (
              <InvoiceCard key={inv.id} inv={inv} token={token} onReported={load} />
            ))}
            {event.payment_instructions && (
              <div className="sp-pay">
                <strong>How to pay</strong>
                <div className="prewrap">{event.payment_instructions}</div>
              </div>
            )}
          </section>
        )}

        {confirmed && mine.length > 0 && (
          <section className="sp-section">
            <h2>Your marketing checklist</h2>
            <p className="meet-muted small">Tick each item when it's done and paste the link so we can amplify it.</p>
            <ul className="sp-checklist">
              {mine.map((d) => (
                <SponsorItem key={`${d.id}-${d.link || ''}-${d.done}`} d={d} token={token} onSaved={load} />
              ))}
            </ul>
          </section>
        )}

        {ours.length > 0 && (
          <section className="sp-section">
            <h2>{confirmed ? "What we'll do for you" : 'What XDC does for sponsors'}</h2>
            <ul className="sp-checklist readonly">
              {ours.map((d) => (
                <li key={d.id} className={d.done ? 'done' : ''}>
                  <span className="sp-tick">{d.done ? '✓' : '○'}</span>
                  <div className="sp-item-main">
                    <span className="sp-item-title">{d.title}</span>
                    {d.link && (
                      <a href={d.link} target="_blank" rel="noreferrer" className="sp-kind">
                        View
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {error && <p className="meet-error">{error}</p>}
        <p className="meet-muted small sp-foot">Questions? Reply to any of our emails and the team will get back to you.</p>
      </div>
    </div>
  );
}
