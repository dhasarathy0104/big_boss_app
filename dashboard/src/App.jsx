import { useEffect, useState } from 'react';
import { ShieldCheck, User } from 'lucide-react';
import JoinPage from './views/JoinPage.jsx';
import ManagerDashboard from './views/ManagerDashboard.jsx';
import EmployeeDashboard from './views/EmployeeDashboard.jsx';

function Shell() {
  const [kind, setKind] = useState('manager'); // 'manager' | 'employee' — not real auth, see project notes
  const [managers, setManagers] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [managerId, setManagerId] = useState(null);
  const [employeeId, setEmployeeId] = useState(null);
  const [newManagerName, setNewManagerName] = useState('');

  function loadAll() {
    fetch('/api/managers').then((r) => r.json()).then((data) => {
      setManagers(data);
      setManagerId((prev) => prev ?? data[0]?.id ?? null);
    });
    fetch('/api/employees').then((r) => r.json()).then((data) => {
      setEmployees(data);
      setEmployeeId((prev) => prev ?? data[0]?.id ?? null);
    });
  }

  useEffect(loadAll, []);

  async function createManager(e) {
    e.preventDefault();
    if (!newManagerName.trim()) return;
    const res = await fetch('/api/managers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: newManagerName.trim() }),
    });
    const manager = await res.json();
    setNewManagerName('');
    setManagers((prev) => [...prev, manager]);
    setManagerId(manager.id);
  }

  if (managers.length === 0) {
    return (
      <div className="join-page">
        <div className="join-card">
          <div className="brand" style={{ border: 'none', marginBottom: 20, paddingBottom: 0 }}>
            <div className="brand-mark">D</div>
            <div className="brand-name">Desklog</div>
          </div>
          <h1>Set up your manager account</h1>
          <p className="join-sub">This is the identity your team will see activity reported under.</p>
          <form className="stacked-form" onSubmit={createManager}>
            <input
              placeholder="Your name"
              value={newManagerName}
              onChange={(e) => setNewManagerName(e.target.value)}
            />
            <button type="submit" style={{ alignSelf: 'flex-start' }}>Create account</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="identity-bar">
        <span>I am a:</span>
        <div className="role-toggle" style={{ width: 240 }}>
          <button className={kind === 'manager' ? 'active' : ''} onClick={() => setKind('manager')}>
            <ShieldCheck size={13} style={{ marginRight: 5, verticalAlign: -2 }} />Manager
          </button>
          <button className={kind === 'employee' ? 'active' : ''} onClick={() => setKind('employee')}>
            <User size={13} style={{ marginRight: 5, verticalAlign: -2 }} />Employee
          </button>
        </div>
      </div>

      {kind === 'manager' && (
        <ManagerDashboard managerId={managerId} managers={managers} onManagerChange={setManagerId} />
      )}

      {kind === 'employee' && (
        employees.length === 0 ? (
          <div className="join-page">
            <div className="join-card">
              <h1>No employees yet</h1>
              <p className="join-sub">
                Employees join by opening an invite link generated from a manager's "Team & Invite" tab and
                running the agent — there's no separate employee sign-up here.
              </p>
            </div>
          </div>
        ) : (
          <EmployeeDashboard
            employee={employees.find((e) => e.id === employeeId)}
            employees={employees}
            onEmployeeChange={setEmployeeId}
          />
        )
      )}
    </div>
  );
}

export default function App() {
  const path = window.location.pathname;
  const joinMatch = path.match(/^\/join\/([^/]+)/);

  if (joinMatch) {
    return <JoinPage token={joinMatch[1]} />;
  }

  return <Shell />;
}
