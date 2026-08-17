import { useEffect, useState } from 'react';
import { todayStr } from '../format.js';
import LiveView from './LiveView.jsx';
import TimelineView from './TimelineView.jsx';
import ScreenshotsView from './ScreenshotsView.jsx';
import TeamView from './TeamView.jsx';
import ProjectsView from './ProjectsView.jsx';
import TimesheetReviewView from './TimesheetReviewView.jsx';
import CategoriesView from './CategoriesView.jsx';
import AttendanceReviewView from './AttendanceReviewView.jsx';

const TABS = [
  { key: 'live', label: 'Live' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'screenshots', label: 'Screenshots' },
  { key: 'projects', label: 'Projects' },
  { key: 'timesheet', label: 'Timesheet' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'categories', label: 'Categories' },
  { key: 'team', label: 'Team & Invite' },
];

export default function ManagerDashboard({ managerId, managers, onManagerChange }) {
  const [team, setTeam] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [date, setDate] = useState(todayStr());
  const [activeTab, setActiveTab] = useState('live');

  useEffect(() => {
    if (!managerId) return;
    fetch(`/api/managers/${managerId}/team`).then((r) => r.json()).then((data) => {
      setTeam(data);
      if (data.length && !data.some((u) => u.id === selectedUserId)) {
        setSelectedUserId(data[0].id);
      }
      if (data.length === 0) setSelectedUserId(null);
    });
  }, [managerId, activeTab]);

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Signed in as</h1>
        <select
          value={managerId ?? ''}
          onChange={(e) => onManagerChange(Number(e.target.value))}
          style={{ width: '100%', marginBottom: 20 }}
        >
          {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>

        <h1>Team</h1>
        {team.length === 0 && <div className="empty">Nobody has joined yet — see the Team &amp; Invite tab.</div>}
        {team.map((u) => (
          <div
            key={u.id}
            className={`user-item ${u.id === selectedUserId ? 'selected' : ''}`}
            onClick={() => setSelectedUserId(u.id)}
          >
            {u.name}
          </div>
        ))}
      </aside>

      <main className="main">
        <div className="tabs">
          {TABS.map((t) => (
            <div
              key={t.key}
              className={`tab ${activeTab === t.key ? 'active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </div>
          ))}
        </div>

        {activeTab === 'live' && (
          <LiveView
            managerId={managerId}
            onSelectMember={(id) => { setSelectedUserId(id); setActiveTab('timeline'); }}
          />
        )}
        {activeTab === 'timeline' && (
          <TimelineView selectedUserId={selectedUserId} date={date} setDate={setDate} />
        )}
        {activeTab === 'screenshots' && <ScreenshotsView selectedUserId={selectedUserId} />}
        {activeTab === 'projects' && <ProjectsView managerId={managerId} team={team} />}
        {activeTab === 'timesheet' && <TimesheetReviewView managerId={managerId} />}
        {activeTab === 'attendance' && <AttendanceReviewView managerId={managerId} />}
        {activeTab === 'categories' && <CategoriesView managerId={managerId} />}
        {activeTab === 'team' && <TeamView managerId={managerId} team={team} />}
      </main>
    </div>
  );
}
