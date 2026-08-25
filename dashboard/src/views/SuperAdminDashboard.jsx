import { useEffect, useState } from 'react';
import { LayoutDashboard, Activity, Clock, Camera, KanbanSquare, LogOut, Zap, Coffee, MoonStar, Users, ShieldCheck, ChevronDown, ChevronRight, UserCog } from 'lucide-react';
import { todayStr } from '../format.js';
import Avatar from '../components/Avatar.jsx';
import TimelineView from './TimelineView.jsx';
import ScreenshotsView from './ScreenshotsView.jsx';

const TASK_STATUS_LABEL = { todo: 'To do', in_progress: 'In progress', review: 'Review', done: 'Done' };

function AdminProjectsPanel({ managerId }) {
  const [projects, setProjects] = useState(null);
  const [taskCounts, setTaskCounts] = useState({});

  useEffect(() => {
    fetch(`/api/projects?managerId=${managerId}`).then((r) => r.json()).then((data) => {
      setProjects(data);
      data.forEach((p) => {
        fetch(`/api/tasks?projectId=${p.id}`).then((r) => r.json()).then((tasks) => {
          const counts = tasks.reduce((acc, t) => { acc[t.status] = (acc[t.status] ?? 0) + 1; return acc; }, {});
          setTaskCounts((prev) => ({ ...prev, [p.id]: counts }));
        });
      });
    });
  }, [managerId]);

  if (projects === null) return <div className="empty">Loading…</div>;
  if (projects.length === 0) return <div className="empty">No projects assigned to this admin yet.</div>;

  return (
    <table>
      <thead><tr><th>Project</th><th>Client</th><th>Tasks</th></tr></thead>
      <tbody>
        {projects.map((p) => {
          const counts = taskCounts[p.id];
          return (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{p.client_name || '—'}</td>
              <td>
                {!counts ? '…' : Object.keys(counts).length === 0 ? 'No tasks yet' : (
                  Object.entries(counts).map(([status, n]) => `${TASK_STATUS_LABEL[status]}: ${n}`).join(' · ')
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const TABS = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'live', label: 'Live', icon: Activity },
  { key: 'timeline', label: 'Timeline', icon: Clock },
  { key: 'screenshots', label: 'Screenshots', icon: Camera },
  { key: 'assign', label: 'Assign Project', icon: KanbanSquare },
  { key: 'manage', label: 'Manage Admins', icon: UserCog },
];

const STATUS_LABEL = { active: 'Active', idle: 'Idle', offline: 'Offline' };
const REFRESH_MS = 15_000;

function OverviewTab({ overview }) {
  const [expandedId, setExpandedId] = useState(null);
  if (!overview) return null;

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

      {overview.admins.length === 0 ? (
        <div className="panel"><div className="empty">No admins yet.</div></div>
      ) : overview.admins.map((admin) => {
        const expanded = expandedId === admin.id;
        return (
          <div className="panel" key={admin.id}>
            <h2
              style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
              onClick={() => setExpandedId(expanded ? null : admin.id)}
            >
              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <Avatar name={admin.name} size={22} />
              {admin.name}
              <span className="shot-meta" style={{ fontWeight: 400 }}>— {admin.employeeCount} employee{admin.employeeCount === 1 ? '' : 's'}</span>
            </h2>
            {admin.employees.length === 0 ? (
              <div className="empty">No employees under this admin yet.</div>
            ) : (
              <div className="chip-row">
                {admin.employees.map((e) => <div className="chip" key={e.id}>{e.name}</div>)}
              </div>
            )}
            {expanded && (
              <>
                <h2 style={{ marginTop: 16 }}>Projects &amp; client work</h2>
                <AdminProjectsPanel managerId={admin.id} />
              </>
            )}
          </div>
        );
      })}
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
          <div className="live-grid">
            {members.map((m) => (
              <div key={m.id} className="live-card" onClick={() => onSelectMember(m.id)}>
                <div className="live-card-top">
                  <Avatar name={m.name} size={30} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
                    <div className="shot-meta" style={{ display: 'flex', alignItems: 'center' }}>
                      <span className={`status-dot status-dot-${m.status}`} />
                      {STATUS_LABEL[m.status]} · reports to {m.managerName}
                    </div>
                  </div>
                </div>
                {m.status !== 'offline' && (
                  <div className="shot-meta" style={{ marginBottom: 4 }}>
                    {m.currentDomain ? `${m.currentApp} · ${m.currentDomain}` : m.currentApp || '—'}
                  </div>
                )}
                <div className="live-card-stats">
                  <span>{m.todayScore}% today</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function AssignTab({ overview }) {
  const [managerId, setManagerId] = useState('');
  const [projects, setProjects] = useState([]);
  const [form, setForm] = useState({ name: '', clientName: '', taskTitle: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
  }

  return (
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
            <div className="chip-row">
              {projects.map((p) => <div className="chip" key={p.id}>{p.name}</div>)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CreateAdminPanel({ onCreated }) {
  const [form, setForm] = useState({ name: '', email: '', password: '' });
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
      body: JSON.stringify({ name: form.name.trim(), email: form.email.trim(), password: form.password }),
    });
    setSubmitting(false);
    if (!res.ok) { setError((await res.json()).error); return; }
    const admin = await res.json();
    setSuccess(`Created admin account for ${admin.name} (${admin.email}). Give them their email and password to log in.`);
    setForm({ name: '', email: '', password: '' });
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

function ManageTab({ overview, onChanged }) {
  return (
    <>
      <CreateAdminPanel onCreated={onChanged} />
      <ChangeAdminPasswordPanel overview={overview} />
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

        <div className="sidebar-section">
          <h1>Signed in as</h1>
          <div className="inline-form" style={{ justifyContent: 'space-between' }}>
            <strong>{user.name}</strong>
            <button className="btn-small" onClick={onLogout}>
              <LogOut size={12} style={{ marginRight: 4, verticalAlign: -1 }} />Log out
            </button>
          </div>
          <div className="shot-meta" style={{ marginTop: 6 }}>Super Admin</div>
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

        {activeTab === 'overview' && <OverviewTab overview={overview} />}
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
