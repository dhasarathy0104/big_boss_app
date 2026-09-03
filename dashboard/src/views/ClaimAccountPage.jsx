import { useEffect, useState } from 'react';
import { setToken } from '../api.js';
import { LOGO_DATA_URI } from '../logo.js';

// An employee lands here from a private link their manager generated in
// Team & Invite — separate from the /join/:token invite link, which only
// connects the background tracking agent, not dashboard access.
export default function ClaimAccountPage({ token, onClaimed }) {
  const [status, setStatus] = useState('loading'); // loading | valid | invalid | done
  const [name, setName] = useState('');
  const [needsEmail, setNeedsEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/auth/claim/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => { setName(data.name); setNeedsEmail(data.needsEmail); setStatus('valid'); })
      .catch(() => setStatus('invalid'));
  }, [token]);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (needsEmail && !email.trim()) { setError('Email required.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setSubmitting(true);
    const res = await fetch(`/api/auth/claim/${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password }),
    });
    setSubmitting(false);
    if (!res.ok) { setError((await res.json()).error); return; }
    const data = await res.json();
    setToken(data.token);
    setStatus('done');
    onClaimed?.(data.user);
  }

  return (
    <div className="join-page">
      <div className="join-card">
        <div className="brand" style={{ border: 'none', marginBottom: 20, paddingBottom: 0 }}>
          <div className="brand-mark">
            <img src={LOGO_DATA_URI} alt="BIG BOSS" width="30" height="30" />
          </div>
          <div className="brand-name">BIG BOSS</div>
        </div>

        {status === 'loading' && <div className="empty">Checking link…</div>}

        {status === 'invalid' && (
          <>
            <h1>Link not valid</h1>
            <p className="join-sub">
              This link has already been used or has expired. Ask your manager for a new one from Team &amp; Invite.
            </p>
          </>
        )}

        {status === 'valid' && (
          <>
            <h1>Welcome, {name}</h1>
            <p className="join-sub">
              {needsEmail
                ? 'Add your email and set a password to access your BIG BOSS dashboard.'
                : 'Set a password to access your BIG BOSS dashboard.'}
            </p>
            <form className="stacked-form" onSubmit={submit}>
              {needsEmail && (
                <input type="email" placeholder="Your email" value={email} onChange={(e) => setEmail(e.target.value)} />
              )}
              <input
                type="password"
                placeholder="Choose a password (8+ characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {error && <div style={{ color: '#e07070', fontSize: 12 }}>{error}</div>}
              <button type="submit" disabled={submitting} style={{ alignSelf: 'flex-start' }}>
                {submitting ? 'Saving…' : 'Set password'}
              </button>
            </form>
          </>
        )}

        {status === 'done' && <div className="empty">All set — loading your dashboard…</div>}
      </div>
    </div>
  );
}
