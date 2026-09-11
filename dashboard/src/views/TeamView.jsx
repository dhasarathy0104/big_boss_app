import { useEffect, useState } from 'react';
import { Pencil, Trash2, Users2, User, Mail, Phone, Building2, Users, Lock, Eye, EyeOff } from 'lucide-react';
import Avatar from '../components/Avatar.jsx';
import Modal from '../components/Modal.jsx';
import { ROLE_LABEL } from '../roles.js';

function EditManagerAdminModal({ managerId, admin, onSaved, onClose }) {
  const [form, setForm] = useState({
    name: admin.name ?? '', email: admin.email ?? '', mobile: admin.mobile ?? '',
    department: admin.department ?? '', jobRole: admin.jobRole ?? '', password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function save(e) {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) { setError('Name is required.'); return; }
    if (form.password && form.password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setSaving(true);
    const res = await fetch(`/api/managers/${managerId}/admins/${admin.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: form.name, email: form.email, mobile: form.mobile, department: form.department, jobRole: form.jobRole,
        ...(form.password ? { password: form.password } : {}),
      }),
    });
    setSaving(false);
    if (!res.ok) { setError((await res.json()).error); return; }
    onSaved?.();
    onClose();
  }

  return (
    <Modal title={`Edit ${admin.name}`} onClose={onClose}>
      <form onSubmit={save}>
        <div className="form-grid">
          <div className="field">
            <label>Full name</label>
            <div className="input-icon-wrap"><User size={15} /><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          </div>
          <div className="field">
            <label>Department</label>
            <div className="input-icon-wrap"><Building2 size={15} /><input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></div>
          </div>
          <div className="field">
            <label>Email address</label>
            <div className="input-icon-wrap"><Mail size={15} /><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          </div>
          <div className="field">
            <label>Role</label>
            <div className="input-icon-wrap"><Users size={15} /><input value={form.jobRole} onChange={(e) => setForm({ ...form, jobRole: e.target.value })} /></div>
          </div>
          <div className="field">
            <label>Mobile number</label>
            <div className="input-icon-wrap"><Phone size={15} /><input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /></div>
          </div>
          <div className="field">
            <label>New password (optional)</label>
            <div className="input-icon-wrap has-toggle">
              <Lock size={15} />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Leave blank to keep as-is"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              <button type="button" className="input-icon-toggle" onClick={() => setShowPassword((v) => !v)} title={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
        </div>
        {error && <div style={{ color: '#e07070', fontSize: 12, marginBottom: 12 }}>{error}</div>}
        <div className="inline-form">
          <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
          <button type="button" className="btn-outline" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

// Scoped equivalent of the super admin's org-wide Admins panel: this
// manager's own Assistant Managers and Team Leads (including one parented
// straight to this manager with no AM in between), same pencil-edit/
// trash-delete pattern and the same edit form fields. No transfer section
// here on purpose — a plain Manager can edit/delete their own AM/TL, but
// handing staff off to a *different* manager's chain stays a
// super-admin-only power (see EditAdminModal in SuperAdminDashboard.jsx).
function ManageAdminsPanel({ managerId }) {
  const [admins, setAdmins] = useState(null);
  const [editing, setEditing] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [deleteError, setDeleteError] = useState('');

  function load() {
    fetch(`/api/managers/${managerId}/admins`).then((r) => r.json()).then(setAdmins);
  }

  useEffect(load, [managerId]);

  async function handleDelete(id) {
    setDeleteError('');
    setDeletingId(id);
    const res = await fetch(`/api/managers/${managerId}/admins/${id}`, { method: 'DELETE' });
    setDeletingId(null);
    if (!res.ok) { setDeleteError((await res.json()).error); return; }
    setConfirmingId(null);
    load();
  }

  if (!admins) return null;

  return (
    <div className="panel">
      <div className="section-head">
        <div className="section-icon"><Users2 size={22} /></div>
        <div>
          <h2 className="card-title">Manage Admins</h2>
          <p className="card-subtitle">
            Every Assistant Manager and Team Lead in your department. Click the pencil to edit their details or
            set a new password, or the trash icon to remove them (as long as no one still reports to them).
          </p>
        </div>
      </div>
      {deleteError && <div style={{ color: '#e07070', fontSize: 12, marginBottom: 10 }}>{deleteError}</div>}
      {admins.length === 0 ? (
        <div className="empty">No Assistant Managers or Team Leads yet.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Mobile</th><th>Role</th><th>Department</th><th></th></tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Avatar name={a.name} size={26} />
                      {a.name}
                    </div>
                  </td>
                  <td>{a.email || '—'}</td>
                  <td>{a.mobile || '—'}</td>
                  <td><span className="badge-role">{ROLE_LABEL[a.role] ?? a.role}</span></td>
                  <td>{a.department ? <span className="badge-dept">{a.department}</span> : '—'}</td>
                  <td>
                    {confirmingId === a.id ? (
                      <div className="inline-form" style={{ gap: 6, flexWrap: 'nowrap' }}>
                        <button className="btn-small btn-danger" disabled={deletingId === a.id} onClick={() => handleDelete(a.id)}>
                          {deletingId === a.id ? 'Removing…' : 'Yes, remove'}
                        </button>
                        <button className="btn-small" onClick={() => setConfirmingId(null)}>Cancel</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="row-icon-btn" title="Edit" onClick={() => setEditing(a)}>
                          <Pencil size={14} />
                        </button>
                        <button className="row-icon-btn row-icon-btn-danger" title="Remove" onClick={() => { setDeleteError(''); setConfirmingId(a.id); }}>
                          <Trash2 size={14} />
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
      {editing && (
        <EditManagerAdminModal managerId={managerId} admin={editing} onSaved={load} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

export default function TeamView({ managerId }) {
  return (
    <>
      <ManageAdminsPanel managerId={managerId} />

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
    </>
  );
}
