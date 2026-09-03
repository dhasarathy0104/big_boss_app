import { useEffect, useState } from 'react';
import Avatar from '../components/Avatar.jsx';

// navigator.clipboard only exists in a secure context (HTTPS) — on a
// plain-HTTP deployment it's undefined, so the modern API silently does
// nothing. document.execCommand is deprecated but still works everywhere,
// including over plain HTTP, so it's the fallback here rather than the
// only option. (Same fix as TeamView.jsx's copyToClipboard.)
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

const ROLE_LABEL = { gm: 'GM', agm: 'AGM', manager: 'Manager', am: 'Assistant Manager', tl: 'Team Lead', employee: 'Employee' };

// The generalized "Team & Invite" tab, shared by every level above Employee
// (GM, AGM, Manager, AM, TL) — the same invite-link idea already used for
// employees, just pointed at whichever role is directly below this person
// (see backend/src/hierarchy.js's roleBelow).
export default function SupervisorTeamView({ supervisorId }) {
  const [team, setTeam] = useState([]);
  const [invites, setInvites] = useState([]);
  const [inviteRole, setInviteRole] = useState(null);
  const [creating, setCreating] = useState(false);
  const [copiedToken, setCopiedToken] = useState(null);

  function load() {
    fetch(`/api/supervisors/${supervisorId}/team`).then((r) => r.json()).then(setTeam);
    fetch(`/api/supervisors/${supervisorId}/invites`).then((r) => r.json()).then(setInvites);
    fetch(`/api/supervisors/${supervisorId}/invite-role`).then((r) => r.json()).then((d) => setInviteRole(d.role));
  }

  useEffect(load, [supervisorId]);

  async function generateInvite() {
    setCreating(true);
    await fetch(`/api/supervisors/${supervisorId}/invites`, { method: 'POST' });
    setCreating(false);
    load();
  }

  async function revokeInvite(inviteId) {
    await fetch(`/api/supervisors/${supervisorId}/invites/${inviteId}/revoke`, { method: 'POST' });
    load();
  }

  function copyLink(token) {
    const url = `${window.location.origin}/join/${token}`;
    copyToClipboard(url).then(() => {
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 1500);
    });
  }

  const inviteRoleLabel = inviteRole ? ROLE_LABEL[inviteRole] ?? inviteRole : null;
  const article = inviteRoleLabel && /^[AEIOU]/.test(inviteRoleLabel) ? 'an' : 'a';

  return (
    <>
      <div className="panel">
        <h2>Invite {inviteRoleLabel ? `${article} ${inviteRoleLabel}` : 'someone'}</h2>
        <p className="join-sub" style={{ marginTop: 0 }}>
          {inviteRole === 'employee'
            ? 'Share this link — it opens the app\'s "Connect this computer" screen, which also starts tracking automatically.'
            : `Share this link — whoever opens it sets up their own ${inviteRoleLabel} account and reports to you.`}
        </p>
        {invites.length === 0 ? (
          <button type="button" onClick={generateInvite} disabled={creating}>
            {creating ? 'Generating…' : 'Generate invite link'}
          </button>
        ) : (
          invites.map((invite) => (
            <div className="inline-form" key={invite.id} style={{ marginTop: invites.length > 1 ? 10 : 0 }}>
              <input readOnly value={`${window.location.origin}/join/${invite.token}`} style={{ flex: 1, minWidth: 320 }} />
              <button type="button" onClick={() => copyLink(invite.token)}>
                {copiedToken === invite.token ? 'Copied!' : 'Copy'}
              </button>
              <button type="button" className="btn-outline-danger" onClick={() => revokeInvite(invite.id)}>Revoke</button>
            </div>
          ))
        )}
        {invites.length > 0 && (
          <button type="button" className="btn-outline" style={{ marginTop: 10 }} onClick={generateInvite} disabled={creating}>
            {creating ? 'Generating…' : 'Generate another link'}
          </button>
        )}
      </div>

      <div className="panel">
        <h2>Your team ({team.length})</h2>
        {team.length === 0 ? (
          <div className="empty">Nobody has joined yet — share the invite link above.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Department</th></tr></thead>
              <tbody>
                {team.map((member) => (
                  <tr key={member.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Avatar name={member.name} size={26} />
                        {member.name}
                        {member.passwordResetRequested && (
                          <span className="badge-role" title="Requested a password reset">reset requested</span>
                        )}
                      </div>
                    </td>
                    <td><span className="badge-role">{ROLE_LABEL[member.role] ?? member.role}</span></td>
                    <td>{member.email || '—'}</td>
                    <td>{member.department ? <span className="badge-dept">{member.department}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
