import { useEffect, useState } from 'react';
import { fmtTime, fmtMinutes } from '../format.js';

export default function LogTimeView({ userId, managerId }) {
  const [projects, setProjects] = useState([]);
  const [entries, setEntries] = useState([]);
  const [form, setForm] = useState({ projectId: '', startedAt: '', endedAt: '', note: '' });
  const [error, setError] = useState('');

  function loadEntries() {
    fetch(`/api/time-entries?userId=${userId}`).then((r) => r.json()).then(setEntries);
  }

  useEffect(() => {
    if (managerId) fetch(`/api/projects?managerId=${managerId}`).then((r) => r.json()).then(setProjects);
  }, [managerId]);

  useEffect(() => { if (userId) loadEntries(); }, [userId]);

  async function submitEntry(e) {
    e.preventDefault();
    setError('');
    if (!form.projectId || !form.startedAt || !form.endedAt) return;
    const res = await fetch('/api/time-entries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId,
        projectId: form.projectId,
        startedAt: new Date(form.startedAt).toISOString(),
        endedAt: new Date(form.endedAt).toISOString(),
        note: form.note || null,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      setError(err.error);
      return;
    }
    setForm({ projectId: '', startedAt: '', endedAt: '', note: '' });
    loadEntries();
  }

  return (
    <>
      <div className="panel">
        <h2>Log time</h2>
        {projects.length === 0 ? (
          <div className="empty">Your manager hasn't created any projects yet.</div>
        ) : (
          <form className="stacked-form" onSubmit={submitEntry}>
            <select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
              <option value="">Select project…</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <div className="inline-form">
              <label>
                Start
                <input type="datetime-local" value={form.startedAt} onChange={(e) => setForm({ ...form, startedAt: e.target.value })} />
              </label>
              <label>
                End
                <input type="datetime-local" value={form.endedAt} onChange={(e) => setForm({ ...form, endedAt: e.target.value })} />
              </label>
            </div>
            <input
              placeholder="Note (optional)"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
            {error && <div style={{ color: '#e07070', fontSize: 12 }}>{error}</div>}
            <button type="submit" style={{ alignSelf: 'flex-start' }}>Submit for approval</button>
          </form>
        )}
      </div>

      <div className="panel">
        <h2>My time entries</h2>
        {entries.length === 0 ? (
          <div className="empty">No time entries yet.</div>
        ) : (
          <table>
            <thead><tr><th>Project</th><th>When</th><th>Duration</th><th>Note</th><th>Status</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{e.project_name}</td>
                  <td>{new Date(e.started_at).toLocaleDateString()} {fmtTime(e.started_at)}–{fmtTime(e.ended_at)}</td>
                  <td>{fmtMinutes((new Date(e.ended_at) - new Date(e.started_at)) / 60000)}</td>
                  <td>{e.note || '—'}</td>
                  <td><span className={`status-badge status-${e.status}`}>{e.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
