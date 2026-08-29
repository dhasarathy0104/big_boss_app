import { useState } from 'react';
import { Pencil, Trash2, User, Mail, Phone, Building2, Users, Lock, Eye, EyeOff, ArrowRightLeft } from 'lucide-react';
import Avatar from './Avatar.jsx';
import Modal from './Modal.jsx';

function EditEmployeeModal({ employee, managerName, otherManagers, onSave, onTransfer, onClose }) {
  const [form, setForm] = useState({
    name: employee.name ?? '', email: employee.email ?? '', mobile: employee.mobile ?? '',
    department: employee.department ?? '', jobRole: employee.jobRole ?? '', password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [targetManagerId, setTargetManagerId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [transferring, setTransferring] = useState(false);

  async function save(e) {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) { setError('Name is required.'); return; }
    if (form.password && form.password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setSaving(true);
    const err = await onSave(employee.id, {
      name: form.name, email: form.email, mobile: form.mobile,
      department: form.department, jobRole: form.jobRole,
      ...(form.password ? { password: form.password } : {}),
    });
    setSaving(false);
    if (err) { setError(err); return; }
    onClose();
  }

  async function doTransfer() {
    if (!targetManagerId) return;
    setTransferring(true);
    const err = await onTransfer(employee.id, targetManagerId);
    setTransferring(false);
    if (err) { setError(err); return; }
    onClose();
  }

  return (
    <Modal title={`Edit ${employee.name}`} onClose={onClose}>
      <form onSubmit={save}>
        <div className="form-grid">
          <div className="field">
            <label>Full name</label>
            <div className="input-icon-wrap">
              <User size={15} />
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>Department</label>
            <div className="input-icon-wrap">
              <Building2 size={15} />
              <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>Email address</label>
            <div className="input-icon-wrap">
              <Mail size={15} />
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>Role</label>
            <div className="input-icon-wrap">
              <Users size={15} />
              <input value={form.jobRole} onChange={(e) => setForm({ ...form, jobRole: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>Mobile number</label>
            <div className="input-icon-wrap">
              <Phone size={15} />
              <input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
            </div>
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
        {managerName && <p className="card-subtitle" style={{ margin: '0 0 12px' }}>Reports to: {managerName}</p>}
        {error && <div style={{ color: '#e07070', fontSize: 12, marginBottom: 12 }}>{error}</div>}
        <div className="inline-form">
          <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
          <button type="button" className="btn-outline" onClick={onClose}>Cancel</button>
        </div>
      </form>

      {otherManagers && otherManagers.filter((m) => m.id !== employee.managerId).length > 0 && (
        <>
          <hr className="modal-divider" />
          <p className="modal-section-title">Transfer to another manager</p>
          <div className="inline-form">
            <div className="input-icon-wrap" style={{ minWidth: 200 }}>
              <ArrowRightLeft size={15} />
              <select value={targetManagerId} onChange={(e) => setTargetManagerId(e.target.value)}>
                <option value="">Select manager…</option>
                {otherManagers.filter((m) => m.id !== employee.managerId).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <button type="button" className="btn-outline-danger" disabled={!targetManagerId || transferring} onClick={doTransfer}>
              {transferring ? 'Transferring…' : 'Transfer'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

// Shared employee table used by both a manager's own "Employee Management"
// tab and the super admin's org-wide employee view — same columns, same
// pencil-opens-edit-form / trash-deletes-row pattern, different API scope
// wired in by the caller via onSave/onDelete/onTransfer.
export default function EmployeeManagementTable({ employees, managerName, otherManagers, onSave, onDelete, onTransfer, onRowClick }) {
  const [editing, setEditing] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  async function handleDelete(id) {
    setDeletingId(id);
    await onDelete(id);
    setDeletingId(null);
    setConfirmingId(null);
  }

  if (employees.length === 0) {
    return <div className="empty">Nobody here yet.</div>;
  }

  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Manager</th><th>Department</th><th></th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id}>
                <td>
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: onRowClick ? 'pointer' : 'default' }}
                    onClick={() => onRowClick?.(e)}
                  >
                    <Avatar name={e.name} size={26} />
                    {e.name}
                  </div>
                </td>
                <td>{e.email || '—'}</td>
                <td>{e.mobile || '—'}</td>
                <td>{e.jobRole ? <span className="badge-role">{e.jobRole}</span> : '—'}</td>
                <td>{e.managerName ?? managerName ?? '—'}</td>
                <td>{e.department ? <span className="badge-dept">{e.department}</span> : '—'}</td>
                <td>
                  {confirmingId === e.id ? (
                    <div className="inline-form" style={{ gap: 6, flexWrap: 'nowrap' }}>
                      <button className="btn-small btn-danger" disabled={deletingId === e.id} onClick={() => handleDelete(e.id)}>
                        {deletingId === e.id ? 'Removing…' : 'Yes, remove'}
                      </button>
                      <button className="btn-small" onClick={() => setConfirmingId(null)}>Cancel</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="row-icon-btn" title="Edit" onClick={() => setEditing(e)}>
                        <Pencil size={14} />
                      </button>
                      <button className="row-icon-btn row-icon-btn-danger" title="Remove" onClick={() => setConfirmingId(e.id)}>
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

      {editing && (
        <EditEmployeeModal
          employee={editing}
          managerName={editing.managerName ?? managerName}
          otherManagers={otherManagers}
          onSave={onSave}
          onTransfer={onTransfer}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
