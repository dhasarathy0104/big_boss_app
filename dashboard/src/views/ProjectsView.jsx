import { useEffect, useState } from 'react';
import {
  X, FolderPlus, FolderOpen, Layers, PlusCircle, Info, ClipboardList, CheckCircle2, User,
} from 'lucide-react';
import FolderIllustration from '../components/FolderIllustration.jsx';

const COLUMNS = [
  { key: 'todo', label: 'To do', dot: 'var(--brand)' },
  { key: 'in_progress', label: 'In progress', dot: 'var(--neutral)' },
  { key: 'review', label: 'Review', dot: 'var(--status-warning)' },
  { key: 'done', label: 'Done', dot: 'var(--productive)' },
];

const COLUMN_EMPTY = {
  review: { icon: ClipboardList, title: 'No tasks in review', sub: 'Move tasks here for review' },
  done: { icon: CheckCircle2, title: 'No tasks completed', sub: 'Completed tasks will appear here' },
};

function QuickAddTask({ status, onAdd }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!title.trim()) { setOpen(false); return; }
    await onAdd(title.trim(), status);
    setTitle('');
    setOpen(false);
  }

  if (!open) {
    return (
      <button type="button" className="btn-text kanban-add-btn" onClick={() => setOpen(true)}>
        <PlusCircle size={14} />Add task
      </button>
    );
  }

  return (
    <form className="kanban-quick-add" onSubmit={submit}>
      <input
        autoFocus
        placeholder="Task title…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => { if (!title.trim()) setOpen(false); }}
      />
    </form>
  );
}

export default function ProjectsView({ managerId, team }) {
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [newProject, setNewProject] = useState({ name: '', clientName: '', isBillable: false, hourlyRate: '' });
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskAssignee, setNewTaskAssignee] = useState('');

  function loadProjects() {
    fetch(`/api/projects?managerId=${managerId}`).then((r) => r.json()).then((data) => {
      setProjects(data);
      if (data.length && !data.some((p) => p.id === selectedProjectId)) setSelectedProjectId(data[0].id);
      if (data.length === 0) setSelectedProjectId(null);
    });
  }

  function loadTasks(projectId) {
    if (!projectId) { setTasks([]); return; }
    fetch(`/api/tasks?projectId=${projectId}`).then((r) => r.json()).then(setTasks);
  }

  useEffect(() => { if (managerId) loadProjects(); }, [managerId]);
  useEffect(() => loadTasks(selectedProjectId), [selectedProjectId]);

  async function createProject(e) {
    e.preventDefault();
    if (!newProject.name.trim()) return;
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        managerId,
        name: newProject.name,
        clientName: newProject.clientName || null,
        isBillable: newProject.isBillable,
        hourlyRate: newProject.hourlyRate ? Number(newProject.hourlyRate) : null,
      }),
    });
    const project = await res.json();
    setNewProject({ name: '', clientName: '', isBillable: false, hourlyRate: '' });
    setProjects((prev) => [project, ...prev]);
    setSelectedProjectId(project.id);
  }

  async function createTask(title, assigneeUserId, status) {
    if (!title.trim() || !selectedProjectId) return;
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: selectedProjectId,
        title,
        assigneeUserId: assigneeUserId || null,
      }),
    });
    const task = await res.json();
    if (status && status !== task.status) {
      await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      task.status = status;
    }
    setTasks((prev) => [...prev, task]);
  }

  async function moveTask(taskId, status) {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status } : t)));
    await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
  }

  async function removeTask(taskId) {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
  }

  function memberName(id) {
    return team.find((u) => u.id === id)?.name ?? '—';
  }

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  return (
    <>
      <div className="panel">
        <div className="section-head">
          <div className="section-icon"><FolderPlus size={22} /></div>
          <div>
            <h2 className="card-title">New project</h2>
            <p className="card-subtitle">Create a new project and get started with your team.</p>
          </div>
          <div className="section-illustration"><FolderIllustration badge="plus" /></div>
        </div>
        <form className="inline-form" onSubmit={createProject}>
          <div className="input-icon-wrap" style={{ minWidth: 200 }}>
            <FolderOpen size={15} />
            <input
              placeholder="Project name"
              value={newProject.name}
              onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
            />
          </div>
          <div className="input-icon-wrap" style={{ minWidth: 180 }}>
            <User size={15} />
            <input
              placeholder="Client (optional)"
              value={newProject.clientName}
              onChange={(e) => setNewProject({ ...newProject, clientName: e.target.value })}
            />
          </div>
          <label className="checkbox-label" title="Track a per-hour rate for this project">
            <input
              type="checkbox"
              checked={newProject.isBillable}
              onChange={(e) => setNewProject({ ...newProject, isBillable: e.target.checked })}
            />
            Billable
            <Info size={13} style={{ opacity: 0.6 }} />
          </label>
          {newProject.isBillable && (
            <input
              type="number"
              placeholder="Rate/hr"
              value={newProject.hourlyRate}
              onChange={(e) => setNewProject({ ...newProject, hourlyRate: e.target.value })}
              style={{ width: 90 }}
            />
          )}
          <button type="submit">
            <PlusCircle size={14} />Create project
          </button>
        </form>
      </div>

      <div className="panel">
        <div className="section-head" style={{ marginBottom: 16, alignItems: 'center' }}>
          <div>
            <h2 className="card-title" style={{ marginBottom: 2 }}>Projects</h2>
            <p className="card-subtitle" style={{ margin: 0 }}>All projects you are working on.</p>
          </div>
          <div className="mini-stat">
            <div>
              <div className="mini-stat-value">{projects.length}</div>
              <div className="mini-stat-label">Total projects</div>
            </div>
            <div className="section-icon section-icon-sm"><Layers size={16} /></div>
          </div>
        </div>
        {projects.length === 0 ? (
          <div className="empty">No projects yet — create one above.</div>
        ) : (
          <div className="chip-row">
            {projects.map((p) => (
              <div
                key={p.id}
                className={`chip ${p.id === selectedProjectId ? 'selected' : ''}`}
                onClick={() => setSelectedProjectId(p.id)}
              >
                <FolderOpen size={13} style={{ marginRight: 6, verticalAlign: -2 }} />
                {p.name}{p.is_billable ? ` · $${p.hourly_rate}/hr` : ''}
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedProject && (
        <div className="panel">
          <div className="section-head">
            <div>
              <h2 className="card-title">Kanban — {selectedProject.name}</h2>
              <p className="card-subtitle">Manage tasks and track progress using the Kanban board.</p>
            </div>
          </div>
          <form
            className="inline-form"
            style={{ marginBottom: 16 }}
            onSubmit={(e) => { e.preventDefault(); createTask(newTaskTitle, newTaskAssignee, 'todo'); setNewTaskTitle(''); setNewTaskAssignee(''); }}
          >
            <div className="input-icon-wrap" style={{ minWidth: 220 }}>
              <ClipboardList size={15} />
              <input
                placeholder="New task title"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
              />
            </div>
            <div className="input-icon-wrap" style={{ minWidth: 160 }}>
              <User size={15} />
              <select value={newTaskAssignee} onChange={(e) => setNewTaskAssignee(e.target.value)}>
                <option value="">Unassigned</option>
                {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <button type="submit">
              <PlusCircle size={14} />Add task
            </button>
          </form>

          <div className="kanban">
            {COLUMNS.map((col) => {
              const colTasks = tasks.filter((t) => t.status === col.key);
              const empty = COLUMN_EMPTY[col.key];
              return (
                <div
                  key={col.key}
                  className={`kanban-col kanban-col-${col.key}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    const taskId = Number(e.dataTransfer.getData('text/task-id'));
                    if (taskId) moveTask(taskId, col.key);
                  }}
                >
                  <h3><span className="kanban-col-dot" style={{ background: col.dot }} />{col.label} ({colTasks.length})</h3>
                  {colTasks.map((t) => (
                    <div
                      key={t.id}
                      className="kanban-card"
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/task-id', String(t.id))}
                      style={{ position: 'relative' }}
                    >
                      <button
                        className="btn-small"
                        title="Remove task"
                        onClick={() => removeTask(t.id)}
                        style={{ position: 'absolute', top: 6, right: 6, padding: 2, lineHeight: 0 }}
                      >
                        <X size={12} />
                      </button>
                      <div style={{ paddingRight: 20 }}>{t.title}</div>
                      <div className="shot-meta">{memberName(t.assignee_user_id)}</div>
                    </div>
                  ))}
                  {colTasks.length === 0 && empty && (
                    <div className="kanban-empty">
                      <empty.icon size={22} />
                      <div className="kanban-empty-title">{empty.title}</div>
                      <div className="kanban-empty-sub">{empty.sub}</div>
                    </div>
                  )}
                  <QuickAddTask status={col.key} onAdd={(title, status) => createTask(title, '', status)} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
