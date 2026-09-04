import { useEffect, useState } from 'react';
import JoinPage from './views/JoinPage.jsx';
import ClaimAccountPage from './views/ClaimAccountPage.jsx';
import ManagerDashboard from './views/ManagerDashboard.jsx';
import SupervisorDashboard from './views/SupervisorDashboard.jsx';
import EmployeeDashboard from './views/EmployeeDashboard.jsx';
import SuperAdminDashboard from './views/SuperAdminDashboard.jsx';
import { getToken, setToken } from './api.js';
import { LOGO_DATA_URI } from './logo.js';
import { SUPERVISOR_DASHBOARD_ROLES } from './roles.js';

// Role choices for the open self-registration form below, and which picker
// field(s) each one needs to declare its place in the org — see
// backend/src/routes/auth.js's register-admin for the matching validation.
const REGISTER_ROLES = [
  { value: 'gm', label: 'General Manager' },
  { value: 'agm', label: 'Assistant General Manager' },
  { value: 'manager', label: 'Manager' },
  { value: 'am', label: 'Assistant Manager' },
  { value: 'tl', label: 'Team Lead' },
];

function RegisterAdminForm({ onAuthed, onBack }) {
  const [role, setRole] = useState('manager');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [department, setDepartment] = useState('');
  const [jobRole, setJobRole] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Picker options, fetched fresh whenever the role changes, plus the
  // picked id for whichever one this role actually needs.
  const [gmOptions, setGmOptions] = useState([]);
  const [agmOptions, setAgmOptions] = useState([]);
  const [managerOptions, setManagerOptions] = useState([]);
  const [amOptions, setAmOptions] = useState([]);
  const [gmId, setGmId] = useState('');
  const [agmId, setAgmId] = useState('');
  const [managerId, setManagerId] = useState('');
  const [amId, setAmId] = useState('');

  useEffect(() => {
    setGmId(''); setAgmId(''); setManagerId(''); setAmId('');
    if (role === 'agm') fetch('/api/auth/accounts?role=gm').then((r) => r.json()).then(setGmOptions);
    if (role === 'manager') fetch('/api/auth/accounts?role=agm').then((r) => r.json()).then(setAgmOptions);
    if (role === 'am') fetch('/api/auth/accounts?role=manager').then((r) => r.json()).then(setManagerOptions);
    if (role === 'tl') fetch('/api/auth/accounts?role=am').then((r) => r.json()).then(setAmOptions);
  }, [role]);

  // TL declares their Assistant Manager; Manager is then shown read-only,
  // derived from that AM's own chain, rather than a second independently
  // pickable field — otherwise nothing would stop someone claiming an AM and
  // a Manager that don't actually match, silently corrupting the hierarchy.
  const selectedAm = amOptions.find((a) => String(a.id) === amId);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Name required.'); return; }
    if (!email.trim()) { setError('Email required.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (role === 'agm' && !gmId) { setError('Select a General Manager.'); return; }
    if (role === 'manager' && !agmId) { setError('Select an Assistant General Manager.'); return; }
    if (role === 'am' && !managerId) { setError('Select a Manager.'); return; }
    if (role === 'tl' && !amId) { setError('Select an Assistant Manager.'); return; }

    setSubmitting(true);
    const res = await fetch('/api/auth/register-admin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(), email: email.trim(), password, role,
        mobile: mobile.trim() || undefined, department: department.trim() || undefined, jobRole: jobRole.trim() || undefined,
        gmId: role === 'agm' ? gmId : undefined,
        agmId: role === 'manager' ? agmId : undefined,
        managerId: role === 'am' ? managerId : undefined,
        amId: role === 'tl' ? amId : undefined,
      }),
    });
    setSubmitting(false);
    if (!res.ok) { setError((await res.json()).error); return; }
    const data = await res.json();
    setToken(data.token);
    onAuthed(data.user);
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
        <h1>Create an account</h1>
        <p className="join-sub">Open signup — anyone with this server's address can create an account at any level here.</p>
        <form className="stacked-form" onSubmit={submit}>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {REGISTER_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          {role === 'agm' && (
            <select value={gmId} onChange={(e) => setGmId(e.target.value)}>
              <option value="">Select General Manager…</option>
              {gmOptions.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}
          {role === 'manager' && (
            <select value={agmId} onChange={(e) => setAgmId(e.target.value)}>
              <option value="">Select Assistant General Manager…</option>
              {agmOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          {role === 'am' && (
            <select value={managerId} onChange={(e) => setManagerId(e.target.value)}>
              <option value="">Select Manager…</option>
              {managerOptions.map((m) => (
                <option key={m.id} value={m.id}>{m.name}{m.department ? ` (${m.department})` : ''}</option>
              ))}
            </select>
          )}
          {role === 'tl' && (
            <>
              <select value={amId} onChange={(e) => setAmId(e.target.value)}>
                <option value="">Select Assistant Manager…</option>
                {amOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              {selectedAm && (
                <p className="join-sub" style={{ margin: 0 }}>Manager: {selectedAm.managerName ?? '—'}</p>
              )}
            </>
          )}
          <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
          <input type="email" placeholder="Your email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input placeholder="Mobile number" value={mobile} onChange={(e) => setMobile(e.target.value)} />
          {role === 'manager' && (
            <input placeholder="Department" value={department} onChange={(e) => setDepartment(e.target.value)} />
          )}
          <input placeholder="Job title (optional)" value={jobRole} onChange={(e) => setJobRole(e.target.value)} />
          <input
            type="password"
            placeholder="Choose a password (8+ characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <div style={{ color: '#e07070', fontSize: 12 }}>{error}</div>}
          <button type="submit" disabled={submitting} style={{ alignSelf: 'flex-start' }}>
            {submitting ? 'Please wait…' : 'Create account'}
          </button>
        </form>
        <button
          onClick={onBack}
          style={{ background: 'none', color: '#8b93a3', fontSize: 12, marginTop: 14, padding: 0, textDecoration: 'underline', width: 'auto' }}
        >
          &larr; Back to login
        </button>
      </div>
    </div>
  );
}

// Text shown after "Forgot password?" is clicked, tailored to who the
// backend actually notifies for that role (see /api/auth/forgot-password) —
// falls back to something neutral when the role isn't known in advance
// (e.g. a fresh visit to the hosted URL, not a post-logout redisplay).
function forgotPasswordMessage(role) {
  if (role === 'employee') return 'Your manager has been notified and will set you a new password.';
  if (role === 'manager') return 'Your super admin has been notified and will set you a new password.';
  return "If that email matches an account, the right person has been notified to set you a new password.";
}

function AuthScreen({ onAuthed, presetRole }) {
  const [bootstrap, setBootstrap] = useState(null); // { state: 'register' | 'claim-manager' | 'login', managerName? }
  const [showRegisterAdmin, setShowRegisterAdmin] = useState(false);
  // Separate super admin mode instead of one combined "email or username"
  // field — that field was the actual source of confusion, since managers
  // and the super admin log in with different kinds of credential entirely.
  // Never available right after an employee's own logout — there's nothing
  // for them to do there.
  const [superAdminMode, setSuperAdminMode] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [forgotMessage, setForgotMessage] = useState('');

  async function forgotPassword() {
    if (!email.trim()) { setError('Enter your email above first, then click this again.'); return; }
    setError('');
    setForgotMessage('Notifying…');
    await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email.trim() }),
    }).catch(() => {});
    setForgotMessage(forgotPasswordMessage(presetRole));
  }

  useEffect(() => {
    fetch('/api/auth/bootstrap').then((r) => r.json()).then(setBootstrap);
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (bootstrap.state === 'register' && !name.trim()) { setError('Name required.'); return; }
    if (bootstrap.state !== 'claim-manager' && !email.trim()) { setError('Email required.'); return; }
    if (password.length < (bootstrap.state === 'login' ? 1 : 8)) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setSubmitting(true);
    const path = bootstrap.state === 'register' ? 'register' : bootstrap.state === 'claim-manager' ? 'claim-manager' : 'login';
    const body = bootstrap.state === 'login'
      ? { email, password }
      : bootstrap.state === 'register' ? { name, email, password } : { password };
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
  if (showRegisterAdmin) return <RegisterAdminForm onAuthed={onAuthed} onBack={() => setShowRegisterAdmin(false)} />;

  // An employee logging back in after their own logout gets just the plain
  // email/password/forgot-password form they'd see in the native app —
  // no super admin toggle or "create a manager account" link, neither of
  // which has anything to do with their account.
  if (presetRole === 'employee' && bootstrap.state === 'login') {
    return (
      <div className="join-page">
        <div className="join-card">
          <div className="brand" style={{ border: 'none', marginBottom: 20, paddingBottom: 0 }}>
            <div className="brand-mark">
              <img src={LOGO_DATA_URI} alt="BIG BOSS" width="30" height="30" />
            </div>
            <div className="brand-name">BIG BOSS</div>
          </div>
          <h1>Log in</h1>
          <form className="stacked-form" onSubmit={submit}>
            <input type="email" placeholder="Your email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
            {error && <div style={{ color: '#e07070', fontSize: 12 }}>{error}</div>}
            <button type="submit" disabled={submitting} style={{ alignSelf: 'flex-start' }}>
              {submitting ? 'Please wait…' : 'Log in'}
            </button>
          </form>
          <button
            onClick={forgotPassword}
            style={{ background: 'none', color: '#8b93a3', fontSize: 12, marginTop: 14, padding: 0, textDecoration: 'underline', width: 'auto' }}
          >
            Forgot password?
          </button>
          {forgotMessage && <div style={{ fontSize: 12, marginTop: 8, color: '#4b5563' }}>{forgotMessage}</div>}
        </div>
      </div>
    );
  }

  const heading = bootstrap.state === 'register'
    ? 'Set up your manager account'
    : bootstrap.state === 'claim-manager'
      ? `Set a password for ${bootstrap.managerName}`
      : superAdminMode ? 'Super Admin login' : 'Log in';
  const sub = bootstrap.state === 'register'
    ? 'This is the identity your team will see activity reported under.'
    : bootstrap.state === 'claim-manager'
      ? 'This account was created before login existed — set a password to secure it.'
      : '';

  return (
    <div className="join-page">
      <div className="join-card">
        <div className="brand" style={{ border: 'none', marginBottom: 20, paddingBottom: 0 }}>
          <div className="brand-mark">
            <img src={LOGO_DATA_URI} alt="BIG BOSS" width="30" height="30" />
          </div>
          <div className="brand-name">BIG BOSS</div>
        </div>
        <h1>{heading}</h1>
        {sub && <p className="join-sub">{sub}</p>}
        <form className="stacked-form" onSubmit={submit}>
          {bootstrap.state === 'register' && (
            <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
          )}
          {bootstrap.state === 'register' && (
            <input type="email" placeholder="Your email" value={email} onChange={(e) => setEmail(e.target.value)} />
          )}
          {bootstrap.state === 'login' && (
            <input
              type={superAdminMode ? 'text' : 'email'}
              placeholder={superAdminMode ? 'Username' : 'Your email'}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
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
        {bootstrap.state === 'login' && !superAdminMode && (
          <button
            onClick={forgotPassword}
            style={{ background: 'none', color: '#8b93a3', fontSize: 12, marginTop: 14, padding: 0, textDecoration: 'underline', width: 'auto', display: 'block' }}
          >
            Forgot password?
          </button>
        )}
        {bootstrap.state === 'login' && !superAdminMode && forgotMessage && (
          <div style={{ fontSize: 12, marginTop: 6, color: '#4b5563' }}>{forgotMessage}</div>
        )}
        {bootstrap.state === 'login' && (
          <button
            onClick={() => { setSuperAdminMode(!superAdminMode); setError(''); setName(''); setEmail(''); setPassword(''); setForgotMessage(''); }}
            style={{ background: 'none', color: '#8b93a3', fontSize: 12, marginTop: 8, padding: 0, textDecoration: 'underline', width: 'auto', display: 'block' }}
          >
            {superAdminMode ? '← Log in with email instead' : 'Log in as Super Admin instead'}
          </button>
        )}
        {bootstrap.state === 'login' && !superAdminMode && (
          <button
            onClick={() => setShowRegisterAdmin(true)}
            style={{ background: 'none', color: '#8b93a3', fontSize: 12, marginTop: 8, padding: 0, textDecoration: 'underline', width: 'auto' }}
          >
            New here? Create an account
          </button>
        )}
      </div>
    </div>
  );
}

function Shell() {
  const [user, setUser] = useState(undefined); // undefined = checking, null = logged out
  // Remembered across logout so the login screen shown right after can be
  // tailored to the role that just logged out (see AuthScreen's presetRole)
  // instead of always falling back to the generic every-role form.
  const [lastRole, setLastRole] = useState(null);

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
    setLastRole(user?.role ?? null);
    fetch('/api/auth/logout', { method: 'POST' }).finally(() => {
      setToken(null);
      setUser(null);
    });
  }

  if (user === undefined) return null;
  if (!user) return <AuthScreen presetRole={lastRole} onAuthed={(u) => { setLastRole(null); setUser(u); }} />;

  if (user.role === 'superadmin') return <SuperAdminDashboard user={user} onLogout={logout} />;
  if (user.role === 'manager') return <ManagerDashboard manager={user} onLogout={logout} />;
  // GM, AGM, AM, and TL share one dashboard — none of them existed before
  // the org-hierarchy rework, and unlike Manager they have no
  // Projects/Billing/Category-Rules features tying them to their own
  // bespoke UI, so there's nothing to preserve by giving each its own.
  if (SUPERVISOR_DASHBOARD_ROLES.includes(user.role)) return <SupervisorDashboard user={user} onLogout={logout} />;
  return <EmployeeDashboard employee={user} onLogout={logout} />;
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
