import { useEffect, useState } from 'react';
import { api, logoUrl, setSession } from './api';

export default function LoginScreen({ onAuthenticated, inviteToken }) {
  const [mode, setMode] = useState(inviteToken ? 'invite' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.getInvite(inviteToken);
        if (!cancelled) {
          setInviteEmail(data.email);
          setMode('invite');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setMode('login');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  async function handleLogin(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.login(email.trim(), password);
      setSession(res.token, res.user);
      onAuthenticated(res.user, res.quota);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSetPassword(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      setBusy(false);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      setBusy(false);
      return;
    }
    try {
      const res = await api.setPassword(inviteToken, password);
      setSession(res.token, res.user);
      setNotice('Password set — you are signed in.');
      onAuthenticated(res.user, res.quota);
      window.history.replaceState({}, '', window.location.pathname);
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
        <h1>{mode === 'invite' ? 'Set your password' : 'Sign in'}</h1>
        <p className="auth-sub">
          {mode === 'invite'
            ? 'Activate your invited admin account to start using the platform.'
            : 'Only invited emails can access. Sign in with your email and password.'}
        </p>

        {error && <div className="banner error">{error}</div>}
        {notice && <div className="banner ok">{notice}</div>}

        {mode === 'invite' ? (
          <form onSubmit={handleSetPassword} className="auth-form">
            <p className="auth-email-line">
              Account: <strong>{inviteEmail || '…'}</strong>
            </p>
            <label>
              New password
              <input
                type="password"
                required
                minLength={8}
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
            </label>
            <label>
              Confirm password
              <input
                type="password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
            <button type="submit" className="primary" disabled={busy || !inviteEmail}>
              {busy ? 'Saving…' : 'Activate & continue'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleLogin} className="auth-form">
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
            <label>
              Password
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
