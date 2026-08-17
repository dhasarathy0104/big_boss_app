import { useEffect, useState } from 'react';
import { todayStr, fmtTime, fmtMinutes } from '../format.js';

export default function AttendanceReviewView({ managerId }) {
  const [date, setDate] = useState(todayStr());
  const [records, setRecords] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);

  function loadAttendance() {
    fetch(`/api/attendance?managerId=${managerId}&date=${date}`).then((r) => r.json()).then(setRecords);
  }

  function loadLeaveRequests() {
    fetch(`/api/leave-requests?managerId=${managerId}`).then((r) => r.json()).then(setLeaveRequests);
  }

  useEffect(() => { if (managerId) loadAttendance(); }, [managerId, date]);
  useEffect(() => { if (managerId) loadLeaveRequests(); }, [managerId]);

  async function review(id, decision) {
    await fetch(`/api/leave-requests/${id}/review`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision, reviewerUserId: managerId }),
    });
    loadLeaveRequests();
  }

  function durationOf(record) {
    if (!record.clock_out) return 'in progress';
    return fmtMinutes((new Date(record.clock_out) - new Date(record.clock_in)) / 60000);
  }

  const pendingLeave = leaveRequests.filter((l) => l.status === 'pending');
  const decidedLeave = leaveRequests.filter((l) => l.status !== 'pending');

  return (
    <>
      <div className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Team attendance</h2>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="panel">
        {records.length === 0 ? (
          <div className="empty">Nobody clocked in on this day.</div>
        ) : (
          <table>
            <thead><tr><th>Employee</th><th>In</th><th>Out</th><th>Duration</th></tr></thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id}>
                  <td>{r.user_name}</td>
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
        <h2>Leave requests awaiting review ({pendingLeave.length})</h2>
        {pendingLeave.length === 0 ? (
          <div className="empty">Nothing pending.</div>
        ) : (
          <table>
            <thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Reason</th><th></th></tr></thead>
            <tbody>
              {pendingLeave.map((l) => (
                <tr key={l.id}>
                  <td>{l.user_name}</td>
                  <td>{l.leave_type}</td>
                  <td>{l.start_date} → {l.end_date}</td>
                  <td>{l.reason || '—'}</td>
                  <td>
                    <button className="btn-small" onClick={() => review(l.id, 'approved')}>Approve</button>
                    <button className="btn-small btn-danger" onClick={() => review(l.id, 'rejected')}>Reject</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {decidedLeave.length > 0 && (
        <div className="panel">
          <h2>Past decisions</h2>
          <table>
            <thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Status</th></tr></thead>
            <tbody>
              {decidedLeave.map((l) => (
                <tr key={l.id}>
                  <td>{l.user_name}</td>
                  <td>{l.leave_type}</td>
                  <td>{l.start_date} → {l.end_date}</td>
                  <td><span className={`status-badge status-${l.status}`}>{l.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
