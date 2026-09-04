import { useEffect, useState } from 'react';
import {
  LayoutDashboard, Activity, Clock, Camera, KanbanSquare, LogOut, Zap, Coffee, MoonStar, Users, ShieldCheck,
  ChevronDown, ChevronRight, UserCog, Send, Building2, ListChecks, BarChart3, FolderOpen, Trash2, Users2,
  UserPlus, Lock, Eye, EyeOff, Mail, Phone, ArrowRightLeft, AlertCircle, User, Pencil, Video,
} from 'lucide-react';
import { todayStr } from '../format.js';
import Avatar from '../components/Avatar.jsx';
import DeskIllustration from '../components/DeskIllustration.jsx';
import FolderIllustration from '../components/FolderIllustration.jsx';
import AdminCardIllustration from '../components/AdminCardIllustration.jsx';
import EmployeeManagementTable from '../components/EmployeeManagementTable.jsx';
import Modal from '../components/Modal.jsx';
import WebRTCViewer from '../components/WebRTCViewer.jsx';
import TimelineView from './TimelineView.jsx';
import ScreenshotsView, { TrackingHoursControl, IntervalControl } from './ScreenshotsView.jsx';
import SupervisorTeamView from './SupervisorTeamView.jsx';
import { LOGO_DATA_URI } from '../logo.js';

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
  { key: 'employees', label: 'Employee Management', icon: Users },
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
function OverviewTab({ overview, onSelectMember, onChanged }) {
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
              <EmployeeManagementTable
                employees={selectedAdmin.employees.map((e) => ({ ...e, managerId: selectedAdmin.id }))}
                managerName={selectedAdmin.name}
                otherManagers={overview.admins.filter((a) => a.id !== selectedAdmin.id)}
                onRowClick={(e) => setSelectedEmployeeId(e.id)}
                onSave={async (employeeId, fields) => {
                  const res = await fetch(`/api/superadmin/employees/${employeeId}`, {
                    method: 'PATCH',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(fields),
                  });
                  if (!res.ok) return (await res.json()).error;
                  onChanged?.();
                  return null;
                }}
                onDelete={async (employeeId) => {
                  const res = await fetch(`/api/superadmin/employees/${employeeId}`, { method: 'DELETE' });
                  if (res.ok) onChanged?.();
                }}
                onTransfer={async (employeeId, targetManagerId) => {
                  const res = await fetch(`/api/superadmin/employees/${employeeId}/transfer`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ targetManagerId }),
                  });
                  if (!res.ok) return (await res.json()).error;
                  onChanged?.();
                  return null;
                }}
              />
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

// Flat, org-wide version of the same employee table — every employee across
// every admin in one list, instead of having to open each admin first (as
// the Overview tab's drill-down still requires).
// Timeline/Screenshots have no "pick from your team" sidebar the way the
// manager dashboard does — this bar fills that gap so the super admin can
// jump straight to (or switch between) any employee's data org-wide,
// instead of having to go through Live or Overview first.
function EmployeePickerBar({ overview, selectedUserId, onSelect }) {
  if (!overview) return null;
  const allEmployees = overview.admins.flatMap((a) =>
    a.employees.map((e) => ({ ...e, managerName: a.name })));

  return (
    <div className="panel">
      <h2>Choose an employee</h2>
      {allEmployees.length === 0 ? (
        <div className="empty">No employees anywhere yet.</div>
      ) : (
        <div className="chip-row">
          {allEmployees.map((e) => (
            <div
              key={e.id}
              className={`chip ${e.id === selectedUserId ? 'selected' : ''}`}
              onClick={() => onSelect(e.id)}
            >
              {e.name} <span style={{ opacity: 0.75 }}>· {e.managerName}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SuperAdminEmployeesTab({ overview, onChanged }) {
  if (!overview) return null;
  const allEmployees = overview.admins.flatMap((a) =>
    a.employees.map((e) => ({ ...e, managerId: a.id, managerName: a.name })));

  return (
    <div className="panel">
      <div className="section-head">
        <div className="section-icon"><Users size={22} /></div>
        <div>
          <h2 className="card-title">Employees ({allEmployees.length})</h2>
          <p className="card-subtitle">
            Every employee, org-wide. Click the pencil to edit their details or set a new password, or the trash icon to remove them.
          </p>
        </div>
      </div>
      <EmployeeManagementTable
        employees={allEmployees}
        otherManagers={overview.admins}
        onSave={async (employeeId, fields) => {
          const res = await fetch(`/api/superadmin/employees/${employeeId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(fields),
          });
          if (!res.ok) return (await res.json()).error;
          onChanged?.();
          return null;
        }}
        onDelete={async (employeeId) => {
          const res = await fetch(`/api/superadmin/employees/${employeeId}`, { method: 'DELETE' });
          if (res.ok) onChanged?.();
        }}
        onTransfer={async (employeeId, targetManagerId) => {
          const res = await fetch(`/api/superadmin/employees/${employeeId}/transfer`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ targetManagerId }),
          });
          if (!res.ok) return (await res.json()).error;
          onChanged?.();
          return null;
        }}
      />
    </div>
  );
}

function LiveTab({ onSelectMember }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [watching, setWatching] = useState(null); // { id, name } | null

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
            <thead><tr><th>Name</th><th>Role</th><th>Manager</th><th>Department</th><th></th></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td style={{ cursor: 'pointer' }} onClick={() => onSelectMember(m.id)}>
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
                  <td>
                    <button
                      type="button"
                      className="btn-small btn-outline"
                      disabled={m.status === 'offline'}
                      onClick={() => setWatching({ id: m.id, name: m.name })}
                    >
                      <Video size={12} />{m.status === 'offline' ? 'Offline' : 'Watch Live'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {watching && (
        <WebRTCViewer employeeId={watching.id} employeeName={watching.name} onClose={() => setWatching(null)} />
      )}
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
      <div className="section-head">
        <div className="section-icon"><BarChart3 size={22} /></div>
        <div>
          <h2 className="card-title">Ongoing projects, org-wide</h2>
          <p className="card-subtitle">Every project across every admin, with each assigned employee's own task progress on it.</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="empty">No projects assigned to anyone yet.</div>
      ) : (
        rows.map((r) => {
          const pct = r.taskTotal > 0 ? Math.round((r.taskDone / r.taskTotal) * 100) : 0;
          return (
            <div className="project-card" key={r.projectId}>
              <div className="project-card-head">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div className="section-icon section-icon-sm"><FolderOpen size={16} /></div>
                  <div>
                    <div className="project-card-title">{r.projectName}</div>
                    <div className="shot-meta">Admin: {r.managerName}</div>
                  </div>
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
                  <button className="btn-outline-danger btn-small" onClick={() => setConfirmingId(r.projectId)}>
                    <Trash2 size={13} />Remove project
                  </button>
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
                  <div className="mini-table-head">
                    <span>By employee</span>
                    <span>Task progress</span>
                  </div>
                  {r.employees.map((e, i) => {
                    const ePct = e.total > 0 ? Math.round((e.done / e.total) * 100) : 0;
                    return (
                      <div className="employee-progress-row" key={i}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Avatar name={e.name} size={22} />
                          {e.name}
                        </div>
                        <div className="progress-row" style={{ flex: 1, maxWidth: 240 }}>
                          <div className="progress-track">
                            <div className="progress-fill" style={{ width: `${ePct}%` }} />
                          </div>
                          <div className="progress-label">{e.done}/{e.total} tasks · {ePct}%</div>
                        </div>
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

  function reset() {
    setManagerId('');
    setForm({ name: '', clientName: '', taskTitle: '' });
    setError(''); setSuccess('');
  }

  return (
    <>
    <div className="panel">
      <div className="section-head">
        <div className="section-icon"><Users2 size={22} /></div>
        <div>
          <h2 className="card-title">Assign a project to an admin</h2>
          <p className="card-subtitle">
            Create a project owned by the selected admin. It shows up in their own Projects tab, ready for them to
            build out with tasks and their team. Optionally, create a first task, assigned directly to that admin.
          </p>
        </div>
        <div className="section-illustration"><FolderIllustration /></div>
      </div>
      <form onSubmit={submit}>
        <div className="form-grid">
          <div className="field">
            <label>Select admin</label>
            <div className="input-icon-wrap">
              <UserCog size={15} />
              <select value={managerId} onChange={(e) => setManagerId(e.target.value)}>
                <option value="">Select admin…</option>
                {overview?.admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Project name</label>
            <div className="input-icon-wrap">
              <FolderOpen size={15} />
              <input
                placeholder="Enter project name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
          </div>
          <div className="field">
            <label>Client (optional)</label>
            <div className="input-icon-wrap">
              <Building2 size={15} />
              <input
                placeholder="Enter client name"
                value={form.clientName}
                onChange={(e) => setForm({ ...form, clientName: e.target.value })}
              />
            </div>
          </div>
          <div className="field">
            <label>First task title (optional)</label>
            <div className="input-icon-wrap">
              <ListChecks size={15} />
              <input
                placeholder="e.g. Setup project repository"
                value={form.taskTitle}
                onChange={(e) => setForm({ ...form, taskTitle: e.target.value })}
              />
            </div>
          </div>
        </div>
        {error && <div style={{ color: '#e07070', fontSize: 12, marginBottom: 12 }}>{error}</div>}
        {success && <div style={{ color: 'var(--status-good)', fontSize: 12, marginBottom: 12 }}>{success}</div>}
        <div className="inline-form">
          <button type="submit" disabled={submitting}>
            <Send size={14} />{submitting ? 'Assigning…' : 'Assign Project'}
          </button>
          <button type="button" className="btn-text" onClick={reset}>Reset</button>
        </div>
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
  const emptyForm = { name: '', email: '', mobile: '', department: '', jobRole: '', password: '' };
  const [form, setForm] = useState(emptyForm);
  const [showPassword, setShowPassword] = useState(false);
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
    setSuccess(`Created admin account for ${admin.name} (${admin.email}). Give them their email and password directly — no email is sent automatically.`);
    setForm(emptyForm);
    onCreated?.();
  }

  function reset() {
    setForm(emptyForm);
    setError(''); setSuccess('');
  }

  return (
    <div className="panel">
      <div className="section-head">
        <div className="section-icon"><UserPlus size={22} /></div>
        <div>
          <h2 className="card-title">Create a new admin</h2>
          <p className="card-subtitle">
            Add a new admin to your workspace. You set their password directly — hand it to them along with their
            email so they can log in.
          </p>
        </div>
        <div className="section-illustration"><AdminCardIllustration /></div>
      </div>
      <form onSubmit={submit}>
        <div className="form-grid">
          <div className="field">
            <label>Full name</label>
            <div className="input-icon-wrap">
              <User size={15} />
              <input placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>Department</label>
            <div className="input-icon-wrap">
              <Building2 size={15} />
              <input placeholder="Department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>Email address</label>
            <div className="input-icon-wrap">
              <Mail size={15} />
              <input type="email" placeholder="Email address" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>Role</label>
            <div className="input-icon-wrap">
              <Users size={15} />
              <input placeholder="Role (e.g. Manager)" value={form.jobRole} onChange={(e) => setForm({ ...form, jobRole: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>Mobile number</label>
            <div className="input-icon-wrap">
              <Phone size={15} />
              <input placeholder="Mobile number" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>Password</label>
            <div className="input-icon-wrap has-toggle">
              <Lock size={15} />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Password (8+ characters)"
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
        {success && <div style={{ color: 'var(--status-good)', fontSize: 12, marginBottom: 12 }}>{success}</div>}
        <div className="inline-form">
          <button type="submit" disabled={submitting}>
            <UserPlus size={14} />{submitting ? 'Creating…' : 'Create admin account'}
          </button>
          <button type="button" className="btn-text" onClick={reset}>Reset</button>
        </div>
      </form>
    </div>
  );
}

// Consolidated "click the pencil" edit form for one admin — profile fields
// and password (both PATCH /api/superadmin/managers/:id) plus, in the same
// dialog, their tracking hours and a way to transfer one of their employees
// elsewhere. Replaces what used to be three separate always-visible panels
// each with their own "select an admin" dropdown.
function EditManagerModal({ manager, allManagers, onSaved, onClose }) {
  const [form, setForm] = useState({
    name: manager.name ?? '', email: manager.email ?? '', mobile: manager.mobile ?? '',
    department: manager.department ?? '', jobRole: manager.jobRole ?? '', password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [employeeId, setEmployeeId] = useState('');
  const [targetManagerId, setTargetManagerId] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState('');
  const [transferSuccess, setTransferSuccess] = useState('');

  async function save(e) {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) { setError('Name is required.'); return; }
    if (form.password && form.password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setSaving(true);
    const res = await fetch(`/api/superadmin/managers/${manager.id}`, {
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

  async function doTransfer() {
    if (!employeeId || !targetManagerId) return;
    setTransferError(''); setTransferSuccess('');
    setTransferring(true);
    const res = await fetch(`/api/superadmin/employees/${employeeId}/transfer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetManagerId }),
    });
    setTransferring(false);
    if (!res.ok) { setTransferError((await res.json()).error); return; }
    const data = await res.json();
    setTransferSuccess(`Moved to ${data.newManagerName}'s team.`);
    setEmployeeId(''); setTargetManagerId('');
    onSaved?.();
  }

  return (
    <Modal title={`Edit ${manager.name}`} onClose={onClose} width={640}>
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
        {error && <div style={{ color: '#e07070', fontSize: 12, marginBottom: 12 }}>{error}</div>}
        <div className="inline-form">
          <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
          <button type="button" className="btn-outline" onClick={onClose}>Cancel</button>
        </div>
      </form>

      <hr className="modal-divider" />
      <p className="modal-section-title">Screenshot frequency</p>
      <IntervalControl managerId={manager.id} settingsUrl={`/api/superadmin/managers/${manager.id}/settings`} />

      <hr className="modal-divider" />
      <p className="modal-section-title">Tracking hours</p>
      <TrackingHoursControl managerId={manager.id} settingsUrl={`/api/superadmin/managers/${manager.id}/settings`} />

      {manager.employees?.length > 0 && (
        <>
          <hr className="modal-divider" />
          <p className="modal-section-title">Transfer one of their employees</p>
          <div className="inline-form">
            <div className="input-icon-wrap" style={{ minWidth: 180 }}>
              <User size={15} />
              <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="">Select employee…</option>
                {manager.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div className="input-icon-wrap" style={{ minWidth: 180 }}>
              <ArrowRightLeft size={15} />
              <select value={targetManagerId} onChange={(e) => setTargetManagerId(e.target.value)}>
                <option value="">Move to admin…</option>
                {allManagers.filter((m) => m.id !== manager.id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <button type="button" className="btn-outline-danger" disabled={!employeeId || !targetManagerId || transferring} onClick={doTransfer}>
              {transferring ? 'Transferring…' : 'Transfer'}
            </button>
          </div>
          {transferError && <div style={{ color: '#e07070', fontSize: 12, marginTop: 8 }}>{transferError}</div>}
          {transferSuccess && <div style={{ color: 'var(--status-good)', fontSize: 12, marginTop: 8 }}>{transferSuccess}</div>}
        </>
      )}
    </Modal>
  );
}

function AdminsListPanel({ overview, onChanged }) {
  const [editing, setEditing] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [deleteError, setDeleteError] = useState('');

  async function handleDelete(id) {
    setDeleteError('');
    setDeletingId(id);
    const res = await fetch(`/api/superadmin/managers/${id}`, { method: 'DELETE' });
    setDeletingId(null);
    if (!res.ok) { setDeleteError((await res.json()).error); return; }
    setConfirmingId(null);
    onChanged?.();
  }

  return (
    <div className="panel">
      <div className="section-head">
        <div className="section-icon"><Users2 size={22} /></div>
        <div>
          <h2 className="card-title">Admins</h2>
          <p className="card-subtitle">
            Click the pencil to edit an admin's details or password, set their tracking hours, or transfer one of their employees. The trash icon removes an admin with no employees left on their team.
          </p>
        </div>
      </div>
      {deleteError && <div style={{ color: '#e07070', fontSize: 12, marginBottom: 10 }}>{deleteError}</div>}
      {overview.admins.length === 0 ? (
        <div className="empty">No admins yet.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Mobile</th><th>Role</th><th>Department</th><th></th></tr>
            </thead>
            <tbody>
              {overview.admins.map((a) => (
                <tr key={a.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Avatar name={a.name} size={26} />
                      {a.name}
                    </div>
                  </td>
                  <td>{a.email || '—'}</td>
                  <td>{a.mobile || '—'}</td>
                  <td><span className="badge-role">{a.jobRole || 'Manager'}</span></td>
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
        <EditManagerModal manager={editing} allManagers={overview.admins} onSaved={onChanged} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

const REASSIGN_ROLE_LABEL = { gm: 'GM', agm: 'AGM', manager: 'Manager', am: 'Assistant Manager', tl: 'Team Lead', employee: 'Employee' };

// Reassigns any one account anywhere in the org to a new parent at any
// level — the super admin's version of the peer-transfer every supervisor
// tier now has for their own direct reports (see SupervisorTeamView.jsx and
// backend/src/routes/supervisors.js's /:id/team/:memberId/transfer). Split
// into its own panel rather than folded into the admins list below, since it
// needs to reach GM/AGM/AM/TL accounts too, which that list still doesn't
// show (see the /overview KNOWN LIMITATION in superadmin.js).
function ReassignPanel() {
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [newParentId, setNewParentId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch('/api/superadmin/users').then((r) => r.json()).then(setUsers);
  }, []);

  useEffect(() => {
    setNewParentId('');
    setCandidates([]);
    if (!userId) return;
    fetch(`/api/superadmin/users/${userId}/reassign-candidates`).then((r) => r.json()).then(setCandidates);
  }, [userId]);

  async function submit(e) {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!userId || !newParentId) return;
    setSubmitting(true);
    const res = await fetch(`/api/superadmin/users/${userId}/reassign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newParentId }),
    });
    setSubmitting(false);
    if (!res.ok) { setError((await res.json()).error); return; }
    const data = await res.json();
    setSuccess(`Moved to report to ${data.newParentName}.`);
    setUserId(''); setNewParentId('');
  }

  const selectedUser = users.find((u) => u.id === Number(userId));

  return (
    <div className="panel">
      <div className="section-head">
        <div className="section-icon"><UserCog size={22} /></div>
        <div>
          <h2 className="card-title">Reassign anyone</h2>
          <p className="card-subtitle">
            Move any account — and everyone below them — to a new supervisor at any level. Only accounts
            one level above their current role are valid destinations, so the reporting chain stays intact.
          </p>
        </div>
      </div>
      <form className="stacked-form" onSubmit={submit}>
        <select value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Who to move…</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.name} ({REASSIGN_ROLE_LABEL[u.role] ?? u.role})</option>
          ))}
        </select>
        {userId && (
          <select value={newParentId} onChange={(e) => setNewParentId(e.target.value)} disabled={candidates.length === 0}>
            <option value="">
              {candidates.length === 0 ? `No valid destination for a ${REASSIGN_ROLE_LABEL[selectedUser?.role] ?? ''}` : 'Move to report to…'}
            </option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {error && <div style={{ color: '#e07070', fontSize: 12 }}>{error}</div>}
        {success && <div style={{ color: 'var(--status-good)', fontSize: 12 }}>{success}</div>}
        <button type="submit" disabled={!userId || !newParentId || submitting} style={{ alignSelf: 'flex-start' }}>
          {submitting ? 'Moving…' : 'Move'}
        </button>
      </form>
    </div>
  );
}

// Every pending "Forgot password?" request in the org, any role — the super
// admin sees all of them as a backstop, on top of whoever's own direct
// supervisor already sees the same request in their Team & Invite tab (an
// employee's TL, or a GM/AGM/Manager/AM's own supervisor).
function PasswordResetRequestsPanel() {
  const [requests, setRequests] = useState(null);
  const [settingFor, setSettingFor] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function load() {
    fetch('/api/superadmin/password-reset-requests').then((r) => r.json()).then(setRequests);
  }

  useEffect(load, []);

  function startSet(id) {
    setSettingFor(id);
    setNewPassword('');
    setError('');
  }

  async function saveNewPassword(id) {
    if (newPassword.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setSaving(true);
    setError('');
    const res = await fetch(`/api/superadmin/users/${id}/set-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: newPassword }),
    });
    setSaving(false);
    if (!res.ok) { setError((await res.json()).error); return; }
    setSettingFor(null);
    load();
  }

  if (!requests || requests.length === 0) return null;

  return (
    <div className="panel">
      <div className="section-head">
        <div className="section-icon"><AlertCircle size={22} /></div>
        <div>
          <h2 className="card-title">Password reset requested ({requests.length})</h2>
          <p className="card-subtitle">
            These accounts clicked "Forgot password?" on the login screen — any role, org-wide. Set them a new one directly below.
          </p>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Name</th><th>Role</th><th>Reports to</th><th></th></tr></thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td><span className="badge-role">{REASSIGN_ROLE_LABEL[r.role] ?? r.role}</span></td>
                <td>{r.reportsTo || '—'}</td>
                <td>
                  {settingFor === r.id ? (
                    <div className="inline-form" style={{ gap: 6, flexWrap: 'nowrap' }}>
                      <input
                        type="password"
                        placeholder="New password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        style={{ width: 140 }}
                      />
                      <button className="btn-small" disabled={saving} onClick={() => saveNewPassword(r.id)}>
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button className="btn-small" onClick={() => setSettingFor(null)}>Cancel</button>
                    </div>
                  ) : (
                    <button className="btn-small" onClick={() => startSet(r.id)}>Set password</button>
                  )}
                  {settingFor === r.id && error && (
                    <div style={{ color: '#e07070', fontSize: 11, marginTop: 4 }}>{error}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ManageTab({ overview, onChanged, superadminId }) {
  return (
    <>
      <PasswordResetRequestsPanel />
      {/* Starts the new GM-down hierarchy — the super admin invites a GM the
          same way every other level invites the one below it (see
          SupervisorTeamView.jsx / hierarchy.js's roleBelow). CreateAdminPanel
          below is the older, separate "create a Manager account directly, no
          invite" flow kept for the two-level org shape from before this
          rework — the two coexist since neither replaces the other. */}
      <SupervisorTeamView supervisorId={superadminId} />
      <CreateAdminPanel onCreated={onChanged} />
      <ReassignPanel />
      <AdminsListPanel overview={overview} onChanged={onChanged} />
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

  // The screenshot interval / tracking-hours settings are per-manager (they
  // apply to that manager's whole team), so viewing one employee's
  // screenshots as super admin needs that employee's own manager's id, not
  // the employee's own id.
  const selectedEmployeeManagerId = overview?.admins
    ?.flatMap((a) => a.employees.map((e) => ({ id: e.id, managerId: a.id })))
    .find((e) => e.id === selectedUserId)?.managerId ?? null;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <img src={LOGO_DATA_URI} alt="BIG BOSS" width="30" height="30" />
          </div>
          <div className="brand-name">BIG BOSS</div>
        </div>

        <nav className="sidebar-nav">
          {TABS.map((t) => (
            <div
              key={t.key}
              className={`nav-item ${activeTab === t.key ? 'active' : ''}`}
              onClick={() => setActiveTab(t.key)}
              title={t.label}
            >
              <t.icon size={16} />
              <span>{t.label}</span>
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
          <button className="btn-outline profile-logout" onClick={onLogout} title="Log out">
            <LogOut size={13} /><span>Log out</span>
          </button>
          <div className="sidebar-illustration">
            <DeskIllustration />
          </div>
        </div>
      </aside>

      <main className="main">
        {activeTab === 'overview' && (
          <OverviewTab overview={overview} onChanged={reloadOverview} onSelectMember={(id, tab = 'timeline') => { setSelectedUserId(id); setActiveTab(tab); }} />
        )}
        {activeTab === 'live' && (
          <LiveTab onSelectMember={(id) => { setSelectedUserId(id); setActiveTab('timeline'); }} />
        )}
        {activeTab === 'timeline' && (
          <>
            <EmployeePickerBar overview={overview} selectedUserId={selectedUserId} onSelect={setSelectedUserId} />
            <TimelineView selectedUserId={selectedUserId} date={date} setDate={setDate} />
          </>
        )}
        {activeTab === 'screenshots' && (
          <>
            <EmployeePickerBar overview={overview} selectedUserId={selectedUserId} onSelect={setSelectedUserId} />
            <ScreenshotsView
              selectedUserId={selectedUserId}
              managerId={selectedEmployeeManagerId}
              settingsUrl={selectedEmployeeManagerId ? `/api/superadmin/managers/${selectedEmployeeManagerId}/settings` : undefined}
              canDelete
            />
          </>
        )}
        {activeTab === 'employees' && <SuperAdminEmployeesTab overview={overview} onChanged={reloadOverview} />}
        {activeTab === 'manage' && <ManageTab overview={overview} onChanged={reloadOverview} superadminId={user.id} />}
        {activeTab === 'assign' && <AssignTab overview={overview} />}
      </main>
    </div>
  );
}
