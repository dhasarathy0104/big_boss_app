import { useEffect, useState } from 'react';
import { LayoutDashboard, Activity, Clock, Camera, KanbanSquare, LogOut, Zap, Coffee, MoonStar, Users, ShieldCheck, ChevronDown, ChevronRight, UserCog } from 'lucide-react';
import { todayStr } from '../format.js';
import Avatar from '../components/Avatar.jsx';
import DeskIllustration from '../components/DeskIllustration.jsx';
import TimelineView from './TimelineView.jsx';
import ScreenshotsView, { TrackingHoursControl } from './ScreenshotsView.jsx';

const TASK_STATUS_LABEL = { todo: 'To do', in_progress: 'In progress', review: 'Review', done: 'Done' };

function AdminProjectsPanel({ managerId, canRemove = true }) {
  const [projects, setProjects] = useState(null);
  const [tasksByProject, setTasksByProject] = useState({});
  const [removingId, setRemovingId] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);

  function load() {
    fetch(`/api/projects?managerId=${managerId}`).then((r) => r.json()).then((data) => {
      setProjects(data);
      data.forEach((p) => {
        fetch(`/api/tasks?projectId=${p.id}`).then((r) => r.json()).then((tasks) => {
          setTasksByProject((prev) => ({ ...prev, [p.id]: tasks }));
        });
      });
    });
  }

  useEffect(load, [managerId]);

  async function removeProject(projectId) {
    setRemovingId(projectId);
    const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
    setRemovingId(null);
    setConfirmingId(null);
    if (!res.ok) return;
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
  }

  if (projects === null) return <div className="empty">Loading…</div>;
  if (projects.length === 0) return <div className="empty">No projects assigned to this admin yet.</div>;

  return (
    <>
      {projects.map((p) => {
        const tasks = tasksByProject[p.id];
        const total = tasks?.length ?? 0;
        const done = tasks?.filter((t) => t.status === 'done').length ?? 0;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;

        return (
          <div className="project-card" key={p.id}>
            <div className="project-card-head">
              <div>
                <div className="project-card-title">{p.name}</div>
                {p.client_name && <div className="shot-meta">{p.client_name}</div>}
              </div>
              {canRemove && (
                confirmingId === p.id ? (
                  <div className="inline-form" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    <span className="shot-meta">Deletes its tasks too?</span>
                    <button className="btn-small btn-danger" disabled={removingId === p.id} onClick={() => removeProject(p.id)}>
                      {removingId === p.id ? 'Removing…' : 'Yes, remove'}
                    </button>
                    <button className="btn-small" onClick={() => setConfirmingId(null)}>Cancel</button>
                  </div>
                ) : (
                  <button className="btn-small btn-danger" onClick={() => setConfirmingId(p.id)}>Remove project</button>
                )
              )}
            </div>

            <div className="shot-meta" style={{ marginBottom: 4, fontWeight: 700, letterSpacing: '.02em', textTransform: 'uppercase', fontSize: 10.5 }}>
              Project progress
            </div>
            <div className="progress-row">
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="progress-label">{total === 0 ? 'No tasks' : `${done}/${total} · ${pct}%`}</div>
            </div>

            <div className="shot-meta" style={{ marginBottom: 2, fontWeight: 700, letterSpacing: '.02em', textTransform: 'uppercase', fontSize: 10.5 }}>
              Task progress
            </div>
            {!tasks ? (
              <div className="shot-meta">Loading tasks…</div>
            ) : tasks.length === 0 ? (
              <div className="shot-meta">No tasks yet.</div>
            ) : (
              tasks.map((t) => (
                <div className="task-row" key={t.id}>
                  <span>{t.title}</span>
                  <span className={`status-badge task-status-${t.status}`}>{TASK_STATUS_LABEL[t.status]}</span>
                </div>
              ))
            )}
          </div>
        );
      })}
    </>
  );
}

const TABS = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'live', label: 'Live', icon: Activity },
  { key: 'timeline', label: 'Timeline', icon: Clock },
  { key: 'screenshots', label: 'Screenshots', icon: Camera },
  { key: 'assign', label: 'Project', icon: KanbanSquare },
  { key: 'manage', label: 'Manage Admins', icon: UserCog },
];

const STATUS_LABEL = { active: 'Active', idle: 'Idle', offline: 'Offline' };
const REFRESH_MS = 15_000;

// Four-level drill-down, mirroring the card look of the manager's own Live
// tab: pick an admin (name only) -> see that admin's own details -> open
// their employees (name + summary each) -> click one to see THEIR full
// details too, with an explicit choice to jump to Timeline/Screenshots
// rather than navigating away the instant you click a name.
function OverviewTab({ overview, onSelectMember }) {
  const [selectedAdminId, setSelectedAdminId] = useState(null);
  const [employeesOpen, setEmployeesOpen] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  if (!overview) return null;

  const selectedAdmin = overview.admins.find((a) => a.id === selectedAdminId) ?? null;
  const selectedEmployee = selectedAdmin?.employees.find((e) => e.id === selectedEmployeeId) ?? null;

  if (selectedEmployee) {
    return (
      <div className="panel">
        <button className="btn-small" onClick={() => setSelectedEmployeeId(null)} style={{ marginBottom: 14 }}>
          &larr; {selectedAdmin.name}'s team
        </button>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Avatar name={selectedEmployee.name} size={26} />
          {selectedEmployee.name}
        </h2>
        <table>
          <tbody>
            <tr><th style={{ width: 110 }}>Email</th><td>{selectedEmployee.email || '—'}</td></tr>
            <tr><th>Mobile</th><td>{selectedEmployee.mobile || '—'}</td></tr>
            <tr><th>Role</th><td>{selectedEmployee.jobRole || 'Employee'}</td></tr>
            <tr><th>Department</th><td>{selectedEmployee.department || '—'}</td></tr>
            <tr><th>Reports to</th><td>{selectedAdmin.name}</td></tr>
          </tbody>
        </table>
        <div className="inline-form" style={{ marginTop: 16 }}>
          <button onClick={() => onSelectMember(selectedEmployee.id, 'timeline')}>View Timeline</button>
          <button onClick={() => onSelectMember(selectedEmployee.id, 'screenshots')}>View Screenshots</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="stat-row">
        <div className="stat-tile">
          <div className="stat-tile-icon" style={{ background: 'rgba(57,135,229,0.15)' }}>
            <ShieldCheck size={18} color="var(--brand)" />
          </div>
          <div>
            <div className="stat-tile-value">{overview.totalAdmins}</div>
            <div className="stat-tile-label">Admins</div>
          </div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile-icon" style={{ background: 'rgba(57,135,229,0.15)' }}>
            <Users size={18} color="var(--brand)" />
          </div>
          <div>
            <div className="stat-tile-value">{overview.totalEmployees}</div>
            <div className="stat-tile-label">Employees (org-wide)</div>
          </div>
        </div>
      </div>

      {!selectedAdmin ? (
        <div className="panel">
          <h2>Admins</h2>
          {overview.admins.length === 0 ? (
            <div className="empty">No admins yet.</div>
          ) : (
            <div className="live-grid">
              {overview.admins.map((admin) => (
                <div
                  key={admin.id}
                  className="live-card"
                  onClick={() => { setSelectedAdminId(admin.id); setEmployeesOpen(false); setSelectedEmployeeId(null); }}
                >
                  <div className="live-card-top">
                    <Avatar name={admin.name} size={30} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{admin.name}</div>
                      <div className="shot-meta">{admin.employeeCount} employee{admin.employeeCount === 1 ? '' : 's'}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="panel">
            <button className="btn-small" onClick={() => setSelectedAdminId(null)} style={{ marginBottom: 14 }}>
              &larr; All admins
            </button>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar name={selectedAdmin.name} size={26} />
              {selectedAdmin.name}
            </h2>
            <table>
              <tbody>
                <tr><th style={{ width: 110 }}>Email</th><td>{selectedAdmin.email || '—'}</td></tr>
                <tr><th>Mobile</th><td>{selectedAdmin.mobile || '—'}</td></tr>
                <tr><th>Role</th><td>Manager</td></tr>
                <tr><th>Department</th><td>{selectedAdmin.department || '—'}</td></tr>
              </tbody>
            </table>

            <h2
              style={{ marginTop: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
              onClick={() => setEmployeesOpen(!employeesOpen)}
            >
              {employeesOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              Employees ({selectedAdmin.employeeCount})
            </h2>
            {employeesOpen && (
              selectedAdmin.employees.length === 0 ? (
                <div className="empty">No employees under this admin yet.</div>
              ) : (
                <div className="live-grid">
                  {selectedAdmin.employees.map((e) => (
                    <div key={e.id} className="live-card" onClick={() => setSelectedEmployeeId(e.id)}>
                      <div className="live-card-top">
                        <Avatar name={e.name} size={28} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</div>
                          <div className="shot-meta">{e.jobRole || 'Employee'}{e.department ? ` · ${e.department}` : ''}</div>
                        </div>
                      </div>
                      <div className="live-card-stats">
                        <span>{e.email || '—'}</span>
                        <span>{e.mobile || '—'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>

          <div className="panel">
            <h2>Projects &amp; progress</h2>
            <AdminProjectsPanel managerId={selectedAdmin.id} canRemove={false} />
          </div>
        </>
      )}
    </>
  );
}

function LiveTab({ onSelectMember }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  function load() {
    fetch('/api/superadmin/live-status').then((r) => r.json()).then((data) => {
      setMembers(data);
      setLoading(false);
    });
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  const counts = members.reduce(
    (acc, m) => { acc[m.status] = (acc[m.status] ?? 0) + 1; return acc; },
    { active: 0, idle: 0, offline: 0 },
  );
  const STAT_TILES = [
    { key: 'active', label: 'Active now', icon: Zap, color: 'var(--status-good)' },
    { key: 'idle', label: 'Idle', icon: Coffee, color: 'var(--status-warning)' },
    { key: 'offline', label: 'Offline', icon: MoonStar, color: 'var(--idle)' },
  ];

  return (
    <>
      <div className="stat-row">
        <div className="stat-tile">
          <div className="stat-tile-icon" style={{ background: 'rgba(57,135,229,0.15)' }}>
            <Users size={18} color="var(--brand)" />
          </div>
          <div>
            <div className="stat-tile-value">{members.length}</div>
            <div className="stat-tile-label">Employees</div>
          </div>
        </div>
        {STAT_TILES.map((t) => (
          <div className="stat-tile" key={t.key}>
            <div className="stat-tile-icon" style={{ background: `color-mix(in srgb, ${t.color} 15%, transparent)` }}>
              <t.icon size={18} color={t.color} />
            </div>
            <div>
              <div className="stat-tile-value">{counts[t.key]}</div>
              <div className="stat-tile-label">{t.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="panel">
        <h2>Everyone, right now</h2>
        {members.length === 0 ? (
          <div className="empty">{loading ? 'Loading…' : 'No employees anywhere yet.'}</div>
        ) : (
          <table>
            <thead><tr><th>Name</th><th>Role</th><th>Manager</th><th>Department</th></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} onClick={() => onSelectMember(m.id)} style={{ cursor: 'pointer' }}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Avatar name={m.name} size={24} />
                      <div>
                        <div>{m.name}</div>
                        <div className="shot-meta" style={{ display: 'flex', alignItems: 'center' }}>
                          <span className={`status-dot status-dot-${m.status}`} />
                          {STATUS_LABEL[m.status]}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>{m.jobRole || '—'}</td>
                  <td>{m.managerName}</td>
                  <td>{m.department || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// Every project across every manager, each showing which employees have
// tasks on it and their own individual progress — the org-wide view,
// independent of whichever single admin is selected in the form above.
function OngoingProjectsPanel({ overview }) {
  const [rows, setRows] = useState(null);
  const [removingId, setRemovingId] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);

  async function removeProject(projectId) {
    setRemovingId(projectId);
    const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
    setRemovingId(null);
    setConfirmingId(null);
    if (!res.ok) return;
    setRows((prev) => prev.filter((r) => r.projectId !== projectId));
  }

  useEffect(() => {
    if (!overview) return;
    let cancelled = false;
    (async () => {
      const allRows = [];
      for (const admin of overview.admins) {
        const projects = await fetch(`/api/projects?managerId=${admin.id}`).then((r) => r.json());
        for (const p of projects) {
          const tasks = await fetch(`/api/tasks?projectId=${p.id}`).then((r) => r.json());
          const byEmployee = new Map();
          for (const t of tasks) {
            if (!t.assignee_user_id) continue;
            if (!byEmployee.has(t.assignee_user_id)) byEmployee.set(t.assignee_user_id, { total: 0, done: 0 });
            const bucket = byEmployee.get(t.assignee_user_id);
            bucket.total += 1;
            if (t.status === 'done') bucket.done += 1;
          }
          const employees = [...byEmployee.entries()].map(([userId, c]) => {
            const employee = admin.employees.find((e) => e.id === userId);
            return { name: employee?.name ?? admin.name, done: c.done, total: c.total };
          });
          allRows.push({
            projectId: p.id,
            projectName: p.name,
            managerName: admin.name,
            taskTotal: tasks.length,
            taskDone: tasks.filter((t) => t.status === 'done').length,
            employees,
          });
        }
      }
      if (!cancelled) setRows(allRows);
    })();
    return () => { cancelled = true; };
  }, [overview]);

  if (rows === null) return <div className="panel"><div className="empty">Loading…</div></div>;

  return (
    <div className="panel">
      <h2>Ongoing projects, org-wide</h2>
      <p className="join-sub" style={{ marginTop: 0 }}>
        Every project across every admin, with each assigned employee's own task progress on it.
      </p>
      {rows.length === 0 ? (
        <div className="empty">No projects assigned to anyone yet.</div>
      ) : (
        rows.map((r) => {
          const pct = r.taskTotal > 0 ? Math.round((r.taskDone / r.taskTotal) * 100) : 0;
          return (
            <div className="project-card" key={r.projectId}>
              <div className="project-card-head">
                <div>
                  <div className="project-card-title">{r.projectName}</div>
                  <div className="shot-meta">Admin: {r.managerName}</div>
                </div>
                {confirmingId === r.projectId ? (
                  <div className="inline-form" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    <span className="shot-meta">Deletes its tasks too?</span>
                    <button className="btn-small btn-danger" disabled={removingId === r.projectId} onClick={() => removeProject(r.projectId)}>
                      {removingId === r.projectId ? 'Removing…' : 'Yes, remove'}
                    </button>
                    <button className="btn-small" onClick={() => setConfirmingId(null)}>Cancel</button>
                  </div>
                ) : (
                  <button className="btn-small btn-danger" onClick={() => setConfirmingId(r.projectId)}>Remove project</button>
                )}
              </div>
              <div className="progress-row">
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="progress-label">{r.taskTotal === 0 ? 'No tasks' : `${r.taskDone}/${r.taskTotal} · ${pct}%`}</div>
              </div>
              {r.employees.length > 0 && (
                <>
                  <div className="shot-meta" style={{ marginBottom: 2, fontWeight: 700, letterSpacing: '.02em', textTransform: 'uppercase', fontSize: 10.5 }}>
                    By employee
                  </div>
                  {r.employees.map((e, i) => {
                    const ePct = e.total > 0 ? Math.round((e.done / e.total) * 100) : 0;
                    return (
                      <div className="task-row" key={i}>
                        <span>{e.name}</span>
                        <span className="shot-meta">{e.done}/{e.total} tasks · {ePct}%</span>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function AssignTab({ overview }) {
  const [managerId, setManagerId] = useState('');
  const [projects, setProjects] = useState([]);
  const [form, setForm] = useState({ name: '', clientName: '', taskTitle: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // AdminProjectsPanel loads its own data independently and has no way to
  // know a project was just created under the same manager — remounting it
  // via a changing key is the simplest way to force a refresh.
  const [refreshKey, setRefreshKey] = useState(0);

  function loadProjects(id) {
    if (!id) { setProjects([]); return; }
    fetch(`/api/projects?managerId=${id}`).then((r) => r.json()).then(setProjects);
  }

  useEffect(() => loadProjects(managerId), [managerId]);

  async function submit(e) {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!managerId || !form.name.trim()) { setError('Pick an admin and enter a project name.'); return; }

    setSubmitting(true);
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ managerId, name: form.name.trim(), clientName: form.clientName || null }),
    });
    if (!res.ok) {
      setSubmitting(false);
      setError((await res.json()).error);
      return;
    }
    const project = await res.json();

    if (form.taskTitle.trim()) {
      await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, title: form.taskTitle.trim(), assigneeUserId: managerId }),
      });
    }

    setSubmitting(false);
    setForm({ name: '', clientName: '', taskTitle: '' });
    setSuccess(`Assigned "${project.name}" to ${overview.admins.find((a) => a.id === Number(managerId))?.name}.`);
    loadProjects(managerId);
    setRefreshKey((k) => k + 1);
  }

  return (
    <>
    <div className="panel">
      <h2>Assign a project to an admin</h2>
      <p className="join-sub" style={{ marginTop: 0 }}>
        Creates a project owned by the selected admin — it shows up in their own Projects tab, ready for them to
        build out with tasks and their team. Optionally also create a first task, assigned directly to that admin.
      </p>
      <form className="stacked-form" onSubmit={submit}>
        <select value={managerId} onChange={(e) => setManagerId(e.target.value)}>
          <option value="">Select admin…</option>
          {overview?.admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <input
          placeholder="Project name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          placeholder="Client (optional)"
          value={form.clientName}
          onChange={(e) => setForm({ ...form, clientName: e.target.value })}
        />
        <input
          placeholder="First task title (optional, assigned to the admin)"
          value={form.taskTitle}
          onChange={(e) => setForm({ ...form, taskTitle: e.target.value })}
        />
        {error && <div style={{ color: '#e07070', fontSize: 12 }}>{error}</div>}
        {success && <div style={{ color: 'var(--status-good)', fontSize: 12 }}>{success}</div>}
        <button type="submit" disabled={submitting} style={{ alignSelf: 'flex-start' }}>
          {submitting ? 'Assigning…' : 'Assign project'}
        </button>
      </form>

      {managerId && (
        <>
          <h2 style={{ marginTop: 24 }}>Existing projects for this admin ({projects.length})</h2>
          {projects.length === 0 ? (
            <div className="empty">None yet.</div>
          ) : (
            <AdminProjectsPanel managerId={managerId} key={`${managerId}-${refreshKey}`} canRemove={false} />
          )}
        </>
      )}
    </div>

    <OngoingProjectsPanel overview={overview} />
    </>
  );
}

function CreateAdminPanel({ onCreated }) {
  const [form, setForm] = useState({ name: '', email: '', mobile: '', department: '', jobRole: '', password: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!form.name.trim() || !form.email.trim() || form.password.length < 8) {
      setError('Name, email, and a password of at least 8 characters are required.');
      return;
    }
    setSubmitting(true);
    const res = await fetch('/api/superadmin/create-admin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: form.name.trim(), email: form.email.trim(), password: form.password,
        mobile: form.mobile.trim() || undefined, department: form.department.trim() || undefined, jobRole: form.jobRole.trim() || undefined,
      }),
    });
    setSubmitting(false);
    if (!res.ok) { setError((await res.json()).error); return; }
    const admin = await res.json();
    setSuccess(`Created admin account for ${admin.name} (${admin.email}). Give them their email and password to log in.`);
    setForm({ name: '', email: '', mobile: '', department: '', jobRole: '', password: '' });
    onCreated?.();
  }

  return (
    <div className="panel">
      <h2>Create a new admin</h2>
      <p className="join-sub" style={{ marginTop: 0 }}>
        You set the password directly — hand it to them along with their email so they can log in.
      </p>
      <form className="stacked-form" onSubmit={submit}>
        <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input placeholder="Mobile number" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
        <input placeholder="Department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
        <input placeholder="Role (e.g. Manager)" value={form.jobRole} onChange={(e) => setForm({ ...form, jobRole: e.target.value })} />
        <input
          type="password"
          placeholder="Password (8+ characters)"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        {error && <div style={{ color: '#e07070', fontSize: 12 }}>{error}</div>}
        {success && <div style={{ color: 'var(--status-good)', fontSize: 12 }}>{success}</div>}
        <button type="submit" disabled={submitting} style={{ alignSelf: 'flex-start' }}>
          {submitting ? 'Creating…' : 'Create admin account'}
        </button>
      </form>
    </div>
  );
}

function ChangeAdminPasswordPanel({ overview }) {
  const [managerId, setManagerId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!managerId || password.length < 8) { setError('Pick an admin and enter a password of at least 8 characters.'); return; }
    setSubmitting(true);
    const res = await fetch(`/api/superadmin/managers/${managerId}/change-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email.trim() || undefined, password }),
    });
    setSubmitting(false);
    if (!res.ok) { setError((await res.json()).error); return; }
    setSuccess('Saved. Hand the new password (and email, if you set one) to that admin.');
    setEmail(''); setPassword('');
  }

  return (
    <div className="panel">
      <h2>Change an admin's password</h2>
      <p className="join-sub" style={{ marginTop: 0 }}>
        Direct override — for an admin who's locked out, or an older account with no email attached yet (leave email
        blank to just change the password). This is the "forgot password" fix for admins.
      </p>
      <form className="stacked-form" onSubmit={submit}>
        <select value={managerId} onChange={(e) => setManagerId(e.target.value)}>
          <option value="">Select admin…</option>
          {overview?.admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <input
          type="email"
          placeholder="Set/fix their email (leave blank to keep as-is)"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          placeholder="New password (8+ characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div style={{ color: '#e07070', fontSize: 12 }}>{error}</div>}
        {success && <div style={{ color: 'var(--status-good)', fontSize: 12 }}>{success}</div>}
        <button type="submit" disabled={submitting} style={{ alignSelf: 'flex-start' }}>
          {submitting ? 'Saving…' : 'Set new password'}
        </button>
      </form>
    </div>
  );
}

function TransferEmployeePanel({ overview, onTransferred }) {
  const [employeeId, setEmployeeId] = useState('');
  const [targetManagerId, setTargetManagerId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const allEmployees = (overview?.admins ?? []).flatMap((a) =>
    a.employees.map((e) => ({ ...e, managerId: a.id, managerName: a.name })));

  async function submit(e) {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!employeeId || !targetManagerId) { setError('Pick an employee and a destination admin.'); return; }
    setSubmitting(true);
    const res = await fetch(`/api/superadmin/employees/${employeeId}/transfer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetManagerId }),
    });
    setSubmitting(false);
    if (!res.ok) { setError((await res.json()).error); return; }
    const data = await res.json();
    setSuccess(`Moved to ${data.newManagerName}'s team.`);
    setEmployeeId(''); setTargetManagerId('');
    onTransferred?.();
  }

  return (
    <div className="panel">
      <h2>Transfer an employee to another admin</h2>
      <p className="join-sub" style={{ marginTop: 0 }}>
        Org-wide — unlike an admin moving their own team members, you can move anyone to any admin.
      </p>
      <form className="stacked-form" onSubmit={submit}>
        <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">Select employee…</option>
          {allEmployees.map((e) => <option key={e.id} value={e.id}>{e.name} (reports to {e.managerName})</option>)}
        </select>
        <select value={targetManagerId} onChange={(e) => setTargetManagerId(e.target.value)}>
          <option value="">Move to admin…</option>
          {overview?.admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        {error && <div style={{ color: '#e07070', fontSize: 12 }}>{error}</div>}
        {success && <div style={{ color: 'var(--status-good)', fontSize: 12 }}>{success}</div>}
        <button type="submit" disabled={submitting} style={{ alignSelf: 'flex-start' }}>
          {submitting ? 'Moving…' : 'Transfer employee'}
        </button>
      </form>
    </div>
  );
}

function SetTrackingHoursPanel({ overview }) {
  const [managerId, setManagerId] = useState('');
  return (
    <>
      <div className="panel">
        <h2>Set an admin's tracking hours</h2>
        <p className="join-sub" style={{ marginTop: 0 }}>
          Same effect as an admin setting this for themselves — outside the window, activity and
          screenshots are discarded on arrival rather than stored. No agent update needed.
        </p>
        <select value={managerId} onChange={(e) => setManagerId(e.target.value)}>
          <option value="">Select admin…</option>
          {overview?.admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      {managerId && (
        <TrackingHoursControl managerId={managerId} settingsUrl={`/api/superadmin/managers/${managerId}/settings`} />
      )}
    </>
  );
}

function ManageTab({ overview, onChanged }) {
  const requested = (overview?.admins ?? []).filter((a) => a.passwordResetRequested);
  return (
    <>
      {requested.length > 0 && (
        <div className="panel">
          <h2>Password reset requested ({requested.length})</h2>
          <p className="join-sub" style={{ marginTop: 0 }}>
            These admins clicked "Forgot password?" on the login screen. Use "Change an admin's password" below to set
            them a new one and tell them directly.
          </p>
          <div className="chip-row">
            {requested.map((a) => <div className="chip" key={a.id}>{a.name}</div>)}
          </div>
        </div>
      )}
      <CreateAdminPanel onCreated={onChanged} />
      <ChangeAdminPasswordPanel overview={overview} />
      <SetTrackingHoursPanel overview={overview} />
      <TransferEmployeePanel overview={overview} onTransferred={onChanged} />
    </>
  );
}

export default function SuperAdminDashboard({ user, onLogout }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [overview, setOverview] = useState(null);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [date, setDate] = useState(todayStr());

  function reloadOverview() {
    fetch('/api/superadmin/overview').then((r) => r.json()).then(setOverview);
  }

  useEffect(reloadOverview, [activeTab]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <svg viewBox="0 0 100 100" width="30" height="30" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="eyeGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#3987e5" />
                  <stop offset="1" stopColor="#9085e9" />
                </linearGradient>
              </defs>
              <polygon points="50,7.8 8.8,89.8 91.2,89.8" fill="url(#eyeGrad)" />
              <ellipse cx="50" cy="68.4" rx="27.3" ry="7.6" fill="#f5f8fc" />
              <circle cx="50" cy="68.4" r="8.4" fill="#18203a" />
              <circle cx="50" cy="68.4" r="7.3" fill="none" stroke="#5878dc" strokeWidth="0.6" />
              <circle cx="50" cy="68.4" r="4.2" fill="#06080f" />
              <circle cx="47.75" cy="66.15" r="1.37" fill="#fff" />
              <circle cx="51.66" cy="70.06" r="0.68" fill="#fff" />
            </svg>
          </div>
          <div className="brand-name">BIG BOSS</div>
        </div>

        <nav className="sidebar-nav">
          {TABS.map((t) => (
            <div
              key={t.key}
              className={`nav-item ${activeTab === t.key ? 'active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              <t.icon size={16} />
              {t.label}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="profile-card">
            <Avatar name={user.name} size={38} />
            <div className="profile-info">
              <div className="profile-name">{user.name}</div>
              <div className="profile-role">Super Admin</div>
            </div>
          </div>
          <button className="btn-small profile-logout" onClick={onLogout}>
            <LogOut size={13} />Log out
          </button>
          <div className="sidebar-illustration">
            <DeskIllustration />
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="tabs">
          {TABS.map((t) => (
            <div
              key={t.key}
              className={`tab ${activeTab === t.key ? 'active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              <t.icon size={15} />
              {t.label}
            </div>
          ))}
        </div>

        {activeTab === 'overview' && (
          <OverviewTab overview={overview} onSelectMember={(id, tab = 'timeline') => { setSelectedUserId(id); setActiveTab(tab); }} />
        )}
        {activeTab === 'live' && (
          <LiveTab onSelectMember={(id) => { setSelectedUserId(id); setActiveTab('timeline'); }} />
        )}
        {activeTab === 'timeline' && (
          <TimelineView selectedUserId={selectedUserId} date={date} setDate={setDate} />
        )}
        {activeTab === 'screenshots' && <ScreenshotsView selectedUserId={selectedUserId} managerId={null} canDelete />}
        {activeTab === 'manage' && <ManageTab overview={overview} onChanged={reloadOverview} />}
        {activeTab === 'assign' && <AssignTab overview={overview} />}
      </main>
    </div>
  );
}
