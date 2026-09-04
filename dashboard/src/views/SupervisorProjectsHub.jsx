import { useEffect, useState } from 'react';
import ProjectsView from './ProjectsView.jsx';
import CategoriesView from './CategoriesView.jsx';
import BillingView from './BillingView.jsx';
import { roleAtOrAbove } from '../roles.js';

const SECTIONS = [
  { key: 'projects', label: 'Projects & Tasks' },
  { key: 'categories', label: 'Category Rules' },
  { key: 'billing', label: 'Billing' },
];

// Projects/Tasks/Category Rules/Billing all take a single Manager-owned
// managerId (see projects.manager_id) — a shape that fits AM/TL naturally
// (their scope is always exactly one department) but not GM/AGM, who can
// oversee several departments/Managers at once. Rather than redesigning
// those three existing views around a multi-manager model, this wraps them
// behind a department picker built from /managers-in-scope: AM/TL get
// exactly one entry and skip the picker entirely; GM/AGM choose which of
// their own departments to work in. Every managerId offered here is
// already confirmed server-side to be in this supervisor's own subtree —
// the backend re-checks it independently on every request regardless.
export default function SupervisorProjectsHub({ supervisorId, role }) {
  const [managers, setManagers] = useState(null);
  const [managerId, setManagerId] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [section, setSection] = useState('projects');

  useEffect(() => {
    fetch(`/api/supervisors/${supervisorId}/managers-in-scope`).then((r) => r.json()).then((data) => {
      setManagers(data);
      setManagerId(data.length === 1 ? data[0].id : null);
    });
    fetch(`/api/supervisors/${supervisorId}/employees`).then((r) => r.json()).then(setEmployees);
  }, [supervisorId]);

  if (!managers) return null;
  if (managers.length === 0) {
    return <div className="panel"><div className="empty">No department in your hierarchy yet.</div></div>;
  }

  // AM/TL should never become the project owner, and TL additionally
  // doesn't get billing or rule-editing — see projects.js's canOwnProject,
  // billing.js's canViewBilling, and categoryRules.js's canEditRules.
  const canCreateProject = roleAtOrAbove(role, 'manager');
  const canSeeBilling = roleAtOrAbove(role, 'am');
  const canEditRules = roleAtOrAbove(role, 'am');
  const visibleSections = SECTIONS.filter((s) => s.key !== 'billing' || canSeeBilling);

  return (
    <>
      {managers.length > 1 && (
        <div className="panel">
          <h2>Department</h2>
          <p className="card-subtitle" style={{ margin: '0 0 12px' }}>Choose which department in your hierarchy to work in.</p>
          <select value={managerId ?? ''} onChange={(e) => setManagerId(Number(e.target.value) || null)}>
            <option value="">Select a department…</option>
            {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      )}

      {managerId && (
        <>
          <div className="sidebar-nav" style={{ marginBottom: 16 }}>
            {visibleSections.map((s) => (
              <div
                key={s.key}
                className={`nav-item ${section === s.key ? 'active' : ''}`}
                onClick={() => setSection(s.key)}
              >
                <span>{s.label}</span>
              </div>
            ))}
          </div>
          {section === 'projects' && (
            <ProjectsView managerId={managerId} team={employees} canCreateProject={canCreateProject} />
          )}
          {section === 'categories' && <CategoriesView managerId={managerId} canEdit={canEditRules} />}
          {section === 'billing' && canSeeBilling && <BillingView managerId={managerId} />}
        </>
      )}
    </>
  );
}
