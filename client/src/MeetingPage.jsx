import { useEffect, useState } from 'react';
import { api, logoUrl } from './api';

const TIME_OPTIONS = ['Morning', 'Midday', 'Afternoon', 'Evening', 'Flexible'];
const MODE_OPTIONS = ['In person at the event', 'Video call', 'Phone call'];

const EMPTY = {
  email: '',
  name: '',
  company: '',
  job_title: '',
  phone: '',
  preferred_date: '',
  preferred_time: '',
  meeting_mode: MODE_OPTIONS[0],
  topic: '',
  message: '',
  website: '',
};

export default function MeetingPage({ token, event }) {
  const [info, setInfo] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  useEffect(() => {
    let alive = true;
    api
      .meetForm({ token, event })
      .then((d) => {
        if (!alive) return;
        setInfo(d);
        setForm((f) => ({
          ...f,
          email: d.email || '',
          name: d.name || '',
          company: d.company || '',
        }));
      })
      .catch((err) => alive && setError(err.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [token, event]);

  const brand = info?.event?.brand || 'xdc';
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.submitMeet({
        ...form,
        token: info?.verified ? token : undefined,
        event_id: info?.event?.id || undefined,
      });
      setDone(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`meet-page meet-theme-${brand}`}>
      <div className="meet-card">
        <div className="meet-head">
          <div className="meet-logos">
            {brand === 'contour' ? (
              <img src={logoUrl('contour.png')} alt="Contour Network" className="meet-logo-contour" />
            ) : (
              <>
                <img src={logoUrl('xdc.png')} alt="XDC Network" className="meet-logo-xdc" />
                <img src={logoUrl('contour.png')} alt="Contour" className="meet-logo-contour" />
              </>
            )}
          </div>
          <p className="meet-eyebrow">{info?.event?.name || 'Meeting request'}</p>
          <h1>Request a meeting</h1>
          <p className="meet-sub">
            {info?.event?.location || info?.event?.dates
              ? [info.event.location, info.event.dates].filter(Boolean).join(' · ')
              : 'Tell us a little about you and when suits you — our team will confirm a time.'}
          </p>
        </div>

        {loading ? (
          <p className="meet-muted">Loading…</p>
        ) : done ? (
          <div className="meet-done">
            <h2>Thank you{form.name ? `, ${form.name.split(' ')[0]}` : ''}!</h2>
            <p>
              {done.resubmitted
                ? 'We have updated your meeting request.'
                : 'Your meeting request has been received.'}{' '}
              Our team will reach out to <strong>{form.email}</strong> shortly to confirm a time.
            </p>
          </div>
        ) : (
          <form className="meet-form" onSubmit={submit}>
            {info?.alreadySubmitted && (
              <p className="meet-note">
                We already have a request from you — submitting again will update it.
              </p>
            )}
            <div className="meet-grid">
              <label>
                Email *
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={set('email')}
                  readOnly={Boolean(info?.verified)}
                />
              </label>
              <label>
                Full name *
                <input required value={form.name} onChange={set('name')} autoComplete="name" />
              </label>
              <label>
                Company
                <input value={form.company} onChange={set('company')} autoComplete="organization" />
              </label>
              <label>
                Job title
                <input value={form.job_title} onChange={set('job_title')} autoComplete="organization-title" />
              </label>
              <label>
                Phone / WhatsApp
                <input value={form.phone} onChange={set('phone')} autoComplete="tel" />
              </label>
              <label>
                Meeting format
                <select value={form.meeting_mode} onChange={set('meeting_mode')}>
                  {MODE_OPTIONS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <label>
                Preferred date
                <input type="date" value={form.preferred_date} onChange={set('preferred_date')} />
              </label>
              <label>
                Preferred time
                <select value={form.preferred_time} onChange={set('preferred_time')}>
                  <option value="">Any time</option>
                  {TIME_OPTIONS.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              What would you like to discuss?
              <input
                value={form.topic}
                onChange={set('topic')}
                placeholder="e.g. Trade finance digitisation, stablecoin settlement, partnership"
              />
            </label>
            <label>
              Anything else?
              <textarea rows={4} value={form.message} onChange={set('message')} />
            </label>
            <input
              className="meet-hp"
              tabIndex={-1}
              autoComplete="off"
              value={form.website}
              onChange={set('website')}
              aria-hidden="true"
            />
            {error && <p className="meet-error">{error}</p>}
            <button type="submit" className="meet-submit" disabled={busy}>
              {busy ? 'Sending…' : 'Request meeting'}
            </button>
            <p className="meet-muted small">
              We only use these details to arrange this meeting.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
