import { useEffect, useState } from 'react';
import {
  Activity, Camera, KanbanSquare, Clock, CalendarCheck, Tags, UserPlus, LogOut, Users,
} from 'lucide-react';
import { todayStr } from '../format.js';
import Avatar from '../components/Avatar.jsx';
import DeskIllustration from '../components/DeskIllustration.jsx';
import LiveView from './LiveView.jsx';
import TimelineView from './TimelineView.jsx';
import ScreenshotsView from './ScreenshotsView.jsx';
import TeamView from './TeamView.jsx';
import ProjectsView from './ProjectsView.jsx';
import EmployeeManagementView from './EmployeeManagementView.jsx';
import CategoriesView from './CategoriesView.jsx';
import AttendanceReviewView from './AttendanceReviewView.jsx';

const TABS = [
  { key: 'live', label: 'Live', icon: Activity },
  { key: 'timeline', label: 'Timeline', icon: Clock },
  { key: 'screenshots', label: 'Screenshots', icon: Camera },
  { key: 'projects', label: 'Projects', icon: KanbanSquare },
  { key: 'employees', label: 'Employee Management', icon: Users },
  { key: 'attendance', label: 'Attendance', icon: CalendarCheck },
  { key: 'categories', label: 'Categories', icon: Tags },
  { key: 'team', label: 'Team & Invite', icon: UserPlus },
];

export default function ManagerDashboard({ manager, onLogout }) {
  const managerId = manager.id;
  const [team, setTeam] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [date, setDate] = useState(todayStr());
  const [activeTab, setActiveTab] = useState('live');

  function loadTeam() {
    fetch(`/api/managers/${managerId}/team`).then((r) => r.json()).then((data) => {
      setTeam(data);
      if (data.length && !data.some((u) => u.id === selectedUserId)) {
        setSelectedUserId(data[0].id);
      }
      if (data.length === 0) setSelectedUserId(null);
    });
  }

  useEffect(loadTeam, [managerId, activeTab]);

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
          <h1>Team ({team.length})</h1>
          {team.length === 0 && <div className="empty">Nobody has joined yet — see the Team &amp; Invite tab.</div>}
          {team.map((u) => (
            <div
              key={u.id}
              className={`user-item ${u.id === selectedUserId ? 'selected' : ''}`}
              onClick={() => setSelectedUserId(u.id)}
            >
              <Avatar name={u.name} size={26} />
              {u.name}
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <div className="profile-card">
            <Avatar name={manager.name} size={38} />
            <div className="profile-info">
              <div className="profile-name">{manager.name}</div>
              <div className="profile-role">Manager</div>
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
            managerId={managerId}
            onSelectMember={(id) => { setSelectedUserId(id); setActiveTab('timeline'); }}
          />
        )}
        {activeTab === 'timeline' && (
          <TimelineView selectedUserId={selectedUserId} date={date} setDate={setDate} />
        )}
        {activeTab === 'screenshots' && <ScreenshotsView selectedUserId={selectedUserId} managerId={managerId} />}
        {activeTab === 'projects' && <ProjectsView managerId={managerId} team={team} />}
        {activeTab === 'employees' && <EmployeeManagementView managerId={managerId} managerName={manager.name} team={team} onTeamChanged={loadTeam} />}
        {activeTab === 'attendance' && <AttendanceReviewView managerId={managerId} />}
        {activeTab === 'categories' && <CategoriesView managerId={managerId} />}
        {activeTab === 'team' && <TeamView managerId={managerId} />}
      </main>
    </div>
  );
}
