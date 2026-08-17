import { useEffect, useMemo, useState } from 'react';
import { fmtTime, fmtMinutes, colorForApp } from '../format.js';

export default function TimelineView({ selectedUserId, date, setDate }) {
  const [events, setEvents] = useState([]);
  const [shots, setShots] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedUserId) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/users/${selectedUserId}/timeline?date=${date}`).then((r) => r.json()),
      fetch(`/api/users/${selectedUserId}/screenshots?date=${date}`).then((r) => r.json()),
    ]).then(([ev, sh]) => {
      setEvents(ev);
      setShots(sh);
      setLoading(false);
    });
  }, [selectedUserId, date]);

  const totals = useMemo(() => {
    let active = 0, idle = 0;
    const byApp = {};
    for (const e of events) {
      const mins = (new Date(e.ended_at) - new Date(e.started_at)) / 60000;
      if (e.is_idle) idle += mins;
      else {
        active += mins;
        byApp[e.app_name] = (byApp[e.app_name] || 0) + mins;
      }
    }
    const topApps = Object.entries(byApp).sort((a, b) => b[1] - a[1]).slice(0, 8);
    return { active, idle, topApps };
  }, [events]);

  const dayStart = new Date(`${date}T00:00:00.000Z`).getTime();
  const dayEnd = new Date(`${date}T23:59:59.999Z`).getTime();
  const dayMs = dayEnd - dayStart;

  if (!selectedUserId) {
    return <div className="panel"><div className="empty">Select someone from your team on the left.</div></div>;
  }

  return (
    <>
      <div className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Daily timeline</h2>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="panel">
        <h2>Activity timeline ({fmtMinutes(totals.active)} active, {fmtMinutes(totals.idle)} idle)</h2>
        {events.length === 0 ? (
          <div className="empty">{loading ? 'Loading…' : 'No activity recorded for this day yet.'}</div>
        ) : (
          <>
            <div className="timeline">
              {events.map((e) => {
                const start = new Date(e.started_at).getTime();
                const end = new Date(e.ended_at).getTime();
                const widthPct = Math.max(0.15, ((end - start) / dayMs) * 100);
                return (
                  <div
                    key={e.id}
                    className="segment"
                    title={`${e.app_name} — ${e.window_title} (${fmtTime(e.started_at)}–${fmtTime(e.ended_at)})`}
                    style={{
                      width: `${widthPct}%`,
                      background: e.is_idle ? 'var(--idle)' : colorForApp(e.app_name),
                    }}
                  />
                );
              })}
            </div>
            <div className="legend">
              <span><span className="legend-dot" style={{ background: 'var(--idle)' }} />Idle</span>
              <span>Hover a segment for app + window title</span>
            </div>
          </>
        )}
      </div>

      <div className="panel">
        <h2>Top applications</h2>
        {totals.topApps.length === 0 ? (
          <div className="empty">Nothing tracked yet.</div>
        ) : (
          <table>
            <thead><tr><th>App</th><th>Time</th></tr></thead>
            <tbody>
              {totals.topApps.map(([app, mins]) => (
                <tr key={app}>
                  <td><span className="legend-dot" style={{ background: colorForApp(app) }} />{app}</td>
                  <td>{fmtMinutes(mins)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>Screenshots ({shots.length})</h2>
        {shots.length === 0 ? (
          <div className="empty">No screenshots for this day.</div>
        ) : (
          <div className="shots">
            {shots.map((s) => (
              <div key={s.id}>
                <img src={`/screenshots/${s.file_path}`} alt={s.window_title} loading="lazy" />
                <div className="shot-meta">{fmtTime(s.captured_at)} — {s.app_name}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
