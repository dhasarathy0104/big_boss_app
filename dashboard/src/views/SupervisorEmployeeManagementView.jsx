import { useEffect, useState } from 'react';
import { Users, AlertCircle } from 'lucide-react';
import EmployeeManagementTable from '../components/EmployeeManagementTable.jsx';

// The generalized version of ManagerDashboard's EmployeeManagementView —
// same table, same edit-modal-does-everything pattern, but for any
// supervisor tier's whole employee subtree (GM/AGM/Manager/AM/TL) instead
// of just a manager's direct reports. No transfer option here on purpose:
// moving an employee across branches is what a TL's peer-transfer (see
// SupervisorTeamView's "Team & Invite" tab) or the super admin's "Reassign
// anyone" are for — this view is profile editing, password reset, and
// removal only, scoped to whoever is actually below this person.
export default function SupervisorEmployeeManagementView({ supervisorId }) {
  const [employees, setEmployees] = useState(null);

  function load() {
    fetch(`/api/supervisors/${supervisorId}/employees-full`).then((r) => r.json()).then(setEmployees);
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
          onSave={saveEmployee}
          onDelete={deleteEmployee}
        />
      )}
    </div>
  );
}
