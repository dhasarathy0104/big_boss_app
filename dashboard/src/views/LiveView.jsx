import { useEffect, useState } from 'react';
import { Zap, Coffee, MoonStar, Users, Video } from 'lucide-react';
import { fmtMinutes } from '../format.js';
import Avatar from '../components/Avatar.jsx';
import WebRTCViewer from '../components/WebRTCViewer.jsx';

const STATUS_LABEL = { active: 'Active', idle: 'Idle', offline: 'Offline' };
const REFRESH_MS = 15_000;

const STAT_TILES = [
  { key: 'active', label: 'Active now', icon: Zap, color: 'var(--status-good)' },
  { key: 'idle', label: 'Idle', icon: Coffee, color: 'var(--status-warning)' },
  { key: 'offline', label: 'Offline', icon: MoonStar, color: 'var(--idle)' },
];

export default function LiveView({ managerId, onSelectMember }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [watching, setWatching] = useState(null); // { id, name } | null

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
    <>
      <div className="stat-row">
        <div className="stat-tile">
          <div className="stat-tile-icon" style={{ background: 'rgba(57,135,229,0.15)' }}>
            <Users size={18} color="var(--brand)" />
          </div>
          <div>
            <div className="stat-tile-value">{members.length}</div>
            <div className="stat-tile-label">Team members</div>
          </div>
        </div>
        {STAT_TILES.map((t) => (
          <div className="stat-tile" key={t.key}>
            <div className="stat-tile-icon" style={{ background: `color-mix(in srgb, ${t.color} 15%, transparent)` }}>
              <t.icon size={18} color={t.color} />
            </div>
            <div>
              <div className="stat-tile-value">{counts[t.key]}</div>
              <div className="stat-tile-label">{t.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="panel">
        <h2>Right now</h2>
        {members.length === 0 ? (
          <div className="empty">{loading ? 'Loading…' : 'Nobody on your team yet.'}</div>
        ) : (
          <div className="live-grid">
            {members.map((m) => (
              <div key={m.id} className="live-card">
                <div className="live-card-top" style={{ cursor: 'pointer' }} onClick={() => onSelectMember?.(m.id)}>
                  <Avatar name={m.name} size={30} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
                    <div className="shot-meta" style={{ display: 'flex', alignItems: 'center' }}>
                      <span className={`status-dot status-dot-${m.status}`} />
                      {STATUS_LABEL[m.status]}
                    </div>
                  </div>
                </div>
                <div className="live-card-stats">
                  <span>{m.todayScore}% today</span>
                  <span>{fmtMinutes(m.todayActiveMinutes)} tracked</span>
                </div>
                <button
                  type="button"
                  className="watch-live-btn"
                  disabled={m.status === 'offline'}
                  onClick={(e) => { e.stopPropagation(); setWatching({ id: m.id, name: m.name }); }}
                >
                  <Video size={13} />{m.status === 'offline' ? 'Offline' : 'Watch Live'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {watching && (
        <WebRTCViewer employeeId={watching.id} employeeName={watching.name} onClose={() => setWatching(null)} />
      )}
    </>
  );
}
