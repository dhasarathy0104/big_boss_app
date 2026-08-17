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
