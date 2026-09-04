import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import Avatar from '../components/Avatar.jsx';
import Modal from '../components/Modal.jsx';
import { ROLE_LABEL } from '../roles.js';

// Name/email/mobile/department only — no password field. GM/AGM get
// read/edit visibility into their own departments here, not super admin's
// account-security powers; setting anyone's password stays super-admin-only
// (see SuperAdminDashboard's AdminsListPanel).
function EditPersonModal({ person, supervisorId, onSaved, onClose }) {
  const [form, setForm] = useState({
    name: person.name ?? '', email: person.email ?? '', mobile: person.mobile ?? '', department: person.department ?? '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function save(e) {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    const res = await fetch(`/api/supervisors/${supervisorId}/admins/${person.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (!res.ok) { setError((await res.json()).error); return; }
    onSaved?.();
    onClose();
  }

  return (
    <Modal title={`Edit ${person.name}`} onClose={onClose}>
      <form onSubmit={save}>
        <div className="form-grid">
          <div className="field">
            <label>Full name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Email address</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="field">
            <label>Mobile number</label>
            <input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
          </div>
          {person.role === 'manager' && (
            <div className="field">
              <label>Department</label>
              <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
            </div>
          )}
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

// GM/AGM's renamed, reshaped version of super admin's "Manage Admins" —
// pick a department (reusing the same /departments endpoint Overview uses),
// then see everyone in it (Manager, AMs, TLs) as one flat Employee
// Management-style list with a pencil to edit. An AM or TL calling this
// just has their own single department to pick, same as their Overview tab.
export default function ManagerDetailsView({ supervisorId }) {
  const [departments, setDepartments] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [editing, setEditing] = useState(null);

  function load() {
    fetch(`/api/supervisors/${supervisorId}/departments`).then((r) => r.json()).then(setDepartments);
  }

  useEffect(load, [supervisorId]);

  if (!departments) return null;
  const dept = departments.find((d) => d.id === selectedId) ?? null;

  if (!dept) {
    return (
      <div className="panel">
        <h2>Departments</h2>
        {departments.length === 0 ? (
          <div className="empty">No departments in your scope yet.</div>
        ) : (
          <div className="live-grid">
            {departments.map((d) => {
              const headcount = 1 + d.ams.length + d.ams.reduce((sum, a) => sum + a.tls.length, 0);
              return (
                <div key={d.id} className="live-card" onClick={() => setSelectedId(d.id)}>
                  <div className="live-card-top">
                    <Avatar name={d.name} size={30} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.department || d.name}</div>
                      <div className="shot-meta">{headcount} {headcount === 1 ? 'person' : 'people'} · {d.employeeCount} employee{d.employeeCount === 1 ? '' : 's'}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const rows = [
    { id: dept.id, name: dept.name, email: dept.email, mobile: dept.mobile, department: dept.department, role: 'manager' },
    ...dept.ams.map((a) => ({ id: a.id, name: a.name, email: a.email, mobile: a.mobile, department: dept.department, role: 'am' })),
    ...dept.ams.flatMap((a) => a.tls.map((t) => ({ id: t.id, name: t.name, email: t.email, mobile: t.mobile, department: dept.department, role: 'tl' }))),
  ];

  return (
    <div className="panel">
      <button className="btn-small" onClick={() => setSelectedId(null)} style={{ marginBottom: 14 }}>&larr; All departments</button>
      <h2>{dept.department || dept.name}</h2>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Mobile</th><th>Role</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.role}-${r.id}`}>
                <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Avatar name={r.name} size={26} />{r.name}</div></td>
                <td>{r.email || '—'}</td>
                <td>{r.mobile || '—'}</td>
                <td><span className="badge-role">{ROLE_LABEL[r.role] ?? r.role}</span></td>
                <td><button className="row-icon-btn" title="Edit" onClick={() => setEditing(r)}><Pencil size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <EditPersonModal person={editing} supervisorId={supervisorId} onSaved={load} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
