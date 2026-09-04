import { useEffect, useState } from 'react';
import { Activity, Camera, Clock, UserPlus, Users, CalendarCheck, KanbanSquare, LogOut } from 'lucide-react';
import { todayStr } from '../format.js';
import Avatar from '../components/Avatar.jsx';
import DeskIllustration from '../components/DeskIllustration.jsx';
import LiveView from './LiveView.jsx';
import TimelineView from './TimelineView.jsx';
import ScreenshotsView from './ScreenshotsView.jsx';
import SupervisorTeamView from './SupervisorTeamView.jsx';
import SupervisorEmployeeManagementView from './SupervisorEmployeeManagementView.jsx';
import AttendanceReviewView from './AttendanceReviewView.jsx';
import SupervisorProjectsHub from './SupervisorProjectsHub.jsx';
import { LOGO_DATA_URI } from '../logo.js';
import { ROLE_LABEL } from '../roles.js';

const TABS = [
  { key: 'live', label: 'Live', icon: Activity },
  { key: 'timeline', label: 'Timeline', icon: Clock },
  { key: 'screenshots', label: 'Screenshots', icon: Camera },
  { key: 'employees', label: 'Employee Management', icon: Users },
  { key: 'projects', label: 'Projects', icon: KanbanSquare },
  { key: 'attendance', label: 'Attendance & Leave', icon: CalendarCheck },
  { key: 'team', label: 'Team & Invite', icon: UserPlus },
];

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
            <img src={LOGO_DATA_URI} alt="BIG BOSS" width="30" height="30" />
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
        {activeTab === 'employees' && <SupervisorEmployeeManagementView supervisorId={supervisorId} />}
        {activeTab === 'projects' && <SupervisorProjectsHub supervisorId={supervisorId} role={user.role} />}
        {activeTab === 'attendance' && <AttendanceReviewView managerId={supervisorId} />}
        {activeTab === 'team' && <SupervisorTeamView supervisorId={supervisorId} />}
      </main>
    </div>
  );
}
