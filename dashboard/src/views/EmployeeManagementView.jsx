import { useEffect, useState } from 'react';

// Everything about managing one specific employee lives here: their profile
// fields, dashboard-access status, a "forgot password?" flag they can raise
// from the login screen, setting them a new password directly, generating a
// one-time dashboard-claim link, and transferring them to another manager.
// Team & Invite keeps only the agent tracking invite link — none of this.
export default function EmployeeManagementView({ managerId, team, onTeamChanged }) {
  const [otherManagers, setOtherManagers] = useState([]);
  const [claimLinks, setClaimLinks] = useState({}); // employeeId -> url
  const [copiedClaimId, setCopiedClaimId] = useState(null);
  const [passwordRowId, setPasswordRowId] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [transferTarget, setTransferTarget] = useState({}); // employeeId -> managerId
  const [confirmingId, setConfirmingId] = useState(null);
  const [transferring, setTransferring] = useState(null);
  const [transferError, setTransferError] = useState('');

  useEffect(() => {
    if (managerId) {
      fetch(`/api/managers/${managerId}/other-managers`).then((r) => r.json()).then(setOtherManagers);
    }
  }, [managerId]);

  async function getDashboardLink(employeeId) {
    const res = await fetch(`/api/managers/${managerId}/team/${employeeId}/claim-link`, { method: 'POST' });
    const { claimToken } = await res.json();
    const url = `${window.location.origin}/claim/${claimToken}`;
    setClaimLinks((prev) => ({ ...prev, [employeeId]: url }));
  }

  function copyClaimLink(employeeId) {
    navigator.clipboard.writeText(claimLinks[employeeId]);
    setCopiedClaimId(employeeId);
    setTimeout(() => setCopiedClaimId(null), 1500);
  }

  async function setPassword(employeeId) {
    setPasswordError(''); setPasswordSuccess('');
    if (newPassword.length < 8) { setPasswordError('Password must be at least 8 characters.'); return; }
    setSavingPassword(true);
    const res = await fetch(`/api/managers/${managerId}/team/${employeeId}/set-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: newPassword }),
    });
    setSavingPassword(false);
    if (!res.ok) { setPasswordError((await res.json()).error); return; }
    setPasswordSuccess('New password saved — hand it to them directly.');
    setNewPassword('');
    setPasswordRowId(null);
    onTeamChanged?.();
  }

  async function confirmTransfer(employee) {
    const targetManagerId = transferTarget[employee.id];
    if (!targetManagerId) return;

    setTransferError('');
    setTransferring(employee.id);
    const res = await fetch(`/api/managers/${managerId}/team/${employee.id}/transfer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetManagerId }),
    });
    setTransferring(null);
    setConfirmingId(null);
    if (!res.ok) { setTransferError((await res.json()).error); return; }
    onTeamChanged?.();
  }

  return (
    <div className="panel">
      <h2>Employees ({team.length})</h2>
      <p className="join-sub" style={{ marginTop: 0 }}>
        Profile details, dashboard access, password resets, and transferring someone to another manager.
      </p>
      {transferError && <div style={{ color: '#e07070', fontSize: 12, marginBottom: 8 }}>{transferError}</div>}
      {passwordError && <div style={{ color: '#e07070', fontSize: 12, marginBottom: 8 }}>{passwordError}</div>}
      {passwordSuccess && <div style={{ color: 'var(--status-good)', fontSize: 12, marginBottom: 8 }}>{passwordSuccess}</div>}
      {team.length === 0 ? (
        <div className="empty">Nobody has joined yet — see the Team &amp; Invite tab.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Email</th><th>Mobile</th><th>Role</th><th>Department</th>
                <th>Dashboard access</th><th>Forgot password?</th><th>Password</th><th>Transfer to</th>
              </tr>
            </thead>
            <tbody>
              {team.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email || '—'}</td>
                  <td>{u.mobile || '—'}</td>
                  <td>{u.jobRole || '—'}</td>
                  <td>{u.department || '—'}</td>
                  <td>
                    {u.hasDashboardLogin ? (
                      <span className="status-badge status-approved">Set up</span>
                    ) : u.hasPendingClaim ? (
                      <span className="status-badge status-pending">Link sent, not used yet</span>
                    ) : (
                      <span className="status-badge status-rejected">Not set up</span>
                    )}
                  </td>
                  <td>
                    {u.passwordResetRequested ? (
                      <span className="status-badge status-pending">Requested</span>
                    ) : '—'}
                  </td>
                  <td>
                    {passwordRowId === u.id ? (
                      <div className="inline-form" style={{ gap: 6 }}>
                        <input
                          type="password"
                          placeholder="New password (8+ characters)"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          style={{ minWidth: 180 }}
                        />
                        <button className="btn-small" disabled={savingPassword} onClick={() => setPassword(u.id)}>
                          {savingPassword ? 'Saving…' : 'Save'}
                        </button>
                        <button className="btn-small" onClick={() => { setPasswordRowId(null); setNewPassword(''); setPasswordError(''); }}>Cancel</button>
                      </div>
                    ) : claimLinks[u.id] ? (
                      <div className="inline-form" style={{ gap: 6 }}>
                        <input readOnly value={claimLinks[u.id]} style={{ minWidth: 220 }} />
                        <button className="btn-small" onClick={() => copyClaimLink(u.id)}>
                          {copiedClaimId === u.id ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                    ) : (
                      <div className="inline-form" style={{ gap: 6 }}>
                        <button className="btn-small" onClick={() => { setPasswordRowId(u.id); setNewPassword(''); setPasswordError(''); setPasswordSuccess(''); }}>
                          Set new password
                        </button>
                        <button className="btn-small" onClick={() => getDashboardLink(u.id)}>
                          {u.hasDashboardLogin ? 'Reset password link' : 'Get dashboard link'}
                        </button>
                      </div>
                    )}
                  </td>
                  <td>
                    {otherManagers.length === 0 ? (
                      <span className="shot-meta">No other managers yet</span>
                    ) : confirmingId === u.id ? (
                      <div className="inline-form" style={{ gap: 6 }}>
                        <span className="shot-meta">
                          Move to {otherManagers.find((m) => m.id === Number(transferTarget[u.id]))?.name}?
                        </span>
                        <button className="btn-small btn-danger" disabled={transferring === u.id} onClick={() => confirmTransfer(u)}>
                          {transferring === u.id ? 'Transferring…' : 'Yes, transfer'}
                        </button>
                        <button className="btn-small" onClick={() => setConfirmingId(null)}>Cancel</button>
                      </div>
                    ) : (
                      <div className="inline-form" style={{ gap: 6 }}>
                        <select
                          value={transferTarget[u.id] ?? ''}
                          onChange={(e) => setTransferTarget((prev) => ({ ...prev, [u.id]: e.target.value }))}
                        >
                          <option value="">Select manager…</option>
                          {otherManagers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                        <button
                          className="btn-small btn-danger"
                          disabled={!transferTarget[u.id]}
                          onClick={() => setConfirmingId(u.id)}
                        >
                          Transfer
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
