import { useEffect, useState } from 'react';
import { todayStr, fmtTime } from '../format.js';

export default function ScreenshotsView({ selectedUserId }) {
  const [date, setDate] = useState(todayStr());
  const [shots, setShots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(null);

  useEffect(() => {
    if (!selectedUserId) return;
    setLoading(true);
    fetch(`/api/users/${selectedUserId}/screenshots?date=${date}`)
      .then((r) => r.json())
      .then((data) => {
        setShots(data);
        setLoading(false);
      });
  }, [selectedUserId, date]);

  useEffect(() => {
    function onKey(e) {
      if (lightboxIndex === null) return;
      if (e.key === 'Escape') setLightboxIndex(null);
      if (e.key === 'ArrowRight') setLightboxIndex((i) => Math.min(i + 1, shots.length - 1));
      if (e.key === 'ArrowLeft') setLightboxIndex((i) => Math.max(i - 1, 0));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxIndex, shots.length]);

  if (!selectedUserId) {
    return <div className="panel"><div className="empty">Select someone from your team on the left.</div></div>;
  }

  const active = lightboxIndex !== null ? shots[lightboxIndex] : null;

  return (
    <>
      <div className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Screenshots ({shots.length})</h2>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="panel">
        {shots.length === 0 ? (
          <div className="empty">{loading ? 'Loading…' : 'No screenshots for this day.'}</div>
        ) : (
          <div className="screenshot-grid">
            {shots.map((s, i) => (
              <div key={s.id} className="screenshot-card" onClick={() => setLightboxIndex(i)}>
                <img src={`/screenshots/${s.file_path}`} alt={s.window_title} loading="lazy" />
                <div className="shot-meta">{fmtTime(s.captured_at)} — {s.app_name}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {active && (
        <div className="lightbox" onClick={() => setLightboxIndex(null)}>
          <img src={`/screenshots/${active.file_path}`} alt={active.window_title} onClick={(e) => e.stopPropagation()} />
          <div className="lightbox-caption">
            {fmtTime(active.captured_at)} — {active.app_name}
            {active.window_title ? ` — ${active.window_title}` : ''}
          </div>
          <button className="lightbox-close" onClick={() => setLightboxIndex(null)}>✕</button>
        </div>
      )}
    </>
  );
}
