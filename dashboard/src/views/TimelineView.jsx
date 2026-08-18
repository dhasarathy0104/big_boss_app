import { useEffect, useState } from 'react';
import { fmtTime, fmtMinutes } from '../format.js';
import ProgressRing from '../components/ProgressRing.jsx';

const CATEGORY_COLOR = {
  productive: 'var(--productive)',
  neutral: 'var(--neutral)',
  unproductive: 'var(--unproductive)',
  engaged: 'var(--engaged)',
  idle: 'var(--idle)',
};

const CATEGORY_LABEL = {
  productive: 'Productive',
  neutral: 'Neutral',
  unproductive: 'Unproductive',
  engaged: 'Engaged (call/reading)',
  idle: 'Idle',
};

export default function TimelineView({ selectedUserId, date, setDate }) {
  const [productivity, setProductivity] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedUserId) return;
    setLoading(true);
    fetch(`/api/users/${selectedUserId}/productivity?date=${date}`)
      .then((r) => r.json())
      .then((prod) => {
        setProductivity(prod);
        setLoading(false);
      });
  }, [selectedUserId, date]);

  const dayStart = new Date(`${date}T00:00:00.000Z`).getTime();
  const dayEnd = new Date(`${date}T23:59:59.999Z`).getTime();
  const dayMs = dayEnd - dayStart;

  if (!selectedUserId) {
    return <div className="panel"><div className="empty">Select someone from your team on the left.</div></div>;
  }

  const events = productivity?.events ?? [];
  const totals = productivity?.totals ?? { productive: 0, neutral: 0, unproductive: 0, engaged: 0, idle: 0 };
  const score = productivity?.score ?? 0;
  const topApps = productivity?.topApps ?? [];

  return (
    <>
      <div className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Daily timeline</h2>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="panel">
        <h2>Productivity score</h2>
        {events.length === 0 ? (
          <div className="empty">{loading ? 'Loading…' : 'No activity recorded for this day yet.'}</div>
        ) : (
          <>
            <div className="score-row">
              <ProgressRing value={score} color={score >= 60 ? 'var(--productive)' : score >= 35 ? 'var(--status-warning)' : 'var(--unproductive)'} />
              <div style={{ flex: 1 }}>
                <div className="score-bar">
                  {Object.entries(totals).filter(([, mins]) => mins > 0).map(([cat, mins]) => (
                    <div
                      key={cat}
                      style={{ width: `${(mins / Object.values(totals).reduce((a, b) => a + b, 0)) * 100}%`, background: CATEGORY_COLOR[cat] }}
                      title={`${CATEGORY_LABEL[cat]}: ${fmtMinutes(mins)}`}
                    />
                  ))}
                </div>
                <div className="legend">
                  {Object.entries(totals).filter(([, mins]) => mins > 0).map(([cat, mins]) => (
                    <span key={cat}><span className="legend-dot" style={{ background: CATEGORY_COLOR[cat] }} />{CATEGORY_LABEL[cat]} — {fmtMinutes(mins)}</span>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="panel">
        <h2>Activity timeline</h2>
        {events.length === 0 ? (
          <div className="empty">{loading ? 'Loading…' : 'No activity recorded for this day yet.'}</div>
        ) : (
          <div className="timeline">
            {events.map((e) => {
              const start = new Date(e.started_at).getTime();
              const end = new Date(e.ended_at).getTime();
              const widthPct = Math.max(0.15, ((end - start) / dayMs) * 100);
              return (
                <div
                  key={e.id}
                  className="segment"
                  title={`${e.domain ? `${e.app_name} — ${e.domain}` : `${e.app_name} — ${e.window_title}`} · ${CATEGORY_LABEL[e.category]} (${fmtTime(e.started_at)}–${fmtTime(e.ended_at)})`}
                  style={{ width: `${widthPct}%`, background: CATEGORY_COLOR[e.category] }}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Top applications</h2>
        {topApps.length === 0 ? (
          <div className="empty">Nothing tracked yet.</div>
        ) : (
          <table>
            <thead><tr><th>App</th><th>Category</th><th>Time</th></tr></thead>
            <tbody>
              {topApps.map((a) => (
                <tr key={a.appName}>
                  <td><span className="legend-dot" style={{ background: CATEGORY_COLOR[a.category] }} />{a.appName}</td>
                  <td>{CATEGORY_LABEL[a.category]}</td>
                  <td>{fmtMinutes(a.minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
