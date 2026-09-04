import { useEffect, useState } from 'react';
import { Users, AlertCircle } from 'lucide-react';
import EmployeeManagementTable from '../components/EmployeeManagementTable.jsx';

// The generalized version of ManagerDashboard's EmployeeManagementView —
// same table, same edit-modal-does-everything pattern, but for any
// supervisor tier's whole employee subtree (GM/AGM/Manager/AM/TL) instead
// of just a manager's direct reports. The edit modal's Assistant
// Manager/Team Lead picker (tlOptions/onReassignTl) can move an employee to
// any TL within this supervisor's own subtree; a move outside that subtree
// (a different Manager's branch entirely) is the super admin's job.
export default function SupervisorEmployeeManagementView({ supervisorId }) {
  const [employees, setEmployees] = useState(null);
  const [tlOptions, setTlOptions] = useState([]);

  function load() {
    fetch(`/api/supervisors/${supervisorId}/employees-full`).then((r) => r.json()).then(setEmployees);
    fetch(`/api/supervisors/${supervisorId}/tls-in-scope`).then((r) => r.json()).then(setTlOptions);
  }

  useEffect(load, [supervisorId]);

  if (!employees) return null;
  const requested = employees.filter((e) => e.passwordResetRequested);

  async function saveEmployee(employeeId, fields) {
    const res = await fetch(`/api/supervisors/${supervisorId}/employees/${employeeId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(fields),
    });
    if (!res.ok) return (await res.json()).error;
    load();
    return null;
  }

  async function reassignTl(employeeId, newTlId) {
    const res = await fetch(`/api/supervisors/${supervisorId}/employees/${employeeId}/reassign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newTlId }),
    });
    if (!res.ok) return (await res.json()).error;
    load();
    return null;
  }

  async function deleteEmployee(employeeId) {
    const res = await fetch(`/api/supervisors/${supervisorId}/employees/${employeeId}`, { method: 'DELETE' });
    if (res.ok) load();
  }

  return (
    <div className="panel">
      {requested.length > 0 && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="section-head">
            <div className="section-icon"><AlertCircle size={22} /></div>
            <div>
              <h2 className="card-title">Password reset requested ({requested.length})</h2>
              <p className="card-subtitle">
                These employees clicked "Forgot password?" on the login screen. Click their row's pencil icon below to set them a new one.
              </p>
            </div>
          </div>
          <div className="chip-row">
            {requested.map((e) => <div className="chip" key={e.id}>{e.name}</div>)}
          </div>
        </div>
      )}
      <div className="section-head">
        <div className="section-icon"><Users size={22} /></div>
        <div>
          <h2 className="card-title">Employees ({employees.length})</h2>
          <p className="card-subtitle">
            Every employee in your subtree, at any depth. Click the pencil to edit their details or set a new password, or the trash icon to remove them.
          </p>
        </div>
      </div>
      {employees.length === 0 ? (
        <div className="empty">Nobody here yet — see the Team &amp; Invite tab.</div>
      ) : (
        <EmployeeManagementTable
          employees={employees}
          tlOptions={tlOptions}
          onSave={saveEmployee}
          onDelete={deleteEmployee}
          onReassignTl={reassignTl}
        />
      )}
    </div>
  );
}
