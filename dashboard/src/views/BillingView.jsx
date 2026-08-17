import { useEffect, useState } from 'react';
import { todayStr } from '../format.js';

export default function BillingView({ managerId }) {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [startDate, setStartDate] = useState(todayStr().slice(0, 8) + '01'); // 1st of this month
  const [endDate, setEndDate] = useState(todayStr());
  const [invoice, setInvoice] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!managerId) return;
    fetch(`/api/projects?managerId=${managerId}`).then((r) => r.json()).then((data) => {
      const billable = data.filter((p) => p.is_billable);
      setProjects(billable);
      if (billable.length && !projectId) setProjectId(billable[0].id);
    });
  }, [managerId]);

  async function generate() {
    setError('');
    setInvoice(null);
    if (!projectId) return;
    const res = await fetch(`/api/projects/${projectId}/invoice?startDate=${startDate}&endDate=${endDate}`);
    if (!res.ok) {
      const err = await res.json();
      setError(err.error);
      return;
    }
    setInvoice(await res.json());
  }

  const pdfUrl = projectId ? `/api/projects/${projectId}/invoice.pdf?startDate=${startDate}&endDate=${endDate}` : null;

  return (
    <>
      <div className="panel">
        <h2>Generate invoice</h2>
        {projects.length === 0 ? (
          <div className="empty">No billable projects yet — mark a project "Billable" with an hourly rate in the Projects tab.</div>
        ) : (
          <form className="inline-form" onSubmit={(e) => { e.preventDefault(); generate(); }}>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name} (${p.hourly_rate}/hr)</option>)}
            </select>
            <label>
              From
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label>
              To
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </label>
            <button type="submit">Preview</button>
          </form>
        )}
        {error && <div style={{ color: '#e07070', fontSize: 12, marginTop: 8 }}>{error}</div>}
      </div>

      {invoice && (
        <div className="panel">
          <h2>{invoice.project.name}{invoice.project.clientName ? ` — ${invoice.project.clientName}` : ''}</h2>
          <div className="shot-meta" style={{ marginBottom: 12 }}>
            {invoice.startDate} to {invoice.endDate} · ${invoice.project.hourlyRate}/hr
          </div>
          {invoice.lineItems.length === 0 ? (
            <div className="empty">No approved time entries in this period.</div>
          ) : (
            <table>
              <thead><tr><th>Employee</th><th>Hours</th><th>Amount</th></tr></thead>
              <tbody>
                {invoice.lineItems.map((li) => (
                  <tr key={li.userName}>
                    <td>{li.userName}</td>
                    <td>{li.hours.toFixed(2)}</td>
                    <td>${li.amount.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="inline-form" style={{ marginTop: 16, justifyContent: 'space-between' }}>
            <strong>Total: ${invoice.totalAmount.toFixed(2)}</strong>
            <a href={pdfUrl}><button type="button">Download PDF</button></a>
          </div>
        </div>
      )}
    </>
  );
}
