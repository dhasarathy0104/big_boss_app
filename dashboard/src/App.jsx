import { useEffect, useState } from 'react';
import JoinPage from './views/JoinPage.jsx';
import ClaimAccountPage from './views/ClaimAccountPage.jsx';
import ManagerDashboard from './views/ManagerDashboard.jsx';
import EmployeeDashboard from './views/EmployeeDashboard.jsx';
import SuperAdminDashboard from './views/SuperAdminDashboard.jsx';
import { getToken, setToken } from './api.js';

function AuthScreen({ onAuthed }) {
  const [bootstrap, setBootstrap] = useState(null); // { state: 'register' | 'claim-manager' | 'login', managerName? }
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch('/api/auth/bootstrap').then((r) => r.json()).then(setBootstrap);
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (bootstrap.state === 'register' && !name.trim()) { setError('Name required.'); return; }
    if (password.length < (bootstrap.state === 'login' ? 1 : 8)) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setSubmitting(true);
    const path = bootstrap.state === 'register' ? 'register' : bootstrap.state === 'claim-manager' ? 'claim-manager' : 'login';
    const body = bootstrap.state === 'login' ? { name, password } : bootstrap.state === 'register' ? { name, password } : { password };
    const res = await fetch(`/api/auth/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSubmitting(false);
    if (!res.ok) { setError((await res.json()).error); return; }
    const data = await res.json();
    setToken(data.token);
    onAuthed(data.user);
  }

  if (!bootstrap) return null;

  const heading = bootstrap.state === 'register'
    ? 'Set up your manager account'
    : bootstrap.state === 'claim-manager'
      ? `Set a password for ${bootstrap.managerName}`
      : 'Log in';
  const sub = bootstrap.state === 'register'
    ? 'This is the identity your team will see activity reported under.'
    : bootstrap.state === 'claim-manager'
      ? 'This account was created before login existed — set a password to secure it.'
      : 'Enter your name and password.';

  return (
    <div className="join-page">
      <div className="join-card">
        <div className="brand" style={{ border: 'none', marginBottom: 20, paddingBottom: 0 }}>
          <div className="brand-mark">D</div>
          <div className="brand-name">Desklog</div>
        </div>
        <h1>{heading}</h1>
        <p className="join-sub">{sub}</p>
        <form className="stacked-form" onSubmit={submit}>
          {bootstrap.state !== 'claim-manager' && (
            <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
          )}
          <input
            type="password"
            placeholder={bootstrap.state === 'login' ? 'Password' : 'Choose a password (8+ characters)'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <div style={{ color: '#e07070', fontSize: 12 }}>{error}</div>}
          <button type="submit" disabled={submitting} style={{ alignSelf: 'flex-start' }}>
            {submitting
              ? 'Please wait…'
              : bootstrap.state === 'login' ? 'Log in' : bootstrap.state === 'claim-manager' ? 'Set password' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}

function Shell() {
  const [user, setUser] = useState(undefined); // undefined = checking, null = logged out

  useEffect(() => {
    // The native app can hand off an already-authenticated session via
    // ?token=... (e.g. after a native login form) so this window opens
    // straight into the dashboard instead of asking to log in a second time.
    const urlToken = new URLSearchParams(window.location.search).get('token');
    if (urlToken) {
      setToken(urlToken);
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      window.history.replaceState({}, '', url);
    }

    if (!getToken()) { setUser(null); return; }
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setUser)
      .catch(() => { setToken(null); setUser(null); });
  }, []);

  function logout() {
    fetch('/api/auth/logout', { method: 'POST' }).finally(() => {
      setToken(null);
      setUser(null);
    });
  }

  if (user === undefined) return null;
  if (!user) return <AuthScreen onAuthed={setUser} />;

  if (user.role === 'superadmin') return <SuperAdminDashboard user={user} onLogout={logout} />;
  return user.role === 'manager'
    ? <ManagerDashboard manager={user} onLogout={logout} />
    : <EmployeeDashboard employee={user} onLogout={logout} />;
}

export default function App() {
  const path = window.location.pathname;
  const joinMatch = path.match(/^\/join\/([^/]+)/);
  const claimMatch = path.match(/^\/claim\/([^/]+)/);

  if (joinMatch) return <JoinPage token={joinMatch[1]} />;
  if (claimMatch) {
    return (
      <ClaimAccountPage
        token={claimMatch[1]}
        onClaimed={() => { window.location.pathname = '/'; }}
      />
    );
  }

  return <Shell />;
}
