import { useEffect, useState } from 'react';
import { Users, AlertCircle } from 'lucide-react';
import EmployeeManagementTable from '../components/EmployeeManagementTable.jsx';

// Profile details, password resets, and transfers now all live inside the
// per-row edit form (pencil icon) — see EmployeeManagementTable.
export default function EmployeeManagementView({ managerId, managerName, team, onTeamChanged }) {
  const [otherManagers, setOtherManagers] = useState([]);
  const [tlOptions, setTlOptions] = useState([]);
  const requested = team.filter((e) => e.passwordResetRequested);

  useEffect(() => {
    if (managerId) {
      fetch(`/api/managers/${managerId}/other-managers`).then((r) => r.json()).then(setOtherManagers);
      // A manager qualifies as a supervisor too (see hierarchy.js's
      // isSupervisorRole), so this reuses the same generalized endpoint
      // SupervisorEmployeeManagementView uses — no manager-only duplicate needed.
      fetch(`/api/supervisors/${managerId}/tls-in-scope`).then((r) => r.json()).then(setTlOptions);
    }
  }, [managerId]);

  async function saveEmployee(employeeId, fields) {
    const res = await fetch(`/api/managers/${managerId}/team/${employeeId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(fields),
    });
    if (!res.ok) return (await res.json()).error;
    onTeamChanged?.();
    return null;
  }

  async function deleteEmployee(employeeId) {
    const res = await fetch(`/api/managers/${managerId}/team/${employeeId}`, { method: 'DELETE' });
    if (res.ok) onTeamChanged?.();
  }

  async function transferEmployee(employeeId, targetManagerId) {
    const res = await fetch(`/api/managers/${managerId}/team/${employeeId}/transfer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetManagerId }),
    });
    if (!res.ok) return (await res.json()).error;
    onTeamChanged?.();
    return null;
  }

  async function reassignTl(employeeId, newTlId) {
    const res = await fetch(`/api/supervisors/${managerId}/employees/${employeeId}/reassign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newTlId }),
    });
    if (!res.ok) return (await res.json()).error;
    onTeamChanged?.();
    return null;
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
          <h2 className="card-title">Employees ({team.length})</h2>
          <p className="card-subtitle">
            Click the pencil to edit an employee's details or set a new password, or the trash icon to remove them.
          </p>
        </div>
      </div>
      {team.length === 0 ? (
        <div className="empty">Nobody has joined yet — see the Team &amp; Invite tab.</div>
      ) : (
        <EmployeeManagementTable
          employees={team}
          managerName={managerName}
          otherManagers={otherManagers}
          tlOptions={tlOptions}
          onSave={saveEmployee}
          onDelete={deleteEmployee}
          onTransfer={transferEmployee}
          onReassignTl={reassignTl}
        />
      )}
    </div>
  );
}
