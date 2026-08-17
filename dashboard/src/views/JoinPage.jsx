import { useEffect, useState } from 'react';

export default function JoinPage({ token }) {
  const [status, setStatus] = useState('loading'); // loading | valid | invalid
  const [managerName, setManagerName] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`/api/invites/${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.valid) {
          setManagerName(data.managerName);
          setStatus('valid');
        } else {
          setStatus('invalid');
        }
      })
      .catch(() => setStatus('invalid'));
  }, [token]);

  const backendUrl = `${window.location.protocol}//${window.location.hostname}:4000`;
  const command = [
    `$env:DESKLOG_INVITE_TOKEN="${token}"`,
    `$env:DESKLOG_AGENT_NAME="Your Name"`,
    `$env:DESKLOG_BACKEND_URL="${backendUrl}"`,
    `node agent.js`,
  ].join('; ');

  function copyCommand() {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="join-page">
      <div className="join-card">
        {status === 'loading' && <div className="empty">Checking invite…</div>}

        {status === 'invalid' && (
          <>
            <h1>Invite not found</h1>
            <p className="join-sub">This link is invalid or has been revoked. Ask your manager for a new one.</p>
          </>
        )}

        {status === 'valid' && (
          <>
            <h1>Join {managerName}'s team</h1>
            <p className="join-sub">
              Run the tracking agent with the command below. It will enroll you automatically —
              no need to tell anyone which manager you report to, the link already knows.
            </p>
            <ol className="join-steps">
              <li>Make sure Node.js is installed on your computer.</li>
              <li>Open a terminal in the <code>agent</code> folder you were given.</li>
              <li>Replace <code>Your Name</code> below with your real name, then run it:</li>
            </ol>
            <div className="code-block">
              <code>{command}</code>
              <button onClick={copyCommand}>{copied ? 'Copied!' : 'Copy'}</button>
            </div>
            <p className="join-sub">
              This is the current prototype flow — a one-click installer comes later once the
              agent is packaged as a real desktop app.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
