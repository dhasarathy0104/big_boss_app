import { useState } from 'react';

// Lists the manager's own employees with their profile fields, and surfaces
// anyone who's used "Forgot password?" on the login screen — the manager
// sets a new password for them directly here and hands it over out-of-band
// (phone/chat/in person), same pattern as a super admin resetting a manager's
// password in Manage Admins.
export default function EmployeeManagementView({ managerId, team, onTeamChanged }) {
  const [resettingId, setResettingId] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const requested = team.filter((u) => u.passwordResetRequested);

  async function setPassword(employeeId) {
    setError(''); setSuccess('');
    if (newPassword.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setSubmitting(true);
    const res = await fetch(`/api/managers/${managerId}/team/${employeeId}/set-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: newPassword }),
    });
    setSubmitting(false);
    if (!res.ok) { setError((await res.json()).error); return; }
    setSuccess('New password saved — hand it to them directly.');
    setNewPassword('');
    setResettingId(null);
    onTeamChanged?.();
  }

  return (
    <>
      {requested.length > 0 && (
        <div className="panel">
          <h2>Password reset requested ({requested.length})</h2>
          <p className="join-sub" style={{ marginTop: 0 }}>
            These employees clicked "Forgot password?" on the login screen. Set them a new one and tell them directly.
          </p>
          <table>
            <thead><tr><th>Name</th><th>Email</th><th></th></tr></thead>
            <tbody>
              {requested.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email || '—'}</td>
                  <td>
                    {resettingId === u.id ? (
                      <div className="inline-form" style={{ gap: 6 }}>
                        <input
                          type="password"
                          placeholder="New password (8+ characters)"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          style={{ minWidth: 200 }}
                        />
                        <button className="btn-small" disabled={submitting} onClick={() => setPassword(u.id)}>
                          {submitting ? 'Saving…' : 'Save'}
                        </button>
                        <button className="btn-small" onClick={() => { setResettingId(null); setNewPassword(''); setError(''); }}>Cancel</button>
                      </div>
                    ) : (
                      <button className="btn-small" onClick={() => { setResettingId(u.id); setNewPassword(''); setError(''); setSuccess(''); }}>
                        Set new password
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {error && <div style={{ color: '#e07070', fontSize: 12, marginTop: 8 }}>{error}</div>}
          {success && <div style={{ color: 'var(--status-good)', fontSize: 12, marginTop: 8 }}>{success}</div>}
        </div>
      )}

      <div className="panel">
        <h2>Employees ({team.length})</h2>
        {team.length === 0 ? (
          <div className="empty">Nobody has joined yet — see the Team &amp; Invite tab.</div>
        ) : (
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Mobile</th><th>Role</th><th>Department</th></tr></thead>
            <tbody>
              {team.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email || '—'}</td>
                  <td>{u.mobile || '—'}</td>
                  <td>{u.jobRole || '—'}</td>
                  <td>{u.department || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
