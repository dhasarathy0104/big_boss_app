import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

const COLUMNS = [
  { key: 'todo', label: 'To do' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'review', label: 'Review' },
  { key: 'done', label: 'Done' },
];

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

  async function createTask(e) {
    e.preventDefault();
    if (!newTaskTitle.trim() || !selectedProjectId) return;
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: selectedProjectId,
        title: newTaskTitle,
        assigneeUserId: newTaskAssignee || null,
      }),
    });
    const task = await res.json();
    setNewTaskTitle('');
    setNewTaskAssignee('');
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
        <h2>New project</h2>
        <form className="inline-form" onSubmit={createProject}>
          <input
            placeholder="Project name"
            value={newProject.name}
            onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
          />
          <input
            placeholder="Client (optional)"
            value={newProject.clientName}
            onChange={(e) => setNewProject({ ...newProject, clientName: e.target.value })}
          />
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={newProject.isBillable}
              onChange={(e) => setNewProject({ ...newProject, isBillable: e.target.checked })}
            />
            Billable
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
          <button type="submit">Create project</button>
        </form>
      </div>

      <div className="panel">
        <h2>Projects</h2>
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
                {p.name}{p.is_billable ? ` · $${p.hourly_rate}/hr` : ''}
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedProject && (
        <div className="panel">
          <h2>Kanban — {selectedProject.name}</h2>
          <form className="inline-form" onSubmit={createTask} style={{ marginBottom: 16 }}>
            <input
              placeholder="New task title"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
            />
            <select value={newTaskAssignee} onChange={(e) => setNewTaskAssignee(e.target.value)}>
              <option value="">Unassigned</option>
              {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <button type="submit">Add task</button>
          </form>

          <div className="kanban">
            {COLUMNS.map((col) => (
              <div
                key={col.key}
                className="kanban-col"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const taskId = Number(e.dataTransfer.getData('text/task-id'));
                  if (taskId) moveTask(taskId, col.key);
                }}
              >
                <h3>{col.label} ({tasks.filter((t) => t.status === col.key).length})</h3>
                {tasks.filter((t) => t.status === col.key).map((t) => (
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
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
