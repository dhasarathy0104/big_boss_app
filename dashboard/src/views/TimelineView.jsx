import { useEffect, useState } from 'react';
import { Calendar, ChevronDown, ChevronRight, Info, Lock, TrendingDown, TrendingUp } from 'lucide-react';
import {
  siGooglechrome, siFirefox, siGithub, siGmail, siZoom, siFigma,
  siNotion, siDiscord, siSpotify, siWhatsapp, siClaude,
} from 'simple-icons';
import { fmtTime, fmtMinutes } from '../format.js';
import ProgressRing from '../components/ProgressRing.jsx';

// Real brand icons where simple-icons has one (trademark takedowns mean a
// handful of common apps — Slack, Edge, Teams — just aren't in the dataset;
// those fall through to the generic initials tile below.
const BRAND_ICONS = [
  { match: /chrome/i, icon: siGooglechrome },
  { match: /firefox/i, icon: siFirefox },
  { match: /github/i, icon: siGithub },
  { match: /gmail/i, icon: siGmail },
  { match: /zoom/i, icon: siZoom },
  { match: /figma/i, icon: siFigma },
  { match: /notion/i, icon: siNotion },
  { match: /discord/i, icon: siDiscord },
  { match: /spotify/i, icon: siSpotify },
  { match: /whatsapp/i, icon: siWhatsapp },
  { match: /^claude$/i, icon: siClaude },
];

const APP_ICON_COLORS = ['#f97316', '#3b82f6', '#8b5cf6', '#0d9488', '#ec4899', '#f59e0b', '#0ea5e9'];

function appIconColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return APP_ICON_COLORS[hash % APP_ICON_COLORS.length];
}

function AppIcon({ name }) {
  const brand = BRAND_ICONS.find((b) => b.match.test(name));
  if (brand) {
    return (
      <div className="app-icon app-icon-brand" title={brand.icon.title}>
        <svg viewBox="0 0 24 24" width={15} height={15} fill={`#${brand.icon.hex}`}>
          <path d={brand.icon.path} />
        </svg>
      </div>
    );
  }
  const lower = name.toLowerCase();
  if (lower === 'lockapp' || lower.includes('lock')) {
    return <div className="app-icon" style={{ background: appIconColor(name) }}><Lock size={14} color="white" /></div>;
  }
  return <div className="app-icon" style={{ background: appIconColor(name) }}>{name.slice(0, 2).toUpperCase()}</div>;
}

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

const HOUR_AXIS = ['12 AM', '3 AM', '6 AM', '9 AM', '12 PM', '3 PM', '6 PM', '9 PM', '12 AM'];
const APPS_PAGE_SIZE = 5;

function prevDateStr(date) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export default function TimelineView({ selectedUserId, date, setDate }) {
  const [productivity, setProductivity] = useState(null);
  const [prevScore, setPrevScore] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showAllApps, setShowAllApps] = useState(false);

  useEffect(() => {
    if (!selectedUserId) return;
    setLoading(true);
    setShowAllApps(false);
    fetch(`/api/users/${selectedUserId}/productivity?date=${date}`)
      .then((r) => r.json())
      .then((prod) => {
        setProductivity(prod);
        setLoading(false);
      });
    fetch(`/api/users/${selectedUserId}/productivity?date=${prevDateStr(date)}`)
      .then((r) => r.json())
      .then((prod) => setPrevScore(prod?.events?.length ? prod.score : null))
      .catch(() => setPrevScore(null));
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
  const totalTrackedMinutes = Object.values(totals).reduce((a, b) => a + b, 0);
  const presentCategories = Object.entries(totals).filter(([, mins]) => mins > 0).map(([cat]) => cat);
  const visibleApps = showAllApps ? topApps : topApps.slice(0, APPS_PAGE_SIZE);
  const trend = prevScore != null ? score - prevScore : null;

  const ringColor = 'var(--productive)';
  const ringCaption = 'Productive';

  return (
    <>
      <div className="panel">
        <div className="card-head">
          <div>
            <h2 className="card-title">Daily timeline</h2>
            <p className="card-subtitle">Overview of productivity and activity</p>
          </div>
          <div className="date-pill">
            <Calendar size={15} />
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <ChevronDown size={14} />
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Productivity score</h2>
        {events.length === 0 ? (
          <div className="empty">{loading ? 'Loading…' : 'No activity recorded for this day yet.'}</div>
        ) : (
          <div className="score-row">
            <ProgressRing value={score} color={ringColor} caption={ringCaption} />
            <div style={{ flex: 1 }}>
              <div className="score-bar">
                {presentCategories.map((cat) => (
                  <div
                    key={cat}
                    style={{ width: `${(totals[cat] / totalTrackedMinutes) * 100}%`, background: CATEGORY_COLOR[cat] }}
                    title={`${CATEGORY_LABEL[cat]}: ${fmtMinutes(totals[cat])}`}
                  />
                ))}
              </div>
              <div className="legend">
                {presentCategories.map((cat) => (
                  <span key={cat}><span className="legend-dot" style={{ background: CATEGORY_COLOR[cat] }} />{CATEGORY_LABEL[cat]} — {fmtMinutes(totals[cat])}</span>
                ))}
              </div>
            </div>
            {trend !== null && (
              <div className={`trend-pill ${trend < 0 ? 'down' : ''}`}>
                <div className="trend-pill-value">
                  {trend < 0 ? <TrendingDown size={15} /> : <TrendingUp size={15} />}
                  {trend > 0 ? '+' : ''}{trend}%
                </div>
                <div className="trend-pill-label">vs yesterday</div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="timeline-head">
          <div className="timeline-head-title">
            <h2>Activity timeline</h2>
            <span className="info-icon" title="Each segment is a tracked activity window, colored by category.">
              <Info size={14} />
            </span>
          </div>
          {presentCategories.length > 0 && (
            <div className="timeline-legend">
              {presentCategories.map((cat) => (
                <span key={cat}><span className="legend-dot" style={{ background: CATEGORY_COLOR[cat] }} />{CATEGORY_LABEL[cat]}</span>
              ))}
            </div>
          )}
        </div>
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
                    title={`${e.domain ? `${e.app_name} — ${e.domain}` : `${e.app_name} — ${e.window_title}`} · ${CATEGORY_LABEL[e.category]} (${fmtTime(e.started_at)}–${fmtTime(e.ended_at)})`}
                    style={{ width: `${widthPct}%`, background: CATEGORY_COLOR[e.category] }}
                  />
                );
              })}
            </div>
            <div className="timeline-axis">
              {HOUR_AXIS.map((label, i) => <span key={i}>{label}</span>)}
            </div>
          </>
        )}
      </div>

      <div className="panel">
        <h2>Top applications</h2>
        {topApps.length === 0 ? (
          <div className="empty">Nothing tracked yet.</div>
        ) : (
          <>
            <table>
              <thead><tr><th>App</th><th>Category</th><th>Time</th><th>Usage %</th></tr></thead>
              <tbody>
                {visibleApps.map((a) => {
                  const pct = totalTrackedMinutes > 0 ? Math.round((a.minutes / totalTrackedMinutes) * 100) : 0;
                  return (
                    <tr key={a.appName}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <AppIcon name={a.appName} />
                          {a.appName}
                        </div>
                      </td>
                      <td><span className={`badge badge-${a.category}`}>{CATEGORY_LABEL[a.category]}</span></td>
                      <td>{fmtMinutes(a.minutes)}</td>
                      <td>
                        <div className="usage-cell">
                          <span className="usage-cell-pct">{pct}%</span>
                          <div className="progress-track">
                            <div className="progress-fill" style={{ width: `${pct}%`, background: CATEGORY_COLOR[a.category] }} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {topApps.length > APPS_PAGE_SIZE && (
              <div className="view-all-row">
                <button className="btn-outline" onClick={() => setShowAllApps((v) => !v)}>
                  {showAllApps ? 'Show less' : 'View all applications'}
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
