import { useEffect, useState } from 'react';
import { fmtTime, fmtMinutes } from '../format.js';

const LEAVE_TYPES = ['sick', 'vacation', 'personal', 'other'];

export default function AttendanceView({ userId }) {
  const [status, setStatus] = useState(null);
  const [records, setRecords] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [form, setForm] = useState({ leaveType: 'vacation', startDate: '', endDate: '', reason: '' });
  const [error, setError] = useState('');

  function loadAll() {
    fetch(`/api/attendance/status?userId=${userId}`).then((r) => r.json()).then((d) => setStatus(d.clockedIn));
    fetch(`/api/attendance?userId=${userId}`).then((r) => r.json()).then(setRecords);
    fetch(`/api/leave-requests?userId=${userId}`).then((r) => r.json()).then(setLeaveRequests);
  }

  useEffect(() => { if (userId) loadAll(); }, [userId]);

  async function clockIn() {
    const res = await fetch('/api/attendance/clock-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (res.ok) loadAll();
  }

  async function clockOut() {
    const res = await fetch('/api/attendance/clock-out', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (res.ok) loadAll();
  }

  async function submitLeave(e) {
    e.preventDefault();
    setError('');
    if (!form.startDate || !form.endDate) return;
    const res = await fetch('/api/leave-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId, ...form }),
    });
    if (!res.ok) {
      const err = await res.json();
      setError(err.error);
      return;
    }
    setForm({ leaveType: 'vacation', startDate: '', endDate: '', reason: '' });
    loadAll();
  }

  function durationOf(record) {
    if (!record.clock_out) return 'in progress';
    return fmtMinutes((new Date(record.clock_out) - new Date(record.clock_in)) / 60000);
  }

  return (
    <>
      <div className="panel">
        <h2>Clock in / out</h2>
        <div className="inline-form">
          {status === null ? (
            <div className="empty">Loading…</div>
          ) : status ? (
            <>
              <span className="status-badge status-approved">Clocked in</span>
              <button onClick={clockOut}>Clock out</button>
            </>
          ) : (
            <>
              <span className="status-badge status-rejected">Not clocked in</span>
              <button onClick={clockIn}>Clock in</button>
            </>
          )}
        </div>
      </div>

      <div className="panel">
        <h2>Recent attendance</h2>
        {records.length === 0 ? (
          <div className="empty">No attendance records yet.</div>
        ) : (
          <table>
            <thead><tr><th>Date</th><th>In</th><th>Out</th><th>Duration</th></tr></thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.clock_in).toLocaleDateString()}</td>
                  <td>{fmtTime(r.clock_in)}</td>
                  <td>{r.clock_out ? fmtTime(r.clock_out) : '—'}</td>
                  <td>{durationOf(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>Request leave</h2>
        <form className="stacked-form" onSubmit={submitLeave}>
          <select value={form.leaveType} onChange={(e) => setForm({ ...form, leaveType: e.target.value })}>
            {LEAVE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <div className="inline-form">
            <label>
              Start date
              <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </label>
            <label>
              End date
              <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </label>
          </div>
          <input
            placeholder="Reason (optional)"
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          />
          {error && <div style={{ color: '#e07070', fontSize: 12 }}>{error}</div>}
          <button type="submit" style={{ alignSelf: 'flex-start' }}>Submit request</button>
        </form>
      </div>

      <div className="panel">
        <h2>My leave requests</h2>
        {leaveRequests.length === 0 ? (
          <div className="empty">No leave requests yet.</div>
        ) : (
          <table>
            <thead><tr><th>Type</th><th>Dates</th><th>Reason</th><th>Status</th></tr></thead>
            <tbody>
              {leaveRequests.map((l) => (
                <tr key={l.id}>
                  <td>{l.leave_type}</td>
                  <td>{l.start_date} → {l.end_date}</td>
                  <td>{l.reason || '—'}</td>
                  <td><span className={`status-badge status-${l.status}`}>{l.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
