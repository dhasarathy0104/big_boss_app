import { useEffect, useState } from 'react';
import { fmtMinutes } from '../format.js';

const STATUS_LABEL = { active: 'Active', idle: 'Idle', offline: 'Offline' };
const REFRESH_MS = 15_000;

export default function LiveView({ managerId, onSelectMember }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  function load() {
    fetch(`/api/managers/${managerId}/live-status`)
      .then((r) => r.json())
      .then((data) => {
        setMembers(data);
        setLoading(false);
      });
  }

  useEffect(() => {
    if (!managerId) return;
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => clearInterval(interval);
  }, [managerId]);

  const counts = members.reduce(
    (acc, m) => { acc[m.status] = (acc[m.status] ?? 0) + 1; return acc; },
    { active: 0, idle: 0, offline: 0 },
  );

  return (
    <div className="panel">
      <h2>Right now</h2>
      <div className="live-summary">
        <span><span className="status-dot status-dot-active" /> {counts.active} active</span>
        <span><span className="status-dot status-dot-idle" /> {counts.idle} idle</span>
        <span><span className="status-dot status-dot-offline" /> {counts.offline} offline</span>
      </div>

      {members.length === 0 ? (
        <div className="empty">{loading ? 'Loading…' : 'Nobody on your team yet.'}</div>
      ) : (
        <div className="live-grid">
          {members.map((m) => (
            <div key={m.id} className="live-card" onClick={() => onSelectMember?.(m.id)}>
              <div className="live-card-top">
                <span className={`status-dot status-dot-${m.status}`} />
                <strong>{m.name}</strong>
              </div>
              <div className="shot-meta">{STATUS_LABEL[m.status]}</div>
              {m.status !== 'offline' && (
                <div className="shot-meta">
                  {m.currentDomain ? `${m.currentApp} · ${m.currentDomain}` : m.currentApp || '—'}
                </div>
              )}
              <div className="live-card-stats">
                <span>{m.todayScore}% today</span>
                <span>{fmtMinutes(m.todayActiveMinutes)} tracked</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
