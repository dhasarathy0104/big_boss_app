import { useEffect, useState } from 'react';

const STATUS_LABEL = { todo: 'To do', in_progress: 'In progress', review: 'Review', done: 'Done' };
const STATUSES = ['todo', 'in_progress', 'review', 'done'];

export default function MyTasksView({ userId }) {
  const [tasks, setTasks] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);

  function load() {
    fetch('/api/tasks/mine').then((r) => r.json()).then(setTasks);
  }

  useEffect(() => { if (userId) load(); }, [userId]);

  async function updateStatus(taskId, status) {
    setUpdatingId(taskId);
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status } : t)));
    await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    setUpdatingId(null);
  }

  if (tasks === null) return null;

  return (
    <div className="panel">
      <h2>My tasks ({tasks.length})</h2>
      <p className="join-sub" style={{ marginTop: 0 }}>
        Every task assigned to you, across every project. Update the status yourself to report progress —
        your manager sees the change immediately on their own project board.
      </p>
      {tasks.length === 0 ? (
        <div className="empty">No tasks assigned to you yet.</div>
      ) : (
        <table>
          <thead><tr><th>Task</th><th>Project</th><th>Status</th></tr></thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td>
                  {t.title}
                  {t.description && <div className="shot-meta">{t.description}</div>}
                </td>
                <td>{t.project_name}{t.client_name ? ` · ${t.client_name}` : ''}</td>
                <td>
                  <select
                    value={t.status}
                    disabled={updatingId === t.id}
                    onChange={(e) => updateStatus(t.id, e.target.value)}
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
