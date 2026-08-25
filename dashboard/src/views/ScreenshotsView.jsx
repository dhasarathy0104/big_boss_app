import { useEffect, useState } from 'react';
import { todayStr, fmtTime } from '../format.js';
import { getToken } from '../api.js';

function shotUrl(filePath) {
  return `/api/screenshots/${filePath}?token=${getToken()}`;
}

const INTERVAL_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 1, label: 'Every 1 minute' },
  { value: 2, label: 'Every 2 minutes' },
  { value: 5, label: 'Every 5 minutes' },
  { value: 10, label: 'Every 10 minutes' },
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Every hour' },
];

function IntervalControl({ managerId }) {
  const [interval, setInterval_] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!managerId) return;
    fetch(`/api/managers/${managerId}/settings`)
      .then((r) => r.json())
      .then((d) => setInterval_(d.screenshotIntervalMinutes));
  }, [managerId]);

  async function save(value) {
    setInterval_(value);
    setSaving(true);
    setSaved(false);
    await fetch(`/api/managers/${managerId}/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ screenshotIntervalMinutes: value }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  if (interval === null) return null;

  return (
    <div className="panel">
      <h2>Screenshot frequency</h2>
      <p className="join-sub" style={{ marginTop: 0 }}>
        Applies to your whole team. Employees' agents pick up a change within about a minute —
        no restart needed.
      </p>
      <div className="inline-form">
        <select value={interval} onChange={(e) => save(Number(e.target.value))}>
          {INTERVAL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {saving && <span className="shot-meta">Saving…</span>}
        {saved && <span className="shot-meta" style={{ color: 'var(--status-good)' }}>Saved</span>}
      </div>
    </div>
  );
}

export default function ScreenshotsView({ selectedUserId, managerId, canDelete }) {
  const [date, setDate] = useState(todayStr());
  const [shots, setShots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

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

  async function deleteShot(id) {
    setDeletingId(id);
    const res = await fetch(`/api/superadmin/screenshots/${id}`, { method: 'DELETE' });
    setDeletingId(null);
    if (!res.ok) return;
    setShots((prev) => prev.filter((s) => s.id !== id));
    setLightboxIndex(null);
  }

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

  const active = lightboxIndex !== null ? shots[lightboxIndex] : null;

  return (
    <>
      <IntervalControl managerId={managerId} />

      {!selectedUserId ? (
        <div className="panel"><div className="empty">Select someone from your team on the left.</div></div>
      ) : (
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
                  <div key={s.id} className="screenshot-card" style={{ position: 'relative' }}>
                    <img src={shotUrl(s.file_path)} alt={s.window_title} loading="lazy" onClick={() => setLightboxIndex(i)} />
                    <div className="shot-meta">{fmtTime(s.captured_at)} — {s.app_name}</div>
                    {canDelete && (
                      <button
                        className="btn-small"
                        style={{ position: 'absolute', top: 6, right: 6 }}
                        disabled={deletingId === s.id}
                        onClick={(e) => { e.stopPropagation(); deleteShot(s.id); }}
                      >
                        {deletingId === s.id ? '…' : 'Delete'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {active && (
        <div className="lightbox" onClick={() => setLightboxIndex(null)}>
          <img src={shotUrl(active.file_path)} alt={active.window_title} onClick={(e) => e.stopPropagation()} />
          <div className="lightbox-caption">
            {fmtTime(active.captured_at)} — {active.app_name}
            {active.window_title ? ` — ${active.window_title}` : ''}
          </div>
          {canDelete && (
            <button
              className="btn-small"
              style={{ position: 'absolute', top: 16, right: 60 }}
              disabled={deletingId === active.id}
              onClick={(e) => { e.stopPropagation(); deleteShot(active.id); }}
            >
              {deletingId === active.id ? 'Deleting…' : 'Delete this screenshot'}
            </button>
          )}
          <button className="lightbox-close" onClick={() => setLightboxIndex(null)}>✕</button>
        </div>
      )}
    </>
  );
}
