import { useEffect, useState } from 'react';
import { Activity, Camera, Clock, UserPlus, LogOut } from 'lucide-react';
import { todayStr } from '../format.js';
import Avatar from '../components/Avatar.jsx';
import DeskIllustration from '../components/DeskIllustration.jsx';
import LiveView from './LiveView.jsx';
import TimelineView from './TimelineView.jsx';
import ScreenshotsView from './ScreenshotsView.jsx';
import SupervisorTeamView from './SupervisorTeamView.jsx';

const TABS = [
  { key: 'live', label: 'Live', icon: Activity },
  { key: 'timeline', label: 'Timeline', icon: Clock },
  { key: 'screenshots', label: 'Screenshots', icon: Camera },
  { key: 'team', label: 'Team & Invite', icon: UserPlus },
];

const ROLE_LABEL = { gm: 'General Manager', agm: 'Assistant General Manager', manager: 'Manager', am: 'Assistant Manager', tl: 'Team Lead' };

// The shared dashboard for every level above Employee except Manager (which
// keeps its own richer dashboard — Projects, Billing, Category Rules, and
// direct employee-account editing are still tied specifically to the
// Manager role's data model, not yet generalized to arbitrary depth). GM,
// AGM, AM, and TL previously had no dashboard of their own at all; this is
// the same Live/Timeline/Screenshots/Team&Invite core every level needs,
// scoped automatically to however much of the org sits below whoever is
// logged in — a TL sees a handful of Employees, a GM sees everyone.
export default function SupervisorDashboard({ user, onLogout }) {
  const supervisorId = user.id;
  const [employees, setEmployees] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [date, setDate] = useState(todayStr());
  const [activeTab, setActiveTab] = useState('live');

  function loadEmployees() {
    fetch(`/api/supervisors/${supervisorId}/employees`).then((r) => r.json()).then((data) => {
      setEmployees(data);
      if (data.length && !data.some((u) => u.id === selectedUserId)) {
        setSelectedUserId(data[0].id);
      }
      if (data.length === 0) setSelectedUserId(null);
    });
  }

  useEffect(loadEmployees, [supervisorId]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <svg viewBox="0 0 100 100" width="30" height="30" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="eyeGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#3987e5" />
                  <stop offset="1" stopColor="#9085e9" />
                </linearGradient>
              </defs>
              <polygon points="50,7.8 8.8,89.8 91.2,89.8" fill="url(#eyeGrad)" />
              <ellipse cx="50" cy="68.4" rx="27.3" ry="7.6" fill="#f5f8fc" />
              <circle cx="50" cy="68.4" r="8.4" fill="#18203a" />
              <circle cx="50" cy="68.4" r="7.3" fill="none" stroke="#5878dc" strokeWidth="0.6" />
              <circle cx="50" cy="68.4" r="4.2" fill="#06080f" />
              <circle cx="47.75" cy="66.15" r="1.37" fill="#fff" />
              <circle cx="51.66" cy="70.06" r="0.68" fill="#fff" />
            </svg>
          </div>
          <div className="brand-name">BIG BOSS</div>
        </div>

        <nav className="sidebar-nav">
          {TABS.map((t) => (
            <div
              key={t.key}
              className={`nav-item ${activeTab === t.key ? 'active' : ''}`}
              onClick={() => setActiveTab(t.key)}
              title={t.label}
            >
              <t.icon size={16} />
              <span>{t.label}</span>
            </div>
          ))}
        </nav>

        <div className="sidebar-section">
          <h1>Employees ({employees.length})</h1>
          {employees.length === 0 && <div className="empty">Nobody tracked under you yet — see Team &amp; Invite.</div>}
          {employees.map((u) => (
            <div
              key={u.id}
              className={`user-item ${u.id === selectedUserId ? 'selected' : ''}`}
              onClick={() => { setSelectedUserId(u.id); if (activeTab !== 'screenshots') setActiveTab('timeline'); }}
            >
              <Avatar name={u.name} size={26} />
              {u.name}
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <div className="profile-card">
            <Avatar name={user.name} size={38} />
            <div className="profile-info">
              <div className="profile-name">{user.name}</div>
              <div className="profile-role">{ROLE_LABEL[user.role] ?? user.role}</div>
            </div>
          </div>
          <button className="btn-outline profile-logout" onClick={onLogout} title="Log out">
            <LogOut size={13} /><span>Log out</span>
          </button>
          <div className="sidebar-illustration">
            <DeskIllustration />
          </div>
        </div>
      </aside>

      <main className="main">
        {activeTab === 'live' && (
          <LiveView
            managerId={supervisorId}
            onSelectMember={(id) => { setSelectedUserId(id); setActiveTab('timeline'); }}
          />
        )}
        {activeTab === 'timeline' && (
          <TimelineView selectedUserId={selectedUserId} date={date} setDate={setDate} />
        )}
        {activeTab === 'screenshots' && (
          <ScreenshotsView
            selectedUserId={selectedUserId}
            managerId={supervisorId}
            settingsUrl={`/api/supervisors/${supervisorId}/settings`}
          />
        )}
        {activeTab === 'team' && <SupervisorTeamView supervisorId={supervisorId} />}
      </main>
    </div>
  );
}
