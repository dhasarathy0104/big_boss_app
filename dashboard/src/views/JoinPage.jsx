import { useEffect, useState } from 'react';
import { setToken } from '../api.js';
import { LOGO_DATA_URI } from '../logo.js';
import { ROLE_LABEL } from '../roles.js';

function Brand() {
  return (
    <div className="brand" style={{ border: 'none', marginBottom: 20, paddingBottom: 0 }}>
      <div className="brand-mark">
        <img src={LOGO_DATA_URI} alt="BIG BOSS" width="30" height="30" />
      </div>
      <div className="brand-name">BIG BOSS</div>
    </div>
  );
}

// Employee invites are claimed inside the native app (paste this same link
// into its "Connect this computer" screen) — only that app can also start
// the tracking agent, which is the whole point of an Employee account. This
// page just points them there instead of duplicating that flow on the web.
function EmployeeJoinInstructions({ managerName, amName, departmentManagerName }) {
  return (
    <>
      <h1>Join {managerName}'s team</h1>
      <p className="join-sub" style={{ marginBottom: 4 }}>
        <strong>Team Lead:</strong> {managerName}
        {amName && <><br /><strong>Assistant Manager:</strong> {amName}</>}
        {departmentManagerName && <><br /><strong>Department Manager:</strong> {departmentManagerName}</>}
      </p>
      <p className="join-sub">
        Open the BIG BOSS app on your computer, choose "Employee," then paste this page's link into the
        "Connect this computer" screen. That sets up your login and starts tracking in one step.
      </p>
      <p className="join-sub">Don't have the app yet? Ask {managerName} for the installer.</p>
    </>
  );
}

// GM/AGM/Manager/AM/TL invites are claimed right here on the web — these are
// dashboard-only accounts with no tracking agent involved, so there's no
// reason to route them through the native app at all.
function SupervisorClaimForm({ token, role, managerName, onClaimed }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [department, setDepartment] = useState('');
  const [jobRole, setJobRole] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!name.trim() || !email.trim() || password.length < 8) {
      setError('Name, email, and a password of at least 8 characters are required.');
      return;
    }
    setSubmitting(true);
    const res = await fetch(`/api/auth/claim-invite/${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(), email: email.trim(), password,
        mobile: mobile.trim() || undefined, department: department.trim() || undefined, jobRole: jobRole.trim() || undefined,
      }),
    });
    setSubmitting(false);
    if (!res.ok) { setError((await res.json()).error); return; }
    const data = await res.json();
    setToken(data.token);
    onClaimed(data.user);
  }

  const roleLabel = ROLE_LABEL[role] ?? role;

  return (
    <>
      <h1>Join as {roleLabel}</h1>
      <p className="join-sub">Set up your account below — you'll report to {managerName}.</p>
      <form className="stacked-form" onSubmit={submit}>
        <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
        <input type="email" placeholder="Your email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input placeholder="Mobile number" value={mobile} onChange={(e) => setMobile(e.target.value)} />
        <input placeholder="Department" value={department} onChange={(e) => setDepartment(e.target.value)} />
        <input placeholder={`Title (e.g. ${roleLabel})`} value={jobRole} onChange={(e) => setJobRole(e.target.value)} />
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
    </>
  );
}

export default function JoinPage({ token }) {
  const [state, setState] = useState({ status: 'loading' }); // loading | valid | invalid | claimed

  useEffect(() => {
    fetch(`/api/invites/${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.valid) setState({ status: 'valid', role: data.role, managerName: data.managerName, amName: data.amName, departmentManagerName: data.departmentManagerName });
        else setState({ status: 'invalid' });
      })
      .catch(() => setState({ status: 'invalid' }));
  }, [token]);

  function onClaimed() {
    setState({ status: 'claimed' });
    window.location.pathname = '/';
  }

  return (
    <div className="join-page">
      <div className="join-card">
        <Brand />

        {state.status === 'loading' && <div className="empty">Checking invite…</div>}

        {state.status === 'invalid' && (
          <>
            <h1>Invite not found</h1>
            <p className="join-sub">This link is invalid or has been revoked. Ask whoever sent it for a new one.</p>
          </>
        )}

        {state.status === 'claimed' && <div className="empty">Account created — opening your dashboard…</div>}

        {state.status === 'valid' && state.role === 'employee' && (
          <EmployeeJoinInstructions managerName={state.managerName} amName={state.amName} departmentManagerName={state.departmentManagerName} />
        )}

        {state.status === 'valid' && state.role !== 'employee' && (
          <SupervisorClaimForm token={token} role={state.role} managerName={state.managerName} onClaimed={onClaimed} />
        )}
      </div>
    </div>
  );
}
