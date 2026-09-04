import { useEffect, useState } from 'react';
import { ShieldCheck, Users } from 'lucide-react';
import Avatar from './Avatar.jsx';

// Department -> Manager -> Assistant Manager -> Team Lead -> Employee, four
// levels of "pick a card, see details and who's below them" — shared by
// super admin's org-wide Overview (endpoint="/api/superadmin/departments")
// and the GM/AGM read-only dashboard's copy of it
// (endpoint=`/api/supervisors/${id}/departments`), so the two views can
// never drift out of sync. Purely a viewer: editing anyone lives in the
// separate Employee Management / Manager Details tabs, not here — the only
// action available is jumping to an employee's Timeline/Screenshots.
export default function DepartmentDrillDown({ endpoint, onSelectMember }) {
  const [departments, setDepartments] = useState(null);
  const [managerId, setManagerId] = useState(null);
  const [amId, setAmId] = useState(null);
  const [tlId, setTlId] = useState(null);
  const [employeeId, setEmployeeId] = useState(null);

  useEffect(() => {
    fetch(endpoint).then((r) => r.json()).then(setDepartments);
  }, [endpoint]);

  if (!departments) return null;

  const manager = departments.find((d) => d.id === managerId) ?? null;
  const am = manager?.ams.find((a) => a.id === amId) ?? null;
  const tl = am?.tls.find((t) => t.id === tlId) ?? null;
  const employeePool = tl ? tl.employees : manager?.directEmployees ?? [];
  const employee = employeePool.find((e) => e.id === employeeId) ?? null;

  function reset() { setManagerId(null); setAmId(null); setTlId(null); setEmployeeId(null); }

  const totalEmployees = departments.reduce((sum, d) => sum + d.employeeCount, 0);

  function DetailTable({ rows }) {
    return (
      <table>
        <tbody>
          {rows.map(([label, value]) => <tr key={label}><th style={{ width: 110 }}>{label}</th><td>{value || '—'}</td></tr>)}
        </tbody>
      </table>
    );
  }

  function CardGrid({ items, onPick, countLabel }) {
    if (items.length === 0) return <div className="empty">Nobody here yet.</div>;
    return (
      <div className="live-grid">
        {items.map((item) => (
          <div key={item.id} className="live-card" onClick={() => onPick(item.id)}>
            <div className="live-card-top">
              <Avatar name={item.name} size={30} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                <div className="shot-meta">{countLabel(item)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Level 4: one employee's details.
  if (employee) {
    return (
      <div className="panel">
        <button className="btn-small" onClick={() => setEmployeeId(null)} style={{ marginBottom: 14 }}>&larr; {tl ? tl.name : manager.name}'s team</button>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Avatar name={employee.name} size={26} />{employee.name}</h2>
        <DetailTable rows={[['Email', employee.email], ['Mobile', employee.mobile], ['Role', employee.jobRole || 'Employee'], ['Department', employee.department], ['Reports to', tl ? tl.name : manager.name]]} />
        <div className="inline-form" style={{ marginTop: 16 }}>
          <button onClick={() => onSelectMember?.(employee.id, 'timeline')}>View Timeline</button>
          <button onClick={() => onSelectMember?.(employee.id, 'screenshots')}>View Screenshots</button>
        </div>
      </div>
    );
  }

  // Level 3: one TL's employees.
  if (tl) {
    return (
      <div className="panel">
        <button className="btn-small" onClick={() => setTlId(null)} style={{ marginBottom: 14 }}>&larr; {am.name}'s team leads</button>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Avatar name={tl.name} size={26} />{tl.name}</h2>
        <DetailTable rows={[['Email', tl.email], ['Mobile', tl.mobile], ['Role', 'Team Lead']]} />
        <h2 style={{ marginTop: 20 }}>Employees ({tl.employees.length})</h2>
        <CardGrid items={tl.employees} onPick={setEmployeeId} countLabel={() => 'Employee'} />
      </div>
    );
  }

  // Level 2: one AM's team leads.
  if (am) {
    return (
      <div className="panel">
        <button className="btn-small" onClick={() => setAmId(null)} style={{ marginBottom: 14 }}>&larr; {manager.name}'s assistant managers</button>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Avatar name={am.name} size={26} />{am.name}</h2>
        <DetailTable rows={[['Email', am.email], ['Mobile', am.mobile], ['Role', 'Assistant Manager']]} />
        <h2 style={{ marginTop: 20 }}>Team Leads ({am.tls.length})</h2>
        <CardGrid items={am.tls} onPick={setTlId} countLabel={(t) => `${t.employeeCount} employee${t.employeeCount === 1 ? '' : 's'}`} />
      </div>
    );
  }

  // Level 1: one department's Manager, direct employees (if any legacy
  // ones exist), and Assistant Managers.
  if (manager) {
    return (
      <div className="panel">
        <button className="btn-small" onClick={reset} style={{ marginBottom: 14 }}>&larr; All departments</button>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Avatar name={manager.name} size={26} />{manager.department || manager.name}</h2>
        <DetailTable rows={[['Manager', manager.name], ['Email', manager.email], ['Mobile', manager.mobile]]} />
        {manager.directEmployees.length > 0 && (
          <>
            <h2 style={{ marginTop: 20 }}>Direct employees ({manager.directEmployees.length})</h2>
            <p className="card-subtitle" style={{ marginTop: 0 }}>Pre-dating Assistant Manager/Team Lead — reports straight to the Manager.</p>
            <CardGrid items={manager.directEmployees} onPick={setEmployeeId} countLabel={() => 'Employee'} />
          </>
        )}
        <h2 style={{ marginTop: 20 }}>Assistant Managers ({manager.ams.length})</h2>
        <CardGrid items={manager.ams} onPick={setAmId} countLabel={(a) => `${a.employeeCount} employee${a.employeeCount === 1 ? '' : 's'}`} />
      </div>
    );
  }

  // Level 0: every department.
  return (
    <>
      <div className="stat-row">
        <div className="stat-tile">
          <div className="stat-tile-icon" style={{ background: 'rgba(57,135,229,0.15)' }}><ShieldCheck size={18} color="var(--brand)" /></div>
          <div><div className="stat-tile-value">{departments.length}</div><div className="stat-tile-label">Departments</div></div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile-icon" style={{ background: 'rgba(57,135,229,0.15)' }}><Users size={18} color="var(--brand)" /></div>
          <div><div className="stat-tile-value">{totalEmployees}</div><div className="stat-tile-label">Employees (org-wide)</div></div>
        </div>
      </div>
      <div className="panel">
        <h2>Departments</h2>
        <CardGrid
          items={departments.map((d) => ({ ...d, name: d.department || d.name }))}
          onPick={setManagerId}
          countLabel={(d) => `${d.employeeCount} employee${d.employeeCount === 1 ? '' : 's'}`}
        />
      </div>
    </>
  );
}
