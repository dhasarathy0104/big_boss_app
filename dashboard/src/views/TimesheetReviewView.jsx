import { useEffect, useState } from 'react';
import { fmtTime, fmtMinutes } from '../format.js';

export default function TimesheetReviewView({ managerId }) {
  const [entries, setEntries] = useState([]);

  function loadEntries() {
    fetch(`/api/time-entries?managerId=${managerId}`).then((r) => r.json()).then(setEntries);
  }

  useEffect(() => { if (managerId) loadEntries(); }, [managerId]);

  async function review(id, decision) {
    await fetch(`/api/time-entries/${id}/review`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision, reviewerUserId: managerId }),
    });
    loadEntries();
  }

  return (
    <div className="panel">
      <h2>Team time entries</h2>
      {entries.length === 0 ? (
        <div className="empty">No time entries submitted yet.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Project</th>
              <th>When</th>
              <th>Duration</th>
              <th>Note</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{e.user_name}</td>
                <td>{e.project_name}</td>
                <td>{new Date(e.started_at).toLocaleDateString()} {fmtTime(e.started_at)}–{fmtTime(e.ended_at)}</td>
                <td>{fmtMinutes((new Date(e.ended_at) - new Date(e.started_at)) / 60000)}</td>
                <td>{e.note || '—'}</td>
                <td><span className={`status-badge status-${e.status}`}>{e.status}</span></td>
                <td>
                  {e.status === 'pending' && (
                    <>
                      <button className="btn-small" onClick={() => review(e.id, 'approved')}>Approve</button>
                      <button className="btn-small btn-danger" onClick={() => review(e.id, 'rejected')}>Reject</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
