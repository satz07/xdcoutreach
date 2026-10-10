import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, readUpload } from './api';

const STATUSES = ['prospect', 'invited', 'interested', 'confirmed', 'declined'];
const STATUS_LABELS = {
  prospect: 'Prospect',
  invited: 'Invited',
  interested: 'Interested',
  confirmed: 'Confirmed',
  declined: 'Declined',
};
const INVOICE_STATUSES = ['draft', 'sent', 'payment_reported', 'paid', 'cancelled'];
const INVOICE_LABELS = {
  draft: 'Draft',
  sent: 'Sent',
  payment_reported: 'Payment reported',
  paid: 'Paid',
  cancelled: 'Cancelled',
};
const EVENT_STATUS_LABELS = { planning: 'Planning', open: 'Open for sponsors', closed: 'Sponsorship closed', done: 'Done' };
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
const CURRENCIES = ['USD', 'AED', 'EUR', 'GBP', 'SGD', 'INR'];
const MERGE_FIELDS = ['name', 'company', 'event', 'event_details', 'package', 'amount', 'portal_link', 'sender'];

function money(v, currency = 'USD') {
  if (v == null || v === '') return '—';
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

function fmtTs(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function guessKind(title) {
  const t = title.toLowerCase();
  if (/linkedin/.test(t)) return 'linkedin';
  if (/twitter|\bx\b|tweet/.test(t)) return 'x';
  if (/newsletter|mailing|community/.test(t)) return 'newsletter';
  if (/blog|article/.test(t)) return 'blog';
  if (/website|landing/.test(t)) return 'website';
  if (/press|pr\b|media/.test(t)) return 'press';
  if (/video|youtube|reel/.test(t)) return 'video';
  if (/logo|asset|banner|bio|headshot/.test(t)) return 'asset';
  if (/speak|keynote|panel/.test(t)) return 'speaking';
  if (/booth|stand/.test(t)) return 'booth';
  return 'other';
}

/** "XDC: Logo on website" → host item; any other line is a sponsor item. */
function parseChecklist(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = /^(xdc|host|us|we|sponsor|them)\s*:\s*(.+)$/i.exec(line);
      const owner = m && /^(xdc|host|us|we)$/i.test(m[1]) ? 'host' : 'sponsor';
      const title = m ? m[2].trim() : line;
      return { title, owner, kind: guessKind(title) };
    });
}

function checklistText(list) {
  return (list || []).map((d) => `${d.owner === 'host' ? 'XDC' : 'Sponsor'}: ${d.title}`).join('\n');
}

function initialFromUrl(key) {
  try {
    return Number(new URLSearchParams(window.location.search).get(key)) || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- event form

const EMPTY_EVENT = {
  name: '',
  tagline: '',
  venue: '',
  city: '',
  start_date: '',
  end_date: '',
  website: '',
  currency: 'USD',
  sponsor_target: '',
  status: 'planning',
  from_name: 'XDC Network',
  payment_instructions: '',
  description: '',
};

function EventForm({ initial, onSave, onCancel, submitLabel }) {
  const [f, setF] = useState(() => ({ ...EMPTY_EVENT, ...Object.fromEntries(Object.entries(initial || {}).map(([k, v]) => [k, v ?? ''])) }));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave({
        name: f.name,
        tagline: f.tagline,
        venue: f.venue,
        city: f.city,
        start_date: f.start_date,
        end_date: f.end_date,
        website: f.website,
        currency: f.currency,
        sponsor_target: f.sponsor_target,
        status: f.status,
        from_name: f.from_name,
        payment_instructions: f.payment_instructions,
        description: f.description,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="host-form" onSubmit={submit}>
      <div className="host-grid">
        <label className="span-2">
          Event name *
          <input required value={f.name} onChange={set('name')} placeholder="XDC Builders Summit Dubai" />
        </label>
        <label className="span-2">
          Tagline
          <input value={f.tagline} onChange={set('tagline')} placeholder="Real-world assets on XDC" />
        </label>
        <label>
          Venue
          <input value={f.venue} onChange={set('venue')} placeholder="Museum of the Future" />
        </label>
        <label>
          City
          <input value={f.city} onChange={set('city')} placeholder="Dubai" />
        </label>
        <label>
          Start date
          <input type="date" value={f.start_date} onChange={set('start_date')} />
        </label>
        <label>
          End date
          <input type="date" value={f.end_date} onChange={set('end_date')} />
        </label>
        <label>
          Event website
          <input value={f.website} onChange={set('website')} placeholder="xdc.org/summit" />
        </label>
        <label>
          Currency
          <select value={f.currency} onChange={set('currency')}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Sponsorship target
          <input inputMode="decimal" value={f.sponsor_target} onChange={set('sponsor_target')} placeholder="60000" />
        </label>
        <label>
          Status
          <select value={f.status} onChange={set('status')}>
            {Object.entries(EVENT_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Emails sent as
          <input value={f.from_name} onChange={set('from_name')} placeholder="XDC Network" />
        </label>
        <label className="span-3">
          Payment instructions (shown on invoices and the sponsor page)
          <textarea
            rows={3}
            value={f.payment_instructions}
            onChange={set('payment_instructions')}
            placeholder={'Bank: …\nAccount name: …\nIBAN / SWIFT: …\nOr pay in XDC / USDC to: …'}
          />
        </label>
        <label className="span-4">
          About the event (shown on the sponsor page)
          <textarea rows={3} value={f.description} onChange={set('description')} />
        </label>
      </div>
      <div className="host-form-actions">
        {onCancel && (
          <button type="button" className="ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="primary" disabled={busy}>
          {busy ? 'Saving…' : submitLabel || 'Save'}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- stats

function Stats({ summary, currency }) {
  const pct = summary.target ? Math.min(100, Math.round((summary.committed / summary.target) * 100)) : null;
  const cards = [
    ['Target', money(summary.target, currency)],
    ['Confirmed', money(summary.committed, currency), `${summary.statusCounts.confirmed} sponsors`],
    ['In pipeline', money(summary.pipeline, currency), `${summary.statusCounts.invited + summary.statusCounts.interested} invited or interested`],
    ['Invoiced', money(summary.invoiced, currency)],
    ['Paid', money(summary.paid, currency), summary.outstanding ? `${money(summary.outstanding, currency)} outstanding` : 'Nothing outstanding'],
    [
      'Marketing done',
      `${summary.deliverablesDone} / ${summary.deliverablesTotal}`,
      summary.overdue ? `${summary.overdue} overdue invoice${summary.overdue > 1 ? 's' : ''}` : '',
    ],
  ];
  return (
    <>
      <div className="host-stats">
        {cards.map(([label, value, sub]) => (
          <div key={label} className={`host-stat ${label === 'Paid' && summary.overdue ? 'warn' : ''}`}>
            <span>{label}</span>
            <strong>{value}</strong>
            {sub && <small>{sub}</small>}
          </div>
        ))}
      </div>
      {pct != null && (
        <div className="host-progress" title={`${pct}% of target confirmed`}>
          <div style={{ width: `${pct}%` }} />
          <span>{pct}% of target confirmed</span>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- sponsors

function AddSponsors({ eventId, packages, onAdded, onError }) {
  const [bulk, setBulk] = useState(false);
  const [f, setF] = useState({ company: '', contact_name: '', contact_email: '', package_id: '', amount: '' });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function add(list) {
    setBusy(true);
    try {
      const r = await api.hostAddSponsors(eventId, list);
      onAdded(r);
      setF({ company: '', contact_name: '', contact_email: '', package_id: '', amount: '' });
      setText('');
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function addBulk() {
    const list = text
      .split('\n')
      .map((l) => l.split(/\t|,/).map((x) => x.trim()))
      .filter((p) => p[0])
      .map(([company, contact_name, contact_email]) => {
        if (!contact_email && /@/.test(contact_name || '')) return { company, contact_email: contact_name };
        return { company, contact_name, contact_email };
      });
    if (list.length) add(list);
  }

  return (
    <div className="host-add">
      {bulk ? (
        <>
          <textarea
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'One sponsor per line: Company, Contact name, email\nAcme Bank, Jane Doe, jane@acme.com\nBeta Labs, , hello@beta.io'}
          />
          <div className="host-add-actions">
            <button className="ghost" onClick={() => setBulk(false)}>
              Single
            </button>
            <button className="primary" onClick={addBulk} disabled={busy || !text.trim()}>
              {busy ? 'Adding…' : 'Add all'}
            </button>
          </div>
        </>
      ) : (
        <form
          className="host-add-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (f.company.trim()) add([f]);
          }}
        >
          <input required placeholder="Company *" value={f.company} onChange={set('company')} />
          <input placeholder="Contact name" value={f.contact_name} onChange={set('contact_name')} />
          <input type="email" placeholder="Contact email" value={f.contact_email} onChange={set('contact_email')} />
          <select value={f.package_id} onChange={set('package_id')}>
            <option value="">No package yet</option>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="primary" disabled={busy}>
            {busy ? 'Adding…' : '+ Add sponsor'}
          </button>
          <button type="button" className="ghost" onClick={() => setBulk(true)}>
            Paste a list
          </button>
        </form>
      )}
    </div>
  );
}

function InvoiceForm({ sponsor, currency, onSaved, onCancel, onError }) {
  const [f, setF] = useState({
    number: '',
    amount: sponsor.value || '',
    currency,
    due_date: '',
    payment_link: '',
    message: '',
  });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save(send) {
    if (send && !sponsor.contact_email) return onError('Add a contact email for this sponsor first.');
    setBusy(true);
    try {
      const upload = await readUpload(file);
      await api.hostCreateInvoice(sponsor.id, { ...f, file: upload, send });
      onSaved(send);
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="host-invoice-form">
      <div className="host-grid">
        <label>
          Invoice no.
          <input value={f.number} onChange={set('number')} placeholder="Auto" />
        </label>
        <label>
          Amount *
          <input inputMode="decimal" value={f.amount} onChange={set('amount')} />
        </label>
        <label>
          Currency
          <select value={f.currency} onChange={set('currency')}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Due date
          <input type="date" value={f.due_date} onChange={set('due_date')} />
        </label>
        <label className="span-2">
          Payment link (optional)
          <input value={f.payment_link} onChange={set('payment_link')} placeholder="Stripe / PayPal / bank portal link" />
        </label>
        <label className="span-2">
          Invoice PDF
          <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>
        <label className="span-4">
          Message in the email (optional)
          <textarea rows={2} value={f.message} onChange={set('message')} placeholder="e.g. Please quote the invoice number in the transfer." />
        </label>
      </div>
      <div className="host-form-actions">
        <button className="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="ghost" onClick={() => save(false)} disabled={busy || !f.amount}>
          Save draft
        </button>
        <button className="primary" onClick={() => save(true)} disabled={busy || !f.amount}>
          {busy ? 'Working…' : 'Save & email invoice'}
        </button>
      </div>
    </div>
  );
}

function Checklist({ items, owner, onUpdate, onDelete }) {
  const list = items.filter((d) => d.owner === owner);
  if (!list.length) return <p className="muted small">Nothing here yet.</p>;
  return (
    <ul className="host-checklist">
      {list.map((d) => (
        <li key={d.id} className={d.done ? 'done' : ''}>
          <input type="checkbox" checked={d.done} onChange={() => onUpdate(d.id, { done: !d.done })} />
          <div className="host-check-main">
            <div>
              <span className="host-check-title">{d.title}</span>
              <span className={`tag kind-${d.kind}`}>{KIND_LABELS[d.kind] || d.kind}</span>
              {d.due_date && <span className={`tag ${!d.done && d.due_date < new Date().toISOString().slice(0, 10) ? 'bad' : ''}`}>due {fmtDate(d.due_date)}</span>}
            </div>
            <div className="host-check-link">
              <input
                key={`${d.id}-${d.link || ''}`}
                defaultValue={d.link || ''}
                placeholder="Paste the post / proof link"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== (d.link || '')) onUpdate(d.id, { link: v, ...(v && !d.done ? { done: true } : {}) });
                }}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
              {d.link && (
                <a href={d.link} target="_blank" rel="noreferrer">
                  Open
                </a>
              )}
            </div>
          </div>
          <button className="ghost icon-btn" title="Remove" onClick={() => onDelete(d.id)}>
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

function SponsorDetail({ id, event, packages, onChanged, onClose, onInvite, setError, setNotice }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [note, setNote] = useState('');
  const [showInvoice, setShowInvoice] = useState(false);
  const [item, setItem] = useState({ title: '', owner: 'sponsor', kind: '', due_date: '' });

  const load = useCallback(async () => {
    try {
      const d = await api.hostSponsor(id);
      setData(d);
      const s = d.sponsor;
      setForm({
        company: s.company || '',
        contact_name: s.contact_name || '',
        contact_email: s.contact_email || '',
        cc_emails: s.cc_emails || '',
        website: s.website || '',
        package_id: s.package_id || '',
        amount: s.amount ?? '',
      });
    } catch (err) {
      setError(err.message);
    }
  }, [id, setError]);

  useEffect(() => {
    setData(null);
    setShowInvoice(false);
    load();
  }, [load]);

  const run = async (fn, msg) => {
    setError('');
    try {
      await fn();
      if (msg) setNotice(msg);
      await load();
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!data || !form) {
    return (
      <aside className="lead-detail host-detail">
        <p className="muted">Loading…</p>
      </aside>
    );
  }
  const s = data.sponsor;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const dirty =
    form.company !== (s.company || '') ||
    form.contact_name !== (s.contact_name || '') ||
    form.contact_email !== (s.contact_email || '') ||
    form.cc_emails !== (s.cc_emails || '') ||
    form.website !== (s.website || '') ||
    String(form.package_id || '') !== String(s.package_id || '') ||
    String(form.amount ?? '') !== String(s.amount ?? '');
  const pkg = packages.find((p) => String(p.id) === String(form.package_id));

  return (
    <aside className="lead-detail host-detail">
      <div className="lead-detail-head">
        <div>
          <h3>{s.company}</h3>
          <p className="muted small">
            {[s.contact_name, s.contact_email].filter(Boolean).join(' · ') || 'No contact yet'}
          </p>
        </div>
        <div className="host-detail-head-actions">
          <select
            className={`status-select sp-${s.status}`}
            value={s.status}
            onChange={(e) => run(() => api.hostUpdateSponsor(s.id, { status: e.target.value }))}
          >
            {STATUSES.map((x) => (
              <option key={x} value={x}>
                {STATUS_LABELS[x]}
              </option>
            ))}
          </select>
          <button className="ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <section className="host-section">
        <div className="host-grid two">
          <label>
            Company
            <input value={form.company} onChange={set('company')} />
          </label>
          <label>
            Contact name
            <input value={form.contact_name} onChange={set('contact_name')} />
          </label>
          <label>
            Contact email
            <input type="email" value={form.contact_email} onChange={set('contact_email')} />
          </label>
          <label>
            CC (finance / marketing)
            <input value={form.cc_emails} onChange={set('cc_emails')} placeholder="finance@…, marketing@…" />
          </label>
          <label>
            Package
            <select value={form.package_id} onChange={set('package_id')}>
              <option value="">No package</option>
              {packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {money(p.price, event.currency)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Agreed amount
            <input
              inputMode="decimal"
              value={form.amount}
              onChange={set('amount')}
              placeholder={pkg?.price ? `${pkg.price} (package price)` : 'Amount'}
            />
          </label>
          <label className="span-2">
            Website
            <input value={form.website} onChange={set('website')} />
          </label>
        </div>
        {dirty && (
          <div className="host-form-actions">
            <button className="primary" onClick={() => run(() => api.hostUpdateSponsor(s.id, form), 'Sponsor saved')}>
              Save changes
            </button>
          </div>
        )}
      </section>

      <section className="host-section">
        <h4>Sponsor page</h4>
        <p className="muted small">
          Their private page shows the packages, invoices, payment details and their marketing checklist. It's linked from every email.
        </p>
        <div className="leads-notify-row">
          <input readOnly value={s.portal_url} onFocus={(e) => e.target.select()} />
          <button
            className="ghost"
            onClick={() => {
              navigator.clipboard?.writeText(s.portal_url);
              setNotice('Sponsor page link copied');
            }}
          >
            Copy
          </button>
          <a className="ghost btn-link" href={s.portal_url} target="_blank" rel="noreferrer">
            Open
          </a>
        </div>
        <div className="host-inline-actions">
          <button className="primary" onClick={() => onInvite(s.id)} disabled={!s.contact_email}>
            {s.invited_at ? 'Send invite again' : 'Send invite'}
          </button>
          <button
            className="ghost small-btn"
            onClick={() =>
              window.confirm('Reset the link? The old link will stop working.') &&
              run(() => api.hostResetPortal(s.id), 'New sponsor page link created')
            }
          >
            Reset link
          </button>
        </div>
      </section>

      <section className="host-section">
        <div className="host-section-head">
          <h4>Invoices</h4>
          {!showInvoice && (
            <button className="ghost small-btn" onClick={() => setShowInvoice(true)}>
              + New invoice
            </button>
          )}
        </div>
        {showInvoice && (
          <InvoiceForm
            sponsor={s}
            currency={event.currency}
            onCancel={() => setShowInvoice(false)}
            onError={setError}
            onSaved={(sent) => {
              setShowInvoice(false);
              setNotice(sent ? `Invoice emailed to ${s.contact_email}` : 'Invoice saved as draft');
              load();
              onChanged();
            }}
          />
        )}
        {data.invoices.length === 0 && !showInvoice && <p className="muted small">No invoices yet.</p>}
        {data.invoices.map((inv) => (
          <div key={inv.id} className={`host-invoice inv-${inv.status} ${inv.overdue ? 'overdue' : ''}`}>
            <div className="host-invoice-main">
              <strong>{inv.number}</strong>
              <span>{money(inv.amount, inv.currency)}</span>
              {inv.due_date && <span className="muted small">due {fmtDate(inv.due_date)}</span>}
              {inv.overdue && <span className="tag bad">overdue</span>}
              {inv.payment_reference && <span className="tag">ref {inv.payment_reference}</span>}
            </div>
            <div className="host-invoice-actions">
              <select
                className={`status-select inv-${inv.status}`}
                value={inv.status}
                onChange={(e) => run(() => api.hostUpdateInvoice(inv.id, { status: e.target.value }))}
              >
                {INVOICE_STATUSES.map((x) => (
                  <option key={x} value={x}>
                    {INVOICE_LABELS[x]}
                  </option>
                ))}
              </select>
              {inv.file_id ? (
                <button className="ghost small-btn" onClick={() => api.hostOpenFile(inv.file_id).catch((e) => setError(e.message))}>
                  PDF
                </button>
              ) : null}
              <label className="ghost small-btn file-btn" title="Upload or replace the invoice PDF">
                {inv.file_id ? 'Replace' : 'Attach PDF'}
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  onChange={async (e) => {
                    const picked = e.target.files?.[0];
                    e.target.value = '';
                    if (!picked) return;
                    run(async () => api.hostUpdateInvoice(inv.id, { file: await readUpload(picked) }), 'PDF uploaded');
                  }}
                />
              </label>
              {inv.status === 'draft' && (
                <button className="primary small-btn" onClick={() => run(() => api.hostSendInvoice(inv.id), 'Invoice emailed')}>
                  Email
                </button>
              )}
              {(inv.status === 'sent' || inv.status === 'payment_reported') && (
                <button
                  className="ghost small-btn"
                  onClick={() => run(() => api.hostSendInvoice(inv.id, { reminder: true }), 'Reminder sent')}
                >
                  Remind
                </button>
              )}
              <button
                className="ghost icon-btn"
                title="Delete invoice"
                onClick={() => window.confirm(`Delete invoice ${inv.number}?`) && run(() => api.hostDeleteInvoice(inv.id))}
              >
                ×
              </button>
            </div>
            <div className="muted small">
              {inv.sent_at ? `Sent ${fmtTs(inv.sent_at)}` : 'Not sent yet'}
              {inv.reminded_at ? ` · reminded ${fmtTs(inv.reminded_at)}` : ''}
              {inv.paid_at ? ` · paid ${fmtTs(inv.paid_at)}` : ''}
              {inv.payment_link && (
                <>
                  {' · '}
                  <a href={inv.payment_link} target="_blank" rel="noreferrer">
                    payment link
                  </a>
                </>
              )}
            </div>
          </div>
        ))}
      </section>

      <section className="host-section">
        <div className="host-section-head">
          <h4>
            Marketing checklist{' '}
            <span className="muted small">
              {s.deliverables_done}/{s.deliverables_total} done
            </span>
          </h4>
          <button
            className="ghost small-btn"
            onClick={() => run(() => api.hostAddDeliverable(s.id, { defaults: true }), 'Standard items added')}
          >
            + Standard items
          </button>
        </div>
        <h5>What {s.company} does</h5>
        <Checklist
          items={data.deliverables}
          owner="sponsor"
          onUpdate={(did, body) => run(() => api.hostUpdateDeliverable(did, body))}
          onDelete={(did) => run(() => api.hostDeleteDeliverable(did))}
        />
        <h5>What we do (XDC)</h5>
        <Checklist
          items={data.deliverables}
          owner="host"
          onUpdate={(did, body) => run(() => api.hostUpdateDeliverable(did, body))}
          onDelete={(did) => run(() => api.hostDeleteDeliverable(did))}
        />
        <form
          className="host-add-item"
          onSubmit={(e) => {
            e.preventDefault();
            if (!item.title.trim()) return;
            run(async () => {
              await api.hostAddDeliverable(s.id, { ...item, kind: item.kind || guessKind(item.title) });
              setItem({ title: '', owner: item.owner, kind: '', due_date: '' });
            });
          }}
        >
          <input
            placeholder="Add item, e.g. Speaker bio & headshot"
            value={item.title}
            onChange={(e) => setItem((x) => ({ ...x, title: e.target.value }))}
          />
          <select value={item.owner} onChange={(e) => setItem((x) => ({ ...x, owner: e.target.value }))}>
            <option value="sponsor">Sponsor does</option>
            <option value="host">We do</option>
          </select>
          <select value={item.kind} onChange={(e) => setItem((x) => ({ ...x, kind: e.target.value }))}>
            <option value="">Type (auto)</option>
            {Object.entries(KIND_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <input type="date" value={item.due_date} onChange={(e) => setItem((x) => ({ ...x, due_date: e.target.value }))} />
          <button className="ghost" disabled={!item.title.trim()}>
            Add
          </button>
        </form>
      </section>

      <section className="host-section">
        <h4>Notes & activity</h4>
        <div className="lead-note-box">
          <textarea
            rows={2}
            placeholder="Add a note (call outcome, negotiated terms, next step…)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            className="primary"
            disabled={!note.trim()}
            onClick={() =>
              run(async () => {
                await api.hostSponsorNote(s.id, note);
                setNote('');
              })
            }
          >
            Add note
          </button>
        </div>
        <ul className="lead-timeline">
          {data.activity.map((a) => (
            <li key={a.id} className={a.kind === 'note' ? 'note' : a.kind === 'sponsor' ? 'sponsor' : 'system'}>
              <div className="small muted">
                {fmtTs(a.created_at)} · {a.kind === 'sponsor' ? s.company : a.user_email || 'system'}
              </div>
              <div className="prewrap">{a.body}</div>
            </li>
          ))}
        </ul>
      </section>

      <button
        className="ghost danger-text"
        onClick={() =>
          window.confirm(`Remove ${s.company} and all its invoices and checklist items?`) &&
          api
            .hostDeleteSponsor(s.id)
            .then(() => {
              setNotice(`${s.company} removed`);
              onClose();
              onChanged();
            })
            .catch((err) => setError(err.message))
        }
      >
        Remove sponsor
      </button>
    </aside>
  );
}

function SponsorsView({ overview, openId, setOpenId, onChanged, onInvite, setError, setNotice }) {
  const [filter, setFilter] = useState('');
  const { event, packages, sponsors, summary } = overview;
  const shown = filter ? sponsors.filter((s) => s.status === filter) : sponsors;
  const open = sponsors.find((s) => s.id === openId);

  return (
    <>
      <AddSponsors
        eventId={event.id}
        packages={packages}
        onError={setError}
        onAdded={(r) => {
          setNotice(`Added ${r.created} sponsor${r.created === 1 ? '' : 's'}${r.skipped ? ` · ${r.skipped} skipped (already added)` : ''}`);
          onChanged();
          if (r.ids?.length === 1) setOpenId(r.ids[0]);
        }}
      />
      <div className="lead-status-chips">
        <button className={`chip ${filter === '' ? 'active' : ''}`} onClick={() => setFilter('')}>
          All <span>{sponsors.length}</span>
        </button>
        {STATUSES.map((s) => (
          <button key={s} className={`chip ${filter === s ? 'active' : ''}`} onClick={() => setFilter(s)}>
            {STATUS_LABELS[s]} <span>{summary.statusCounts[s] || 0}</span>
          </button>
        ))}
      </div>
      <div className={`leads-layout ${open ? 'with-detail' : ''}`}>
        <div className="table-wrap">
          <table className="leads-table host-table">
            <thead>
              <tr>
                <th>Sponsor</th>
                <th>Package</th>
                <th>Value</th>
                <th>Status</th>
                <th>Invoice</th>
                <th>Marketing</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted empty-row">
                    {sponsors.length ? 'No sponsors with this status.' : 'Add the companies you want to invite as co-sponsors.'}
                  </td>
                </tr>
              )}
              {shown.map((s) => {
                const pct = s.deliverables_total ? Math.round((s.deliverables_done / s.deliverables_total) * 100) : 0;
                return (
                  <tr key={s.id} className={`lead-row ${openId === s.id ? 'selected' : ''}`} onClick={() => setOpenId(openId === s.id ? null : s.id)}>
                    <td>
                      <strong>{s.company}</strong>
                      <div className="muted small">{[s.contact_name, s.contact_email].filter(Boolean).join(' · ') || 'No contact'}</div>
                    </td>
                    <td className="small">{s.package_name || '—'}</td>
                    <td className="nowrap">{money(s.value, event.currency)}</td>
                    <td>
                      <span className={`sp-pill sp-${s.status}`}>{STATUS_LABELS[s.status]}</span>
                    </td>
                    <td className="small">
                      {s.invoice_status ? (
                        <span className={`sp-pill inv-${s.invoice_status}`}>{INVOICE_LABELS[s.invoice_status]}</span>
                      ) : (
                        '—'
                      )}
                      {s.overdue && <span className="tag bad">overdue</span>}
                      {s.paid > 0 && <div className="muted">{money(s.paid, event.currency)} paid</div>}
                    </td>
                    <td className="small">
                      {s.deliverables_total ? (
                        <div className="host-mini-progress" title={`${s.deliverables_done} of ${s.deliverables_total} done`}>
                          <div style={{ width: `${pct}%` }} />
                          <span>
                            {s.deliverables_done}/{s.deliverables_total}
                          </span>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {open && (
          <SponsorDetail
            id={open.id}
            event={event}
            packages={packages}
            onChanged={onChanged}
            onClose={() => setOpenId(null)}
            onInvite={onInvite}
            setError={setError}
            setNotice={setNotice}
          />
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- packages

function PackageForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState(() => ({
    name: initial?.name || '',
    price: initial?.price ?? '',
    slots: initial?.slots ?? '',
    benefits: initial?.benefits || '',
    checklist: checklistText(initial?.deliverables),
  }));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form
      className="host-package-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSave({
            name: f.name,
            price: f.price,
            slots: f.slots,
            benefits: f.benefits,
            ...(f.checklist.trim() || initial ? { deliverables: parseChecklist(f.checklist) } : {}),
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="host-grid">
        <label className="span-2">
          Package name *
          <input required value={f.name} onChange={set('name')} placeholder="Gold" />
        </label>
        <label>
          Price
          <input inputMode="decimal" value={f.price} onChange={set('price')} placeholder="25000" />
        </label>
        <label>
          Slots available
          <input inputMode="numeric" value={f.slots} onChange={set('slots')} placeholder="2" />
        </label>
        <label className="span-2">
          Benefits (one per line)
          <textarea rows={5} value={f.benefits} onChange={set('benefits')} placeholder={'Keynote slot (15 min)\nBooth 3×3m\nLogo on stage and website\n4 VIP passes'} />
        </label>
        <label className="span-2">
          Marketing checklist (one per line; start with "XDC:" for things we do)
          <textarea
            rows={5}
            value={f.checklist}
            onChange={set('checklist')}
            placeholder={'Sponsor: Announce on LinkedIn\nSponsor: Announce on X (Twitter)\nXDC: Welcome post on XDC LinkedIn\nXDC: Logo on event website\n(leave empty for the standard list)'}
          />
        </label>
      </div>
      <div className="host-form-actions">
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save package'}
        </button>
      </div>
    </form>
  );
}

function PackagesView({ overview, onChanged, setError, setNotice }) {
  const { event, packages, summary } = overview;
  const [editing, setEditing] = useState(null);
  const save = async (fn, msg) => {
    setError('');
    try {
      await fn();
      setNotice(msg);
      setEditing(null);
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <p className="muted small">
        Packages are the sponsorship levels you offer. Each one has a price, number of slots, benefits and the marketing
        checklist that's added to every sponsor on that package.
      </p>
      <div className="host-packages">
        {packages.map((p) =>
          editing === p.id ? (
            <div key={p.id} className="host-package editing">
              <PackageForm
                initial={p}
                onCancel={() => setEditing(null)}
                onSave={(body) => save(() => api.hostUpdatePackage(p.id, body), `${body.name} saved`)}
              />
            </div>
          ) : (
            <div key={p.id} className="host-package">
              <div className="host-package-head">
                <h4>{p.name}</h4>
                <strong>{money(p.price, event.currency)}</strong>
              </div>
              <div className="muted small">
                {summary.packageSlotsUsed[p.id] || 0} confirmed{p.slots != null ? ` of ${p.slots} slots` : ''}
              </div>
              {p.benefits && (
                <ul className="host-benefits">
                  {p.benefits
                    .split('\n')
                    .filter((b) => b.trim())
                    .map((b) => (
                      <li key={b}>{b.replace(/^[-•*]\s*/, '')}</li>
                    ))}
                </ul>
              )}
              {p.deliverables?.length > 0 && (
                <div className="muted small">
                  Checklist: {p.deliverables.filter((d) => d.owner === 'sponsor').length} sponsor items ·{' '}
                  {p.deliverables.filter((d) => d.owner === 'host').length} XDC items
                </div>
              )}
              <div className="host-inline-actions">
                <button className="ghost small-btn" onClick={() => setEditing(p.id)}>
                  Edit
                </button>
                <button
                  className="ghost small-btn danger-text"
                  onClick={() =>
                    window.confirm(`Delete the ${p.name} package? Sponsors on it keep their details.`) &&
                    save(() => api.hostDeletePackage(p.id), `${p.name} deleted`)
                  }
                >
                  Delete
                </button>
              </div>
            </div>
          )
        )}
        {editing === 'new' ? (
          <div className="host-package editing">
            <PackageForm
              onCancel={() => setEditing(null)}
              onSave={(body) => save(() => api.hostCreatePackage(event.id, body), `${body.name} package added`)}
            />
          </div>
        ) : (
          <button className="host-package add" onClick={() => setEditing('new')}>
            + Add package
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- invite

function InviteView({ overview, preselect, onChanged, setError, setNotice }) {
  const { event, sponsors, prospectus, defaults } = overview;
  const withEmail = sponsors.filter((s) => s.contact_email);
  const [selected, setSelected] = useState(() => {
    if (preselect) return new Set([preselect]);
    return new Set(withEmail.filter((s) => s.status === 'prospect').map((s) => s.id));
  });
  const [subject, setSubject] = useState(event.invite_subject || defaults.invite_subject);
  const [body, setBody] = useState(event.invite_body || defaults.invite_body);
  const [attach, setAttach] = useState(Boolean(prospectus));
  const [saveDefault, setSaveDefault] = useState(false);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);

  const toggle = (id) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const firstId = [...selected][0] || withEmail[0]?.id;
  useEffect(() => {
    if (!firstId) return setPreview(null);
    const t = setTimeout(() => {
      api
        .hostInvitePreview(event.id, { sponsor_id: firstId, subject, body })
        .then(setPreview)
        .catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [event.id, firstId, subject, body]);

  async function send() {
    const n = selected.size;
    if (!n || !window.confirm(`Email the invitation to ${n} sponsor${n > 1 ? 's' : ''}?`)) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.hostSendInvites(event.id, {
        sponsor_ids: [...selected],
        subject,
        body,
        attach_prospectus: attach,
        save_as_default: saveDefault,
      });
      setResults(r.results);
      setNotice(`Invitations sent: ${r.sent}${r.failed ? ` · ${r.failed} failed` : ''}`);
      setSelected(new Set());
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="host-invite">
      <div className="host-invite-left">
        <div className="host-section-head">
          <h4>
            Send to <span className="muted small">{selected.size} selected</span>
          </h4>
          <div className="host-inline-actions">
            <button className="ghost small-btn" onClick={() => setSelected(new Set(withEmail.filter((s) => s.status === 'prospect').map((s) => s.id)))}>
              Not invited yet
            </button>
            <button className="ghost small-btn" onClick={() => setSelected(new Set(withEmail.map((s) => s.id)))}>
              All
            </button>
            <button className="ghost small-btn" onClick={() => setSelected(new Set())}>
              None
            </button>
          </div>
        </div>
        <div className="host-recipients">
          {withEmail.length === 0 && <p className="muted small">Add sponsors with a contact email first.</p>}
          {withEmail.map((s) => (
            <label key={s.id} className="host-recipient">
              <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
              <span>
                <strong>{s.company}</strong> <span className="muted small">{s.contact_email}</span>
              </span>
              <span className={`sp-pill sp-${s.status}`}>{STATUS_LABELS[s.status]}</span>
              {s.invited_at && <span className="muted small">invited {fmtTs(s.invited_at)}</span>}
            </label>
          ))}
        </div>
        <label>
          Subject
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label>
          Message
          <textarea rows={11} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <p className="muted small">
          Merge fields: {MERGE_FIELDS.map((m) => `{{${m}}}`).join(' ')}. Replies go to your email.
        </p>
        <label className="check-row">
          <input type="checkbox" checked={attach} disabled={!prospectus} onChange={(e) => setAttach(e.target.checked)} />
          {prospectus ? `Attach prospectus (${prospectus.filename})` : 'Attach prospectus (upload one in Event settings)'}
        </label>
        <label className="check-row">
          <input type="checkbox" checked={saveDefault} onChange={(e) => setSaveDefault(e.target.checked)} />
          Save this subject and message as the default for this event
        </label>
        <div className="host-form-actions">
          <button
            className="ghost"
            onClick={() => {
              setSubject(defaults.invite_subject);
              setBody(defaults.invite_body);
            }}
          >
            Reset text
          </button>
          <button className="primary" onClick={send} disabled={busy || !selected.size}>
            {busy ? 'Sending…' : `Send invitation${selected.size > 1 ? 's' : ''} (${selected.size})`}
          </button>
        </div>
        {results && (
          <ul className="host-results">
            {results.map((r) => (
              <li key={r.id} className={r.ok ? 'ok' : 'bad'}>
                {r.ok ? '✓' : '✗'} {r.company || `#${r.id}`} {r.error ? `— ${r.error}` : ''}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="host-invite-preview">
        <div className="muted small">
          Preview{preview ? ` · ${sponsors.find((s) => s.id === firstId)?.company || ''}` : ''}
        </div>
        {preview ? (
          <>
            <div className="host-preview-subject">{preview.subject}</div>
            <iframe title="Invitation preview" srcDoc={preview.html} />
          </>
        ) : (
          <p className="muted small">Select a sponsor to preview the email.</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- settings

function SettingsView({ overview, isSuperAdmin, onChanged, onDeleted, setError, setNotice }) {
  const { event, prospectus } = overview;
  const [uploading, setUploading] = useState(false);
  return (
    <div>
      <EventForm
        key={event.updated_at}
        initial={event}
        submitLabel="Save event"
        onSave={async (body) => {
          setError('');
          try {
            await api.hostUpdateEvent(event.id, body);
            setNotice('Event saved');
            onChanged();
          } catch (err) {
            setError(err.message);
          }
        }}
      />
      <div className="host-section">
        <h4>Sponsorship prospectus</h4>
        <p className="muted small">A PDF deck with your packages. It can be attached to invitations and downloaded from every sponsor page.</p>
        <div className="host-inline-actions">
          {prospectus && (
            <>
              <button className="ghost small-btn" onClick={() => api.hostOpenFile(prospectus.id).catch((e) => setError(e.message))}>
                {prospectus.filename}
              </button>
              <button
                className="ghost small-btn danger-text"
                onClick={() =>
                  api
                    .hostRemoveProspectus(event.id)
                    .then(() => {
                      setNotice('Prospectus removed');
                      onChanged();
                    })
                    .catch((e) => setError(e.message))
                }
              >
                Remove
              </button>
            </>
          )}
          <label className="ghost small-btn file-btn">
            {uploading ? 'Uploading…' : prospectus ? 'Replace PDF' : 'Upload PDF'}
            <input
              type="file"
              accept="application/pdf"
              disabled={uploading}
              onChange={async (e) => {
                const picked = e.target.files?.[0];
                e.target.value = '';
                if (!picked) return;
                setUploading(true);
                setError('');
                try {
                  await api.hostUploadProspectus(event.id, await readUpload(picked));
                  setNotice('Prospectus uploaded');
                  onChanged();
                } catch (err) {
                  setError(err.message);
                } finally {
                  setUploading(false);
                }
              }}
            />
          </label>
        </div>
      </div>
      {isSuperAdmin && (
        <div className="host-section">
          <button
            className="ghost danger-text"
            onClick={() =>
              window.confirm(`Delete ${event.name} with all sponsors, invoices and files? This cannot be undone.`) &&
              api
                .hostDeleteEvent(event.id)
                .then(onDeleted)
                .catch((e) => setError(e.message))
            }
          >
            Delete event
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- panel

export default function HostingPanel({ isSuperAdmin }) {
  const [events, setEvents] = useState(null);
  const [eventId, setEventId] = useState(() => initialFromUrl('hostedEvent') || Number(localStorage.getItem('host_event')) || null);
  const [overview, setOverview] = useState(null);
  const [view, setView] = useState('sponsors');
  const [openId, setOpenId] = useState(() => initialFromUrl('sponsor'));
  const [invitePreselect, setInvitePreselect] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadEvents = useCallback(async () => {
    try {
      const d = await api.hostEvents();
      setEvents(d.events);
      return d.events;
    } catch (err) {
      setError(err.message);
      return [];
    }
  }, []);

  const loadOverview = useCallback(async (id) => {
    if (!id) return setOverview(null);
    try {
      setOverview(await api.hostEvent(id));
    } catch (err) {
      setError(err.message);
      setOverview(null);
    }
  }, []);

  useEffect(() => {
    loadEvents().then((list) => {
      if (!list.length) return;
      setEventId((cur) => (list.some((e) => e.id === cur) ? cur : list[0].id));
    });
  }, [loadEvents]);

  useEffect(() => {
    if (eventId) localStorage.setItem('host_event', String(eventId));
    loadOverview(eventId);
  }, [eventId, loadOverview]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const refresh = useCallback(() => {
    loadOverview(eventId);
    loadEvents();
  }, [eventId, loadOverview, loadEvents]);

  const switchEvent = (id) => {
    setEventId(id);
    setOpenId(null);
    setView('sponsors');
    setCreating(false);
  };

  const ev = overview?.event?.id === eventId ? overview.event : null;
  const invitable = useMemo(() => (overview?.sponsors || []).filter((s) => s.contact_email).length, [overview]);

  return (
    <main className="panel hosting-panel">
      <div className="panel-head row">
        <div>
          <h2>Host events & co-sponsors</h2>
          <p className="muted">
            Plan the events XDC hosts, invite co-sponsors, send invoices, track payments and every sponsor's marketing in one place.
          </p>
        </div>
        <button className="primary" onClick={() => setCreating((c) => !c)}>
          {creating ? 'Close' : '+ New event'}
        </button>
      </div>

      {(error || notice) && (
        <div className="banners">
          {error && (
            <div className="banner error" onClick={() => setError('')}>
              {error}
            </div>
          )}
          {notice && <div className="banner ok">{notice}</div>}
        </div>
      )}

      {creating && (
        <div className="host-card">
          <h3>New event</h3>
          <EventForm
            submitLabel="Create event"
            onCancel={() => setCreating(false)}
            onSave={async (body) => {
              setError('');
              try {
                const { event } = await api.hostCreateEvent(body);
                setNotice(`${event.name} created. Next: add sponsorship packages.`);
                await loadEvents();
                switchEvent(event.id);
                setView('packages');
              } catch (err) {
                setError(err.message);
              }
            }}
          />
        </div>
      )}

      {events && events.length > 0 && (
        <div className="host-events">
          {events.map((e) => (
            <button key={e.id} className={`host-event-pill ${e.id === eventId ? 'active' : ''}`} onClick={() => switchEvent(e.id)}>
              <strong>{e.name}</strong>
              <small>
                {e.summary.statusCounts.confirmed} confirmed · {money(e.summary.committed, e.currency)}
                {e.status === 'done' ? ' · done' : ''}
              </small>
            </button>
          ))}
        </div>
      )}

      {events && events.length === 0 && !creating && (
        <div className="host-empty">
          <h3>Host your first event</h3>
          <p className="muted">
            Create the event, add sponsorship packages (e.g. Gold, Silver), add the companies you want as co-sponsors, then send
            invitations. Invoices, payments and marketing commitments are tracked per sponsor.
          </p>
          <button className="primary" onClick={() => setCreating(true)}>
            + New event
          </button>
        </div>
      )}

      {ev && overview && (
        <>
          <div className="host-event-head">
            <div>
              <h3>{ev.name}</h3>
              <p className="muted small">
                {[ev.details, EVENT_STATUS_LABELS[ev.status]].filter(Boolean).join(' · ')}
                {ev.website && (
                  <>
                    {' · '}
                    <a href={ev.website} target="_blank" rel="noreferrer">
                      website
                    </a>
                  </>
                )}
              </p>
            </div>
          </div>
          <Stats summary={overview.summary} currency={ev.currency} />

          <nav className="host-subnav">
            {[
              ['sponsors', `Sponsors (${overview.sponsors.length})`],
              ['packages', `Packages (${overview.packages.length})`],
              ['invite', `Invite (${invitable})`],
              ['settings', 'Event settings'],
            ].map(([k, label]) => (
              <button
                key={k}
                className={view === k ? 'active' : ''}
                onClick={() => {
                  setInvitePreselect(null);
                  setView(k);
                }}
              >
                {label}
              </button>
            ))}
          </nav>

          {view === 'sponsors' && (
            <SponsorsView
              overview={overview}
              openId={openId}
              setOpenId={setOpenId}
              onChanged={refresh}
              onInvite={(sid) => {
                setInvitePreselect(sid);
                setView('invite');
              }}
              setError={setError}
              setNotice={setNotice}
            />
          )}
          {view === 'packages' && <PackagesView overview={overview} onChanged={refresh} setError={setError} setNotice={setNotice} />}
          {view === 'invite' && (
            <InviteView
              key={`${ev.id}-${invitePreselect || ''}`}
              overview={overview}
              preselect={invitePreselect}
              onChanged={refresh}
              setError={setError}
              setNotice={setNotice}
            />
          )}
          {view === 'settings' && (
            <SettingsView
              overview={overview}
              isSuperAdmin={isSuperAdmin}
              onChanged={refresh}
              onDeleted={async () => {
                setNotice(`${ev.name} deleted`);
                localStorage.removeItem('host_event');
                const list = await loadEvents();
                switchEvent(list[0]?.id || null);
              }}
              setError={setError}
              setNotice={setNotice}
            />
          )}
        </>
      )}
    </main>
  );
}
