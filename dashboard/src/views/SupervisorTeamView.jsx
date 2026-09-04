import { useEffect, useState } from 'react';
import Avatar from '../components/Avatar.jsx';
import { ROLE_LABEL } from '../roles.js';

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
  const [settingPasswordFor, setSettingPasswordFor] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [peers, setPeers] = useState([]);
  const [transferringFor, setTransferringFor] = useState(null);
  const [targetParentId, setTargetParentId] = useState('');
  const [transferError, setTransferError] = useState('');
  const [transferring, setTransferring] = useState(false);

  function load() {
    fetch(`/api/supervisors/${supervisorId}/team`).then((r) => r.json()).then(setTeam);
    fetch(`/api/supervisors/${supervisorId}/invites`).then((r) => r.json()).then(setInvites);
    fetch(`/api/supervisors/${supervisorId}/invite-role`).then((r) => r.json()).then((d) => setInviteRole(d.role));
    fetch(`/api/supervisors/${supervisorId}/peers`).then((r) => r.json()).then(setPeers);
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

  function startSetPassword(memberId) {
    setSettingPasswordFor(memberId);
    setNewPassword('');
    setPasswordError('');
  }

  async function saveNewPassword(memberId) {
    if (newPassword.length < 8) { setPasswordError('Password must be at least 8 characters.'); return; }
    setSavingPassword(true);
    setPasswordError('');
    const res = await fetch(`/api/supervisors/${supervisorId}/team/${memberId}/set-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: newPassword }),
    });
    setSavingPassword(false);
    if (!res.ok) { setPasswordError((await res.json()).error); return; }
    setSettingPasswordFor(null);
    load();
  }

  function startTransfer(memberId) {
    setTransferringFor(memberId);
    setTargetParentId('');
    setTransferError('');
  }

  async function saveTransfer(memberId) {
    if (!targetParentId) return;
    setTransferring(true);
    setTransferError('');
    const res = await fetch(`/api/supervisors/${supervisorId}/team/${memberId}/transfer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetParentId }),
    });
    setTransferring(false);
    if (!res.ok) { setTransferError((await res.json()).error); return; }
    setTransferringFor(null);
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
      {/* Only a TL still invites via link — every other level self-registers
          now (see App.jsx's RegisterAdminForm), so this panel would just be
          offering a redundant (and, for anything above TL, actually
          non-functional — /api/enroll only accepts a TL's invite) second
          path if shown for those roles. */}
      {inviteRole === 'employee' && (
        <div className="panel">
          <h2>Invite {inviteRoleLabel ? `${article} ${inviteRoleLabel}` : 'someone'}</h2>
          <p className="join-sub" style={{ marginTop: 0 }}>
            Share this link — it opens the app's "Connect this computer" screen, which also starts tracking automatically.
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
      )}

      <div className="panel">
        <h2>Your team ({team.length})</h2>
        {team.length === 0 ? (
          <div className="empty">Nobody has joined yet — share the invite link above.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Department</th><th></th></tr></thead>
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
                    <td>
                      {settingPasswordFor === member.id ? (
                        <div className="inline-form" style={{ gap: 6, flexWrap: 'nowrap' }}>
                          <input
                            type="password"
                            placeholder="New password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            style={{ width: 140 }}
                          />
                          <button className="btn-small" disabled={savingPassword} onClick={() => saveNewPassword(member.id)}>
                            {savingPassword ? 'Saving…' : 'Save'}
                          </button>
                          <button className="btn-small" onClick={() => setSettingPasswordFor(null)}>Cancel</button>
                        </div>
                      ) : transferringFor === member.id ? (
                        <div className="inline-form" style={{ gap: 6, flexWrap: 'nowrap' }}>
                          <select value={targetParentId} onChange={(e) => setTargetParentId(e.target.value)}>
                            <option value="">Move to…</option>
                            {peers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                          <button className="btn-small" disabled={!targetParentId || transferring} onClick={() => saveTransfer(member.id)}>
                            {transferring ? 'Moving…' : 'Move'}
                          </button>
                          <button className="btn-small" onClick={() => setTransferringFor(null)}>Cancel</button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn-small" onClick={() => startSetPassword(member.id)}>Set password</button>
                          {peers.length > 0 && (
                            <button className="btn-small" onClick={() => startTransfer(member.id)}>Transfer</button>
                          )}
                        </div>
                      )}
                      {settingPasswordFor === member.id && passwordError && (
                        <div style={{ color: '#e07070', fontSize: 11, marginTop: 4 }}>{passwordError}</div>
                      )}
                      {transferringFor === member.id && transferError && (
                        <div style={{ color: '#e07070', fontSize: 11, marginTop: 4 }}>{transferError}</div>
                      )}
                    </td>
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
