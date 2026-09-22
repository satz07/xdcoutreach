import { useState } from 'react';
import { api, logoUrl, setSession } from './api';

export default function LoginScreen({ onAuthenticated }) {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function requestOtp(e) {
    e?.preventDefault?.();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await api.requestOtp(email.trim());
      setNotice(res.message || 'OTP sent to your email');
      setStep('otp');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.verifyOtp(email.trim(), otp.trim());
      setSession(res.token, res.user);
      onAuthenticated(res.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app auth-app">
      <div className="auth-card">
        <div className="brand-logos auth-logos">
          <img src={logoUrl('xdc.png')} alt="XDC Network" className="brand-xdc" />
          <img src={logoUrl('contour.png')} alt="Contour" className="brand-contour" />
        </div>
        <p className="eyebrow">XDC Outreach</p>
        <h1>Sign in</h1>
        <p className="auth-sub">
          Enter your invited email. We&apos;ll send a one-time code — no password.
        </p>

        {error && <div className="banner error">{error}</div>}
        {notice && <div className="banner ok">{notice}</div>}

        {step === 'email' ? (
          <form onSubmit={requestOtp} className="auth-form">
            <label>
              Work email
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </label>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Sending…' : 'Send OTP'}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyOtp} className="auth-form">
            <p className="auth-email-line">
              Code sent to <strong>{email}</strong>
            </p>
            <label>
              6-digit OTP
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••••"
              />
            </label>
            <button type="submit" className="primary" disabled={busy || otp.length !== 6}>
              {busy ? 'Verifying…' : 'Verify & continue'}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => {
                setStep('email');
                setOtp('');
                setError('');
                setNotice('');
              }}
            >
              Use a different email
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={() => requestOtp()}>
              Resend code
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
