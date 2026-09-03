import { useEffect, useState } from 'react';

// navigator.clipboard only exists in a "secure context" (HTTPS, or
// localhost) — on a plain-HTTP deployment (no domain/SSL yet) it's simply
// undefined, so the modern API silently does nothing. document.execCommand
// is deprecated but still works everywhere, including over plain HTTP, so
// it's the fallback here rather than the only option.
function copyToClipboard(text) {
  if (navigator.clipboard) {
    return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
  }
  return legacyCopy(text) ? Promise.resolve() : Promise.reject();
}

function legacyCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
}

export default function TeamView({ managerId }) {
  const [invites, setInvites] = useState([]);
  const [copied, setCopied] = useState(false);
  const [otherManagers, setOtherManagers] = useState([]);
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
    copyToClipboard(joinUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
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
    copyToClipboard(newManagerLink).then(() => {
      setCopiedManagerLink(true);
      setTimeout(() => setCopiedManagerLink(false), 1500);
    });
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
    </>
  );
}
