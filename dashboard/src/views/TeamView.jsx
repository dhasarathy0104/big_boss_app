import { useEffect, useState } from 'react';

export default function TeamView({ managerId, team, onTeamChanged }) {
  const [invites, setInvites] = useState([]);
  const [copied, setCopied] = useState(false);
  const [claimLinks, setClaimLinks] = useState({}); // employeeId -> url
  const [copiedClaimId, setCopiedClaimId] = useState(null);
  const [otherManagers, setOtherManagers] = useState([]);
  const [transferTarget, setTransferTarget] = useState({}); // employeeId -> managerId
  const [transferring, setTransferring] = useState(null); // employeeId currently in flight
  const [transferError, setTransferError] = useState('');
  const [confirmingId, setConfirmingId] = useState(null); // employeeId awaiting inline confirmation
  const [newManagerName, setNewManagerName] = useState('');
  const [newManagerEmail, setNewManagerEmail] = useState('');
  const [newManagerLink, setNewManagerLink] = useState(null);
  const [creatingManager, setCreatingManager] = useState(false);
  const [managerCreateError, setManagerCreateError] = useState('');
  const [copiedManagerLink, setCopiedManagerLink] = useState(false);

  function loadInvites() {
    fetch(`/api/managers/${managerId}/invites`).then((r) => r.json()).then(setInvites);
  }

  function loadOtherManagers() {
    fetch(`/api/managers/${managerId}/other-managers`).then((r) => r.json()).then(setOtherManagers);
  }

  useEffect(() => {
    if (managerId) { loadInvites(); loadOtherManagers(); }
  }, [managerId]);

  async function generateInvite() {
    const res = await fetch(`/api/managers/${managerId}/invites`, { method: 'POST' });
    const invite = await res.json();
    setInvites((prev) => [invite, ...prev]);
  }

  const activeInvite = invites[0];
  const joinUrl = activeInvite ? `${window.location.origin}/join/${activeInvite.token}` : null;

  function copyLink() {
    navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

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

  async function createPeerManager(e) {
    e.preventDefault();
    if (!newManagerName.trim() || !newManagerEmail.trim()) return;
    setManagerCreateError('');
    setCreatingManager(true);
    const res = await fetch('/api/managers/create-peer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: newManagerName.trim(), email: newManagerEmail.trim() }),
    });
    setCreatingManager(false);
    if (!res.ok) { setManagerCreateError((await res.json()).error); return; }
    const data = await res.json();
    setNewManagerLink(`${window.location.origin}/claim/${data.claimToken}`);
    setNewManagerName('');
    setNewManagerEmail('');
    loadOtherManagers();
  }

  function copyManagerLink() {
    navigator.clipboard.writeText(newManagerLink);
    setCopiedManagerLink(true);
    setTimeout(() => setCopiedManagerLink(false), 1500);
  }

  return (
    <>
      <div className="panel">
        <h2>Invite link</h2>
        {!activeInvite ? (
          <>
            <div className="empty">No invite link yet — generate one and share it with your team.</div>
            <button onClick={generateInvite}>Generate invite link</button>
          </>
        ) : (
          <>
            <div className="inline-form">
              <input readOnly value={joinUrl} style={{ flex: 1, minWidth: 320 }} />
              <button onClick={copyLink}>{copied ? 'Copied!' : 'Copy'}</button>
              <button onClick={generateInvite}>Generate new link</button>
            </div>
            <div className="shot-meta" style={{ marginTop: 8 }}>
              Used {activeInvite.use_count} time{activeInvite.use_count === 1 ? '' : 's'}. Anyone who opens this link and
              runs the agent automatically joins your team — no manual approval needed. This only connects their
              background tracking agent — it does not give them dashboard access (see below for that).
            </div>
          </>
        )}
      </div>

      <div className="panel">
        <h2>Browser extension (optional, for real website tracking)</h2>
        <p className="join-sub" style={{ marginTop: 0 }}>
          Without it, browser time is classified generically as "neutral" since only the app name is visible.
          With it, each employee's Chrome/Edge time is classified by the actual domain visited
          (see the Categories tab). It only reports the domain — never full URLs, page content, or history —
          and only to the agent already running on that same computer.
        </p>
        <ol className="join-steps">
          <li>Open <code>chrome://extensions</code> (or <code>edge://extensions</code>) on the employee's computer.</li>
          <li>Turn on "Developer mode" (top right).</li>
          <li>Click "Load unpacked" and select the <code>browser-extension</code> folder from the project.</li>
          <li>The extension's icon shows a green dot once it's talking to the running agent.</li>
        </ol>
      </div>

      <div className="panel">
        <h2>Other managers ({otherManagers.length})</h2>
        <p className="join-sub" style={{ marginTop: 0 }}>
          Create another manager account to transfer employees to (e.g. a peer manager on another team).
          They get a private link to set their own password, same as employees do.
        </p>
        {otherManagers.length > 0 && (
          <ul style={{ margin: '0 0 12px', paddingLeft: 18 }}>
            {otherManagers.map((m) => <li key={m.id} className="shot-meta">{m.name}</li>)}
          </ul>
        )}
        {newManagerLink ? (
          <div className="inline-form">
            <input readOnly value={newManagerLink} style={{ flex: 1, minWidth: 320 }} />
            <button onClick={copyManagerLink}>{copiedManagerLink ? 'Copied!' : 'Copy'}</button>
            <button onClick={() => setNewManagerLink(null)}>Create another</button>
          </div>
        ) : (
          <form className="inline-form" onSubmit={createPeerManager}>
            <input
              placeholder="New manager's name"
              value={newManagerName}
              onChange={(e) => setNewManagerName(e.target.value)}
            />
            <input
              type="email"
              placeholder="New manager's email"
              value={newManagerEmail}
              onChange={(e) => setNewManagerEmail(e.target.value)}
            />
            <button type="submit" disabled={creatingManager}>{creatingManager ? 'Creating…' : 'Create manager account'}</button>
          </form>
        )}
        {managerCreateError && <div style={{ color: '#e07070', fontSize: 12, marginTop: 6 }}>{managerCreateError}</div>}
      </div>

      <div className="panel">
        <h2>Team ({team.length})</h2>
        <p className="join-sub" style={{ marginTop: 0 }}>
          Each employee needs their own private link to set a password and view their own dashboard
          (their own timeline, log time, attendance/leave) — separate from the invite link above.
          Nobody can see another employee's data or your manager view with this link.
        </p>
        {transferError && <div style={{ color: '#e07070', fontSize: 12, marginBottom: 8 }}>{transferError}</div>}
        {team.length === 0 ? (
          <div className="empty">Nobody has joined yet. Share the invite link above.</div>
        ) : (
          <table>
            <thead><tr><th>Name</th><th>Joined</th><th>Dashboard access</th><th></th><th>Transfer to</th></tr></thead>
            <tbody>
              {team.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{new Date(u.created_at).toLocaleDateString()}</td>
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
                    {claimLinks[u.id] ? (
                      <div className="inline-form" style={{ gap: 6 }}>
                        <input readOnly value={claimLinks[u.id]} style={{ minWidth: 260 }} />
                        <button className="btn-small" onClick={() => copyClaimLink(u.id)}>
                          {copiedClaimId === u.id ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                    ) : (
                      <button className="btn-small" onClick={() => getDashboardLink(u.id)}>
                        {u.hasDashboardLogin ? 'Reset password link' : 'Get dashboard link'}
                      </button>
                    )}
                  </td>
                  <td>
                    {otherManagers.length === 0 ? (
                      <span className="shot-meta">No other managers yet</span>
                    ) : confirmingId === u.id ? (
                      <div className="inline-form" style={{ gap: 6 }}>
                        <span className="shot-meta">
                          Move to {otherManagers.find((m) => m.id === Number(transferTarget[u.id]))?.name}?
                          They'll gain full access (including past history); you'll lose it.
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
        )}
      </div>
    </>
  );
}
