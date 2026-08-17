import { useEffect, useState } from 'react';

export default function TeamView({ managerId, team }) {
  const [invites, setInvites] = useState([]);
  const [copied, setCopied] = useState(false);

  function loadInvites() {
    fetch(`/api/managers/${managerId}/invites`).then((r) => r.json()).then(setInvites);
  }

  useEffect(() => {
    if (managerId) loadInvites();
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
              runs the agent automatically joins your team — no manual approval needed.
            </div>
          </>
        )}
      </div>

      <div className="panel">
        <h2>Team ({team.length})</h2>
        {team.length === 0 ? (
          <div className="empty">Nobody has joined yet. Share the invite link above.</div>
        ) : (
          <table>
            <thead><tr><th>Name</th><th>Joined</th></tr></thead>
            <tbody>
              {team.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{new Date(u.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
